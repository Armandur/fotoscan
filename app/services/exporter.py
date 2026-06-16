import shutil
import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import EXPORT_DIR
from app.database import Photo

# Vår rotation (grader medurs) -> EXIF Orientation-värde. Antar att originalet
# saknar egen Orientation (vanligt for scans/negativ), vilket är vårt huvudfall.
_ORIENTATION = {0: 1, 90: 6, 180: 3, 270: 8}


def exiftool_available() -> bool:
    return shutil.which("exiftool") is not None


def _person_tags(photo: Photo) -> list[str]:
    return [t.name for t in photo.tags if t.kind == "person"]


def _keyword_tags(photo: Photo) -> list[str]:
    return [t.name for t in photo.tags if t.kind == "tag"]


def _metadata_args(photo: Photo) -> list[str]:
    """Bygg exiftool-argument som bäddar in metadatan som XMP (+ EXIF-datum).

    XMP är primärt: UTF-8 (å/ä/ö), partiella datum och fält for personer/taggar.
    EXIF:DateTimeOriginal skrivs bara när vi har ett exakt inbäddat datum.
    """
    args: list[str] = []

    if photo.date_year:
        args.append(f"-XMP-photoshop:DateCreated={photo.date_year}")
    elif photo.date_text:
        args.append(f"-XMP-photoshop:DateCreated={photo.date_text}")

    if photo.exif_datetime:
        # Exakt datum ur filen - skriv aven EXIF for maximal kompatibilitet.
        args.append(f"-EXIF:DateTimeOriginal={photo.exif_datetime}")
        args.append(f"-XMP-photoshop:DateCreated={photo.exif_datetime}")

    if photo.location:
        args.append(f"-XMP-iptcCore:Location={photo.location}")
    if photo.notes:
        args.append(f"-XMP-dc:Description={photo.notes}")
    if photo.source:
        args.append(f"-XMP-photoshop:Source={photo.source}")

    for name in _keyword_tags(photo):
        args.append(f"-XMP-dc:Subject={name}")
    for name in _person_tags(photo):
        args.append(f"-XMP-iptcExt:PersonInImage={name}")

    if photo.rotation:
        args.append(f"-Orientation#={_ORIENTATION.get(photo.rotation, 1)}")

    return args


def export_photo(photo: Photo, dest_dir: Path = EXPORT_DIR) -> Path:
    """Kopiera originalet till EXPORT_DIR och bädda in metadatan i kopian.

    Originalfilen rörs aldrig. Returnerar sökvägen till exportfilen.
    """
    src = Path(photo.path)
    if not src.exists():
        raise FileNotFoundError(f"Originalfil saknas: {src}")

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    shutil.copy2(src, dest)

    args = ["exiftool", "-overwrite_original", *_metadata_args(photo), str(dest)]
    if len(args) > 3:  # bara om det finns metadata att skriva
        subprocess.run(args, check=True, capture_output=True, text=True)
    return dest


def export_many(db: Session, only_reviewed: bool = True) -> dict:
    query = db.query(Photo)
    if only_reviewed:
        query = query.filter(Photo.reviewed_at.isnot(None))

    exported = errors = 0
    for photo in query.all():
        try:
            export_photo(photo)
            exported += 1
        except Exception:
            errors += 1

    return {"exported": exported, "errors": errors, "dir": str(EXPORT_DIR)}
