from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, Float, String, Text, DateTime, ForeignKey, Table,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from app.config import DB_PATH, DATA_DIR, THUMB_DIR, RENDER_DIR

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
    # Relativ undermapp i PHOTO_DIR (posix), "" för foton direkt i rotmappen.
    folder = Column(String, default="", index=True)

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

    # Färg-/tonjusteringar (multiplikatorer, 1.0 = oförändrat). Renderas
    # on-the-fly och bakas in först vid export - originalet rörs aldrig.
    auto_tone = Column(Integer, default=0)
    adj_brightness = Column(Float, default=1.0)
    adj_contrast = Column(Float, default=1.0)
    adj_gamma = Column(Float, default=1.0)
    adj_saturation = Column(Float, default=1.0)
    adj_red = Column(Float, default=1.0)
    adj_green = Column(Float, default=1.0)
    adj_blue = Column(Float, default=1.0)

    # Sätt när metadata bekräftats/redigerats av användaren.
    reviewed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    tags = relationship(
        "Tag", secondary=photo_tags, back_populates="photos", lazy="selectin"
    )
    faces = relationship(
        "FaceRegion", back_populates="photo",
        cascade="all, delete-orphan", lazy="selectin",
    )


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False, default="tag")  # "person" | "tag"

    photos = relationship("Photo", secondary=photo_tags, back_populates="tags")


class FaceRegion(Base):
    __tablename__ = "face_regions"

    id = Column(Integer, primary_key=True)
    photo_id = Column(
        Integer, ForeignKey("photos.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    tag_id = Column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False
    )
    # Normaliserade koordinater (0-1) relativt den VISADE bilden (efter
    # EXIF-orientering + användarens rotation). x/y = övre vänstra hörnet.
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)
    created_at = Column(DateTime, default=_now)

    photo = relationship("Photo", back_populates="faces")
    tag = relationship("Tag")


def _column_exists(conn, table: str, column: str) -> bool:
    rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
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
        if not _column_exists(conn, "photos", "folder"):
            conn.exec_driver_sql(
                "ALTER TABLE photos ADD COLUMN folder VARCHAR DEFAULT ''"
            )
        if not _column_exists(conn, "photos", "auto_tone"):
            conn.exec_driver_sql(
                "ALTER TABLE photos ADD COLUMN auto_tone INTEGER DEFAULT 0"
            )
        for _col in (
            "adj_brightness", "adj_contrast", "adj_gamma", "adj_saturation",
            "adj_red", "adj_green", "adj_blue",
        ):
            if not _column_exists(conn, "photos", _col):
                conn.exec_driver_sql(
                    f"ALTER TABLE photos ADD COLUMN {_col} FLOAT DEFAULT 1.0"
                )
