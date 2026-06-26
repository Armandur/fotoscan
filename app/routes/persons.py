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
    PersonMerge, PersonMeta, PersonRename, PersonThumb, RelationApply, RelationIn,
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
        db.query(FaceRegion.photo_id).filter(
            FaceRegion.tag_id == tag.id, FaceRegion.confirmed == 1
        ).all()
    }
    return via_tags | via_faces


def _merge_person(db: Session, source: Tag, target: Tag) -> None:
    """Flytta source-personens ansikten och fototaggar till target, radera source."""
    db.query(FaceRegion).filter(FaceRegion.tag_id == source.id).update(
        {"tag_id": target.id}, synchronize_session=False
    )
    db.query(FaceRegion).filter(FaceRegion.suggested_tag_id == source.id).update(
        {"suggested_tag_id": target.id}, synchronize_session=False
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


def _best_region_id(db: Session, tag: Tag) -> int | None:
    """Auto-val av personens tumnagel: störst ansiktsarea (mest pixlar -> skarpast
    crop), med detektorns konfidens (frontal/kvalitet) som tiebreaker."""
    faces = (
        db.query(FaceRegion)
        .filter(FaceRegion.tag_id == tag.id, FaceRegion.confirmed == 1)
        .all()
    )
    if not faces:
        return None
    best = max(faces, key=lambda f: ((f.w or 0) * (f.h or 0), f.det_score or 0.0))
    return best.id


def _avatar_region_id(db: Session, tag: Tag) -> int | None:
    """Personens representativa ansiktsregion: manuellt vald (thumb_face_id) om
    den finns kvar och tillhör personen, annars auto-valt bästa ansiktet."""
    if tag.thumb_face_id:
        chosen = db.get(FaceRegion, tag.thumb_face_id)
        if chosen and chosen.tag_id == tag.id:
            return chosen.id
    return _best_region_id(db, tag)


def _person_regions(db: Session, tag: Tag) -> list[dict]:
    """Alla ansiktsregioner för personen (för tumnagel-väljaren)."""
    regions = (
        db.query(FaceRegion)
        .filter(FaceRegion.tag_id == tag.id, FaceRegion.confirmed == 1)
        .order_by(FaceRegion.id.desc())
        .all()
    )
    return [{"id": r.id, "photo_id": r.photo_id} for r in regions]


def _section_ids(db: Session, placeholder: bool) -> list[int]:
    """Person-id i samma ordning som /persons-sektionen (identifierade på namn,
    oidentifierade på Okänd-nummer)."""
    persons = db.query(Tag).filter(
        Tag.kind == "person", Tag.placeholder == (1 if placeholder else 0)
    ).all()
    if placeholder:
        def _k(t):
            m = re.search(r"(\d+)$", t.name)
            return int(m.group(1)) if m else 10 ** 9
        persons.sort(key=_k)
    else:
        persons.sort(key=lambda t: t.name.lower())
    return [t.id for t in persons]


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
        item = {"link_id": lk.id, "id": other.id, "name": other.name,
                "region_id": _avatar_region_id(db, other),
                "placeholder": bool(other.placeholder)}
        if lk.relation == "partner":
            partners.append(item)
        elif lk.relation == "parent":
            # person_id är förälder till related_id
            (children if lk.person_id == tag.id else parents).append(item)
    return {"parents": parents, "children": children, "partners": partners}


_PERSONS_PAGE = 60


def _lead_year(text: str | None) -> int:
    """Första 4-siffriga året i en fritext (för sortering); saknas -> stort tal
    så tomma hamnar sist."""
    if text:
        m = re.search(r"(\d{4})", text)
        if m:
            return int(m.group(1))
    return 10 ** 9


@router.get("/persons", response_class=HTMLResponse)
def persons_page(
    request: Request, q: str = "", filt: str = "all", sort: str = "name",
    ip: int = 1, up: int = 1, db: Session = Depends(get_db),
):
    persons = db.query(Tag).filter(Tag.kind == "person").all()
    # Familjelänk-antal per person i ett svep (för filter/visning).
    link_counts: dict[int, int] = {}
    for lk in db.query(PersonLink.person_id, PersonLink.related_id).all():
        link_counts[lk[0]] = link_counts.get(lk[0], 0) + 1
        link_counts[lk[1]] = link_counts.get(lk[1], 0) + 1

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
            "born": tag.born or "",
            "died": tag.died or "",
            "aliases": tag.aliases or "",
            "rel_count": link_counts.get(tag.id, 0),
        })

    # Sök (namn + alias).
    if q.strip():
        ql = q.strip().lower()
        rows = [r for r in rows
                if ql in r["name"].lower() or ql in r["aliases"].lower()]

    # Filter.
    if filt == "has_photos":
        rows = [r for r in rows if r["count"] > 0]
    elif filt == "no_photos":
        rows = [r for r in rows if r["count"] == 0]
    elif filt == "has_family":
        rows = [r for r in rows if r["rel_count"] > 0]
    # (identified/unknown styrs av sektionerna nedan + show_*)

    def _uk(r):  # Okänd-N på nummer
        m = re.search(r"(\d+)$", r["name"])
        return int(m.group(1)) if m else 10 ** 9

    def _sorted(items):
        if sort == "count":
            return sorted(items, key=lambda r: (-r["count"], r["name"].lower()))
        if sort == "born":
            return sorted(items, key=lambda r: (_lead_year(r["born"]), r["name"].lower()))
        if sort == "died":
            return sorted(items, key=lambda r: (_lead_year(r["died"]), r["name"].lower()))
        return None  # "name" -> sektionsspecifik nedan

    identified = [r for r in rows if not r["placeholder"]]
    unknown = [r for r in rows if r["placeholder"]]
    if _sorted(identified) is not None:
        identified, unknown = _sorted(identified), _sorted(unknown)
    else:
        identified = sorted(identified, key=lambda r: r["name"].lower())
        unknown = sorted(unknown, key=_uk)

    show_id = filt != "unknown"
    show_uk = filt != "identified"

    def _page(items, page):
        pages = max(1, (len(items) + _PERSONS_PAGE - 1) // _PERSONS_PAGE)
        page = max(1, min(page, pages))
        start = (page - 1) * _PERSONS_PAGE
        return items[start:start + _PERSONS_PAGE], page, pages

    id_items, ip, i_pages = _page(identified, ip)
    uk_items, up, u_pages = _page(unknown, up)
    return templates.TemplateResponse(
        request, "persons.html",
        {"identified": id_items if show_id else [],
         "unknown": uk_items if show_uk else [],
         "i_total": len(identified) if show_id else 0,
         "u_total": len(unknown) if show_uk else 0,
         "ip": ip, "up": up, "i_pages": i_pages, "u_pages": u_pages,
         "q": q, "filt": filt, "sort": sort},
    )


@router.get("/persons/tree", response_class=HTMLResponse)
def persons_tree_page(request: Request, start: int | None = None,
                      db: Session = Depends(get_db)):
    # MÅSTE ligga före /persons/{tag_id} - annars fångar int-routen "tree"
    # och kastar 422 (typvalidering sker efter path-matchning i FastAPI).
    return templates.TemplateResponse(
        request, "persons_tree.html", {"start": start or ""},
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
    # Prev/next inom personens sektion (identifierad/oidentifierad).
    sec = _section_ids(db, bool(tag.placeholder))
    prev_id = next_id = None
    pos = total = len(sec)
    if tag.id in sec:
        i = sec.index(tag.id)
        pos = i + 1
        prev_id = sec[i - 1] if i > 0 else None
        next_id = sec[i + 1] if i < len(sec) - 1 else None
    return templates.TemplateResponse(
        request, "person_detail.html",
        {"person": tag, "photos": photos,
         "region_id": _avatar_region_id(db, tag),
         "regions": _person_regions(db, tag),
         "relations": _relations(db, tag),
         "prev_id": prev_id, "next_id": next_id, "pos": pos, "total": total,
         "section": "Oidentifierade" if tag.placeholder else "Identifierade",
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


def _partners(db: Session, pid: int) -> set[int]:
    out = set()
    for lk in db.query(PersonLink).filter(
        PersonLink.relation == "partner",
        or_(PersonLink.person_id == pid, PersonLink.related_id == pid),
    ).all():
        out.add(lk.related_id if lk.person_id == pid else lk.person_id)
    return out


def _children(db: Session, pid: int) -> set[int]:
    return {r[0] for r in db.query(PersonLink.related_id).filter(
        PersonLink.person_id == pid, PersonLink.relation == "parent").all()}


def _is_parent(db: Session, parent_id: int, child_id: int) -> bool:
    return db.query(PersonLink).filter(
        PersonLink.person_id == parent_id, PersonLink.related_id == child_id,
        PersonLink.relation == "parent",
    ).first() is not None


def _suggest_parent(db: Session, parent_id: int, child_id: int, out: list, seen: set):
    """Lägg ett förslag (parent_id är förälder till child_id) om det inte redan
    finns och inte redan föreslagits."""
    key = (parent_id, child_id)
    if key in seen or parent_id == child_id or _is_parent(db, parent_id, child_id):
        return
    p, c = db.get(Tag, parent_id), db.get(Tag, child_id)
    if not p or not c:
        return
    seen.add(key)
    out.append({
        "person_id": parent_id, "related_id": child_id,
        "parent_name": p.name, "parent_region_id": _avatar_region_id(db, p),
        "child_name": c.name, "child_region_id": _avatar_region_id(db, c),
    })


@router.get("/api/persons/{tag_id}/relation-suggestions")
def relation_suggestions(tag_id: int, related_id: int, relation: str,
                         db: Session = Depends(get_db)):
    """Föreslå kompletterande förälder-länkar efter att en relation lagts till,
    så familjen blir symmetrisk (delade barn mellan partners)."""
    out: list = []
    seen: set = set()
    if relation == "parent_of":
        # tag är förälder till related_id (barnet) -> tags partners också förälder.
        for pa in _partners(db, tag_id):
            _suggest_parent(db, pa, related_id, out, seen)
    elif relation == "child_of":
        # related_id är förälder till tag -> related_ids partners också förälder.
        for pa in _partners(db, related_id):
            _suggest_parent(db, pa, tag_id, out, seen)
    elif relation == "partner":
        # tag & related_id är partners -> dela bådas barn med den andra.
        for c in _children(db, tag_id):
            _suggest_parent(db, related_id, c, out, seen)
        for c in _children(db, related_id):
            _suggest_parent(db, tag_id, c, out, seen)
    return JSONResponse({"suggestions": out})


@router.post("/api/persons/{tag_id}/relations/apply")
def apply_relations(tag_id: int, data: RelationApply, db: Session = Depends(get_db)):
    """Skapa flera förälder-länkar på en gång (från förslagen). Dedupar."""
    added = 0
    for lk in data.links:
        p, c = db.get(Tag, lk.person_id), db.get(Tag, lk.related_id)
        if not p or p.kind != "person" or not c or c.kind != "person":
            continue
        if lk.person_id == lk.related_id or _is_parent(db, lk.person_id, lk.related_id):
            continue
        db.add(PersonLink(person_id=lk.person_id, related_id=lk.related_id,
                          relation="parent"))
        added += 1
    db.commit()
    return JSONResponse({"ok": True, "added": added})


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


def _build_family_graph(db: Session):
    """Bygg släktgrafen ur PersonLink. Returnerar (nodes, partner_pairs,
    parent_pairs) där nodes = set av person-id med någon länk."""
    links = db.query(PersonLink).all()
    nodes: set[int] = set()
    partners: list[tuple[int, int]] = []
    parents: list[tuple[int, int]] = []  # (förälder, barn)
    for lk in links:
        nodes.add(lk.person_id)
        nodes.add(lk.related_id)
        if lk.relation == "partner":
            partners.append((lk.person_id, lk.related_id))
        elif lk.relation == "parent":
            parents.append((lk.person_id, lk.related_id))
    return nodes, partners, parents


def _components(nodes, partners, parents) -> list[list[int]]:
    """Sammanhängande komponenter (union-find) över både partner- och
    förälderkanter."""
    parent_of = {n: n for n in nodes}

    def find(x):
        while parent_of[x] != x:
            parent_of[x] = parent_of[parent_of[x]]
            x = parent_of[x]
        return x

    def union(a, b):
        parent_of[find(a)] = find(b)

    for a, b in partners + parents:
        union(a, b)
    groups: dict[int, list[int]] = {}
    for n in nodes:
        groups.setdefault(find(n), []).append(n)
    return sorted(groups.values(), key=len, reverse=True)


@router.get("/api/persons/tree-data")
def persons_tree_data(start: int | None = None, db: Session = Depends(get_db)):
    """family-chart-data för EN släkt (komponent). `start` väljer vilken person
    (och därmed komponent) som visas; annars största komponentens nav."""
    nodes, partners, parents = _build_family_graph(db)
    comps = _components(nodes, partners, parents)
    unlinked = db.query(Tag).filter(
        Tag.kind == "person", Tag.id.notin_(nodes or {-1})).count()

    # Länk-räkning per person (för att välja representativt nav).
    deg: dict[int, int] = {n: 0 for n in nodes}
    for a, b in partners + parents:
        deg[a] = deg.get(a, 0) + 1
        deg[b] = deg.get(b, 0) + 1

    def rep(comp):  # representativ person = flest länkar
        return max(comp, key=lambda n: deg.get(n, 0))

    # Komponent-lista för växlaren.
    comp_list = []
    for comp in comps:
        r = db.get(Tag, rep(comp))
        comp_list.append({"main": rep(comp), "size": len(comp),
                          "label": (r.name if r else "?") + f" ({len(comp)})"})

    if not comps:
        return JSONResponse({"data": [], "main_id": None, "components": [],
                             "unlinked": unlinked})

    # Välj komponent: den som innehåller `start`, annars största.
    chosen = comps[0]
    if start:
        for comp in comps:
            if start in comp:
                chosen = comp
                break
    main_id = start if (start and start in chosen) else rep(chosen)

    cset = set(chosen)
    # Bygg rels per person inom komponenten.
    rels: dict[int, dict] = {n: {"spouses": [], "children": []} for n in chosen}
    for a, b in partners:
        if a in cset and b in cset:
            if str(b) not in rels[a]["spouses"]:
                rels[a]["spouses"].append(str(b))
            if str(a) not in rels[b]["spouses"]:
                rels[b]["spouses"].append(str(a))
    for p, c in parents:
        if p in cset and c in cset:
            rels[p]["children"].append(str(c))
            # Tilldela förälder till father/mother-platsen (kön spåras inte).
            slot = "father" if "father" not in rels[c] else "mother"
            rels[c][slot] = str(p)

    data = []
    for n in chosen:
        t = db.get(Tag, n)
        if not t:
            continue
        rid = _avatar_region_id(db, t)
        data.append({
            "id": str(n),
            "data": {
                "name": t.name,
                "birthday": (t.born or "") + (("–" + t.died) if t.died else ""),
                "avatar": f"/api/faces/{rid}/thumb" if rid else "",
            },
            "rels": rels[n],
        })
    return JSONResponse({"data": data, "main_id": str(main_id),
                         "components": comp_list, "unlinked": unlinked})
