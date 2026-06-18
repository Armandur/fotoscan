import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.database import engine

router = APIRouter()


@router.get("/api/backup")
def download_backup():
    """Konsekvent ögonblicksbild av databasen som nedladdningsbar zip.

    `VACUUM INTO` ger en hel, transaktionssäker kopia även medan appen kör.
    Databasen är sanningskällan; thumbnails/cache regenereras ur originalen,
    så de behöver inte ingå."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmpdir = Path(tempfile.mkdtemp(prefix="fotoscan-backup-"))
    snapshot = tmpdir / "fotoscan.db"
    zip_path = tmpdir / f"fotoscan-backup-{ts}.zip"

    with engine.begin() as conn:
        conn.exec_driver_sql("VACUUM INTO ?", (str(snapshot),))

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(snapshot, "fotoscan.db")
    snapshot.unlink()

    def _cleanup():
        for p in (zip_path,):
            if p.exists():
                p.unlink()
        tmpdir.rmdir()

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=zip_path.name,
        background=BackgroundTask(_cleanup),
    )
