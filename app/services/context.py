"""Bläddringskontext: när en bild öppnas från person-/tagg-/plats-/tidslinjevyn
ska prev/next i detaljvyn gå genom just den listan, inte hela galleriet.

ctx = "person" | "tag" | "place" | "timeline" (+ ctx_id för de tre första).
Speglar respektive vys foto-query så ordningen blir densamma som man ser."""
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.database import FaceRegion, Photo, Tag
from app.services.filtering import apply_dimensions, sort_order

_CTX_PATHS = {
    "person": "/persons/{id}", "tag": "/tags/{id}",
    "place": "/place/{id}", "timeline": "/timeline",
}
_CTX_LABELS = {
    "person": "Till personen", "tag": "Till taggen",
    "place": "Till platsen", "timeline": "Till tidslinjen",
}


def _descendant_tag_ids(tag: Tag) -> list[int]:
    ids = [tag.id]
    for child in tag.children:
        ids.extend(_descendant_tag_ids(child))
    return ids


def context_query(db: Session, ctx: str, ctx_id: int | None):
    """Bas-Photo-query för en ursprungsvy, eller None om ctx är okänt/ogiltigt."""
    if ctx == "person" and ctx_id:
        tag = db.get(Tag, ctx_id)
        if not tag or tag.kind != "person":
            return None
        via_tags = {p.id for p in tag.photos}
        via_faces = {
            r[0] for r in
            db.query(FaceRegion.photo_id).filter(
                FaceRegion.tag_id == tag.id, FaceRegion.confirmed == 1
            ).all()
        }
        return db.query(Photo).filter(Photo.id.in_(via_tags | via_faces))
    if ctx == "tag" and ctx_id:
        tag = db.get(Tag, ctx_id)
        if not tag or tag.kind != "tag":
            return None
        ids = _descendant_tag_ids(tag)
        return db.query(Photo).filter(Photo.tags.any(Tag.id.in_(ids)))
    if ctx == "place" and ctx_id:
        return db.query(Photo).filter(Photo.place_id == ctx_id)
    if ctx == "timeline":
        return db.query(Photo)
    return None


def context_ordered_ids(
    db: Session, ctx: str, ctx_id: int | None,
    reviewed: str, ptype: str, paired: str, separate: bool, sort: str,
) -> list[int] | None:
    """Foto-id i ursprungsvyns ordning (med samma filter), eller None om ctx
    inte gick att tolka -> anroparen faller tillbaka på galleriet."""
    query = context_query(db, ctx, ctx_id)
    if query is None:
        return None
    query = apply_dimensions(query, reviewed, ptype, paired, separate)
    rows = query.with_entities(Photo.id).order_by(*sort_order(sort)).all()
    return [r[0] for r in rows]


def _filter_params(reviewed, ptype, paired, separate, sort) -> dict:
    p = {}
    if reviewed:
        p["reviewed"] = reviewed
    if ptype:
        p["ptype"] = ptype
    if paired:
        p["paired"] = paired
    if separate:
        p["separate"] = "1"
    if sort and sort != "date":
        p["sort"] = sort
    return p


def context_card_qs(
    ctx: str, ctx_id: int | None,
    reviewed="", ptype="", paired="", separate=False, sort="date",
) -> str:
    """'?...'-querystring som länkar ett kort till detaljvyn med kontexten kvar."""
    params = {"ctx": ctx}
    if ctx_id:
        params["ctx_id"] = ctx_id
    params.update(_filter_params(reviewed, ptype, paired, separate, sort))
    return "?" + urlencode(params)


def context_nav_qs(
    ctx: str, ctx_id: int | None,
    reviewed="", ptype="", paired="", separate=False, sort="date",
) -> str:
    """Samma som context_card_qs - bärs vidare i prev/next-länkarna."""
    return context_card_qs(ctx, ctx_id, reviewed, ptype, paired, separate, sort)


def context_back(
    ctx: str, ctx_id: int | None,
    reviewed="", ptype="", paired="", separate=False, sort="date",
) -> tuple[str, str] | None:
    """(url, etikett) tillbaka till ursprungsvyn, eller None om ctx okänt."""
    if ctx not in _CTX_PATHS:
        return None
    path = _CTX_PATHS[ctx].format(id=ctx_id)
    qs = _filter_params(reviewed, ptype, paired, separate, sort)
    url = path + ("?" + urlencode(qs) if qs else "")
    return url, _CTX_LABELS[ctx]
