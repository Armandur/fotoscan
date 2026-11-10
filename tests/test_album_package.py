import hashlib
from io import BytesIO
from zipfile import ZipFile

import pytest
from docx import Document
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Album, AlbumPhoto, Base, Photo, Tag
from app.deps import get_db
from app.main import app


@pytest.fixture
def setup(tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        photos = []
        for number in range(2):
            directory = tmp_path / str(number)
            directory.mkdir()
            path = directory / "åäö.tiff"
            Image.new("RGB", (80, 40), (200, 20, 10)).save(path)
            photo = Photo(path=str(path), filename=path.name, date_text="ca 1975",
                          notes="Intern anteckning", rotation=90, adj_red=0.5)
            photos.append(photo)
            db.add(photo)
        album = Album(name="Stigsjö")
        db.add(album)
        db.flush()
        for index, photo in enumerate(reversed(photos)):
            db.add(AlbumPhoto(album_id=album.id, photo_id=photo.id, position=index))
        photos[0].tags.append(Tag(name="Okänd-1", kind="person", placeholder=1))
        photos[0].tags.append(Tag(name="Anna", kind="person"))
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        with TestClient(app, raise_server_exceptions=True) as client:
            yield client, db, album, photos
        app.dependency_overrides.clear()
    engine.dispose()


def test_package_route_preserves_order_metadata_and_originals(setup):
    client, db, album, photos = setup
    before = [hashlib.sha256(open(p.path, "rb").read()).hexdigest() for p in photos]
    response = client.post(f"/api/albums/{album.id}/export-package", data={"fields": ["date", "persons"]})
    assert response.status_code == 200
    with ZipFile(BytesIO(response.content)) as archive:
        images = [name for name in archive.namelist() if name.endswith(".jpg")]
        assert images == [f"Bilder/001_foto-{photos[1].id}.jpg", f"Bilder/002_foto-{photos[0].id}.jpg"]
        for name in images:
            image = Image.open(BytesIO(archive.read(name)))
            assert image.format == "JPEG"
            assert image.size == (40, 80)
            assert image.getpixel((10, 10))[0] < 150
            assert not image.getexif()
        doc = Document(BytesIO(archive.read("Bildlista.docx")))
        text = '\n'.join(p.text for p in doc.paragraphs)
        assert all(name in text for name in images)
        assert "ca 1975" in text and "Anna" in text
        assert "Intern anteckning" not in text and "Okänd-1" not in text
        assert len(doc.inline_shapes) == 2
    assert before == [hashlib.sha256(open(p.path, "rb").read()).hexdigest() for p in photos]


def test_package_empty_missing_and_invalid_fields(setup):
    client, db, album, photos = setup
    url = f"/api/albums/{album.id}/export-package"
    assert client.post(url, data={"fields": ["gps"]}).status_code == 422
    assert client.post('/api/albums/999999/export-package').status_code == 404
    photos[0].path = '/saknas.jpg'
    db.commit()
    assert client.post(url).status_code == 400
    db.query(AlbumPhoto).delete()
    db.commit()
    db.expire_all()
    assert client.post(url).status_code == 400


def test_membership_and_removed_album_navigation(setup):
    client, db, album, photos = setup
    photo = photos[0]
    url = f"/api/albums/{album.id}/photos/{photo.id}"
    assert client.delete(url).status_code == 200
    assert client.delete(url).status_code == 200
    rows = client.get(f"/api/albums?photo_id={photo.id}").json()
    assert not rows[0]['contains']
    removed = client.get(f"/photo/{photo.id}?ctx=album&ctx_id={album.id}", follow_redirects=False)
    assert removed.status_code == 303
    assert removed.headers['location'] == f'/albums/{album.id}'
    for _ in range(2):
        assert client.post(f"/api/albums/{album.id}/photos", json={"photo_ids": [photo.id]}).status_code == 200
    assert db.query(AlbumPhoto).filter_by(album_id=album.id, photo_id=photo.id).count() == 1
    assert client.get(f"/api/albums?photo_id={photo.id}").json()[0]['contains']
    assert client.delete('/api/albums/999999/photos/1').status_code == 404


def test_package_no_fields_and_cleanup(setup, tmp_path, monkeypatch):
    client, db, album, photos = setup
    directory = tmp_path / 'package'
    directory.mkdir()
    monkeypatch.setattr('app.routes.album_export.tempfile.mkdtemp', lambda **kwargs: str(directory))
    response = client.post(f'/api/albums/{album.id}/export-package')
    assert response.status_code == 200
    assert not directory.exists()
    with ZipFile(BytesIO(response.content)) as archive:
        doc = Document(BytesIO(archive.read('Bildlista.docx')))
        text = '\n'.join(p.text for p in doc.paragraphs)
        assert 'Ingen beskrivande metadata registrerad.' in text
        assert 'ca 1975' not in text
    directory.mkdir()
    photos[0].path = '/saknas.jpg'
    db.commit()
    assert client.post(f'/api/albums/{album.id}/export-package').status_code == 400
    assert not directory.exists()
    assert client.post(f'/api/albums/{album.id}/photos', json={'photo_ids': [999999]}).status_code == 404
