from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import Tag
from app.deps import get_db

router = APIRouter()


@router.get("/api/tags")
def list_tags(kind: str = "", db: Session = Depends(get_db)):
    """Lista taggar för autocomplete. Filtrera på kind (person/tag) om angivet."""
    query = db.query(Tag)
    if kind:
        query = query.filter(Tag.kind == kind)
    tags = query.order_by(Tag.name).all()
    return [{"name": t.name, "kind": t.kind} for t in tags]
