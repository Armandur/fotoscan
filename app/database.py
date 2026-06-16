from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Table, create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from app.config import DB_PATH, DATA_DIR, THUMB_DIR

Base = declarative_base()

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _now() -> datetime:
    return datetime.now(timezone.utc)


photo_tags = Table(
    "photo_tags",
    Base.metadata,
    Column("photo_id", ForeignKey("photos.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Photo(Base):
    __tablename__ = "photos"

    id = Column(Integer, primary_key=True)
    # Absolut sökväg på disk. Filen läses orörd, flyttas/döps aldrig om.
    path = Column(String, unique=True, nullable=False, index=True)
    filename = Column(String, nullable=False)

    # Fritext för att stödja ungefärliga datum, t.ex. "ca 1975", "1970-talet".
    date_text = Column(String, default="")
    # Valfritt sorterbart år, fylls i när det går att tolka.
    date_year = Column(Integer, nullable=True, index=True)
    # Råt inbäddat fotodatum ur filens EXIF (DateTimeOriginal), läses en gång vid
    # scan och skrivs aldrig över. Visas read-only så användaren ser vad filen
    # faktiskt innehåller även efter att date_text redigerats.
    exif_datetime = Column(String, nullable=True)

    location = Column(String, default="")
    notes = Column(Text, default="")
    # Källa: vem fotot kommer från (t.ex. mormors album).
    source = Column(String, default="")

    # Rotation i grader medurs (0/90/180/270). Appliceras på thumbnail och
    # visning samt vid framtida export - originalfilen rörs aldrig.
    rotation = Column(Integer, default=0)

    # Sätt när metadata bekräftats/redigerats av användaren.
    reviewed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    tags = relationship(
        "Tag", secondary=photo_tags, back_populates="photos", lazy="selectin"
    )


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False, default="tag")  # "person" | "tag"

    photos = relationship("Photo", secondary=photo_tags, back_populates="tags")


def _column_exists(conn, table: str, column: str) -> bool:
    rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)

    # ALTER TABLE-guards för kolumner tillagda efter första release.
    with engine.begin() as conn:
        if not _column_exists(conn, "photos", "rotation"):
            conn.exec_driver_sql(
                "ALTER TABLE photos ADD COLUMN rotation INTEGER DEFAULT 0"
            )
        if not _column_exists(conn, "photos", "exif_datetime"):
            conn.exec_driver_sql(
                "ALTER TABLE photos ADD COLUMN exif_datetime VARCHAR"
            )
