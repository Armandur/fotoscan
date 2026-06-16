from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.database import Photo, Tag
from app.deps import get_db
from app.schemas import NameIn
from app.services.filtering import apply_dimensions, sort_order

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))


@router.get("/api/tags")
def list_tags(kind: str = "", db: Session = Depends(get_db)):
    """Lista taggar för autocomplete. Filtrera på kind (person/tag) om angivet."""
    query = db.query(Tag)
    if kind:
        query = query.filter(Tag.kind == kind)
    tags = query.order_by(Tag.name).all()
    return [{"name": t.name, "kind": t.kind} for t in tags]


@router.get("/tags", response_class=HTMLResponse)
def tags_page(request: Request, db: Session = Depends(get_db)):
    tags = db.query(Tag).filter(Tag.kind == "tag").order_by(Tag.name).all()
    rows = [
        {
            "id": t.id,
            "name": t.name,
            "count": len(t.photos),
            "sample": min((p.id for p in t.photos), default=None),
        }
        for t in tags
    ]
    return templates.TemplateResponse(request, "tags.html", {"tags": rows})


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
    query = db.query(Photo).filter(Photo.tags.any(Tag.id == tag.id))
    query = apply_dimensions(query, reviewed, ptype, paired, separate)
    photos = query.order_by(*sort_order(sort)).all()
    return templates.TemplateResponse(
        request, "tag_detail.html",
        {"tag": tag, "photos": photos, "reviewed": reviewed, "ptype": ptype,
         "paired": paired, "separate": separate, "sort": sort},
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
    tag = Tag(name=name, kind="tag")
    db.add(tag)
    db.commit()
    return JSONResponse({"ok": True, "id": tag.id, "existed": False})


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
    for photo in list(tag.photos):
        if existing not in photo.tags:
            photo.tags.append(existing)
    db.delete(tag)
    db.commit()
    return JSONResponse({"ok": True, "id": existing.id, "merged": True})


@router.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.kind != "tag":
        raise HTTPException(404, "Taggen hittades inte")
    db.delete(tag)
    db.commit()
    return JSONResponse({"ok": True})
