import io
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse,
)
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.config import BASE_DIR, THUMB_DIR, ASSET_V
from app.database import Album, AlbumPhoto, Photo, Tag
from app.database import _now
from app.deps import get_db
from app.schemas import BatchUpdate, PhotoAdjust, PhotoUpdate, ReorderRequest
from app.services.adjust import apply_adjustments, has_adjustments, suggest_auto
from app.services.context import (
    context_back, context_nav_qs, context_ordered_ids,
)
from app.services.dates import parse_date_text
from app.services.filtering import apply_dimensions, sort_order as _sort_order
from app.routes.places import get_or_create_place, place_avg_gps
from app.services.scanner import (
    invalidate_face_thumb, invalidate_render, load_oriented, render_cache_path,
    refresh_derived, write_render, write_thumbnail,
)

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V

PAGE_SIZE = 60


def _filtered_query(
    db: Session, q: str, reviewed: str, ptype: str, paired: str,
    folder: str, recursive: bool = False, separate: bool = False,
    missing: str = "",
):
    """Bygg Photo-query enligt galleriets sök/filter/mapp-parametrar.

    reviewed: ""|"yes"|"no", ptype: ""|"negative"|"photo", paired: ""|"yes"|"no".
    missing: ""|"date"|"place"|"person" - foton som saknar respektive metadata
    (för dashboardens snabblänkar). Dimensionerna AND:as. recursive=True inkluderar
    undermappar till `folder`. separate=False döljer sekundären i hopparade par.
    """
    query = db.query(Photo)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Photo.filename.ilike(like),
                Photo.folder.ilike(like),
                Photo.location.ilike(like),  # plats (namn-cache)
                Photo.notes.ilike(like),
                Photo.date_text.ilike(like),
                Photo.source.ilike(like),
                Photo.tags.any(Tag.name.ilike(like)),  # taggar + personer
            )
        )
    query = apply_dimensions(query, reviewed, ptype, paired, separate)
    if missing == "date":
        query = query.filter(Photo.date_year.is_(None))
    elif missing == "place":
        query = query.filter(Photo.place_id.is_(None))
    elif missing == "person":
        query = query.filter(~Photo.tags.any(Tag.kind == "person"))
    # folder == "*" betyder alla mappar; "" är rotmappen.
    if folder != "*":
        if recursive:
            # "" + rekursivt = allt. Annars mappen själv + dess undermappar.
            if folder != "":
                query = query.filter(
                    or_(Photo.folder == folder, Photo.folder.like(f"{folder}/%"))
                )
        else:
            query = query.filter(Photo.folder == folder)
    return query


def _gallery_qs(q, reviewed, ptype, paired, recursive, separate, sort, missing="") -> str:
    """Urlencodad querystring (utan ledande &) med galleriets kontext, för
    länkar (mappträd, kort, paginering). Tomma/default utelämnas."""
    params = {}
    if q:
        params["q"] = q
    if reviewed:
        params["reviewed"] = reviewed
    if ptype:
        params["ptype"] = ptype
    if paired:
        params["paired"] = paired
    if missing:
        params["missing"] = missing
    if recursive:
        params["recursive"] = "1"
    if separate:
        params["separate"] = "1"
    if sort and sort != "date":
        params["sort"] = sort
    return urlencode(params)


def _build_folder_tree(folders: list[str]) -> list[dict]:
    """Bygg en nästlad trädstruktur av distinkta mappsökvägar (posix)."""
    root: dict = {}
    for f in folders:
        if not f:
            continue
        level = root
        path = ""
        for part in f.split("/"):
            path = part if not path else f"{path}/{part}"
            node = level.setdefault(part, {"path": path, "children": {}})
            level = node["children"]

    def to_list(d: dict) -> list[dict]:
        return [
            {"name": name, "path": data["path"], "children": to_list(data["children"])}
            for name, data in sorted(d.items(), key=lambda kv: kv[0].lower())
        ]
    return to_list(root)


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    db: Session = Depends(get_db),
    q: str = "",
    reviewed: str = "",
    ptype: str = "",
    paired: str = "",
    folder: str = "*",
    recursive: bool = False,
    separate: bool = False,
    sort: str = "date",
    missing: str = "",
    page: int = 1,
):
    query = _filtered_query(db, q, reviewed, ptype, paired, folder, recursive, separate, missing)

    total = query.count()
    page = max(1, page)
    photos = (
        query.order_by(*_sort_order(sort))
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .all()
    )
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)

    total_all = db.query(Photo).count()
    reviewed_count = db.query(Photo).filter(Photo.reviewed_at.isnot(None)).count()

    # Distinkta undermappar -> nästlat träd. None hoppas över.
    folders = [
        row[0]
        for row in db.query(Photo.folder).distinct().order_by(Photo.folder).all()
        if row[0] is not None
    ]
    folder_tree = _build_folder_tree(folders)
    has_root_photos = "" in folders

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "photos": photos,
            "q": q,
            "reviewed": reviewed,
            "ptype": ptype,
            "paired": paired,
            "folder": folder,
            "recursive": recursive,
            "separate": separate,
            "sort": sort,
            "missing": missing,
            "qbase": _gallery_qs(q, reviewed, ptype, paired, recursive, separate, sort, missing),
            "folder_tree": folder_tree,
            "has_root_photos": has_root_photos,
            "page": page,
            "pages": pages,
            "total": total,
            "total_all": total_all,
            "reviewed_count": reviewed_count,
        },
    )


