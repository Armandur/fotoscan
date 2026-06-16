import io
from pathlib import Path

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
from app.schemas import PhotoUpdate
from app.services.scanner import load_oriented, make_thumbnail

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

PAGE_SIZE = 60


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    db: Session = Depends(get_db),
    q: str = "",
    filter: str = "all",
    page: int = 1,
):
    query = db.query(Photo)

    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Photo.filename.ilike(like),
                Photo.location.ilike(like),
                Photo.notes.ilike(like),
                Photo.date_text.ilike(like),
                Photo.source.ilike(like),
            )
        )

    if filter == "unreviewed":
        query = query.filter(Photo.reviewed_at.is_(None))
    elif filter == "reviewed":
        query = query.filter(Photo.reviewed_at.isnot(None))

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

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "photos": photos,
            "q": q,
            "filter": filter,
            "page": page,
            "pages": pages,
            "total": total,
            "total_all": total_all,
            "reviewed": reviewed,
        },
    )


def _ordered_ids(db: Session) -> list[int]:
    """Foto-id i samma ordning som galleriet (för prev/next-navigering)."""
    rows = (
        db.query(Photo.id)
        .order_by(Photo.date_year.is_(None), Photo.date_year, Photo.filename)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/photo/{photo_id}", response_class=HTMLResponse)
def photo_detail(photo_id: int, request: Request, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    ids = _ordered_ids(db)
    prev_id = next_id = None
    pos = total = len(ids)
    if photo_id in ids:
        i = ids.index(photo_id)
        pos = i + 1
        prev_id = ids[i - 1] if i > 0 else None
        next_id = ids[i + 1] if i < len(ids) - 1 else None

    return templates.TemplateResponse(
        request,
        "photo.html",
        {
            "photo": photo,
            "prev_id": prev_id,
            "next_id": next_id,
            "pos": pos,
            "total": total,
        },
    )


@router.get("/thumb/{photo_id}")
def thumb(photo_id: int):
    path = THUMB_DIR / f"{photo_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "Thumbnail saknas")
    return FileResponse(path)


@router.get("/image/{photo_id}")
def image(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo or not Path(photo.path).exists():
        raise HTTPException(404, "Bildfil saknas")
    # Utan rotation: servera originalfilen direkt. Med rotation: rotera on-the-fly
    # så att originalet på disk förblir orört.
    if not photo.rotation:
        return FileResponse(photo.path)
    img = load_oriented(Path(photo.path), photo.rotation)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")


@router.post("/api/photos/{photo_id}/rotate")
def rotate_photo(
    photo_id: int, dir: str = "cw", db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    step = 90 if dir == "cw" else -90
    photo.rotation = ((photo.rotation or 0) + step) % 360
    db.commit()
    if Path(photo.path).exists():
        make_thumbnail(Path(photo.path), photo.id, photo.rotation)
    return JSONResponse({"ok": True, "rotation": photo.rotation})


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
    photo.date_year = data.date_year
    photo.location = data.location.strip()
    photo.notes = data.notes.strip()
    photo.source = data.source.strip()

    photo.tags = [
        _get_or_create_tag(db, t.name, t.kind)
        for t in data.tags
        if t.name.strip()
    ]

    if data.mark_reviewed:
        photo.reviewed_at = _now()

    db.commit()
    return JSONResponse({"ok": True})
