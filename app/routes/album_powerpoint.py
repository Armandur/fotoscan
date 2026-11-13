import logging
import time
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, Path as PathParam
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.database import Album
from app.deps import get_db
from app.services.captions import CAPTION_FIELDS
from app.services.pptx_album import build_presentation

router = APIRouter()
logger = logging.getLogger(__name__)
_DOWNLOAD_DIR = DATA_DIR / 'presentations'
_TTL = 3600


def _clean_expired():
    _DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    for path in _DOWNLOAD_DIR.iterdir():
        if path.suffix not in ('.pptx', '.part'):
            continue
        try:
            if path.stat().st_mtime < time.time() - _TTL:
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            # En annan export kan ha städat samma fil.
            continue


@router.post('/api/albums/{album_id}/export-pptx')
def create_presentation(
    album_id: int,
    aspect: Annotated[Literal['16:9', '4:3'], Form()] = '16:9',
    fit: Annotated[Literal['contain', 'cover'], Form()] = 'contain',
    metadata: Annotated[Literal['none', 'slide', 'notes', 'both'], Form()] = 'slide',
    fields: Annotated[list[str], Form()] = [],
    quality: Annotated[Literal['normal', 'high'], Form()] = 'normal',
    title_slide: Annotated[bool, Form()] = False,
    db: Session = Depends(get_db),
):
    if set(fields) - set(CAPTION_FIELDS):
        raise HTTPException(422, 'Välj giltiga metadatafält')
    album = db.get(Album, album_id)
    if album is None:
        raise HTTPException(404, 'Albumet finns inte kvar')
    if not album.entries:
        raise HTTPException(400, 'Lägg till bilder i albumet före export')
    _clean_expired()
    token = uuid4().hex
    destination = _DOWNLOAD_DIR / f'{token}.pptx'
    partial = destination.with_suffix('.part')
    try:
        result = build_presentation(album, partial, aspect=aspect, fit=fit, metadata=metadata,
                                    fields=fields, quality=quality, title_slide=title_slide)
        partial.replace(destination)
    except Exception as error:
        partial.unlink(missing_ok=True)
        logger.exception('PowerPoint-export misslyckades för album %s', album_id)
        message = str(error) if isinstance(error, ValueError) else 'Kunde inte skapa PowerPoint-filen. Försök igen.'
        raise HTTPException(400, message) from error
    return {**result, 'download_url': f'/api/album-presentations/{token}',
            'size_bytes': destination.stat().st_size}


@router.get('/api/album-presentations/{token}')
def download_presentation(token: Annotated[str, PathParam(pattern=r'^[0-9a-f]{32}$')]):
    _clean_expired()
    destination = _DOWNLOAD_DIR / f'{token}.pptx'
    if not destination.is_file():
        raise HTTPException(404, 'Nedladdningen har gått ut. Skapa presentationen igen.')
    # Behåll filen en timme för avbrutna nedladdningar och upprepade försök.
    return FileResponse(destination, filename='fotoscan-album.pptx',
                        media_type='application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        headers={'Cache-Control': 'no-store'})