@router.post("/api/photos/batch")
def batch_update(data: BatchUpdate, db: Session = Depends(get_db)):
    if data.use_filter:
        photos = _filtered_query(
            db, data.q, data.reviewed, data.ptype, data.paired,
            data.folder, data.recursive, data.separate, data.missing,
        ).all()
    elif data.ids:
        photos = db.query(Photo).filter(Photo.id.in_(data.ids)).all()
    else:
        return JSONResponse({"ok": True, "count": 0})

    now = _now()
    # Förbered delade objekt en gång (tagg/person + plats).
    add_tags = [
        _get_or_create_tag(db, t.name, t.kind)
        for t in data.add_tags if t.name.strip()
    ]
    remove_keys = {(t.name.strip(), t.kind) for t in data.remove_tags if t.name.strip()}
    place = None
    if data.set_location is not None and data.set_location.strip():
        place = get_or_create_place(db, data.set_location.strip())
    # Datum/plats/taggar är delad metadata -> speglas till hopparad partner.
    shared_changed = bool(
        add_tags or remove_keys or place is not None or data.set_date is not None
    )

    for p in photos:
        if data.set_negative is not None:
            p.is_negative = 1 if data.set_negative else 0
        if data.set_reviewed is not None:
            p.reviewed_at = now if data.set_reviewed else None
        if data.set_date is not None:
            p.date_text = data.set_date.strip()
            p.date_year, p.date_month, p.date_precision = parse_date_text(p.date_text)
        if place is not None:
            p.place_id = place.id
            p.location = place.name
        for tag in add_tags:
            if tag not in p.tags:
                p.tags.append(tag)
        if remove_keys:
            p.tags = [t for t in p.tags if (t.name, t.kind) not in remove_keys]
        if shared_changed:
            _sync_pair_metadata(db, p)

    # Lägg foton i ett album (appendar sist, hoppar över redan ingående).
    if data.add_to_album is not None and db.get(Album, data.add_to_album):
        existing = {
            r[0] for r in db.query(AlbumPhoto.photo_id)
            .filter(AlbumPhoto.album_id == data.add_to_album).all()
        }
        pos = (
            db.query(func.max(AlbumPhoto.position))
            .filter(AlbumPhoto.album_id == data.add_to_album).scalar()
        )
        pos = (pos + 1) if pos is not None else 0
        for p in photos:
            if p.id not in existing:
                db.add(AlbumPhoto(album_id=data.add_to_album, photo_id=p.id, position=pos))
                existing.add(p.id)
                pos += 1

    db.commit()
    return JSONResponse({"ok": True, "count": len(photos)})


@router.post("/api/photos/reorder")
def reorder_photos(data: ReorderRequest, db: Session = Depends(get_db)):
    """Sätt manuell ordning (seq) efter listans index. seq är en tiebreaker inom
    samma år/månad - lämplig att sätta på en vy/sida med grovt daterade foton som
    skannats i oordning."""
    for i, pid in enumerate(data.ids):
        photo = db.get(Photo, pid)
        if photo:
            photo.seq = i
    db.commit()
    return JSONResponse({"ok": True, "count": len(data.ids)})


def _ordered_ids(db, q, reviewed, ptype, paired, folder, recursive, separate, sort, missing="") -> list[int]:
    """Foto-id i galleriets ordning för given filtrering (för prev/next-nav)."""
    rows = (
        _filtered_query(db, q, reviewed, ptype, paired, folder, recursive, separate, missing)
        .with_entities(Photo.id)
        .order_by(*_sort_order(sort))
        .all()
    )
    return [r[0] for r in rows]


