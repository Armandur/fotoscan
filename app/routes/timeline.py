from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.database import Photo
from app.deps import get_db
from app.services.filtering import apply_dimensions

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

_MONTHS = [
    "", "Januari", "Februari", "Mars", "April", "Maj", "Juni",
    "Juli", "Augusti", "September", "Oktober", "November", "December",
]


@router.get("/timeline", response_class=HTMLResponse)
def timeline(
    request: Request,
    reviewed: str = "", ptype: str = "", paired: str = "",
    separate: bool = False, sort: str = "date",
    db: Session = Depends(get_db),
):
    query = apply_dimensions(db.query(Photo), reviewed, ptype, paired, separate)
    photos = (
        query.order_by(
            Photo.date_year.is_(None), Photo.date_year,
            Photo.date_month.is_(None), Photo.date_month,
            Photo.date_text, Photo.filename,
        )
        .all()
    )

    year_map: dict[int, dict] = {}
    undated: list = []
    for p in photos:
        if p.date_year is None:
            undated.append(p)
            continue
        year_map.setdefault(p.date_year, {}).setdefault(p.date_month, []).append(p)

    desc = sort == "date_desc"
    groups = []
    for year in sorted(year_map, reverse=desc):
        months = year_map[year]
        month_groups = []
        total = 0
        for m in sorted(months, key=lambda x: (x is None, x or 0), reverse=desc):
            items = months[m]
            total += len(items)
            month_groups.append({
                "month": m,
                "label": _MONTHS[m] if m else "Okänd månad",
                "photos": items,
            })
        groups.append({"year": year, "count": total, "months": month_groups})

    return templates.TemplateResponse(
        request, "timeline.html",
        {"groups": groups, "undated": undated, "reviewed": reviewed,
         "ptype": ptype, "paired": paired, "separate": separate, "sort": sort},
    )
