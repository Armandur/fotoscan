"""PDF-export av album via weasyprint (HTML/CSS -> PDF). Varje foto renderas
till en print-storlek temp-JPEG (orienterad + justerad), bilderna chunkas i
sidor om N (layout) och renderas via en Jinja-mall."""
import tempfile
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

from app.config import BASE_DIR
from app.database import Album
from app.services.scanner import render_photo

_PRINT_MAX = 1600  # px, längsta sida på inbäddade bilder

# Bildtextfält: nyckel -> (etikett, värdefunktion). Ordningen styr radordningen.
CAPTION_FIELDS = {
    "date": ("Datum", lambda p: p.date_text or (str(p.date_year) if p.date_year else "")),
    "place": ("Plats", lambda p: p.location or ""),
    "persons": ("Personer", lambda p: ", ".join(t.name for t in p.tags if t.kind == "person")),
    "tags": ("Taggar", lambda p: ", ".join(t.name for t in p.tags if t.kind == "tag")),
    "source": ("Källa", lambda p: p.source or ""),
    "notes": ("Anteckning", lambda p: p.notes or ""),
    "filename": ("Fil", lambda p: p.filename),
}

_env = Environment(
    loader=FileSystemLoader(str(BASE_DIR / "app" / "templates")), autoescape=True
)


def _caption_lines(photo, fields: list[str]) -> list[str]:
    lines = []
    for key in CAPTION_FIELDS:  # fast ordning
        if key not in fields:
            continue
        _, fn = CAPTION_FIELDS[key]
        val = fn(photo).strip()
        if val:
            lines.append(val)
    return lines


def _build_sections(album: Album, default_layout: int) -> list[dict]:
    """Dela albumets entries i avsnitt. Ett foto med section_heading inleder ett
    nytt avsnitt (med ev. egen layout). Foton före första rubriken = ett avsnitt
    utan rubrik."""
    sections: list[dict] = []
    cur = {"heading": None, "layout": default_layout, "entries": []}
    for e in album.entries:  # ordnade på position
        if e.section_heading:
            if cur["entries"]:
                sections.append(cur)
            cur = {
                "heading": e.section_heading,
                "layout": e.section_layout or default_layout,
                "entries": [],
            }
        cur["entries"].append(e)
    if cur["entries"]:
        sections.append(cur)
    return sections


def render_album_pdf(album: Album, layout: int, fields: list[str], subtitle: str = "") -> bytes:
    """Returnerar PDF-bytes för albumet. layout = antal bilder per A4-sida (1/2/4/6).
    Avsnitt (section_heading) bryts till nya sidor med egen layout."""
    if layout not in (1, 2, 4, 6):
        layout = 4

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)

        def make_item(idx: int, photo) -> dict:
            img = render_photo(photo)
            img.thumbnail((_PRINT_MAX, _PRINT_MAX))
            dest = tmpdir / f"{idx}.jpg"
            img.save(dest, "JPEG", quality=88)
            return {"src": dest.as_uri(), "lines": _caption_lines(photo, fields)}

        # Bygg sidor: varje avsnitt chunkas på sin layout; rubriken visas överst
        # på avsnittets första sida.
        pages: list[dict] = []
        idx = 0
        for sec in _build_sections(album, layout):
            lay = sec["layout"] if sec["layout"] in (1, 2, 4, 6) else layout
            items = [make_item(idx + j, e.photo) for j, e in enumerate(sec["entries"])]
            idx += len(items)
            chunks = [items[i:i + lay] for i in range(0, len(items), lay)]
            for k, chunk in enumerate(chunks):
                pages.append({
                    "heading": sec["heading"] if k == 0 else None,
                    "layout": lay,
                    "cells": chunk,
                })

        html = _env.get_template("album_pdf.html").render(
            title=album.name, subtitle=subtitle, pages=pages,
        )
        return HTML(string=html, base_url=str(tmpdir)).write_pdf()
