import io
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.database import FaceRegion, Photo, Tag
from app.deps import get_db
from app.routes.photos import _get_or_create_tag
from app.schemas import FaceRegionIn
from app.services.scanner import load_oriented

router = APIRouter()

_UNKNOWN_RE = re.compile(r"^Okänd-(\d+)$")


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def _serialize(f: FaceRegion) -> dict:
    return {
        "id": f.id, "person": f.tag.name,
        "x": f.x, "y": f.y, "w": f.w, "h": f.h,
    }


def _next_unknown_name(db: Session) -> str:
    """Nästa lediga 'Okänd-N' bland personer (för ansikten utan känt namn)."""
    highest = 0
    for (name,) in db.query(Tag.name).filter(Tag.kind == "person").all():
        m = _UNKNOWN_RE.match(name)
        if m:
            highest = max(highest, int(m.group(1)))
    return f"Okänd-{highest + 1}"


@router.get("/api/persons")
def list_persons(q: str = "", db: Session = Depends(get_db)):
    """Personer för ansiktssökning, med antal taggade ansikten och ett
    representativt region-id (för thumbnail)."""
    query = db.query(Tag).filter(Tag.kind == "person")
    if q:
        query = query.filter(Tag.name.ilike(f"%{q}%"))

    result = []
    for tag in query.order_by(Tag.name).all():
        faces = (
            db.query(FaceRegion)
            .filter(FaceRegion.tag_id == tag.id)
            .order_by(FaceRegion.id.desc())
            .all()
        )
        result.append({
            "name": tag.name,
            "count": len(faces),
            "region_id": faces[0].id if faces else None,
        })
    return result


@router.get("/api/photos/{photo_id}/faces")
def list_faces(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    return [_serialize(f) for f in photo.faces]


@router.post("/api/photos/{photo_id}/faces")
def add_face(
    photo_id: int, data: FaceRegionIn, db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    # Tomt namn -> skapa en platshållarperson "Okänd-N" att komplettera senare.
    name = data.person.strip() or _next_unknown_name(db)
    tag = _get_or_create_tag(db, name, "person")
    face = FaceRegion(
        photo_id=photo_id, tag_id=tag.id,
        x=_clamp(data.x), y=_clamp(data.y),
        w=_clamp(data.w), h=_clamp(data.h),
    )
    db.add(face)
    db.commit()
    db.refresh(face)
    return JSONResponse(_serialize(face))


@router.delete("/api/faces/{region_id}")
def delete_face(region_id: int, db: Session = Depends(get_db)):
    face = db.get(FaceRegion, region_id)
    if not face:
        raise HTTPException(404, "Region hittades inte")
    db.delete(face)
    db.commit()
    return JSONResponse({"ok": True})


@router.get("/api/faces/{region_id}/thumb")
def face_thumb(region_id: int, db: Session = Depends(get_db)):
    face = db.get(FaceRegion, region_id)
    if not face:
        raise HTTPException(404, "Region hittades inte")
    photo = face.photo
    src = Path(photo.path)
    if not src.exists():
        raise HTTPException(404, "Bildfil saknas")

    img = load_oriented(src, photo.rotation)
    w, h = img.size
    box = (
        int(face.x * w), int(face.y * h),
        max(int((face.x + face.w) * w), int(face.x * w) + 1),
        max(int((face.y + face.h) * h), int(face.y * h) + 1),
    )
    crop = img.crop(box)
    crop.thumbnail((96, 96))
    buf = io.BytesIO()
    crop.save(buf, "JPEG", quality=80)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")
