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

# Sidformat: @page-size för PDF, innehållshöjd (sidhöjd - 2*marginal), samt
# sidmått i cm (för layoutvyns låsta sida + zoom). Delas av PDF och layoutvy.
PAGE_FORMATS = {
    "a4p": {"label": "A4 stående", "size": "A4 portrait", "page_h": "27.5cm", "w_cm": 21.0, "h_cm": 29.7},
    "a4l": {"label": "A4 liggande", "size": "A4 landscape", "page_h": "18.8cm", "w_cm": 29.7, "h_cm": 21.0},
    "a5p": {"label": "A5 stående", "size": "A5 portrait", "page_h": "18.8cm", "w_cm": 14.8, "h_cm": 21.0},
}


def page_format(album) -> dict:
    return PAGE_FORMATS.get(album.page_format, PAGE_FORMATS["a4p"])
# Bootstrap-icons-fonten för bildtextikoner i PDF:en (laddas via @font-face).
_BI_FONT = (BASE_DIR / "app" / "static" / "vendor" / "fonts" / "bootstrap-icons.woff2").as_uri()

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




def entry_caption_fields(entry, default_fields: list[str]) -> list[str]:
    """Bildtextfält för ett album-foto: per-foto-override om satt, annars
    albumets standard. caption_fields None = standard; "" = ingen bildtext."""
    if entry.caption_fields is None:
        return default_fields
    return [f for f in entry.caption_fields.split(",") if f]


def build_pages(album: Album, default_layout: int) -> list[dict]:
    """Dela albumet i sidor (samma modell för layoutvyn och PDF:en). Ett foto med
    section_heading ELLER blank_before inleder en ny körning (ny sida); foton
    chunkas per körning. Tomma sidor (blank_before + albumets trailing_blanks)
    bäddas in. Returnerar [{heading, layout, entries, blank}]."""
    if default_layout not in (1, 2, 4, 6):
        default_layout = 4
    # Gruppera i körningar som bryts av rubrik eller infogade tomma sidor.
    runs: list[dict] = []
    cur = None
    for e in album.entries:  # ordnade på position
        brk = bool(e.section_heading) or (e.blank_before or 0) > 0
        if cur is None or brk:
            lay = e.section_layout if e.section_layout in (1, 2, 4, 6) else default_layout
            cur = {"heading": e.section_heading, "layout": lay,
                   "blanks": (e.blank_before or 0), "entries": []}
            runs.append(cur)
        cur["entries"].append(e)

    pages: list[dict] = []
    for run in runs:
        for _ in range(run["blanks"]):
            pages.append({"blank": True})
        lay = run["layout"]
        chunks = [run["entries"][i:i + lay] for i in range(0, len(run["entries"]), lay)]
        for k, chunk in enumerate(chunks):
            pages.append({
                "heading": run["heading"] if k == 0 else None,
                "layout": lay, "entries": chunk, "blank": False,
            })
    for _ in range(album.trailing_blanks or 0):
        pages.append({"blank": True})
    return pages


def render_album_pdf(album: Album, layout: int, fields: list[str], subtitle: str = "") -> bytes:
    """Returnerar PDF-bytes för albumet. layout = antal bilder per A4-sida (1/2/4/6).
    Avsnitt (section_heading) bryts till nya sidor med egen layout."""
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        idx = 0

        # Titelsidesbild (om vald och med i albumet).
        cover_src = None
        if album.cover_photo_id:
            cover = next(
                (e.photo for e in album.entries if e.photo_id == album.cover_photo_id),
                None,
            )
            if cover:
                img = render_photo(cover)
                img.thumbnail((_PRINT_MAX, _PRINT_MAX))
                dest = tmpdir / "cover.jpg"
                img.save(dest, "JPEG", quality=88)
                cover_src = dest.as_uri()

        out_pages: list[dict] = []
        for page in build_pages(album, layout):
            if page.get("blank"):
                out_pages.append({"blank": True})
                continue
            cells = []
            for entry in page["entries"]:
                photo = entry.photo
                img = render_photo(photo)
                img.thumbnail((_PRINT_MAX, _PRINT_MAX))
                dest = tmpdir / f"{idx}.jpg"
                img.save(dest, "JPEG", quality=88)
                idx += 1
                lines = caption_lines(photo, entry_caption_fields(entry, fields))
                cells.append({"src": dest.as_uri(), "lines": lines})
            out_pages.append({
                "heading": page["heading"], "layout": page["layout"],
                "cells": cells, "blank": False,
            })

        fmt = page_format(album)
        html = _env.get_template("album_pdf.html").render(
            title=album.name, subtitle=subtitle, pages=out_pages,
            bi_font=_BI_FONT, cover_src=cover_src,
            page_size=fmt["size"], page_h=fmt["page_h"],
        )
        return HTML(string=html, base_url=str(tmpdir)).write_pdf()
