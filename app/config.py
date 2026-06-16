from pathlib import Path
import os

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

PHOTO_DIR = Path(os.getenv("PHOTO_DIR", BASE_DIR / "photos")).resolve()
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data")).resolve()
THUMB_DIR = DATA_DIR / "thumbnails"
# Cache för fullstora renderade bilder (rotation + färgjustering inbakat).
RENDER_DIR = DATA_DIR / "rendered"
DB_PATH = DATA_DIR / "fotoscan.db"

# Dit exporterade kopior (med inbäddad metadata) skrivs. Originalen rörs aldrig.
EXPORT_DIR = Path(os.getenv("EXPORT_DIR", BASE_DIR / "export")).resolve()

PORT = int(os.getenv("PORT", "8810"))


def _asset_version() -> str:
    """Senaste ändringstid bland egna css/js - för cache-busting av statiska
    assets (beräknas vid uppstart)."""
    latest = 0
    for sub in ("css", "js"):
        d = BASE_DIR / "app" / "static" / sub
        if d.exists():
            for f in d.rglob("*"):
                if f.is_file():
                    latest = max(latest, int(f.stat().st_mtime))
    return str(latest)


ASSET_V = _asset_version()

THUMB_SIZE = (400, 400)

# Filändelser som behandlas som bilder vid scanning
SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff",
    ".bmp", ".gif", ".webp", ".heic",
}

# Taggtyper. "person" och "tag" lagras i samma tabell, åtskilda av kind.
TAG_KINDS = ("person", "tag")
