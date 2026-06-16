from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import BASE_DIR
from app.database import init_db
from app.routes import (
    export, faces, geo, pairing, persons, photos, places, scan, tags,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Fotoscan", lifespan=lifespan)

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "app" / "static")),
    name="static",
)

app.include_router(photos.router)
app.include_router(scan.router)
app.include_router(tags.router)
app.include_router(export.router)
app.include_router(faces.router)
app.include_router(persons.router)
app.include_router(pairing.router)
app.include_router(geo.router)
app.include_router(places.router)
