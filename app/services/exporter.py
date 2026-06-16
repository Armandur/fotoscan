import shutil
import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import EXPORT_DIR
from app.database import Photo
from app.services.adjust import has_adjustments
from app.services.dates import iso_date_for_export
from app.services.scanner import load_oriented, render_photo

# Vår rotation (grader medurs) -> EXIF Orientation-värde. Antar att originalet
# saknar egen Orientation (vanligt for scans/negativ), vilket är vårt huvudfall.
_ORIENTATION = {0: 1, 90: 6, 180: 3, 270: 8}

# EXIF-datumfält som ofta bär skanntiden. Normaliseras/rensas vid export.
_EXIF_DT_TAGS = ("DateTimeOriginal", "CreateDate", "ModifyDate")


def exiftool_available() -> bool:
    return shutil.which("exiftool") is not None


def _person_tags(photo: Photo) -> list[str]:
    return [t.name for t in photo.tags if t.kind == "person"]


def _keyword_tags_hierarchical(photo: Photo) -> list[tuple[str, str]]:
    """Returnerar lista med (platt namn, hierarkisk sökväg) för taggar."""
    res = []
    for t in photo.tags:
        if t.kind != "tag":
            continue
        # Bygg sökväg baklänges
        path = [t.name]
        curr = t
        while curr.parent:
            curr = curr.parent
            path.append(curr.name)
        res.append((t.name, "|".join(reversed(path))))
    return res


def _metadata_args(photo: Photo, skip_orientation: bool = False) -> list[str]:
    """Bygg exiftool-argument som bäddar in metadatan som XMP (+ EXIF-datum).

    XMP är primärt: UTF-8 (å/ä/ö), partiella datum och fält for personer/taggar.
    EXIF:DateTimeOriginal skrivs bara när vi har ett exakt inbäddat datum.
    """
    args: list[str] = []

    # Datum: vår kurerade date_text (med full precision: år / år-månad /
    # år-månad-dag) är sanningen, inte filens inbäddade tid. Skrivs som XMP
    # DateCreated (stödjer partiella datum). DateTimeOriginal hanteras separat
    # nedan eftersom vi inte har något pålitligt klockslag.
    date_created = iso_date_for_export(
        photo.date_text, photo.date_year, photo.date_month, photo.date_precision
    )
    if date_created:
        args.append(f"-XMP-photoshop:DateCreated={date_created}")

    # EXIF-datumfälten: kopian ärver ofta filens skanntid. Vi har inget pålitligt
    # klockslag -> vid full dag-precision skriver vi datumet kl 00:00:00 (och
    # skriver över skanntiden), annars raderar vi fälten så ingen skanntid blir
    # kvar. Partiella datum (bara år/månad) bärs i stället av XMP DateCreated.
    if date_created and len(date_created) == 10:  # YYYY-MM-DD
        exif_dt = date_created.replace("-", ":") + " 00:00:00"
        for tag in _EXIF_DT_TAGS:
            args.append(f"-EXIF:{tag}={exif_dt}")
    else:
        for tag in _EXIF_DT_TAGS:
            args.append(f"-EXIF:{tag}=")

    if photo.location:
        args.append(f"-XMP-iptcCore:Location={photo.location}")

    if photo.gps_lat is not None and photo.gps_lon is not None:
        args += [
            f"-GPSLatitude={abs(photo.gps_lat)}",
            f"-GPSLatitudeRef={'N' if photo.gps_lat >= 0 else 'S'}",
            f"-GPSLongitude={abs(photo.gps_lon)}",
            f"-GPSLongitudeRef={'E' if photo.gps_lon >= 0 else 'W'}",
        ]
        if photo.gps_radius_m:
            args.append(f"-GPSHPositioningError={photo.gps_radius_m}")
    if photo.notes:
        args.append(f"-XMP-dc:Description={photo.notes}")
    if photo.source:
        args.append(f"-XMP-photoshop:Source={photo.source}")

    for flat_name, hier_name in _keyword_tags_hierarchical(photo):
        args.append(f"-XMP-dc:Subject={flat_name}")
        args.append(f"-XMP-lr:HierarchicalSubject={hier_name}")

    for name in _person_tags(photo):
        args.append(f"-XMP-iptcExt:PersonInImage={name}")

    if photo.rotation and not skip_orientation:
        args.append(f"-Orientation#={_ORIENTATION.get(photo.rotation, 1)}")

    return args


