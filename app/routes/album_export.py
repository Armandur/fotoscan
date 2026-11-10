import logging
import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.database import Album
from app.deps import get_db
from app.services.album_export import build_package, snapshot_entries
from app.services.captions import CAPTION_FIELDS

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/albums/{album_id}/export-package")
def export_package(
    album_id: int,
    fields: Annotated[list[str], Form()] = [],
    db: Session = Depends(get_db),
):
    if set(fields) - (set(CAPTION_FIELDS) - {"filename"}):
        raise HTTPException(422, "Välj giltiga metadatafält")
    album = db.get(Album, album_id)
    if album is None:
        raise HTTPException(404, "Albumet finns inte kvar")
    if not album.entries:
        raise HTTPException(400, "Lägg till bilder i albumet före export")
    entries = snapshot_entries(album, fields)
    title = album.name
    directory = Path(tempfile.mkdtemp(prefix="fotoscan-package-"))
    try:
        destination = build_package(entries, title, directory)
    except Exception as error:
        shutil.rmtree(directory)
        logger.exception("Paketexport misslyckades för album %s", album_id)
        message = str(error) if isinstance(error, ValueError) else "Kunde inte skapa paketet. Försök igen."
        raise HTTPException(400, message) from error
    return FileResponse(destination, media_type="application/zip", filename=destination.name,
                        background=BackgroundTask(shutil.rmtree, directory))
