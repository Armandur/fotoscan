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
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import FaceRegion, Photo, Tag, SessionLocal, _now
from app.deps import get_db
from app.routes.faces import _next_unknown_name
from app.routes.persons import _avatar_region_id
from app.routes.photos import _get_or_create_tag
from app.schemas import ClusterName, ConfirmFace
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
    "message": "", "error": "", "cancel": False,
}


def _run_job(force: bool) -> None:
    db = SessionLocal()
    try:
        q = db.query(Photo).filter(
            Photo.back_of_id.is_(None), Photo.ai_exclude == 0,
            # Hoppa över negativet i ett par (sekundären) - samma motiv som fotot,
            # som redan detekteras. Oparade negativ scannas dock.
            or_(Photo.paired_with_id.is_(None), Photo.is_pair_primary == 1),
        )
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
            if JOB["cancel"]:
                JOB["message"] = f"Avbrutet: {JOB['done']}/{JOB['total']} foton klara, {added} förslag."
                return
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
                    if best_f.det_score is None:
                        best_f.det_score = d["det_score"]
                    continue
                if any(faces_ai.iou(d, f) >= _IOU_DUP_AI for f in ai_existing):
                    continue
                tag_id, _score = matcher.suggest(d["embedding"])
                db.add(FaceRegion(
                    photo_id=pid, tag_id=None,
                    x=d["x"], y=d["y"], w=d["w"], h=d["h"],
                    source="ai", confirmed=0,
                    embedding=faces_ai.emb_to_bytes(d["embedding"]),
                    det_score=d["det_score"],
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
                   message="Startar...", cancel=False)
    threading.Thread(target=_run_job, args=(force,), daemon=True).start()
    return JSONResponse({"ok": True})


@router.post("/api/faces/ai/cancel")
def cancel_scan():
    """Begär att ett pågående jobb stannar vid nästa foto (kraschsäkert -
    allt klart behålls)."""
    if JOB["running"]:
        JOB["cancel"] = True
        JOB["message"] = "Avbryter vid nästa foto..."
    return JSONResponse({"ok": True})


@router.get("/api/faces/ai/status")
def scan_status():
    return JSONResponse(dict(JOB))


@router.post("/api/faces/ai/photo/{photo_id}/exclude")
def set_exclude(photo_id: int, exclude: bool = True, db: Session = Depends(get_db)):
    """Uteslut/inkludera ett foto i AI-detekteringen. Vid uteslutning tas även
    fotots obekräftade AI-förslag bort (de återkommer annars inte men städas)."""
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    photo.ai_exclude = 1 if exclude else 0
    if exclude:
        for f in list(photo.faces):
            if f.source == "ai" and not f.confirmed:
                invalidate_face_thumb(f.id)
                db.delete(f)
    db.commit()
    return JSONResponse({"ok": True, "excluded": bool(photo.ai_exclude)})


def _confirmed_count(db: Session, tag_id: int) -> int:
    return (
        db.query(FaceRegion)
        .filter(FaceRegion.tag_id == tag_id, FaceRegion.confirmed == 1)
        .count()
    )


@router.get("/api/persons/similar")
def similar_persons(threshold: float = 0.5, db: Session = Depends(get_db)):
    """Personpar vars ansikts-embeddingar liknar varandra - troliga dubbletter
    att slå ihop. Bygger på samma centroider som namnförslagen."""
    threshold = max(0.3, min(0.95, threshold))
    matcher = _build_db_matcher(db)
    out = []
    for a, b, score in matcher.pairs(threshold)[:100]:
        ta, tb = db.get(Tag, a), db.get(Tag, b)
        if not ta or not tb:
            continue
        out.append({
            "a": {"id": a, "name": ta.name, "region_id": _avatar_region_id(db, ta),
                  "count": _confirmed_count(db, a)},
            "b": {"id": b, "name": tb.name, "region_id": _avatar_region_id(db, tb),
                  "count": _confirmed_count(db, b)},
            "score": round(score, 3),
        })
    return JSONResponse({"pairs": out, "threshold": threshold})


@router.get("/persons/duplicates", response_class=HTMLResponse)
def persons_duplicates_page(request: Request, threshold: float = 0.5,
                            db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        request, "persons_duplicates.html", {"threshold": threshold},
    )


@router.get("/api/faces/ai/clusters")
def face_clusters(threshold: float = 0.5, min_size: int = 2,
                  db: Session = Depends(get_db)):
    """Klustra obekräftade AI-ansikten på likhet -> grupper att namnge på en
    gång. Klara ansikten (högst det_score) blir frön. Varje grupp får ett
    namnförslag via matchning mot kända personer. Enstaka ansikten (storlek <
    min_size, default 2) utelämnas - de hör hemma i per-foto-granskningen."""
    import numpy as np

    threshold = max(0.3, min(0.9, threshold))
    faces = (
        db.query(FaceRegion)
        .filter(FaceRegion.source == "ai", FaceRegion.confirmed == 0,
                FaceRegion.embedding.isnot(None))
        .all()
    )
    # Tydliga ansikten först (frön): högst det_score, sedan störst area.
    faces.sort(key=lambda f: (f.det_score or 0.0, f.w * f.h), reverse=True)
    items = [(f.id, f.embedding) for f in faces]
    by_id = {f.id: f for f in faces}
    clusters = faces_ai.cluster_embeddings(items, threshold)
    singletons = sum(1 for ids in clusters if len(ids) < min_size)
    clusters = [ids for ids in clusters if len(ids) >= min_size]

    matcher = _build_db_matcher(db)
    out = []
    for ids in clusters:
        members = [by_id[i] for i in ids]
        centroid = np.mean(
            [faces_ai.bytes_to_emb(m.embedding) for m in members], axis=0)
        tag_id, score = matcher.suggest(centroid)
        suggestion = None
        if tag_id is not None:
            tag = db.get(Tag, tag_id)
            if tag:
                suggestion = {"tag_id": tag_id, "name": tag.name,
                              "score": round(float(score), 3),
                              "region_id": _avatar_region_id(db, tag)}
        out.append({
            "faces": [{"id": m.id, "photo_id": m.photo_id} for m in members],
            "suggestion": suggestion,
        })
    return JSONResponse({"clusters": out, "threshold": threshold,
                         "total_faces": len(faces), "singletons": singletons})


@router.post("/api/faces/ai/cluster-name")
def name_cluster(data: ClusterName, db: Session = Depends(get_db)):
    """Namnge (bekräfta) alla ansikten i ett kluster på en gång."""
    if data.unidentified:
        tag = _get_or_create_tag(db, _next_unknown_name(db), "person")
        tag.placeholder = 1
        identified = False
    elif data.tag_id:
        tag = db.get(Tag, data.tag_id)
        if not tag or tag.kind != "person":
            raise HTTPException(400, "Ogiltig person")
        identified = False  # bevara målpersonens status (kan vara en Okänd-N)
    elif data.name.strip():
        tag = _get_or_create_tag(db, data.name.strip(), "person")
        identified = True
    else:
        raise HTTPException(400, "Ange en person")

    faces = (
        db.query(FaceRegion)
        .filter(FaceRegion.id.in_(data.face_ids),
                FaceRegion.source == "ai", FaceRegion.confirmed == 0)
        .all()
    )
    for face in faces:
        _confirm(db, face, tag, identified=identified)
    db.commit()
    return JSONResponse({"ok": True, "count": len(faces),
                         "person": {"id": tag.id, "name": tag.name}})


@router.get("/faces/clusters", response_class=HTMLResponse)
def clusters_page(request: Request, threshold: float = 0.5,
                  db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        request, "faces_clusters.html", {"threshold": threshold},
    )


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
    # Inkluderar platshållare (Okänd-N): faces sparade som "oidentifierade" är
    # också referensgrupper, så nya ansikten av samma okända person föreslås mot
    # dem och kan fyllas på (och namnges senare i klump).
    rows = (
        db.query(FaceRegion.tag_id, FaceRegion.embedding)
        .filter(
            FaceRegion.confirmed == 1,
            FaceRegion.tag_id.isnot(None),
            FaceRegion.embedding.isnot(None),
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
    # Ansikten med namnförslag först (högsta poäng överst), övriga sist.
    out.sort(
        key=lambda o: (bool(o["suggestions"]),
                       o["suggestions"][0]["score"] if o["suggestions"] else 0.0),
        reverse=True,
    )
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


def _confirm(db: Session, face: FaceRegion, tag: Tag, identified: bool = True) -> None:
    if identified:
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
    identified = True
    if data.unidentified:
        # Bekräfta som oidentifierad: skapa en "Okänd-N"-platshållare att namnge senare.
        tag = _get_or_create_tag(db, _next_unknown_name(db), "person")
        tag.placeholder = 1
        identified = False
    elif data.tag_id:
        tag = db.get(Tag, data.tag_id)
        if not tag or tag.kind != "person":
            raise HTTPException(400, "Ogiltig person")
        identified = False  # bevara målpersonens status (kan vara en Okänd-N)
    elif data.name.strip():
        tag = _get_or_create_tag(db, data.name.strip(), "person")
    else:
        raise HTTPException(400, "Ange en person")
    _confirm(db, face, tag, identified=identified)
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
