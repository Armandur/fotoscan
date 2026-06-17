from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import Album, AlbumPhoto, Photo
from app.deps import get_db
from app.schemas import AlbumPhotosIn, NameIn, ReorderRequest, SectionIn
from app.services.pdf_album import render_album_pdf

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


@router.get("/albums/{album_id}/pdf")
def album_pdf(
    album_id: int, layout: int = 4, fields: str = "date,place,persons",
    subtitle: str = "", db: Session = Depends(get_db),
):
    """Generera och ladda ner albumet som PDF. layout = bilder per A4 (1/2/4/6),
    fields = kommaseparerade bildtextfält."""
    album = db.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Albumet hittades inte")
    field_list = [f for f in fields.split(",") if f]
    pdf = render_album_pdf(album, layout, field_list, subtitle.strip())
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
