import zipfile
from pathlib import Path

from docx import Document
from docx.shared import Inches

from app.services.captions import CAPTION_FIELDS, caption_lines
from app.services.scanner import render_photo


def build_package(entries: list[dict], title: str, directory: Path) -> Path:
    document = Document()
    document.add_heading(title, 0)
    document.add_paragraph(f"{len(entries)} bilder. Filnamnen följer albumets ordning.")
    destination = directory / "bilder-och-bildlista.zip"
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_STORED) as archive:
        for index, entry in enumerate(entries, 1):
            photo = entry["photo"]
            name = f"Bilder/{index:03d}_foto-{photo.id}.jpg"
            try:
                with render_photo(photo) as image:
                    image.thumbnail((3840, 3840))
                    # En ny bild tar bort ärvd EXIF, GPS och andra inbäddade fält.
                    clean = image.copy()
                    clean.info.clear()
                    picture = directory / "bild.jpg"
                    clean.save(picture, "JPEG", quality=95)
                    archive.write(picture, name)
                    clean.thumbnail((600, 600))
                    preview = directory / "preview.jpg"
                    clean.save(preview, "JPEG", quality=85)
                    width, height = clean.size
                    clean.close()
            except (OSError, ValueError) as error:
                raise ValueError(f"Kunde inte läsa bilden {photo.filename}. Kontrollera originalfilen.") from error
            if index > 1:
                document.add_page_break()
            document.add_heading(f"Bild {index}", 1)
            document.add_paragraph(name)
            document.add_paragraph(f"Originalfil: {photo.filename}")
            document.add_picture(str(preview), width=Inches(min(5.5, 4.5 * width / height)))
            for line in entry["lines"]:
                document.add_paragraph(f"{CAPTION_FIELDS[line['key']][0]}: {line['text']}")
            if not entry["lines"]:
                document.add_paragraph("Ingen beskrivande metadata registrerad.")
        doc_path = directory / "Bildlista.docx"
        document.save(doc_path)
        archive.write(doc_path, "Bildlista.docx")
    return destination


def snapshot_entries(album, fields):
    return [{"photo": entry.photo, "lines": caption_lines(entry.photo, fields)}
            for entry in album.entries]
