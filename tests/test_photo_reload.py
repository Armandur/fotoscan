from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import PHOTO_DIR, THUMB_DIR
from app.database import Base, Photo
from app.deps import get_db
from app.main import app


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _thumb_color(photo_id):
    with Image.open(THUMB_DIR / f"{photo_id}.jpg") as im:
        return im.convert("RGB").getpixel((5, 5))


def test_reload_rebuilds_thumbnail_after_file_replaced(client, db):
    path = PHOTO_DIR / "ersatt.jpg"
    Image.new("RGB", (64, 48), (255, 0, 0)).save(path)
    photo = Photo(path=str(path), filename="ersatt.jpg", folder="",
                  updated_at=datetime(2020, 1, 1))
    db.add(photo)
    db.commit()
    assert client.get(f"/thumb/{photo.id}").status_code == 200
    assert _thumb_color(photo.id)[0] > 200  # röd

    Image.new("RGB", (64, 48), (0, 0, 255)).save(path)  # filen ersätts på disk
    assert client.post(f"/api/photos/{photo.id}/reload").status_code == 200
    r, _, b = _thumb_color(photo.id)
    assert b > 200 and r < 50
    db.refresh(photo)
    assert photo.updated_at.year > 2020
    assert photo.phash


def test_reload_missing_file_gives_404(client, db):
    photo = Photo(path=str(PHOTO_DIR / "finns-inte.jpg"), filename="finns-inte.jpg", folder="")
    db.add(photo)
    db.commit()
    assert client.post(f"/api/photos/{photo.id}/reload").status_code == 404
