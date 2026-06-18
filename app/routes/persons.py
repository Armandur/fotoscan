import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import FaceRegion, PersonLink, Photo, Tag
from app.deps import get_db
from app.schemas import (
    PersonMerge, PersonMeta, PersonRename, PersonThumb, RelationIn,
)
from app.services.context import context_card_qs
from app.services.filtering import apply_dimensions, sort_order
from app.services.scanner import invalidate_face_thumb

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V


def _person_photo_ids(db: Session, tag: Tag) -> set[int]:
    """Foton där personen förekommer - via metadatatagg ELLER ansiktsregion."""
    via_tags = {p.id for p in tag.photos}
    via_faces = {
        r[0] for r in
        db.query(FaceRegion.photo_id).filter(FaceRegion.tag_id == tag.id).all()
    }
    return via_tags | via_faces


def _merge_person(db: Session, source: Tag, target: Tag) -> None:
    """Flytta source-personens ansikten och fototaggar till target, radera source."""
    db.query(FaceRegion).filter(FaceRegion.tag_id == source.id).update(
        {"tag_id": target.id}, synchronize_session=False
    )
    # Peka om familjelänkar till target, ta bort ev. själv-länkar.
    db.query(PersonLink).filter(PersonLink.person_id == source.id).update(
        {"person_id": target.id}, synchronize_session=False
    )
    db.query(PersonLink).filter(PersonLink.related_id == source.id).update(
        {"related_id": target.id}, synchronize_session=False
    )
    db.query(PersonLink).filter(PersonLink.person_id == PersonLink.related_id).delete(
        synchronize_session=False
    )
    db.expire_all()
    source = db.get(Tag, source.id)
    target = db.get(Tag, target.id)
    for photo in list(source.photos):
        if target not in photo.tags:
            photo.tags.append(target)
    db.delete(source)
    db.commit()


def _sample_region_id(db: Session, tag: Tag) -> int | None:
    region = (
        db.query(FaceRegion)
        .filter(FaceRegion.tag_id == tag.id)
        .order_by(FaceRegion.id.desc())
        .first()
    )
    return region.id if region else None


def _avatar_region_id(db: Session, tag: Tag) -> int | None:
    """Personens representativa ansiktsregion: vald (thumb_face_id) om den finns
    kvar och fortfarande tillhör personen, annars senaste ansiktet (fallback)."""
    if tag.thumb_face_id:
        chosen = db.get(FaceRegion, tag.thumb_face_id)
        if chosen and chosen.tag_id == tag.id:
            return chosen.id
    return _sample_region_id(db, tag)


def _person_regions(db: Session, tag: Tag) -> list[dict]:
    """Alla ansiktsregioner för personen (för tumnagel-väljaren)."""
    regions = (
        db.query(FaceRegion)
        .filter(FaceRegion.tag_id == tag.id)
        .order_by(FaceRegion.id.desc())
        .all()
    )
    return [{"id": r.id, "photo_id": r.photo_id} for r in regions]


def _relations(db: Session, tag: Tag) -> dict:
    """Familjelänkar för en person, grupperade: föräldrar/barn/partner.
    Varje post: {link_id, id, name}."""
    links = db.query(PersonLink).filter(
        or_(PersonLink.person_id == tag.id, PersonLink.related_id == tag.id)
    ).all()
    parents, children, partners = [], [], []
    for lk in links:
        other_id = lk.related_id if lk.person_id == tag.id else lk.person_id
        other = db.get(Tag, other_id)
        if not other:
            continue
        item = {"link_id": lk.id, "id": other.id, "name": other.name}
        if lk.relation == "partner":
            partners.append(item)
        elif lk.relation == "parent":
            # person_id är förälder till related_id
            (children if lk.person_id == tag.id else parents).append(item)
    return {"parents": parents, "children": children, "partners": partners}


@router.get("/persons", response_class=HTMLResponse)
def persons_page(request: Request, db: Session = Depends(get_db)):
    persons = db.query(Tag).filter(Tag.kind == "person").order_by(Tag.name).all()
    rows = []
    for tag in persons:
        ids = _person_photo_ids(db, tag)
        rows.append({
            "id": tag.id,
            "name": tag.name,
            "count": len(ids),
            "region_id": _avatar_region_id(db, tag),
            "sample_photo": min(ids) if ids else None,
            "placeholder": bool(tag.placeholder),
        })
    identified = sorted((r for r in rows if not r["placeholder"]), key=lambda r: r["name"].lower())
    # Oidentifierade ("Okänd-N") sorteras på sitt nummer.
    def _uk(r):
        m = re.search(r"(\d+)$", r["name"])
        return int(m.group(1)) if m else 10 ** 9
    unknown = sorted((r for r in rows if r["placeholder"]), key=_uk)
    return templates.TemplateResponse(
        request, "persons.html", {"identified": identified, "unknown": unknown},
    )


