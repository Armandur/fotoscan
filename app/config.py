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

THUMB_SIZE = (400, 400)

# Filändelser som behandlas som bilder vid scanning
SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff",
    ".bmp", ".gif", ".webp", ".heic",
}

# Taggtyper. "person" och "tag" lagras i samma tabell, åtskilda av kind.
TAG_KINDS = ("person", "tag")
