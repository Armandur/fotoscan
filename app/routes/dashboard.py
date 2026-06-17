from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import Photo, Tag
from app.deps import get_db

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db)):
    # Räkna kombinationer som galleriet visar dem (sekundär-negativet + baksidor dolt).
    base = db.query(Photo).filter(
        Photo.back_of_id.is_(None),
        or_(Photo.paired_with_id.is_(None), Photo.is_pair_primary == 1),
    )
    total = base.count()
    reviewed = base.filter(Photo.reviewed_at.isnot(None)).count()
    missing_date = base.filter(Photo.date_year.is_(None)).count()
    missing_place = base.filter(Photo.place_id.is_(None)).count()
    missing_person = base.filter(~Photo.tags.any(Tag.kind == "person")).count()
    not_reviewed = total - reviewed

    # Foton per decennium (bara daterade).
    decade_counts: dict[int, int] = {}
    for (year,) in base.filter(Photo.date_year.isnot(None)).with_entities(Photo.date_year).all():
        decade_counts[(year // 10) * 10] = decade_counts.get((year // 10) * 10, 0) + 1
    decades = [
        {"decade": d, "count": c}
        for d, c in sorted(decade_counts.items())
    ]
    decade_max = max((d["count"] for d in decades), default=1)

    pct = round(100 * reviewed / total) if total else 0

    return templates.TemplateResponse(
        request, "dashboard.html",
        {
            "total": total, "reviewed": reviewed, "not_reviewed": not_reviewed,
            "pct": pct, "missing_date": missing_date, "missing_place": missing_place,
            "missing_person": missing_person,
            "decades": decades, "decade_max": decade_max,
        },
    )
