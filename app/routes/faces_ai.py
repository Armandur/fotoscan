"""AI-ansiktsdetektering: bakgrundsjobb + granskningskö.

Jobbet körs i en daemon-tråd med egen DB-session. Tillstånd hålls i en
modul-global dict (single-container -> räcker). Ett inkrementellt pass: varje
foto detekteras, bekräftade rutor får backfillade embeddings (via IoU),
förslagsrutor skapas och fotot markeras klart med en commit per foto - kön
fylls löpande och avbrott behåller klart arbete. Inget skrivs in i katalogen
som bekräftat - allt är förslag tills användaren godkänner i granskningen.
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
from app.routes.persons import _avatar_region_id
from app.routes.photos import _get_or_create_tag
from app.schemas import ConfirmFace
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

        # Referensmatcher byggs en gång vid start (bekräftade, namngivna ansikten
        # med embedding). Lagrade förslag är "best-effort" - granskningsvyn räknar
        # ändå ut förslagen live, så de är alltid färska.
        matcher = _build_db_matcher(db)

        # Ett inkrementellt pass: varje foto detekteras, får förslagsrutor och
        # markeras klart med en commit per foto. Granskningskön fylls löpande och
        # ett avbrutet jobb behåller allt som hunnit bli klart.
        added = 0
        for photo in photos:
            pid = photo.id
            if not Path(photo.path).exists():
                photo.ai_faces_at = _now()
                db.commit()
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
                logger.exception("Detektering misslyckades för foto %s", pid)
                photo.ai_faces_at = _now()
                db.commit()
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
                tag_id, _score = matcher.suggest(d["embedding"])
                db.add(FaceRegion(
                    photo_id=pid, tag_id=None,
                    x=d["x"], y=d["y"], w=d["w"], h=d["h"],
                    source="ai", confirmed=0,
                    embedding=faces_ai.emb_to_bytes(d["embedding"]),
                    suggested_tag_id=tag_id,
                ))
                added += 1

            photo.ai_faces_at = _now()
            db.commit()  # per foto -> kraschsäkert + kön fylls löpande
            JOB["done"] += 1
            JOB["added"] = added
        JOB["message"] = f"Klart: {added} nya ansiktsförslag."
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


def _pending_faces_query(db: Session):
    return db.query(FaceRegion).filter(
        FaceRegion.source == "ai", FaceRegion.confirmed == 0
    )


def _pending_photos(db: Session) -> list[dict]:
    """Foton med obekräftade AI-ansikten i filnamnsordning (delas av listvy +
    prev/next-navigeringen)."""
    faces = _pending_faces_query(db).order_by(FaceRegion.id).all()
    by_photo: dict[int, dict] = {}
    for f in faces:
        p = f.photo
        if not p:
            continue
        d = by_photo.setdefault(p.id, {
            "photo_id": p.id, "filename": p.filename, "face_ids": [],
        })
        d["face_ids"].append(f.id)
    return sorted(by_photo.values(), key=lambda d: d["filename"])


@router.get("/api/faces/ai/photos")
def pending_photos(db: Session = Depends(get_db)):
    """Foton med obekräftade AI-ansikten, med foto-thumb + ansikts-crops."""
    photos = _pending_photos(db)
    total = sum(len(p["face_ids"]) for p in photos)
    return JSONResponse({"photos": photos, "total": total})


def _build_db_matcher(db: Session) -> faces_ai.Matcher:
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
    return faces_ai.build_matcher(rows)


@router.get("/api/faces/ai/photo/{photo_id}")
def photo_faces(photo_id: int, db: Session = Depends(get_db)):
    """Obekräftade AI-ansikten på ett foto, med rutor + topp-namnförslag (live-
    beräknade mot bekräftade personer)."""
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    faces = (
        _pending_faces_query(db)
        .filter(FaceRegion.photo_id == photo_id)
        .order_by(FaceRegion.id)
        .all()
    )
    matcher = _build_db_matcher(db)
    out = []
    for f in faces:
        suggestions = []
        if f.embedding:
            emb = faces_ai.bytes_to_emb(f.embedding)
            for tag_id, score in matcher.topk(emb):
                tag = db.get(Tag, tag_id)
                if tag:
                    suggestions.append({
                        "tag_id": tag_id, "name": tag.name,
                        "score": round(score, 3),
                        "region_id": _avatar_region_id(db, tag),
                    })
        out.append({
            "id": f.id, "x": f.x, "y": f.y, "w": f.w, "h": f.h,
            "suggestions": suggestions,
        })
    # Redan bekräftade/manuella rutor visas som kontext (med namn), utan åtgärder.
    confirmed = [
        {"id": f.id, "x": f.x, "y": f.y, "w": f.w, "h": f.h,
         "name": f.tag.name if f.tag else "?"}
        for f in photo.faces if f.confirmed and f.tag_id
    ]
    return JSONResponse({
        "photo": {"id": photo.id, "filename": photo.filename},
        "faces": out, "confirmed": confirmed,
    })


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


@router.get("/faces/review", response_class=HTMLResponse)
def review_page(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        request, "faces_review.html",
        {"pending": _pending_count(db), "scanned": db.query(Photo).filter(
            Photo.ai_faces_at.isnot(None), Photo.back_of_id.is_(None)).count(),
         "total_photos": db.query(Photo).filter(Photo.back_of_id.is_(None)).count()},
    )


@router.get("/faces/review/{photo_id}", response_class=HTMLResponse)
def review_photo_page(photo_id: int, request: Request, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    # Prev/next bland foton med obekräftade ansikten (filnamnsordning, samma som
    # listvyn). Är fotot redan klart (ej i listan) faller vi tillbaka på listans
    # ändar så man ändå kan ta sig vidare.
    ids = [p["photo_id"] for p in _pending_photos(db)]
    prev_id = next_id = None
    pos, total = 0, len(ids)
    if photo_id in ids:
        i = ids.index(photo_id)
        pos = i + 1
        prev_id = ids[i - 1] if i > 0 else None
        next_id = ids[i + 1] if i < len(ids) - 1 else None
    elif ids:
        next_id = ids[0]
    return templates.TemplateResponse(
        request, "faces_review_photo.html",
        {"photo": photo, "prev_id": prev_id, "next_id": next_id,
         "pos": pos, "total": total},
    )
