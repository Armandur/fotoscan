import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import FaceRegion, Photo, Tag
from app.deps import get_db
from app.routes.persons import _avatar_region_id
from app.routes.photos import _get_or_create_tag
from app.schemas import ConfirmFace, FaceBox, FaceRegionIn
from app.services.scanner import (
    face_thumb_path, invalidate_face_thumb, load_oriented,
)

router = APIRouter()

_UNKNOWN_RE = re.compile(r"^Okänd-(\d+)$")


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def _serialize(f: FaceRegion) -> dict:
    return {
        "id": f.id, "person": f.tag.name if f.tag else None,
        "person_id": f.tag_id,
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
        like = f"%{q}%"
        query = query.filter(or_(Tag.name.ilike(like), Tag.aliases.ilike(like)))

    result = []
    for tag in query.order_by(Tag.name).all():
        count = (
            db.query(FaceRegion)
            .filter(FaceRegion.tag_id == tag.id, FaceRegion.confirmed == 1)
            .count()
        )
        result.append({
            "id": tag.id,
            "name": tag.name,
            "count": count,
            "region_id": _avatar_region_id(db, tag),
        })
    return result


@router.get("/api/photos/{photo_id}/faces")
def list_faces(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    # Bara bekräftade rutor visas i detaljvyn; AI-förslag hanteras i granskningskön.
    return [_serialize(f) for f in photo.faces if f.confirmed]


@router.post("/api/photos/{photo_id}/faces")
def add_face(
    photo_id: int, data: FaceRegionIn, db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    # Tomt namn -> skapa en platshållarperson "Okänd-N" att komplettera senare.
    is_placeholder = not data.person.strip()
    name = data.person.strip() or _next_unknown_name(db)
    tag = _get_or_create_tag(db, name, "person")
    if is_placeholder:
        tag.placeholder = 1
    face = FaceRegion(
        photo_id=photo_id, tag_id=tag.id,
        x=_clamp(data.x), y=_clamp(data.y),
        w=_clamp(data.w), h=_clamp(data.h),
        source="manual", confirmed=1,
    )
    db.add(face)
    # En markerad person finns i bilden -> lägg även till i fotots Personer-fält.
    if tag not in photo.tags:
        photo.tags.append(tag)
    db.commit()
    db.refresh(face)
    return JSONResponse(_serialize(face))


@router.post("/api/faces/{region_id}/move")
def move_face(region_id: int, data: FaceBox, db: Session = Depends(get_db)):
    face = db.get(FaceRegion, region_id)
    if not face:
        raise HTTPException(404, "Region hittades inte")
    face.x, face.y = _clamp(data.x), _clamp(data.y)
    face.w, face.h = _clamp(data.w), _clamp(data.h)
    db.commit()
    db.refresh(face)
    invalidate_face_thumb(region_id)  # crop ändrades
    return JSONResponse(_serialize(face))


@router.post("/api/faces/{region_id}/person")
def set_face_person(region_id: int, data: ConfirmFace, db: Session = Depends(get_db)):
    """Byt person på en befintlig ruta (utan att ta bort + lägga till). Body som
    ConfirmFace: tag_id, name (skapas vid behov) eller unidentified (Okänd-N).
    Städar gamla personen ur fotots Personer-fält om den inte har fler rutor där,
    och rapporterar om den blev helt oanvänd (för att kunna erbjuda borttag)."""
    face = db.get(FaceRegion, region_id)
    if not face:
        raise HTTPException(404, "Region hittades inte")
    photo = face.photo
    old_tag = face.tag

    if data.unidentified:
        new_tag = _get_or_create_tag(db, _next_unknown_name(db), "person")
        new_tag.placeholder = 1
    elif data.tag_id:
        new_tag = db.get(Tag, data.tag_id)
        if not new_tag or new_tag.kind != "person":
            raise HTTPException(400, "Ogiltig person")
    elif data.name.strip():
        new_tag = _get_or_create_tag(db, data.name.strip(), "person")
        new_tag.placeholder = 0
    else:
        raise HTTPException(400, "Ange en person")

    if old_tag and old_tag.id == new_tag.id:
        return JSONResponse({"ok": True, "person": {"id": new_tag.id, "name": new_tag.name}, "old": None})

    face.tag_id = new_tag.id
    face.confirmed = 1
    face.suggested_tag_id = None
    if new_tag not in photo.tags:
        photo.tags.append(new_tag)
    db.flush()

    old = None
    if old_tag:
        remaining_here = (
            db.query(FaceRegion)
            .filter(FaceRegion.photo_id == photo.id, FaceRegion.tag_id == old_tag.id)
            .count()
        )
        if remaining_here == 0 and old_tag in photo.tags:
            photo.tags.remove(old_tag)
        db.flush()
        total = db.query(FaceRegion).filter(FaceRegion.tag_id == old_tag.id).count()
        orphaned = total == 0 and len(old_tag.photos) == 0
        old = {"id": old_tag.id, "name": old_tag.name, "orphaned": orphaned}
    db.commit()
    return JSONResponse({
        "ok": True,
        "person": {"id": new_tag.id, "name": new_tag.name},
        "old": old,
    })


@router.delete("/api/faces/{region_id}")
def delete_face(region_id: int, db: Session = Depends(get_db)):
    face = db.get(FaceRegion, region_id)
    if not face:
        raise HTTPException(404, "Region hittades inte")
    tag = face.tag
    photo = face.photo
    db.delete(face)
    db.flush()
    invalidate_face_thumb(region_id)

    person = None
    if tag is not None:
        # Om personen inte har någon kvarvarande ruta på detta foto, ta även bort
        # personen ur fotots Personer-fält (taggades dit när rutan skapades).
        remaining_here = (
            db.query(FaceRegion)
            .filter(FaceRegion.photo_id == photo.id, FaceRegion.tag_id == tag.id)
            .count()
        )
        if remaining_here == 0 and tag in photo.tags:
            photo.tags.remove(tag)
        db.flush()

        # Är personen nu helt oanvänd (inga rutor, inga foton)? Då kan den städas bort.
        total_faces = db.query(FaceRegion).filter(FaceRegion.tag_id == tag.id).count()
        orphaned = total_faces == 0 and len(tag.photos) == 0
        person = {"id": tag.id, "name": tag.name, "orphaned": orphaned}
    db.commit()
    return JSONResponse({"ok": True, "person": person})


@router.get("/api/faces/{region_id}/thumb")
def face_thumb(region_id: int, db: Session = Depends(get_db)):
    # Cachad crop (per region) - undviker att öppna+orientera originalet varje
    # gång (segt på /persons med många ansikten). Invalideras vid flytt/rotation.
    cache = face_thumb_path(region_id)
    if cache.exists():
        return FileResponse(cache)
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
    crop.thumbnail((256, 256))
    crop.save(cache, "JPEG", quality=82)
    return FileResponse(cache)
