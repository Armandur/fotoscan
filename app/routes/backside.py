import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import Photo
from app.deps import get_db
from app.schemas import BackLink, BackPairs

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V


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


def _natural_key(name: str) -> list:
    """Sorteringsnyckel som liknar Windows Utforskaren: skiftlägesokänslig och
    siffergrupper jämförs som tal (2.jpg före 10.jpg)."""
    return [int(t) if t.isdigit() else t.casefold() for t in re.split(r"(\d+)", name)]


def _folder_plan(db: Session, folder: str) -> dict:
    """Föreslå par fram/bak för en mapp där filerna ligger i ordningen
    framsida, baksida, framsida, baksida ... Foton som redan är baksidor, eller
    redan har en baksida, räknas bort innan växlingen - annars skulle en andra
    körning para ihop två framsidor."""
    photos = db.query(Photo).filter(Photo.folder == folder).all()
    ids = [p.id for p in photos]
    has_back = {
        fid for (fid,) in
        db.query(Photo.back_of_id).filter(Photo.back_of_id.in_(ids)).distinct()
    }
    by_id = {p.id: p for p in photos}
    linked = [
        (by_id.get(p.back_of_id) or db.get(Photo, p.back_of_id), p)
        for p in photos if p.back_of_id
    ]
    linked.sort(key=lambda fb: _natural_key(fb[1].filename))
    free = sorted(
        (p for p in photos if not p.back_of_id and p.id not in has_back),
        key=lambda p: _natural_key(p.filename),
    )
    return {
        "pairs": list(zip(free[0::2], free[1::2])),
        "leftover": free[-1] if len(free) % 2 else None,
        "linked": linked,
    }


@router.get("/backsides/folder", response_class=HTMLResponse)
def backside_folder_page(request: Request, folder: str, db: Session = Depends(get_db)):
    plan = _folder_plan(db, folder)
    return templates.TemplateResponse(
        request, "backside_folder.html", {"folder": folder, **plan},
    )


@router.post("/api/backsides/link-many")
def link_many(data: BackPairs, db: Session = Depends(get_db)):
    """Koppla flera fram/bak-par i en transaktion. Ett ogiltigt par stoppar
    hela anropet så inget halvfärdigt sparas."""
    seen: set[int] = set()
    for pair in data.pairs:
        if pair.front_id == pair.back_id:
            raise HTTPException(400, "Ett foto kan inte vara sin egen baksida")
        if {pair.front_id, pair.back_id} & seen:
            raise HTTPException(400, "Samma foto finns i flera par")
        seen |= {pair.front_id, pair.back_id}
        front = db.get(Photo, pair.front_id)
        back = db.get(Photo, pair.back_id)
        if not front or not back:
            raise HTTPException(404, "Foto hittades inte")
        if front.back_of_id:
            raise HTTPException(400, f"{front.filename} är redan en baksida")
        if back.back_of_id and back.back_of_id != front.id:
            raise HTTPException(400, f"{back.filename} är redan baksida till ett annat foto")
        if db.query(Photo.id).filter(Photo.back_of_id == back.id).first():
            raise HTTPException(400, f"{back.filename} har redan en egen baksida")
        back.back_of_id = front.id
    db.commit()
    return JSONResponse({"ok": True, "count": len(data.pairs)})
