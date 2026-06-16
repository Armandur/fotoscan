from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import Photo
from app.deps import get_db
from app.schemas import PairRequest

router = APIRouter()

# Skalärfält som slås samman vid hopparning.
_MERGE_FIELDS = [
    ("date_text", "Fotodatum"),
    ("date_year", "År"),
    ("location", "Plats"),
    ("source", "Källa"),
    ("notes", "Anteckningar"),
]


def _empty(v) -> bool:
    return v is None or v == "" or v == 0


def _photo_brief(p: Photo) -> dict:
    return {
        "id": p.id,
        "filename": p.filename,
        "folder": p.folder,
        "date": p.date_text or (str(p.date_year) if p.date_year else ""),
        "is_negative": bool(p.is_negative),
    }


@router.get("/api/photos/{photo_id}/pair-candidates")
def pair_candidates(
    photo_id: int, q: str = "", show_matched: bool = False,
    all_types: bool = False, offset: int = 0, limit: int = 60,
    db: Session = Depends(get_db),
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    query = db.query(Photo).filter(Photo.id != photo_id)
    # Redan hopparade visas inte som default (toggle kan visa dem).
    if not show_matched:
        query = query.filter(Photo.paired_with_id.is_(None))
    # Default: visa motsatt typ (foto <-> negativ). Toggle visar alla typer.
    if not all_types:
        query = query.filter(Photo.is_negative == (0 if photo.is_negative else 1))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            Photo.filename.ilike(like),
            Photo.folder.ilike(like),
            Photo.date_text.ilike(like),
        ))
    photos = (
        query.order_by(Photo.folder, Photo.filename)
        .offset(max(0, offset)).limit(min(limit, 200)).all()
    )
    return [_photo_brief(p) for p in photos]


@router.post("/api/photos/{photo_id}/pair")
def pair_photos(
    photo_id: int, data: PairRequest, db: Session = Depends(get_db)
):
    a = db.get(Photo, photo_id)
    b = db.get(Photo, data.other_id)
    if not a or not b:
        raise HTTPException(404, "Foto hittades inte")
    if a.id == b.id:
        raise HTTPException(400, "Kan inte para ihop ett foto med sig självt")

    merged: dict = {}
    conflicts = []
    for field, label in _MERGE_FIELDS:
        va, vb = getattr(a, field), getattr(b, field)
        ea, eb = _empty(va), _empty(vb)
        if ea and eb:
            continue
        if ea:
            merged[field] = vb
        elif eb:
            merged[field] = va
        elif va == vb:
            continue
        else:
            choice = data.resolutions.get(field)
            if choice == "a":
                merged[field] = va
            elif choice == "b":
                merged[field] = vb
            else:
                conflicts.append({"field": field, "label": label, "a": va, "b": vb})

    if conflicts:
        return JSONResponse({"ok": False, "needs_resolution": True, "conflicts": conflicts})

    # Applicera sammanslagna värden på båda bilderna.
    for field, val in merged.items():
        setattr(a, field, val)
        setattr(b, field, val)

    # Taggar/personer: union på båda.
    union = list({t.id: t for t in (a.tags + b.tags)}.values())
    a.tags = list(union)
    b.tags = list(union)

    # Symmetrisk länk. Primär = icke-negativ (annars lägst id) - representerar
    # paret i grupperad gallerivy.
    a.paired_with_id = b.id
    b.paired_with_id = a.id
    if bool(a.is_negative) != bool(b.is_negative):
        primary = a if not a.is_negative else b
    else:
        primary = a if a.id <= b.id else b
    a.is_pair_primary = 1 if primary is a else 0
    b.is_pair_primary = 1 if primary is b else 0
    db.commit()
    return JSONResponse({"ok": True, "paired_with": b.id})


@router.post("/api/photos/{photo_id}/unpair")
def unpair_photo(photo_id: int, db: Session = Depends(get_db)):
    a = db.get(Photo, photo_id)
    if not a:
        raise HTTPException(404, "Foto hittades inte")
    if a.paired_with_id:
        b = db.get(Photo, a.paired_with_id)
        if b and b.paired_with_id == a.id:
            b.paired_with_id = None
            b.is_pair_primary = 0
    a.paired_with_id = None
    a.is_pair_primary = 0
    db.commit()
    return JSONResponse({"ok": True})
