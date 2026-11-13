import hashlib
import os
import time
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Album, AlbumPhoto, Base, Photo, Tag
from app.deps import get_db
from app.main import app


@pytest.fixture
def data(tmp_path, monkeypatch):
    from app.routes import album_powerpoint
    directory = tmp_path / 'downloads'
    monkeypatch.setattr(album_powerpoint, '_DOWNLOAD_DIR', directory)
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        album = Album(name='Stigsjö kyrka')
        db.add(album)
        db.flush()
        photos = []
        for index, size in enumerate([(400, 200), (1200, 100), (200, 200)]):
            path = tmp_path / f'foto-{index}.tiff'
            Image.new('RGB', size, (200, 100, 50)).save(path)
            photo = Photo(path=str(path), filename=path.name, date_text=f'ca {1970+index}',
                          location='Stigsjö', notes='Intern anteckning ' * 100,
                          rotation=90 if index == 0 else 0, adj_red=0.5)
            db.add(photo)
            db.flush()
            db.add(AlbumPhoto(album_id=album.id, photo_id=photo.id, position=2-index))
            photos.append(photo)
        photos[0].tags.extend([Tag(name='Anna', kind='person'), Tag(name='Okänd-1', kind='person', placeholder=1)])
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        try:
            yield TestClient(app), db, album, photos, directory
        finally:
            app.dependency_overrides.clear()
    engine.dispose()


def _export(client, album, **options):
    response = client.post(f'/api/albums/{album.id}/export-pptx', data=options)
    assert response.status_code == 200, response.text
    result = response.json()
    response = client.get(result['download_url'])
    assert response.status_code == 200
    return Presentation(BytesIO(response.content)), result, response.content


def _pictures(slide):
    return [s for s in slide.shapes if s.shape_type == MSO_SHAPE_TYPE.PICTURE]


@pytest.mark.parametrize('aspect', ['16:9', '4:3'])
@pytest.mark.parametrize('fit', ['contain', 'cover'])
@pytest.mark.parametrize('metadata', ['none', 'slide', 'notes', 'both'])
def test_geometry_metadata_and_order(data, aspect, fit, metadata):
    client, db, album, photos, directory = data
    before = [hashlib.sha256(Path(p.path).read_bytes()).hexdigest() for p in photos]
    deck, result, content = _export(client, album, aspect=aspect, fit=fit, metadata=metadata, fields=['date', 'persons'])
    assert len(deck.slides) == result['slides'] == 3
    assert deck.slide_width / deck.slide_height == pytest.approx(16/9 if aspect == '16:9' else 4/3)
    for index, slide in enumerate(deck.slides):
        picture, = _pictures(slide)
        assert picture.image.size == [(200, 200), (1200, 100), (200, 400)][index]
        iw, ih = picture.image.size
        visible_ratio = iw * (1-picture.crop_left-picture.crop_right) / (ih*(1-picture.crop_top-picture.crop_bottom))
        assert visible_ratio == pytest.approx(picture.width/picture.height, rel=1e-4)
        assert picture.left >= 0 and picture.top >= 0
        assert picture.left+picture.width <= deck.slide_width+1
        assert picture.top+picture.height <= deck.slide_height+1
        if fit == 'contain':
            assert picture.crop_left == picture.crop_right == picture.crop_top == picture.crop_bottom == 0
        else:
            assert picture.crop_left == picture.crop_right
            assert picture.crop_top == picture.crop_bottom
            assert picture.width == deck.slide_width
        text = '\n'.join(s.text for s in slide.shapes if s.has_text_frame)
        note = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ''
        expected = f'ca {1972-index}'
        assert (expected in text) == (metadata in ['slide', 'both'])
        assert (expected in note) == (metadata in ['notes', 'both'])
        assert 'Intern anteckning' not in text+note
        assert 'Okänd-1' not in text+note
    with ZipFile(BytesIO(content)) as archive:
        for name in archive.namelist():
            if name.endswith('.rels'):
                assert b'TargetMode="External"' not in archive.read(name)
    assert before == [hashlib.sha256(Path(p.path).read_bytes()).hexdigest() for p in photos]


def test_overflow_title_and_redraw(data):
    client, db, album, photos, directory = data
    deck, result, _ = _export(client, album, aspect='4:3', fit='cover', metadata='slide',
                              fields=['notes'], title_slide='true')
    assert len(deck.slides) == 4
    assert not _pictures(deck.slides[0])
    assert deck.slides[0].shapes[0].text == album.name
    assert result['overflow_count'] == 3
    for slide in list(deck.slides)[1:]:
        text = next(s.text for s in slide.shapes if s.has_text_frame)
        assert len(text.splitlines()) <= 3 and text.endswith('…')
        assert photos[0].notes.strip() in slide.notes_slide.notes_text_frame.text
    image = Image.open(BytesIO(_pictures(deck.slides[3])[0].image.blob))
    assert image.getpixel((10, 10))[0] < 150
    assert not image.getexif()


def test_empty_metadata_has_full_image_area(data):
    client, db, album, photos, directory = data
    deck, _, _ = _export(client, album, fit='cover', metadata='slide', fields=['source'])
    for slide in deck.slides:
        assert len(slide.shapes) == 1
        assert _pictures(slide)[0].height == deck.slide_height


@pytest.mark.parametrize('quality,expected', [('normal', 1920), ('high', 3840)])
def test_resolution(data, quality, expected):
    client, db, album, photos, directory = data
    Image.new('RGB', (4200, 2100), 'blue').save(photos[0].path)
    deck, _, _ = _export(client, album, quality=quality)
    assert max(_pictures(deck.slides[2])[0].image.size) == expected


def test_validation_missing_and_cleanup(data):
    client, db, album, photos, directory = data
    url = f'/api/albums/{album.id}/export-pptx'
    for options in [{'aspect':'2:1'}, {'fit':'stretch'}, {'metadata':'all'}, {'quality':'huge'}, {'fields':['gps']}]:
        assert client.post(url, data=options).status_code == 422
    assert client.post('/api/albums/999999/export-pptx').status_code == 404
    photos[0].path = '/saknas.jpg'
    db.commit()
    assert client.post(url).status_code == 400
    assert list(directory.iterdir()) == []
    db.query(AlbumPhoto).delete()
    db.commit()
    db.expire_all()
    assert client.post(url).status_code == 400
    assert client.get('/api/album-presentations/invalid').status_code == 422
    assert client.get('/api/album-presentations/'+'a'*32).status_code == 404


def test_download_retry_and_expiry(data):
    client, db, album, photos, directory = data
    _, result, content = _export(client, album)
    assert client.get(result['download_url']).content == content
    path, = directory.glob('*.pptx')
    old = time.time()-3700
    os.utime(path, (old, old))
    assert client.get(result['download_url']).status_code == 404
    assert not path.exists()
