from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.database import Photo, Place
from app.deps import get_db
from app.schemas import NameIn

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))


def get_or_create_place(db: Session, name: str) -> Place:
    name = name.strip()
    place = db.query(Place).filter(Place.name == name).first()
    if not place:
        place = Place(name=name)
        db.add(place)
        db.flush()
    return place


@router.get("/api/places")
def list_places_api(q: str = "", db: Session = Depends(get_db)):
    query = db.query(Place)
    if q:
        query = query.filter(Place.name.ilike(f"%{q}%"))
    return [{"id": p.id, "name": p.name} for p in query.order_by(Place.name).all()]


@router.get("/places", response_class=HTMLResponse)
def places_page(request: Request, q: str = "", db: Session = Depends(get_db)):
    query = db.query(Place)
    if q:
        query = query.filter(Place.name.ilike(f"%{q}%"))
    rows = []
    for place in query.order_by(Place.name).all():
        photos = db.query(Photo).filter(Photo.place_id == place.id)
        ids = [r[0] for r in photos.with_entities(Photo.id).all()]
        if not ids:
            continue
        rows.append({
            "id": place.id, "name": place.name,
            "count": len(ids), "sample": min(ids),
        })
    return templates.TemplateResponse(request, "places.html", {"places": rows, "q": q})


@router.get("/place/{place_id}", response_class=HTMLResponse)
def place_detail(place_id: int, request: Request, db: Session = Depends(get_db)):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Platsen hittades inte")
    photos = (
        db.query(Photo)
        .filter(Photo.place_id == place.id)
        .order_by(Photo.date_year.is_(None), Photo.date_year, Photo.filename)
        .all()
    )
    return templates.TemplateResponse(
        request, "place_detail.html", {"place": place, "photos": photos}
    )


@router.post("/api/places/{place_id}/rename")
def rename_place(place_id: int, data: NameIn, db: Session = Depends(get_db)):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Platsen hittades inte")
    new_name = data.name.strip()
    if not new_name:
        raise HTTPException(400, "Ange ett namn")

    existing = (
        db.query(Place).filter(Place.name == new_name, Place.id != place.id).first()
    )
    if existing:
        # Slå ihop in i befintlig plats.
        db.query(Photo).filter(Photo.place_id == place.id).update(
            {"place_id": existing.id, "location": existing.name},
            synchronize_session=False,
        )
        db.delete(place)
        db.commit()
        return JSONResponse({"ok": True, "id": existing.id, "merged": True})

    place.name = new_name
    db.query(Photo).filter(Photo.place_id == place.id).update(
        {"location": new_name}, synchronize_session=False
    )
    db.commit()
    return JSONResponse({"ok": True, "id": place.id, "merged": False})


@router.delete("/api/places/{place_id}")
def delete_place(place_id: int, db: Session = Depends(get_db)):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Platsen hittades inte")
    db.query(Photo).filter(Photo.place_id == place.id).update(
        {"place_id": None, "location": ""}, synchronize_session=False
    )
    db.delete(place)
    db.commit()
    return JSONResponse({"ok": True})
