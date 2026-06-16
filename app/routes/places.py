from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import Photo, Place
from app.deps import get_db
from app.schemas import NameIn
from app.services.filtering import apply_dimensions, sort_order

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V


def place_avg_gps(db: Session, place_id: int, exclude_photo_id: int | None = None):
    """Representativ GPS för en plats = snittet av platsens fotons egna GPS.
    Returnerar (lat, lon, antal) eller None."""
    q = db.query(Photo.gps_lat, Photo.gps_lon).filter(
        Photo.place_id == place_id,
        Photo.gps_lat.isnot(None), Photo.gps_lon.isnot(None),
    )
    if exclude_photo_id is not None:
        q = q.filter(Photo.id != exclude_photo_id)
    rows = q.all()
    if not rows:
        return None
    n = len(rows)
    return (sum(r[0] for r in rows) / n, sum(r[1] for r in rows) / n, n)


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
def place_detail(
    place_id: int, request: Request,
    reviewed: str = "", ptype: str = "", paired: str = "",
    separate: bool = False, sort: str = "date",
    db: Session = Depends(get_db),
):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Platsen hittades inte")
    query = db.query(Photo).filter(Photo.place_id == place.id)
    query = apply_dimensions(query, reviewed, ptype, paired, separate)
    photos = query.order_by(*sort_order(sort)).all()
    avg = place_avg_gps(db, place.id)
    place_gps = {"lat": round(avg[0], 6), "lon": round(avg[1], 6), "n": avg[2]} if avg else None
    return templates.TemplateResponse(
        request, "place_detail.html",
        {"place": place, "photos": photos, "place_gps": place_gps,
         "reviewed": reviewed, "ptype": ptype,
         "paired": paired, "separate": separate, "sort": sort},
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
