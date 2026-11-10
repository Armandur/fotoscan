def _persons_ordered(p) -> str:
    """Personer i bildtext: de med ansiktsruta först, sorterade vänster->höger
    (lägsta x), därefter personer utan ruta i namnordning."""
    xmin: dict[int, float] = {}
    for f in p.faces:
        if f.tag_id is not None and f.confirmed:
            xmin[f.tag_id] = min(xmin.get(f.tag_id, 2.0), f.x)
    # Oidentifierade platshållare ("Okänd-N") skrivs inte ut med namn.
    persons = [t for t in p.tags if t.kind == "person" and not getattr(t, "placeholder", 0)]
    with_face = sorted((t for t in persons if t.id in xmin), key=lambda t: xmin[t.id])
    without = sorted((t for t in persons if t.id not in xmin), key=lambda t: t.name)
    return ", ".join(t.name for t in with_face + without)


# Bildtextfält: nyckel -> (etikett, värdefunktion). Ordningen styr radordningen.
CAPTION_FIELDS = {
    "date": ("Datum", lambda p: p.date_text or (str(p.date_year) if p.date_year else "")),
    "place": ("Plats", lambda p: p.location or ""),
    "persons": ("Personer", _persons_ordered),
    "tags": ("Taggar", lambda p: ", ".join(t.name for t in p.tags if t.kind == "tag")),
    "source": ("Källa", lambda p: p.source or ""),
    "notes": ("Anteckning", lambda p: p.notes or ""),
    "filename": ("Fil", lambda p: p.filename),
}



def caption_lines(photo, fields: list[str]) -> list[dict]:
    """Bildtextrader som {key, text} (key används för ikon/styckebrytning i mallen)."""
    lines = []
    for key in CAPTION_FIELDS:  # fast ordning
        if key not in fields:
            continue
        _, fn = CAPTION_FIELDS[key]
        val = fn(photo).strip()
        if val:
            lines.append({"key": key, "text": val})
    return lines



