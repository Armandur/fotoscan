from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR, ASSET_V
from app.database import Photo, Tag
from app.deps import get_db
from app.schemas import NameIn, TagParentUpdate
from app.services.context import context_card_qs
from app.services.filtering import apply_dimensions, sort_order

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["asset_v"] = ASSET_V


@router.get("/api/tags")
def list_tags(kind: str = "", db: Session = Depends(get_db)):
    """Lista taggar för autocomplete. Filtrera på kind (person/tag) om angivet."""
    query = db.query(Tag)
    if kind:
        query = query.filter(Tag.kind == kind)
    tags = query.order_by(Tag.name).all()
    return [{"name": t.name, "kind": t.kind, "id": t.id} for t in tags]


@router.get("/tags", response_class=HTMLResponse)
def tags_page(request: Request, db: Session = Depends(get_db)):
    all_tags = db.query(Tag).filter(Tag.kind == "tag").order_by(Tag.name).all()

    def get_descendant_ids(tag_id: int):
        ids = []
        for t in all_tags:
            if t.parent_id == tag_id:
                ids.append(t.id)
                ids.extend(get_descendant_ids(t.id))
        return ids

    def build_tree(parent_id: int | None):
        children = [t for t in all_tags if t.parent_id == parent_id]
        res = []
        for t in children:
            res.append({
                "id": t.id,
                "name": t.name,
                "count": len(t.photos),
                "sample": min((p.id for p in t.photos), default=None),
                "children": build_tree(t.id),
                "parent_id": t.parent_id,
                "descendant_ids": get_descendant_ids(t.id)
            })
        return res

    tree = build_tree(None)
    # Skicka även med platt lista för föräldraval (alla utom sig själv och barn hanteras i UI)
    all_tags_simplified = [
        {"id": t.id, "name": t.name} for t in all_tags
    ]
    return templates.TemplateResponse(
        request, "tags.html", {"tree": tree, "all_tags": all_tags_simplified}
    )


@router.get("/tags/{tag_id}", response_class=HTMLResponse)
def tag_detail(
    tag_id: int, request: Request,
    reviewed: str = "", ptype: str = "", paired: str = "",
    separate: bool = False, sort: str = "date",
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "tag":
        raise HTTPException(404, "Taggen hittades inte")

    def get_all_tag_ids(t: Tag) -> list[int]:
        ids = [t.id]
        for child in t.children:
            ids.extend(get_all_tag_ids(child))
        return ids

    tag_ids = get_all_tag_ids(tag)

    query = db.query(Photo).filter(Photo.tags.any(Tag.id.in_(tag_ids)))
    query = apply_dimensions(query, reviewed, ptype, paired, separate)
    photos = query.order_by(*sort_order(sort)).all()
    card_qs = context_card_qs(
        "tag", tag.id, reviewed, ptype, paired, separate, sort
    )
    return templates.TemplateResponse(
        request, "tag_detail.html",
        {"tag": tag, "photos": photos, "reviewed": reviewed, "ptype": ptype,
         "paired": paired, "separate": separate, "sort": sort,
         "card_qs": card_qs},
    )


@router.post("/api/tags/create")
def create_tag(data: NameIn, db: Session = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Ange ett namn")
    existing = (
        db.query(Tag).filter(Tag.kind == "tag", Tag.name == name).first()
    )
    if existing:
        return JSONResponse({"ok": True, "id": existing.id, "existed": True})
    tag = Tag(name=name, kind="tag", parent_id=data.parent_id)
    db.add(tag)
    db.commit()
    return JSONResponse({"ok": True, "id": tag.id, "existed": False})


@router.post("/api/tags/{tag_id}/parent")
def set_tag_parent(tag_id: int, data: TagParentUpdate, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "tag":
        raise HTTPException(404, "Taggen hittades inte")

    if data.parent_id is None:
        tag.parent_id = None
        db.commit()
        return {"ok": True}

    if data.parent_id == tag.id:
        raise HTTPException(400, "En tagg kan inte vara sin egen förälder")

    # Kolla efter cykler (om målet är en ättling till tag)
    def is_descendant(target_id: int, current_tag: Tag) -> bool:
        for child in current_tag.children:
            if child.id == target_id:
                return True
            if is_descendant(target_id, child):
                return True
        return False

    if is_descendant(data.parent_id, tag):
        raise HTTPException(400, "Mål-föräldern är en ättling till taggen (cykel)")

    tag.parent_id = data.parent_id
    db.commit()
    return {"ok": True}


@router.post("/api/tags/{tag_id}/rename")
def rename_tag(tag_id: int, data: NameIn, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "tag":
        raise HTTPException(404, "Taggen hittades inte")
    new_name = data.name.strip()
    if not new_name:
        raise HTTPException(400, "Ange ett namn")

    existing = (
        db.query(Tag)
        .filter(Tag.kind == "tag", Tag.name == new_name, Tag.id != tag.id)
        .first()
    )
    if not existing:
        tag.name = new_name
        db.commit()
        return JSONResponse({"ok": True, "id": tag.id, "merged": False})

    # Namnet finns redan -> slå ihop taggen i den befintliga.
    # Flytta foton
    for photo in list(tag.photos):
        if existing not in photo.tags:
            photo.tags.append(existing)
    # Flytta barn till den överlevande taggen via relationen (så de tas ur
    # tag.children och inte nullställs när tag raderas).
    for child in list(tag.children):
        child.parent = existing

    db.delete(tag)
    db.commit()
    return JSONResponse({"ok": True, "id": existing.id, "merged": True})


@router.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "tag":
        raise HTTPException(404, "Taggen hittades inte")

    # Flytta barn till förälder (eller rot) via relationen, så de tas ur
    # tag.children och inte nullställs när tag raderas.
    grandparent = tag.parent
    for child in list(tag.children):
        child.parent = grandparent

    db.delete(tag)
    db.commit()
    return JSONResponse({"ok": True})
