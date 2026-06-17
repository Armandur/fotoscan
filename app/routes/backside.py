from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import Photo
from app.deps import get_db
from app.schemas import BackLink

router = APIRouter()


def _brief(p: Photo) -> dict:
    return {
        "id": p.id,
        "filename": p.filename,
        "folder": p.folder,
        "is_negative": bool(p.is_negative),
    }


@router.get("/api/photos/{photo_id}/back-candidates")
def back_candidates(
    photo_id: int, q: str = "", offset: int = 0, limit: int = 60,
    db: Session = Depends(get_db),
):
    """Foton som kan kopplas som baksida: inte fotot självt, inte redan en
    baksida till något, och inte fotots ev. hopparade partner."""
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    query = db.query(Photo).filter(
        Photo.id != photo_id,
        Photo.back_of_id.is_(None),
    )
    if photo.paired_with_id:
        query = query.filter(Photo.id != photo.paired_with_id)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            Photo.filename.ilike(like),
            Photo.folder.ilike(like),
        ))
    photos = (
        query.order_by(Photo.folder, Photo.filename)
        .offset(max(0, offset)).limit(min(limit, 200)).all()
    )
    return [_brief(p) for p in photos]


@router.post("/api/photos/{photo_id}/back")
def set_back(photo_id: int, data: BackLink, db: Session = Depends(get_db)):
    front = db.get(Photo, photo_id)
    back = db.get(Photo, data.other_id)
    if not front or not back:
        raise HTTPException(404, "Foto hittades inte")
    if front.id == back.id:
        raise HTTPException(400, "Ett foto kan inte vara sin egen baksida")
    if back.back_of_id and back.back_of_id != front.id:
        raise HTTPException(400, "Bilden är redan baksida till ett annat foto")
    back.back_of_id = front.id
    db.commit()
    return JSONResponse({"ok": True, "back_id": back.id})


@router.delete("/api/photos/{photo_id}/back")
def unlink_back(photo_id: int, db: Session = Depends(get_db)):
    """Koppla loss baksidan/baksidorna från fotot (front-perspektiv)."""
    backs = db.query(Photo).filter(Photo.back_of_id == photo_id).all()
    for b in backs:
        b.back_of_id = None
    db.commit()
    return JSONResponse({"ok": True, "count": len(backs)})