def _region_args(photo: Photo, width: int, height: int) -> list[str]:
    """MWG-rs ansiktsregioner (XMP). Läses av Lightroom/digiKam/Apple Foton.

    Våra koordinater är normaliserade (övre vänstra hörnet) relativt den visade
    bilden. MWG anger area med CENTRUM-koordinater, därav +w/2 och +h/2.
    """
    if not photo.faces:
        return []
    args = [
        f"-RegionAppliedToDimensionsW={width}",
        f"-RegionAppliedToDimensionsH={height}",
        "-RegionAppliedToDimensionsUnit=pixel",
    ]
    for f in photo.faces:
        args += [
            f"-RegionName={f.tag.name}",
            "-RegionType=Face",
            f"-RegionAreaX={f.x + f.w / 2:.5f}",
            f"-RegionAreaY={f.y + f.h / 2:.5f}",
            f"-RegionAreaW={f.w:.5f}",
            f"-RegionAreaH={f.h:.5f}",
            "-RegionAreaUnit=normalized",
        ]
    return args


def _is_pair_negative(photo: Photo) -> bool:
    """True om fotot är negativet i ett par (har partner och inte är primär)."""
    return bool(photo.paired_with_id) and not photo.is_pair_primary


def _dest_path(photo: Photo, partner: Photo | None, dest_dir: Path) -> Path:
    """Filnamn för exporten. Negativet i ett par får huvudbildens namnstam +
    '-negativ' (men behåller sin egen filändelse, det är negativets pixeldata)."""
    src = Path(photo.path)
    if _is_pair_negative(photo) and partner is not None:
        return dest_dir / f"{Path(partner.path).stem}-negativ{src.suffix}"
    return dest_dir / src.name


def export_photo(
    photo: Photo, partner: Photo | None = None, dest_dir: Path = EXPORT_DIR
) -> Path:
    """Kopiera originalet till EXPORT_DIR och bädda in metadatan i kopian.

    `partner` (det hopparade fotot) används bara för att namnge negativet efter
    huvudbilden. Originalfilen rörs aldrig. Returnerar sökvägen till exportfilen.
    """
    src = Path(photo.path)
    if not src.exists():
        raise FileNotFoundError(f"Originalfil saknas: {src}")

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = _dest_path(photo, partner, dest_dir)

    # Med färgjusteringar måste pixlarna kodas om (justeringarna bakas in, och
    # rotationen blir då redan applicerad -> ingen Orientation-tag). Utan
    # justeringar behålls originalet bit-för-bit och rotationen sätts som tagg.
    baked = has_adjustments(photo)
    if baked:
        img = render_photo(photo)
        img.save(dest, "JPEG", quality=95)
        dims = img.size
    else:
        shutil.copy2(src, dest)
        dims = load_oriented(src, photo.rotation).size if photo.faces else (0, 0)

    meta = _metadata_args(photo, skip_orientation=baked)
    # Ansiktsrutor skrivs inte på negativ - de kan vara skannade i annan dimension
    # eller förskjutna mot framkallningen, så koordinaterna stämmer inte.
    if photo.faces and not _is_pair_negative(photo):
        meta += _region_args(photo, dims[0], dims[1])

    args = ["exiftool", "-overwrite_original", *meta, str(dest)]
    if meta:  # bara om det finns metadata att skriva
        subprocess.run(args, check=True, capture_output=True, text=True)
    return dest


def export_with_pair(
    db: Session, photo: Photo, dest_dir: Path = EXPORT_DIR
) -> list[Path]:
    """Exportera ett foto - och dess hopparade negativ/foto om sådant finns.
    Huvudbilden behåller sitt namn, negativet blir '{huvudbild}-negativ'."""
    partner = db.get(Photo, photo.paired_with_id) if photo.paired_with_id else None
    if partner is None:
        return [export_photo(photo, dest_dir=dest_dir)]

    primary = photo if photo.is_pair_primary else partner
    negative = partner if photo.is_pair_primary else photo
    return [
        export_photo(primary, dest_dir=dest_dir),
        export_photo(negative, partner=primary, dest_dir=dest_dir),
    ]


def export_many(db: Session, only_reviewed: bool = True) -> dict:
    query = db.query(Photo)
    if only_reviewed:
        query = query.filter(Photo.reviewed_at.isnot(None))

    exported = errors = 0
    for photo in query.all():
        try:
            partner = (
                db.get(Photo, photo.paired_with_id)
                if photo.paired_with_id else None
            )
            export_photo(photo, partner=partner)
            exported += 1
        except Exception:
            errors += 1

    return {"exported": exported, "errors": errors, "dir": str(EXPORT_DIR)}
