"""AI-ansiktsdetektering: bakgrundsjobb + granskningskö.

Jobbet körs i en daemon-tråd med egen DB-session. Tillstånd hålls i en
modul-global dict (single-container -> räcker). Två pass: (1) detektera i varje
foto, backfilla embeddings på redan bekräftade rutor (via IoU) och samla
kandidater till nya ansikten; (2) bygg referens av bekräftade namngivna
ansikten och föreslå namn för kandidaterna. Inget skrivs in i katalogen som
bekräftat - allt är förslag tills användaren godkänner i granskningskön.
"""
import logging
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import FaceRegion, Photo, Tag, SessionLocal, _now
from app.deps import get_db
from app.routes.photos import _get_or_create_tag
from app.schemas import ConfirmFace, ConfirmGroup
from app.services import faces_ai
from app.services.scanner import invalidate_face_thumb

logger = logging.getLogger("fotoscan.faces_ai")
router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V

_IOU_SAME = 0.30      # detektering överlappar bekräftad ruta -> samma ansikte
_IOU_DUP_AI = 0.50    # detektering överlappar befintligt AI-förslag -> dubblett

_job_lock = threading.Lock()
JOB = {
    "running": False, "total": 0, "done": 0, "added": 0,
    "message": "", "error": "",
}


def _run_job(force: bool) -> None:
    db = SessionLocal()
    try:
        q = db.query(Photo).filter(Photo.back_of_id.is_(None))
        if not force:
            q = q.filter(Photo.ai_faces_at.is_(None))
        photos = q.all()
        JOB.update(total=len(photos), done=0, added=0, message="Detekterar ansikten...")

        candidates: list[tuple[int, dict]] = []
        for photo in photos:
            if not Path(photo.path).exists():
                photo.ai_faces_at = _now()
                JOB["done"] += 1
                continue
            if force:
                # Rensa tidigare obekräftade AI-förslag på fotot -> färska förslag.
                for f in list(photo.faces):
                    if f.source == "ai" and not f.confirmed:
                        invalidate_face_thumb(f.id)
                        db.delete(f)
                db.flush()

            try:
                dets = faces_ai.detect_in_photo(photo)
            except Exception:
                logger.exception("Detektering misslyckades för foto %s", photo.id)
                photo.ai_faces_at = _now()
                JOB["done"] += 1
                continue

            confirmed = [f for f in photo.faces if f.confirmed and f.tag_id]
            ai_existing = [f for f in photo.faces if f.source == "ai" and not f.confirmed]
            used: set[int] = set()
            for d in dets:
                best_f, best = None, 0.0
                for f in confirmed:
                    if f.id in used:
                        continue
                    o = faces_ai.iou(d, f)
                    if o > best:
                        best, best_f = o, f
                if best_f and best >= _IOU_SAME:
                    used.add(best_f.id)
                    if not best_f.embedding:
                        best_f.embedding = faces_ai.emb_to_bytes(d["embedding"])
                    continue
                if any(faces_ai.iou(d, f) >= _IOU_DUP_AI for f in ai_existing):
                    continue
                candidates.append((photo.id, d))

            photo.ai_faces_at = _now()
            JOB["done"] += 1
            if JOB["done"] % 20 == 0:
                db.commit()
        db.commit()

        # Referens: bekräftade, namngivna (ej platshållare) ansikten med embedding.
        JOB["message"] = "Matchar mot kända personer..."
        rows = (
            db.query(FaceRegion.tag_id, FaceRegion.embedding)
            .join(Tag, Tag.id == FaceRegion.tag_id)
            .filter(
                FaceRegion.confirmed == 1,
                FaceRegion.embedding.isnot(None),
                Tag.placeholder == 0,
            )
            .all()
        )
        matcher = faces_ai.build_matcher(rows)

        added = 0
        for photo_id, d in candidates:
            tag_id, _score = matcher.suggest(d["embedding"])
            db.add(FaceRegion(
                photo_id=photo_id, tag_id=None,
                x=d["x"], y=d["y"], w=d["w"], h=d["h"],
                source="ai", confirmed=0,
                embedding=faces_ai.emb_to_bytes(d["embedding"]),
                suggested_tag_id=tag_id,
            ))
            added += 1
        db.commit()
        JOB.update(added=added, message=f"Klart: {added} nya ansiktsförslag.")
    except Exception as e:
        logger.exception("AI-jobbet kraschade")
        JOB["error"] = str(e)
        JOB["message"] = "Jobbet misslyckades."
    finally:
        db.close()
        JOB["running"] = False


