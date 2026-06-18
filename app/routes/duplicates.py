import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V, THUMB_DIR
from app.database import Photo
from app.deps import get_db
from app.services.dupes import dhash_from_path, group_similar

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V
logger = logging.getLogger("fotoscan.dupes")


def _backfill_phashes(db: Session) -> int:
    """Beräkna phash för foton som saknar det, från deras thumbnail. Snabbt
    (thumbnailen är redan nedskalad). Returnerar antal beräknade."""
    missing = db.query(Photo).filter(Photo.phash.is_(None)).all()
    done = 0
    for p in missing:
        tp = THUMB_DIR / f"{p.id}.jpg"
        if not tp.exists():
            continue
        try:
            p.phash = dhash_from_path(tp)
            done += 1
        except Exception:
            logger.exception("Kunde inte beräkna phash för foto %s", p.id)
    if done:
        db.commit()
    return done


@router.get("/duplicates", response_class=HTMLResponse)
def duplicates_page(request: Request, dist: int = 10, db: Session = Depends(get_db)):
    dist = max(0, min(20, dist))
    _backfill_phashes(db)

    # Jämför synliga foton (baksidor utesluts). Negativ inkluderas - en
    # dubblettskanning kan vara vad som helst.
    rows = (
        db.query(Photo)
        .filter(Photo.phash.isnot(None), Photo.back_of_id.is_(None))
        .all()
    )
    by_id = {p.id: p for p in rows}
    groups_ids = group_similar([(p.id, p.phash) for p in rows], dist)

    def _pair_key(p: Photo) -> int:
        # Ett foto och dess hopparade negativ är samma logiska bild.
        return min(p.id, p.paired_with_id) if p.paired_with_id else p.id

    groups = []
    for ids in sorted(groups_ids, key=len, reverse=True):
        members = [by_id[i] for i in ids]
        # Hoppa över grupper som bara är ett foto + dess negativ (avsiktligt par,
        # inte en dubblett att åtgärda).
        if len({_pair_key(m) for m in members}) < 2:
            continue
        groups.append(members)
    return templates.TemplateResponse(
        request, "duplicates.html",
        {"groups": groups, "dist": dist, "total": len(rows)},
    )