@router.get("/persons/{tag_id}", response_class=HTMLResponse)
def person_detail(
    tag_id: int, request: Request,
    reviewed: str = "", ptype: str = "", paired: str = "",
    separate: bool = False, sort: str = "date",
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    ids = _person_photo_ids(db, tag)
    photos = []
    if ids:
        query = db.query(Photo).filter(Photo.id.in_(ids))
        query = apply_dimensions(query, reviewed, ptype, paired, separate)
        photos = query.order_by(*sort_order(sort)).all()
    card_qs = context_card_qs(
        "person", tag.id, reviewed, ptype, paired, separate, sort
    )
    return templates.TemplateResponse(
        request, "person_detail.html",
        {"person": tag, "photos": photos,
         "region_id": _avatar_region_id(db, tag),
         "regions": _person_regions(db, tag),
         "relations": _relations(db, tag),
         "all_persons": db.query(Tag).filter(Tag.kind == "person").order_by(Tag.name).all(),
         "reviewed": reviewed, "ptype": ptype, "paired": paired,
         "separate": separate, "sort": sort, "card_qs": card_qs},
    )


@router.post("/api/persons/{tag_id}/rename")
def rename_person(
    tag_id: int, data: PersonRename, db: Session = Depends(get_db)
):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    new_name = data.name.strip()
    if not new_name:
        raise HTTPException(400, "Ange ett namn")

    existing = (
        db.query(Tag)
        .filter(Tag.kind == "person", Tag.name == new_name, Tag.id != tag.id)
        .first()
    )
    if not existing:
        tag.name = new_name
        tag.placeholder = 0  # namngiven = identifierad
        db.commit()
        return JSONResponse({"ok": True, "id": tag.id, "name": new_name, "merged": False})

    # Namnet finns redan -> slå ihop denna person in i den befintliga.
    target_id = existing.id
    _merge_person(db, tag, existing)
    return JSONResponse(
        {"ok": True, "id": target_id, "name": new_name, "merged": True}
    )


@router.post("/api/persons/{tag_id}/thumb")
def set_person_thumb(
    tag_id: int, data: PersonThumb, db: Session = Depends(get_db)
):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    if data.face_id is not None:
        region = db.get(FaceRegion, data.face_id)
        if not region or region.tag_id != tag.id:
            raise HTTPException(400, "Ansiktet tillhör inte personen")
    tag.thumb_face_id = data.face_id
    db.commit()
    return JSONResponse({"ok": True})


@router.delete("/api/persons/{tag_id}")
def delete_person(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    for (rid,) in db.query(FaceRegion.id).filter(FaceRegion.tag_id == tag.id).all():
        invalidate_face_thumb(rid)
    db.query(FaceRegion).filter(FaceRegion.tag_id == tag.id).delete(
        synchronize_session=False
    )
    db.query(PersonLink).filter(
        or_(PersonLink.person_id == tag.id, PersonLink.related_id == tag.id)
    ).delete(synchronize_session=False)
    db.delete(tag)
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/persons/{tag_id}/meta")
def set_person_meta(tag_id: int, data: PersonMeta, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    tag.born = data.born.strip()
    tag.died = data.died.strip()
    tag.aliases = ", ".join(a.strip() for a in data.aliases.split(",") if a.strip())
    tag.bio = data.bio.strip()
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/persons/{tag_id}/relations")
def add_relation(tag_id: int, data: RelationIn, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    other = db.get(Tag, data.related_id)
    if not tag or tag.kind != "person" or not other or other.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    if tag.id == other.id:
        raise HTTPException(400, "Kan inte länka en person till sig själv")
    # Normalisera till lagrad form (parent: person_id är förälder till related_id).
    if data.relation == "parent_of":
        pid, rid, rel = tag.id, other.id, "parent"
    elif data.relation == "child_of":
        pid, rid, rel = other.id, tag.id, "parent"
    elif data.relation == "partner":
        pid, rid, rel = tag.id, other.id, "partner"
    else:
        raise HTTPException(400, "Okänd relationstyp")
    exists = db.query(PersonLink).filter(
        PersonLink.person_id == pid, PersonLink.related_id == rid,
        PersonLink.relation == rel,
    ).first()
    if not exists:
        db.add(PersonLink(person_id=pid, related_id=rid, relation=rel))
        db.commit()
    return JSONResponse({"ok": True})


@router.delete("/api/persons/{tag_id}/relations/{link_id}")
def delete_relation(tag_id: int, link_id: int, db: Session = Depends(get_db)):
    link = db.get(PersonLink, link_id)
    if link and tag_id in (link.person_id, link.related_id):
        db.delete(link)
        db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/persons/{tag_id}/merge")
def merge_person(
    tag_id: int, data: PersonMerge, db: Session = Depends(get_db)
):
    source = db.get(Tag, tag_id)
    target = db.get(Tag, data.into_id)
    if not source or source.kind != "person":
        raise HTTPException(404, "Person hittades inte")
    if not target or target.kind != "person":
        raise HTTPException(404, "Målpersonen hittades inte")
    if source.id == target.id:
        raise HTTPException(400, "Kan inte slå ihop en person med sig själv")
    name = target.name
    _merge_person(db, source, target)
    return JSONResponse({"ok": True, "id": data.into_id, "name": name})