@router.post("/api/faces/ai/scan")
def start_scan(force: bool = False):
    with _job_lock:
        if JOB["running"]:
            raise HTTPException(409, "Ett jobb körs redan")
        JOB.update(running=True, total=0, done=0, added=0, error="",
                   message="Startar...")
    threading.Thread(target=_run_job, args=(force,), daemon=True).start()
    return JSONResponse({"ok": True})


@router.get("/api/faces/ai/status")
def scan_status():
    return JSONResponse(dict(JOB))


def _pending_count(db: Session) -> int:
    return (
        db.query(FaceRegion)
        .filter(FaceRegion.source == "ai", FaceRegion.confirmed == 0)
        .count()
    )


@router.get("/api/faces/ai/pending")
def pending(db: Session = Depends(get_db)):
    """Obekräftade AI-ansikten grupperade efter namnförslag (förslag först,
    'inget förslag' sist)."""
    faces = (
        db.query(FaceRegion)
        .filter(FaceRegion.source == "ai", FaceRegion.confirmed == 0)
        .order_by(FaceRegion.suggested_tag_id, FaceRegion.id)
        .all()
    )
    groups: dict[int | None, dict] = {}
    for f in faces:
        key = f.suggested_tag_id
        if key not in groups:
            name = f.suggested_tag.name if f.suggested_tag else None
            groups[key] = {"suggested_id": key, "suggested_name": name, "faces": []}
        photo = f.photo
        groups[key]["faces"].append({
            "id": f.id, "photo_id": f.photo_id,
            "filename": photo.filename if photo else "",
        })
    ordered = sorted(groups.values(), key=lambda g: (g["suggested_id"] is None, g["suggested_name"] or ""))
    return JSONResponse({"groups": ordered, "total": len(faces)})


def _confirm(db: Session, face: FaceRegion, tag: Tag) -> None:
    tag.placeholder = 0
    face.tag_id = tag.id
    face.confirmed = 1
    face.suggested_tag_id = None
    if face.photo and tag not in face.photo.tags:
        face.photo.tags.append(tag)


@router.post("/api/faces/{region_id}/confirm")
def confirm_face(region_id: int, data: ConfirmFace, db: Session = Depends(get_db)):
    face = db.get(FaceRegion, region_id)
    if not face:
        raise HTTPException(404, "Region hittades inte")
    if data.tag_id:
        tag = db.get(Tag, data.tag_id)
        if not tag or tag.kind != "person":
            raise HTTPException(400, "Ogiltig person")
    elif data.name.strip():
        tag = _get_or_create_tag(db, data.name.strip(), "person")
    else:
        raise HTTPException(400, "Ange en person")
    _confirm(db, face, tag)
    db.commit()
    return JSONResponse({"ok": True, "person": {"id": tag.id, "name": tag.name}})


@router.post("/api/faces/ai/confirm-group")
def confirm_group(data: ConfirmGroup, db: Session = Depends(get_db)):
    """Bekräfta alla obekräftade AI-ansikten med ett visst namnförslag."""
    tag = db.get(Tag, data.suggested_tag_id)
    if not tag or tag.kind != "person":
        raise HTTPException(400, "Ogiltig person")
    faces = (
        db.query(FaceRegion)
        .filter(
            FaceRegion.source == "ai", FaceRegion.confirmed == 0,
            FaceRegion.suggested_tag_id == tag.id,
        )
        .all()
    )
    for face in faces:
        _confirm(db, face, tag)
    db.commit()
    return JSONResponse({"ok": True, "count": len(faces)})


@router.get("/faces/review", response_class=HTMLResponse)
def review_page(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        request, "faces_review.html",
        {"pending": _pending_count(db), "scanned": db.query(Photo).filter(
            Photo.ai_faces_at.isnot(None), Photo.back_of_id.is_(None)).count(),
         "total_photos": db.query(Photo).filter(Photo.back_of_id.is_(None)).count()},
    )
