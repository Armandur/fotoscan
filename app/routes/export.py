from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import Photo
from app.deps import get_db
from app.services.exporter import (
    exiftool_available, export_many, export_with_pair,
)

router = APIRouter()


@router.post("/api/photos/{photo_id}/export")
def export_one(photo_id: int, db: Session = Depends(get_db)):
    if not exiftool_available():
        raise HTTPException(503, "exiftool är inte installerat på servern")
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    try:
        paths = export_with_pair(db, photo)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    return JSONResponse({"ok": True, "paths": [str(p) for p in paths]})


@router.post("/api/export")
def export_all(only_reviewed: bool = True, db: Session = Depends(get_db)):
    if not exiftool_available():
        raise HTTPException(503, "exiftool är inte installerat på servern")
    result = export_many(db, only_reviewed=only_reviewed)
    return JSONResponse(result)
