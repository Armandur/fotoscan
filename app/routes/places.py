from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.database import Photo
from app.deps import get_db
from app.schemas import PlaceRename

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))


@router.get("/places", response_class=HTMLResponse)
def places_page(request: Request, q: str = "", db: Session = Depends(get_db)):
    query = (
        db.query(Photo.location, func.count(Photo.id), func.min(Photo.id))
        .filter(Photo.location != "")
    )
    if q:
        query = query.filter(Photo.location.ilike(f"%{q}%"))
    rows = [
        {"name": loc, "count": cnt, "sample": sample}
        for loc, cnt, sample in query.group_by(Photo.location)
        .order_by(Photo.location).all()
    ]
    return templates.TemplateResponse(request, "places.html", {"places": rows, "q": q})


@router.get("/place", response_class=HTMLResponse)
def place_detail(loc: str, request: Request, db: Session = Depends(get_db)):
    photos = (
        db.query(Photo)
        .filter(Photo.location == loc)
        .order_by(Photo.date_year.is_(None), Photo.date_year, Photo.filename)
        .all()
    )
    if not photos:
        raise HTTPException(404, "Platsen hittades inte")
    return templates.TemplateResponse(
        request, "place_detail.html", {"place": loc, "photos": photos}
    )


@router.post("/api/places/rename")
def rename_place(data: PlaceRename, db: Session = Depends(get_db)):
    old, new = data.old, data.new.strip()
    if not new:
        raise HTTPException(400, "Ange ett namn")
    count = (
        db.query(Photo).filter(Photo.location == old)
        .update({"location": new}, synchronize_session=False)
    )
    db.commit()
    return JSONResponse({"ok": True, "count": count, "name": new})
