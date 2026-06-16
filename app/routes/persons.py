from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import FaceRegion, Photo, Tag
from app.deps import get_db
from app.schemas import PersonMerge, PersonRename, PersonThumb
from app.services.context import context_card_qs
from app.services.filtering import apply_dimensions, sort_order

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
        })
    return templates.TemplateResponse(request, "persons.html", {"persons": rows})


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
    db.query(FaceRegion).filter(FaceRegion.tag_id == tag.id).delete(
        synchronize_session=False
    )
    db.delete(tag)
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
