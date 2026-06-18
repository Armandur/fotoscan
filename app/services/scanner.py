import logging
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from sqlalchemy.orm import Session

# Gör att Pillow kan öppna HEIC/HEIF (iPhone-foton). Måste köras innan
# Image.open på sådana filer; all bildöppning går via den här modulen.
register_heif_opener()

from app.config import (
    PHOTO_DIR, THUMB_DIR, THUMB_SIZE, RENDER_DIR, SUPPORTED_EXTENSIONS,
)
from app.database import Photo
from app.services.adjust import apply_adjustments, has_adjustments
from app.services.dates import parse_date_text
from app.services.dupes import dhash_from_path

logger = logging.getLogger("fotoscan.scanner")

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


def render_photo(photo) -> Image.Image:
    """Originalbilden med EXIF-orientering, rotation och färgjusteringar
    applicerade. Originalfilen på disk rörs aldrig."""
    img = load_oriented(Path(photo.path), photo.rotation or 0)
    return apply_adjustments(img, photo)


def write_thumbnail(photo) -> None:
    img = render_photo(photo)
    img.thumbnail(THUMB_SIZE)
    img.save(THUMB_DIR / f"{photo.id}.jpg", "JPEG", quality=85)


def render_cache_path(photo_id: int) -> Path:
    return RENDER_DIR / f"{photo_id}.jpg"


def face_thumb_path(region_id: int) -> Path:
    """Cachad ansikts-thumbnail (beror på regionens koordinater + rotation)."""
    return THUMB_DIR / f"face_{region_id}.jpg"


def invalidate_face_thumb(region_id: int) -> None:
    p = face_thumb_path(region_id)
    if p.exists():
        p.unlink()


def invalidate_render(photo_id: int) -> None:
    p = render_cache_path(photo_id)
    if p.exists():
        p.unlink()


def write_render(photo) -> Path:
    """Rendera och cacha fullbilden (rotation + färg inbakat) till disk."""
    dest = render_cache_path(photo.id)
    render_photo(photo).save(dest, "JPEG", quality=90)
    return dest


def refresh_derived(photo) -> None:
    """Uppdatera thumbnail och render-cache efter rotation/justering.
    Tar bort render-cachen om fotot inte längre har några transformeringar."""
    write_thumbnail(photo)
    if (photo.rotation or 0) or has_adjustments(photo):
        write_render(photo)
    else:
        invalidate_render(photo.id)


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
            rel_parent = path.relative_to(PHOTO_DIR).parent
            folder = "" if str(rel_parent) == "." else rel_parent.as_posix()
            p_year, p_month, p_prec = parse_date_text(date_text)
            photo = Photo(
                path=abspath,
                filename=path.name,
                folder=folder,
                date_text=date_text,
                date_year=p_year or year,
                date_month=p_month,
                date_precision=p_prec,
                exif_datetime=exif_raw,
            )
            db.add(photo)
            db.flush()  # ger photo.id för thumbnailen
            write_thumbnail(photo)
            photo.phash = dhash_from_path(THUMB_DIR / f"{photo.id}.jpg")
            db.commit()
            added += 1
        except Exception:
            db.rollback()
            logger.exception("Kunde inte skanna in %s", path)
            errors += 1

    return {"added": added, "skipped": skipped, "errors": errors, "missing_dir": False}
