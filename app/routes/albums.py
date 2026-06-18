from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import Album, AlbumPhoto, Photo
from app.deps import get_db
from app.schemas import (
    AlbumPhotosIn, AlbumSettingsIn, CaptionIn, CoverIn, NameIn, ReorderRequest,
    SectionIn,
)
from app.services.pdf_album import (
    build_pages, caption_lines, entry_caption_fields, render_album_pdf,
)

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V


def _next_position(db: Session, album_id: int) -> int:
    m = (
        db.query(func.max(AlbumPhoto.position))
        .filter(AlbumPhoto.album_id == album_id)
        .scalar()
    )
    return (m + 1) if m is not None else 0


@router.get("/albums", response_class=HTMLResponse)
def albums_page(request: Request, db: Session = Depends(get_db)):
    rows = []
    for album in db.query(Album).order_by(Album.name).all():
        entries = album.entries
        rows.append({
            "id": album.id,
            "name": album.name,
            "count": len(entries),
            "cover": entries[0].photo_id if entries else None,
        })
    return templates.TemplateResponse(request, "albums.html", {"albums": rows})


@router.get("/albums/{album_id}", response_class=HTMLResponse)
def album_detail(album_id: int, request: Request, db: Session = Depends(get_db)):
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    # entries är ordnade på position; bär foto + ev. avsnittsstart.
    return templates.TemplateResponse(
        request, "album_detail.html", {"album": album, "entries": album.entries},
    )


@router.get("/albums/{album_id}/layout", response_class=HTMLResponse)
def album_layout(album_id: int, request: Request, db: Session = Depends(get_db)):
    """WYSIWYG-layoutvy: sidor löpande (som PDF:en) + avsnittshantering."""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    fields = [f for f in (album.caption_fields or "").split(",") if f]
    pages = []
    for p in build_pages(album, album.layout or 4):
        cells = []
        for e in p["entries"]:
            ef = entry_caption_fields(e, fields)
            cells.append({
                "id": e.photo.id,
                "lines": caption_lines(e.photo, ef),
                "uses_default": e.caption_fields is None,
                "fields": ef,
                "section_heading": e.section_heading,
                "section_layout": e.section_layout,
            })
        pages.append({
            "heading": p["heading"],
            "layout": p["layout"],
            "first_id": p["entries"][0].photo.id if p["entries"] else None,
            "cells": cells,
        })
    return templates.TemplateResponse(
        request, "album_layout.html",
        {"album": album, "pages": pages, "fields": fields},
    )


@router.post("/api/albums/{album_id}/settings")
def album_settings(album_id: int, data: AlbumSettingsIn, db: Session = Depends(get_db)):
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    if data.layout in (1, 2, 4, 6):
        album.layout = data.layout
    album.subtitle = data.subtitle.strip()
    album.caption_fields = ",".join(
        f for f in data.caption_fields.split(",") if f
    )
    db.commit()
    return JSONResponse({"ok": True})


@router.get("/albums/{album_id}/pdf")
def album_pdf(
    album_id: int, layout: int | None = None, fields: str | None = None,
    subtitle: str | None = None, db: Session = Depends(get_db),
):
    """Generera och ladda ner albumet som PDF. Saknade parametrar tas från
    albumets sparade inställningar (så PDF:en matchar layoutvyn)."""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    lay = layout if layout in (1, 2, 4, 6) else (album.layout or 4)
    fields_str = fields if fields is not None else (album.caption_fields or "")
    field_list = [f for f in fields_str.split(",") if f]
    sub = (subtitle if subtitle is not None else (album.subtitle or "")).strip()
    pdf = render_album_pdf(album, lay, field_list, sub)
    fname = quote(f"{album.name}.pdf")
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )


@router.get("/api/albums")
def list_albums_api(db: Session = Depends(get_db)):
    return [
        {"id": a.id, "name": a.name, "count": len(a.entries)}
        for a in db.query(Album).order_by(Album.name).all()
    ]


@router.post("/api/albums/create")
def create_album(data: NameIn, db: Session = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Ange ett namn")
    album = Album(name=name)
    db.add(album)
    db.commit()
    return JSONResponse({"ok": True, "id": album.id})


@router.post("/api/albums/{album_id}/rename")
def rename_album(album_id: int, data: NameIn, db: Session = Depends(get_db)):
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Ange ett namn")
    album.name = name
    db.commit()
    return JSONResponse({"ok": True, "name": name})


@router.delete("/api/albums/{album_id}")
def delete_album(album_id: int, db: Session = Depends(get_db)):
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    db.delete(album)  # entries städas via cascade
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/albums/{album_id}/photos")
def add_photos(album_id: int, data: AlbumPhotosIn, db: Session = Depends(get_db)):
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    existing = {e.photo_id for e in album.entries}
    pos = _next_position(db, album_id)
    added = 0
    for pid in data.photo_ids:
        if pid in existing or not db.get(Photo, pid):
            continue
        db.add(AlbumPhoto(album_id=album_id, photo_id=pid, position=pos))
        existing.add(pid)
        pos += 1
        added += 1
    db.commit()
    return JSONResponse({"ok": True, "added": added})


@router.delete("/api/albums/{album_id}/photos/{photo_id}")
def remove_photo(album_id: int, photo_id: int, db: Session = Depends(get_db)):
    entry = db.get(AlbumPhoto, (album_id, photo_id))
    if entry:
        db.delete(entry)
        db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/albums/{album_id}/photos/{photo_id}/section")
def set_section(
    album_id: int, photo_id: int, data: SectionIn, db: Session = Depends(get_db)
):
    """Sätt/ta bort en avsnittsstart på ett foto i albumet. Tom rubrik tar bort."""
    entry = db.get(AlbumPhoto, (album_id, photo_id))
    if not entry:
        raise HTTPException(404, "Fotot finns inte i albumet")
    heading = data.heading.strip()
    entry.section_heading = heading or None
    entry.section_layout = data.layout if heading else None
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/albums/{album_id}/cover")
def set_cover(album_id: int, data: CoverIn, db: Session = Depends(get_db)):
    """Välj (eller rensa) titelsidesbild för albumet."""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    album.cover_photo_id = data.photo_id
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/albums/{album_id}/photos/{photo_id}/caption")
def set_caption(
    album_id: int, photo_id: int, data: CaptionIn, db: Session = Depends(get_db)
):
    """Per-foto bildtextfält i albumet. use_default = följ albumets standard."""
    entry = db.get(AlbumPhoto, (album_id, photo_id))
    if not entry:
        raise HTTPException(404, "Fotot finns inte i albumet")
    if data.use_default:
        entry.caption_fields = None
    else:
        entry.caption_fields = ",".join(f for f in data.fields.split(",") if f)
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/albums/{album_id}/reorder")
def reorder_album(album_id: int, data: ReorderRequest, db: Session = Depends(get_db)):
    if not db.get(Album, album_id):
        raise HTTPException(404, "Albumet hittades inte")
    for i, pid in enumerate(data.ids):
        entry = db.get(AlbumPhoto, (album_id, pid))
        if entry:
            entry.position = i
    db.commit()
    return JSONResponse({"ok": True, "count": len(data.ids)})
