import io
from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, StreamingResponse,
)
from fastapi.templating import Jinja2Templates
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import BASE_DIR, THUMB_DIR
from app.database import Photo, Tag
from app.database import _now
from app.deps import get_db
from app.schemas import BatchUpdate, PhotoAdjust, PhotoUpdate
from app.services.adjust import has_adjustments, suggest_auto
from app.services.dates import parse_date_text
from app.services.scanner import (
    load_oriented, render_cache_path, refresh_derived, write_render,
)

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

PAGE_SIZE = 60


def _filtered_query(
    db: Session, q: str, reviewed: str, ptype: str, paired: str,
    folder: str, recursive: bool = False, separate: bool = False,
):
    """Bygg Photo-query enligt galleriets sök/filter/mapp-parametrar.

    reviewed: ""|"yes"|"no", ptype: ""|"negative"|"photo", paired: ""|"yes"|"no".
    Dimensionerna AND:as. recursive=True inkluderar undermappar till `folder`.
    separate=False döljer sekundären i hopparade par (visar bara primären).
    """
    query = db.query(Photo)
    # Gruppera hopparade: dölj sekundären (negativet) om vi inte separerar.
    if not separate:
        query = query.filter(
            or_(Photo.paired_with_id.is_(None), Photo.is_pair_primary == 1)
        )
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Photo.filename.ilike(like),
                Photo.folder.ilike(like),
                Photo.location.ilike(like),
                Photo.notes.ilike(like),
                Photo.date_text.ilike(like),
                Photo.source.ilike(like),
            )
        )
    if reviewed == "yes":
        query = query.filter(Photo.reviewed_at.isnot(None))
    elif reviewed == "no":
        query = query.filter(Photo.reviewed_at.is_(None))
    if ptype == "negative":
        query = query.filter(Photo.is_negative == 1)
    elif ptype == "photo":
        query = query.filter(Photo.is_negative == 0)
    if paired == "yes":
        query = query.filter(Photo.paired_with_id.isnot(None))
    elif paired == "no":
        query = query.filter(Photo.paired_with_id.is_(None))
    # folder == "*" betyder alla mappar; "" är rotmappen.
    if folder != "*":
        if recursive:
            # "" + rekursivt = allt. Annars mappen själv + dess undermappar.
            if folder != "":
                query = query.filter(
                    or_(Photo.folder == folder, Photo.folder.like(f"{folder}/%"))
                )
        else:
            query = query.filter(Photo.folder == folder)
    return query


def _build_folder_tree(folders: list[str]) -> list[dict]:
    """Bygg en nästlad trädstruktur av distinkta mappsökvägar (posix)."""
    root: dict = {}
    for f in folders:
        if not f:
            continue
        level = root
        path = ""
        for part in f.split("/"):
            path = part if not path else f"{path}/{part}"
            node = level.setdefault(part, {"path": path, "children": {}})
            level = node["children"]

    def to_list(d: dict) -> list[dict]:
        return [
            {"name": name, "path": data["path"], "children": to_list(data["children"])}
            for name, data in sorted(d.items(), key=lambda kv: kv[0].lower())
        ]
    return to_list(root)


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    db: Session = Depends(get_db),
    q: str = "",
    reviewed: str = "",
    ptype: str = "",
    paired: str = "",
    folder: str = "*",
    recursive: bool = False,
    separate: bool = False,
    page: int = 1,
):
    query = _filtered_query(db, q, reviewed, ptype, paired, folder, recursive, separate)

    total = query.count()
    page = max(1, page)
    photos = (
        query.order_by(Photo.date_year.is_(None), Photo.date_year, Photo.filename)
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .all()
    )
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)

    total_all = db.query(Photo).count()
    reviewed = db.query(Photo).filter(Photo.reviewed_at.isnot(None)).count()

    # Distinkta undermappar -> nästlat träd. None hoppas över.
    folders = [
        row[0]
        for row in db.query(Photo.folder).distinct().order_by(Photo.folder).all()
        if row[0] is not None
    ]
    folder_tree = _build_folder_tree(folders)
    has_root_photos = "" in folders

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "photos": photos,
            "q": q,
            "reviewed": reviewed,
            "ptype": ptype,
            "paired": paired,
            "folder": folder,
            "recursive": recursive,
            "separate": separate,
            "folder_tree": folder_tree,
            "has_root_photos": has_root_photos,
            "page": page,
            "pages": pages,
            "total": total,
            "total_all": total_all,
            "reviewed": reviewed,
        },
    )


