from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import PHOTO_DIR
from app.deps import get_db
from app.services.scanner import scan_directory

router = APIRouter()


@router.post("/api/scan")
def scan(db: Session = Depends(get_db)):
    result = scan_directory(db)
    result["photo_dir"] = str(PHOTO_DIR)
    return JSONResponse(result)
