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


def render_album_pdf(album: Album, layout: int, fields: list[str], subtitle: str = "") -> bytes:
    """Returnerar PDF-bytes för albumet. layout = antal bilder per A4-sida (1/2/4/6)."""
    if layout not in (1, 2, 4, 6):
        layout = 4
    photos = [e.photo for e in album.entries]  # ordnade på position

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        items = []
        for i, photo in enumerate(photos):
            img = render_photo(photo)
            img.thumbnail((_PRINT_MAX, _PRINT_MAX))
            dest = tmpdir / f"{i}.jpg"
            img.save(dest, "JPEG", quality=88)
            items.append({"src": dest.as_uri(), "lines": _caption_lines(photo, fields)})

        pages = [items[i:i + layout] for i in range(0, len(items), layout)]
        html = _env.get_template("album_pdf.html").render(
            title=album.name, subtitle=subtitle, layout=layout, pages=pages,
        )
        return HTML(string=html, base_url=str(tmpdir)).write_pdf()