@router.get("/review")
def review(db: Session = Depends(get_db)):
    """Granskningsläge: hoppa till första ogranskade fotot (galleriets ordning).
    Markeras ett som granskat och man går vidare hamnar man här igen och får
    nästa. Inga ogranskade kvar -> tillbaka till översikten."""
    photo = (
        _filtered_query(db, "", "no", "", "", "*", False, False)
        .order_by(*_sort_order("date"))
        .first()
    )
    if not photo:
        return RedirectResponse("/dashboard", status_code=302)
    return RedirectResponse(
        f"/photo/{photo.id}?reviewed=no&review=1", status_code=302
    )


@router.get("/photo/{photo_id}", response_class=HTMLResponse)
def photo_detail(
    photo_id: int, request: Request,
    q: str = "", reviewed: str = "", ptype: str = "", paired: str = "",
    folder: str = "*", recursive: bool = False, separate: bool = False,
    sort: str = "date", missing: str = "", ctx: str = "", ctx_id: int | None = None,
    review: bool = False,
    db: Session = Depends(get_db),
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    # Navigera inom samma lista man kom ifrån. ctx (person/tagg/plats/tidslinje)
    # har företräde; annars galleriets filtrering. Faller tillbaka på alla foton
    # om fotot inte ingår (t.ex. direktlänk eller dolt sekundär-negativ).
    ctx_ids = (
        context_ordered_ids(db, ctx, ctx_id, reviewed, ptype, paired, separate, sort)
        if ctx else None
    )
    in_ctx = ctx_ids is not None
    if in_ctx:
        ids = ctx_ids
    else:
        ids = _ordered_ids(
            db, q, reviewed, ptype, paired, folder, recursive, separate, sort, missing
        )
    if photo_id not in ids:
        ids = _ordered_ids(db, "", "", "", "", "*", False, True, sort)
        in_ctx = False

    prev_id = next_id = None
    pos = total = len(ids)
    if photo_id in ids:
        i = ids.index(photo_id)
        pos = i + 1
        prev_id = ids[i - 1] if i > 0 else None
        next_id = ids[i + 1] if i < len(ids) - 1 else None

    # Querystring som bär kontexten vidare i prev/next-länkar, samt bakåtlänk.
    if in_ctx:
        nav_qs = context_nav_qs(
            ctx, ctx_id, reviewed, ptype, paired, separate, sort
        )
        back_url, back_label = context_back(
            ctx, ctx_id, reviewed, ptype, paired, separate, sort
        )
    else:
        params = {}
        if q:
            params["q"] = q
        if reviewed:
            params["reviewed"] = reviewed
        if ptype:
            params["ptype"] = ptype
        if paired:
            params["paired"] = paired
        if missing:
            params["missing"] = missing
        if folder and folder != "*":
            params["folder"] = folder
        if recursive:
            params["recursive"] = "1"
        if separate:
            params["separate"] = "1"
        if sort and sort != "date":
            params["sort"] = sort
        nav_qs = ("?" + urlencode(params)) if params else ""
        back_url, back_label = "/" + nav_qs, "Galleri"

    paired = db.get(Photo, photo.paired_with_id) if photo.paired_with_id else None
    # Baksida: stöd-foto kopplat till detta foto. Och om DETTA foto självt är en
    # baksida, vilket foto det hör till.
    back = db.query(Photo).filter(Photo.back_of_id == photo.id).first()
    back_of = db.get(Photo, photo.back_of_id) if photo.back_of_id else None

    # Representativ GPS från platsen, som kart-förslag när fotot saknar egen.
    place_gps = None
    if photo.place_id and (photo.gps_lat is None or photo.gps_lon is None):
        avg = place_avg_gps(db, photo.place_id, exclude_photo_id=photo.id)
        if avg:
            place_gps = {"lat": round(avg[0], 6), "lon": round(avg[1], 6)}

    return templates.TemplateResponse(
        request,
        "photo.html",
        {
            "photo": photo,
            "paired": paired,
            "back": back,
            "back_of": back_of,
            "place_gps": place_gps,
            "prev_id": prev_id,
            "next_id": next_id,
            "pos": pos,
            "total": total,
            "nav_qs": nav_qs,
            "back_url": back_url,
            "back_label": back_label,
            "review": review,
        },
    )


@router.get("/thumb/{photo_id}")
def thumb(photo_id: int, db: Session = Depends(get_db)):
    path = THUMB_DIR / f"{photo_id}.jpg"
    if not path.exists():
        # Self-heal: regenerera ur originalet om det går (t.ex. efter flytt med
        # medhavd databas men utan thumbnail-cache). Annars 404.
        photo = db.get(Photo, photo_id)
        if not photo or not Path(photo.path).exists():
            raise HTTPException(404, "Thumbnail saknas")
        write_thumbnail(photo)
    return FileResponse(path)


# Format webbläsare kan visa inline. Övriga (TIFF/BMP/HEIC ...) renderas till JPEG.
_WEB_NATIVE = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def _web_native(photo) -> bool:
    return Path(photo.path).suffix.lower() in _WEB_NATIVE


@router.get("/image/{photo_id}")
def image(photo_id: int, raw: bool = False, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo or not Path(photo.path).exists():
        raise HTTPException(404, "Bildfil saknas")
    native = _web_native(photo)
    # raw=1: orienterad/roterad men UTAN färgjusteringar (för live-preview),
    # renderas on-the-fly och cachas inte.
    if raw:
        if not photo.rotation and native:
            return FileResponse(photo.path)
        img = load_oriented(Path(photo.path), photo.rotation or 0)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/jpeg")

    # Inga transformeringar OCH webb-native format: servera originalet direkt.
    if not photo.rotation and not has_adjustments(photo) and native:
        return FileResponse(photo.path)

    # Annars (transform eller t.ex. TIFF): servera cachad JPEG-rendering.
    cache = render_cache_path(photo.id)
    if not cache.exists():
        write_render(photo)
    return FileResponse(cache)


@router.post("/api/photos/{photo_id}/rotate")
def rotate_photo(
    photo_id: int, dir: str = "cw", db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    step = 90 if dir == "cw" else -90
    photo.rotation = ((photo.rotation or 0) + step) % 360
    # Transformera ansiktsregionerna så de följer med bilden (normaliserade
    # koordinater relativt den visade bilden). x/y = övre vänstra hörnet.
    for f in photo.faces:
        if dir == "cw":
            f.x, f.y, f.w, f.h = 1 - f.y - f.h, f.x, f.h, f.w
        else:
            f.x, f.y, f.w, f.h = f.y, 1 - f.x - f.w, f.h, f.w
        invalidate_face_thumb(f.id)  # crop roterar med
    db.commit()
    if Path(photo.path).exists():
        refresh_derived(photo)
    return JSONResponse({"ok": True, "rotation": photo.rotation})


@router.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(get_db)):
    """Ta bort ett foto ur katalogen (DB + cache). Rör ALDRIG originalfilen -
    den måste tas bort ur fotomappen separat, annars läggs den tillbaka vid
    nästa scan. Städar alla kopplingar explicit (SQLite-FK:erna är inte
    påslagna)."""
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    face_ids = [f.id for f in photo.faces]

    # Personers utvalda tumnagel kan peka på en av fotots ansiktsrutor.
    if face_ids:
        for tag in db.query(Tag).filter(Tag.thumb_face_id.in_(face_ids)).all():
            tag.thumb_face_id = None

    # Hopparning: koppla loss eventuell partner (åt båda håll).
    if photo.paired_with_id:
        partner = db.get(Photo, photo.paired_with_id)
        if partner:
            partner.paired_with_id = None
            partner.is_pair_primary = 0
    for other in db.query(Photo).filter(Photo.paired_with_id == photo.id).all():
        other.paired_with_id = None
        other.is_pair_primary = 0

    # Baksidor som pekar hit blir vanliga foton igen.
    for other in db.query(Photo).filter(Photo.back_of_id == photo.id).all():
        other.back_of_id = None

    # Album: nolla omslag som pekar hit, ta bort medlemskap.
    for alb in db.query(Album).filter(Album.cover_photo_id == photo.id).all():
        alb.cover_photo_id = None
    db.query(AlbumPhoto).filter(AlbumPhoto.photo_id == photo.id).delete(
        synchronize_session=False
    )

    db.delete(photo)  # tar ansiktsrutor (delete-orphan) + photo_tags-rader
    db.commit()

    # Diskcache (regenereras annars aldrig för ett borttaget foto).
    (THUMB_DIR / f"{photo_id}.jpg").unlink(missing_ok=True)
    invalidate_render(photo_id)
    for fid in face_ids:
        invalidate_face_thumb(fid)

    return JSONResponse({"ok": True})


@router.get("/api/photos/{photo_id}/auto-suggest")
def auto_suggest(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    if not Path(photo.path).exists():
        raise HTTPException(404, "Bildfil saknas")
    # Analysera basbilden (orienterad/roterad, utan tidigare färgjusteringar).
    img = load_oriented(Path(photo.path), photo.rotation or 0)
    return JSONResponse(suggest_auto(img))


@router.get("/api/photos/{photo_id}/preview")
def adjust_preview(
    photo_id: int,
    adj_brightness: float = 1.0, adj_contrast: float = 1.0, adj_gamma: float = 1.0,
    adj_saturation: float = 1.0, adj_red: float = 1.0, adj_green: float = 1.0,
    adj_blue: float = 1.0, db: Session = Depends(get_db),
):
    """Rendera en nedskalad förhandsvisning med givna (osparade) justeringar -
    för live-preview av alla reglage (inkl. gamma/per-kanal som CSS ej klarar)."""
    photo = db.get(Photo, photo_id)
    if not photo or not Path(photo.path).exists():
        raise HTTPException(404, "Bildfil saknas")
    img = load_oriented(Path(photo.path), photo.rotation or 0)
    img.thumbnail((1200, 1200))  # nedskalat för snabb rendering
    ns = SimpleNamespace(
        auto_tone=0, adj_brightness=adj_brightness, adj_contrast=adj_contrast,
        adj_gamma=adj_gamma, adj_saturation=adj_saturation,
        adj_red=adj_red, adj_green=adj_green, adj_blue=adj_blue,
    )
    out = apply_adjustments(img, ns)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=85)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")


@router.post("/api/photos/{photo_id}/adjust")
def adjust_photo(
    photo_id: int, data: PhotoAdjust, db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")
    photo.auto_tone = 1 if data.auto_tone else 0
    photo.adj_brightness = data.adj_brightness
    photo.adj_contrast = data.adj_contrast
    photo.adj_gamma = data.adj_gamma
    photo.adj_saturation = data.adj_saturation
    photo.adj_red = data.adj_red
    photo.adj_green = data.adj_green
    photo.adj_blue = data.adj_blue
    db.commit()
    if Path(photo.path).exists():
        refresh_derived(photo)
    return JSONResponse({"ok": True})


# Metadata som delas inom en hopparning (foto + negativ = en kombination).
# Per-bild-fält (is_negative, rotation, justeringar, exif_datetime, bildfilen)
# delas INTE.
_SHARED_META = [
    "date_text", "date_year", "date_month", "date_precision",
    "place_id", "location", "notes", "source",
    "gps_lat", "gps_lon", "gps_radius_m", "reviewed_at",
]


def _sync_pair_metadata(db: Session, photo: Photo) -> None:
    """Spegla delad metadata + taggar till det hopparade fotot, så att en
    hopparning beter sig som en kombination (redigera en -> uppdaterar båda)."""
    if not photo.paired_with_id:
        return
    partner = db.get(Photo, photo.paired_with_id)
    if not partner:
        return
    for f in _SHARED_META:
        setattr(partner, f, getattr(photo, f))
    partner.tags = list(photo.tags)


def _get_or_create_tag(db: Session, name: str, kind: str) -> Tag:
    name = name.strip()
    tag = (
        db.query(Tag)
        .filter(Tag.name == name, Tag.kind == kind)
        .first()
    )
    if not tag:
        tag = Tag(name=name, kind=kind)
        db.add(tag)
        db.flush()
    return tag


@router.post("/api/photos/{photo_id}")
def update_photo(
    photo_id: int, data: PhotoUpdate, db: Session = Depends(get_db)
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Foto hittades inte")

    photo.date_text = data.date_text.strip()
    # Härled år/månad/precision ur fritexten.
    photo.date_year, photo.date_month, photo.date_precision = parse_date_text(photo.date_text)
    # Plats normaliseras till en Place; location hålls som synkad cache.
    place_name = data.location.strip()
    if place_name:
        place = get_or_create_place(db, place_name)
        photo.place_id = place.id
        photo.location = place.name
    else:
        photo.place_id = None
        photo.location = ""
    photo.notes = data.notes.strip()
    photo.source = data.source.strip()
    photo.is_negative = 1 if data.is_negative else 0
    photo.gps_lat = data.gps_lat
    photo.gps_lon = data.gps_lon
    photo.gps_radius_m = data.gps_radius_m

    photo.tags = [
        _get_or_create_tag(db, t.name, t.kind)
        for t in data.tags
        if t.name.strip()
    ]
    # Personer med ansiktsregion på fotot måste alltid finnas i Personer-fältet
    # (man kan inte ta bort en person ur fältet om dess ansikte är markerat).
    present = {t.id for t in photo.tags}
    for f in photo.faces:
        if f.tag_id not in present:
            photo.tags.append(f.tag)
            present.add(f.tag_id)

    if data.mark_reviewed:
        photo.reviewed_at = _now()

    _sync_pair_metadata(db, photo)
    db.commit()
    return JSONResponse({"ok": True})
