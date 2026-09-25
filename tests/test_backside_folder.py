import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, Photo
from app.deps import get_db
from app.main import app

FOLDER = "Lösa bilder"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    # Avsiktligt i "fel" ordning så id-ordningen inte råkar ge rätt par.
    for n in [10, 2, 1, 12, 3, 11, 4, 9, 5, 8, 6, 7]:
        session.add(Photo(path=f"/p/{FOLDER}/{n}.jpg", filename=f"{n}.jpg", folder=FOLDER))
    session.add(Photo(path="/p/annan/1.jpg", filename="1.jpg", folder="annan"))
    session.commit()
    yield session
    session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    # Utan context manager körs inte lifespan (init_db mot riktig DB).
    yield TestClient(app)
    app.dependency_overrides.clear()


def _ids(db):
    return {p.filename: p.id for p in db.query(Photo).filter(Photo.folder == FOLDER)}


def _page_pairs(client, db):
    html = client.get("/backsides/folder", params={"folder": FOLDER}).text
    names = {v: k for k, v in _ids(db).items()}
    return [
        (names[int(f)], names[int(b)])
        for f, b in re.findall(r'data-front="(\d+)" data-back="(\d+)"', html)
    ]


def test_preview_pairs_in_natural_order(client, db):
    pairs = _page_pairs(client, db)
    assert pairs == [(f"{n}.jpg", f"{n + 1}.jpg") for n in range(1, 12, 2)]


def test_link_many_then_preview_skips_linked(client, db):
    ids = _ids(db)
    r = client.post("/api/backsides/link-many",
                    json={"pairs": [{"front_id": ids["1.jpg"], "back_id": ids["2.jpg"]}]})
    assert r.status_code == 200 and r.json()["count"] == 1
    assert db.get(Photo, ids["2.jpg"]).back_of_id == ids["1.jpg"]
    # Andra körningen får inte förskjuta växlingen (2,3) - nästa par är (3,4).
    assert _page_pairs(client, db)[0] == ("3.jpg", "4.jpg")


def test_link_many_rejects_whole_batch_on_conflict(client, db):
    ids = _ids(db)
    client.post("/api/backsides/link-many",
                json={"pairs": [{"front_id": ids["1.jpg"], "back_id": ids["2.jpg"]}]})
    r = client.post("/api/backsides/link-many", json={"pairs": [
        {"front_id": ids["3.jpg"], "back_id": ids["4.jpg"]},
        {"front_id": ids["2.jpg"], "back_id": ids["5.jpg"]},
    ]})
    assert r.status_code == 400
    db.rollback()
    assert db.get(Photo, ids["4.jpg"]).back_of_id is None