@router.post("/api/photos/batch")
def batch_update(data: BatchUpdate, db: Session = Depends(get_db)):
    if data.use_filter:
        photos = _filtered_query(
            db, data.q, data.reviewed, data.ptype, data.paired,
            data.folder, data.recursive, data.separate,
        ).all()
    elif data.ids:
        photos = db.query(Photo).filter(Photo.id.in_(data.ids)).all()
    else:
        return JSONResponse({"ok": True, "count": 0})

    now = _now()
    for p in photos:
        if data.is_negative is not None:
            p.is_negative = 1 if data.is_negative else 0
        if data.reviewed is not None:
            p.reviewed_at = now if data.reviewed else None
    db.commit()
    return JSONResponse({"ok": True, "count": len(photos)})


def _ordered_ids(db, q, reviewed, ptype, paired, folder, recursive, separate) -> list[int]:
    """Foto-id i galleriets ordning för given filtrering (för prev/next-nav)."""
    rows = (
        _filtered_query(db, q, reviewed, ptype, paired, folder, recursive, separate)
        .with_entities(Photo.id)
        .order_by(Photo.date_year.is_(None), Photo.date_year, Photo.filename)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/photo/{photo_id}", response_class=HTMLResponse)
def photo_detail(
    photo_id: int, request: Request,
    q: str = "", reviewed: str = "", ptype: str = "", paired: str = "",
    folder: str = "*", recursive: bool = False, separate: bool = False,
    db: Session = Depends(get_db),
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    # Navigera inom samma filtrering man kom ifrån. Om fotot inte ingår i den
    # (t.ex. direktlänk eller dolt sekundär-negativ), falla tillbaka.
    ids = _ordered_ids(db, q, reviewed, ptype, paired, folder, recursive, separate)
    if photo_id not in ids:
        ids = _ordered_ids(db, "", "", "", "", "*", False, True)

    prev_id = next_id = None
    pos = total = len(ids)
    if photo_id in ids:
        i = ids.index(photo_id)
        pos = i + 1
        prev_id = ids[i - 1] if i > 0 else None
        next_id = ids[i + 1] if i < len(ids) - 1 else None

    # Querystring som bär filterkontexten vidare i prev/next/galleri-länkar.
    params = {}
    if q:
        params["q"] = q
    if reviewed:
        params["reviewed"] = reviewed
    if ptype:
        params["ptype"] = ptype
    if paired:
        params["paired"] = paired
    if folder and folder != "*":
        params["folder"] = folder
    if recursive:
        params["recursive"] = "1"
    if separate:
        params["separate"] = "1"
    nav_qs = ("?" + urlencode(params)) if params else ""

    paired = db.get(Photo, photo.paired_with_id) if photo.paired_with_id else None

    return templates.TemplateResponse(
        request,
        "photo.html",
        {
            "photo": photo,
            "paired": paired,
            "prev_id": prev_id,
            "next_id": next_id,
            "pos": pos,
            "total": total,
            "nav_qs": nav_qs,
        },
    )


@router.get("/thumb/{photo_id}")
def thumb(photo_id: int):
    path = THUMB_DIR / f"{photo_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "Thumbnail saknas")
    return FileResponse(path)


@router.get("/image/{photo_id}")
def image(photo_id: int, raw: bool = False, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo or not Path(photo.path).exists():
        raise HTTPException(404, "Bildfil saknas")
    # raw=1: orienterad/roterad men UTAN färgjusteringar (för live-preview),
    # renderas on-the-fly och cachas inte.
    if raw:
        if not photo.rotation:
            return FileResponse(photo.path)
        img = load_oriented(Path(photo.path), photo.rotation)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/jpeg")

    # Inga transformeringar: servera originalet direkt.
    if not photo.rotation and not has_adjustments(photo):
        return FileResponse(photo.path)

    # Annars: servera den cachade renderingen (skapa den vid första visning).
    cache = render_cache_path(photo.id)
    if not cache.exists():
        write_render(photo)
    return FileResponse(cache)


@router.post("/api/photos/{photo_id}/rotate")
def rotate_photo(
    photo_id: int, dir: str = "cw", db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    step = 90 if dir == "cw" else -90
    photo.rotation = ((photo.rotation or 0) + step) % 360
    # Transformera ansiktsregionerna så de följer med bilden (normaliserade
    # koordinater relativt den visade bilden). x/y = övre vänstra hörnet.
    for f in photo.faces:
        if dir == "cw":
            f.x, f.y, f.w, f.h = 1 - f.y - f.h, f.x, f.h, f.w
        else:
            f.x, f.y, f.w, f.h = f.y, 1 - f.x - f.w, f.h, f.w
    db.commit()
    if Path(photo.path).exists():
        refresh_derived(photo)
    return JSONResponse({"ok": True, "rotation": photo.rotation})


@router.get("/api/photos/{photo_id}/auto-suggest")
def auto_suggest(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    if not Path(photo.path).exists():
        raise HTTPException(404, "Bildfil saknas")
    # Analysera basbilden (orienterad/roterad, utan tidigare färgjusteringar).
    img = load_oriented(Path(photo.path), photo.rotation or 0)
    return JSONResponse(suggest_auto(img))


@router.post("/api/photos/{photo_id}/adjust")
def adjust_photo(
    photo_id: int, data: PhotoAdjust, db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    photo.auto_tone = 1 if data.auto_tone else 0
    photo.adj_brightness = data.adj_brightness
    photo.adj_contrast = data.adj_contrast
    photo.adj_gamma = data.adj_gamma
    photo.adj_saturation = data.adj_saturation
    photo.adj_red = data.adj_red
    photo.adj_green = data.adj_green
    photo.adj_blue = data.adj_blue
    db.commit()
    if Path(photo.path).exists():
        refresh_derived(photo)
    return JSONResponse({"ok": True})


# Metadata som delas inom en hopparning (foto + negativ = en kombination).
# Per-bild-fält (is_negative, rotation, justeringar, exif_datetime, bildfilen)
# delas INTE.
_SHARED_META = [
    "date_text", "date_year", "date_month", "date_precision",
    "location", "notes", "source", "gps_lat", "gps_lon", "gps_radius_m",
    "reviewed_at",
]


def _sync_pair_metadata(db: Session, photo: Photo) -> None:
    """Spegla delad metadata + taggar till det hopparade fotot, så att en
    hopparning beter sig som en kombination (redigera en -> uppdaterar båda)."""
    if not photo.paired_with_id:
        return
    partner = db.get(Photo, photo.paired_with_id)
    if not partner:
        return
    for f in _SHARED_META:
        setattr(partner, f, getattr(photo, f))
    partner.tags = list(photo.tags)


def _get_or_create_tag(db: Session, name: str, kind: str) -> Tag:
    name = name.strip()
    tag = (
        db.query(Tag)
        .filter(Tag.name == name, Tag.kind == kind)
        .first()
    )
    if not tag:
        tag = Tag(name=name, kind=kind)
        db.add(tag)
        db.flush()
    return tag


@router.post("/api/photos/{photo_id}")
def update_photo(
    photo_id: int, data: PhotoUpdate, db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    photo.date_text = data.date_text.strip()
    # Härled år/månad/precision ur fritexten.
    photo.date_year, photo.date_month, photo.date_precision = parse_date_text(photo.date_text)
    photo.location = data.location.strip()
    photo.notes = data.notes.strip()
    photo.source = data.source.strip()
    photo.is_negative = 1 if data.is_negative else 0
    photo.gps_lat = data.gps_lat
    photo.gps_lon = data.gps_lon
    photo.gps_radius_m = data.gps_radius_m

    photo.tags = [
        _get_or_create_tag(db, t.name, t.kind)
        for t in data.tags
        if t.name.strip()
    ]

    if data.mark_reviewed:
        photo.reviewed_at = _now()

    _sync_pair_metadata(db, photo)
    db.commit()
    return JSONResponse({"ok": True})
