from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from app.config import PHOTO_DIR, THUMB_DIR, THUMB_SIZE, SUPPORTED_EXTENSIONS
from app.database import Photo

_DATETIME_ORIGINAL = 0x9003  # DateTimeOriginal, ligger i Exif-sub-IFD
_DATETIME = 0x0132           # DateTime (ModifyDate) i IFD0, fallback
_EXIF_IFD = 0x8769           # pekare till Exif-sub-IFD


def _read_exif_date(img: Image.Image) -> tuple[str | None, str, int | None]:
    """Plocka ut fotodatum ur EXIF om det finns. Scans saknar oftast detta.

    Returnerar (raw, nice, year): raw är hela EXIF-strängen
    ("YYYY:MM:DD HH:MM:SS") oförändrad, nice ett trevligt datumförslag och year
    det sorterbara året. DateTimeOriginal lever i Exif-sub-IFD:n på riktiga
    kamerafoton; vi faller tillbaka till DateTime i IFD0.
    """
    try:
        exif = img.getexif()
    except Exception:
        return None, "", None
    if not exif:
        return None, "", None

    raw = None
    try:
        raw = exif.get_ifd(_EXIF_IFD).get(_DATETIME_ORIGINAL)
    except Exception:
        raw = None
    if not raw:
        raw = exif.get(_DATETIME_ORIGINAL) or exif.get(_DATETIME)
    if not raw:
        return None, "", None
    raw = str(raw).strip()
    # EXIF-format: "YYYY:MM:DD HH:MM:SS"
    date_part = raw.split(" ")[0]
    pieces = date_part.split(":")
    if len(pieces) >= 1 and pieces[0].isdigit():
        year = int(pieces[0])
        nice = "-".join(pieces[:3]) if len(pieces) >= 3 else pieces[0]
        return raw, nice, year
    return raw, "", None


def load_oriented(src: Path, rotation: int = 0) -> Image.Image:
    """Öppna bild, applicera EXIF-orientering och användarens rotation."""
    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")
    if rotation:
        # PIL roterar moturs; vi lagrar grader medurs.
        img = img.rotate(-rotation, expand=True)
    return img


def make_thumbnail(src: Path, photo_id: int, rotation: int = 0) -> None:
    dest = THUMB_DIR / f"{photo_id}.jpg"
    img = load_oriented(src, rotation)
    img.thumbnail(THUMB_SIZE)
    img.save(dest, "JPEG", quality=85)


def scan_directory(db: Session) -> dict:
    """Genomsök PHOTO_DIR rekursivt och lägg till nya foton i databasen.

    Befintliga foton (matchade på sökväg) lämnas orörda. Originalfiler
    läses bara, flyttas eller döps aldrig om.
    """
    if not PHOTO_DIR.exists():
        return {"added": 0, "skipped": 0, "errors": 0, "missing_dir": True}

    existing = {row[0] for row in db.query(Photo.path).all()}

    added = skipped = errors = 0

    for path in sorted(PHOTO_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        abspath = str(path.resolve())
        if abspath in existing:
            skipped += 1
            continue

        try:
            with Image.open(path) as img:
                exif_raw, date_text, year = _read_exif_date(img)
            photo = Photo(
                path=abspath,
                filename=path.name,
                date_text=date_text,
                date_year=year,
                exif_datetime=exif_raw,
            )
            db.add(photo)
            db.flush()  # ger photo.id för thumbnailen
            make_thumbnail(path, photo.id)
            db.commit()
            added += 1
        except Exception:
            db.rollback()
            errors += 1

    return {"added": added, "skipped": skipped, "errors": errors, "missing_dir": False}
