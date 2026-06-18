from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, Float, String, Text, DateTime, ForeignKey, Table,
    LargeBinary, create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from app.config import DB_PATH, DATA_DIR, THUMB_DIR, RENDER_DIR, PHOTO_DIR

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
    # Härlett ur date_text: månad (1-12) och precision (day/month/season/year/"").
    date_month = Column(Integer, nullable=True, index=True)
    date_precision = Column(String, default="")
    # Råt inbäddat fotodatum ur filens EXIF (DateTimeOriginal), läses en gång vid
    # scan och skrivs aldrig över. Visas read-only så användaren ser vad filen
    # faktiskt innehåller även efter att date_text redigerats.
    exif_datetime = Column(String, nullable=True)

    # Markerar att bilden är ett skannat negativ (används vid hopparning).
    is_negative = Column(Integer, default=0)
    # Symmetrisk 1:1-länk till motsvarande foto/negativ (samma motiv).
    paired_with_id = Column(
        Integer, ForeignKey("photos.id", ondelete="SET NULL"), nullable=True
    )
    # 1 = primär i hopparningen (fotot), 0 = sekundär (negativet). Primären
    # representerar paret i grupperad gallerivy.
    is_pair_primary = Column(Integer, default=0)
    # Detta foto är en skanning av baksidan till foto back_of_id (handskrivna
    # namn/datum). Stöd-foto - delar INTE metadata och döljs i listningarna.
    back_of_id = Column(
        Integer, ForeignKey("photos.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Plats: normaliserad via Place (place_id). location är en synkad cache av
    # platsnamnet (för sök/visning). Fotots egen GPS nedan är frikopplad.
    place_id = Column(
        Integer, ForeignKey("places.id", ondelete="SET NULL"), nullable=True, index=True
    )
    location = Column(String, default="")
    # Fotografens position (där bilden togs). Valfri osäkerhetsradie i meter.
    gps_lat = Column(Float, nullable=True)
    gps_lon = Column(Float, nullable=True)
    gps_radius_m = Column(Integer, nullable=True)
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

    # Perceptuell hash (dHash, 16 hex) för dubblett-/liknande-detektering.
    phash = Column(String, nullable=True, index=True)
    # Manuell ordning (tiebreaker inom samma år/månad) för foton som skannats i
    # oordning och bara har grovt datum. Sätts via dra-och-släpp i galleriet.
    seq = Column(Integer, nullable=True, index=True)

    # Tidpunkt då AI-ansiktsdetekteringen kördes på fotot (NULL = aldrig).
    # Låter batch-jobbet hoppa över redan behandlade foton.
    ai_faces_at = Column(DateTime, nullable=True)
    # 1 = uteslut fotot från AI-ansiktsdetektering helt (även "kör om alla").
    # För foton där t.ex. målade dockor/mönster felaktigt tolkas som ansikten.
    ai_exclude = Column(Integer, default=0)

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
    place = relationship("Place", lazy="selectin")


class Place(Base):
    __tablename__ = "places"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False, default="tag")  # "person" | "tag"
    parent_id = Column(
        Integer, ForeignKey("tags.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Vald representativ ansiktsregion för en person (None = auto, senaste ansiktet).
    thumb_face_id = Column(
        Integer, ForeignKey("face_regions.id", ondelete="SET NULL"), nullable=True
    )
    # Personmetadata (används när kind="person"). Fritext för ofullständiga år.
    born = Column(String, default="")
    died = Column(String, default="")
    aliases = Column(String, default="")   # kommaseparerade alternativa namn
    bio = Column(Text, default="")
    # 1 = oidentifierad platshållarperson (skapad vid ansiktsmarkering utan namn,
    # "Okänd-N"). Skrivs inte ut med namn i album-bildtexten.
    placeholder = Column(Integer, default=0)

    photos = relationship("Photo", secondary=photo_tags, back_populates="tags")
    parent = relationship("Tag", remote_side=[id], back_populates="children")
    # Ingen delete-orphan: när en förälder tas bort flyttas barnen (i routen),
    # de får aldrig raderas på köpet. passive_deletes -> DB:ns ON DELETE SET NULL
    # är säkerhetsnätet om ett barn ändå skulle hänga kvar.
    children = relationship(
        "Tag", back_populates="parent", passive_deletes=True,
    )


class PersonLink(Base):
    """Familjelänk mellan två personer (Tag kind=person). relation:
    'parent' = person_id är förälder till related_id; 'partner' = symmetrisk."""
    __tablename__ = "person_links"

    id = Column(Integer, primary_key=True)
    person_id = Column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    related_id = Column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relation = Column(String, nullable=False)  # "parent" | "partner"


class FaceRegion(Base):
    __tablename__ = "face_regions"

    id = Column(Integer, primary_key=True)
    photo_id = Column(
        Integer, ForeignKey("photos.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Nullbar: obekräftade AI-ansikten utan säker matchning saknar person tills
    # de bekräftas i granskningskön.
    tag_id = Column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=True
    )
    # Normaliserade koordinater (0-1) relativt den VISADE bilden (efter
    # EXIF-orientering + användarens rotation). x/y = övre vänstra hörnet.
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    w = Column(Float, nullable=False)
    h = Column(Float, nullable=False)
    created_at = Column(DateTime, default=_now)

    # AI-ansiktsigenkänning. source="manual" (ritad av användaren) | "ai"
    # (hittad av batch-jobbet). confirmed=0 => förslag som inte räknas in i
    # personer/export/album förrän användaren bekräftat det i granskningskön.
    source = Column(String, default="manual")
    confirmed = Column(Integer, default=1)
    # 512-d ansikts-embedding (float32 -> bytes) för matchning/klustring.
    embedding = Column(LargeBinary, nullable=True)
    # Detektorns konfidens (frontal/kvalitet), om hittat av AI. Används som
    # tiebreaker vid auto-val av personens tumnagel. Manuella rutor saknar den.
    det_score = Column(Float, nullable=True)
    # AI:ns namngissning (bekräftas/avvisas av användaren). Skild från tag_id.
    suggested_tag_id = Column(
        Integer, ForeignKey("tags.id", ondelete="SET NULL"), nullable=True
    )

    photo = relationship("Photo", back_populates="faces")
    # foreign_keys behövs: flera FK-vägar mellan tabellerna (Tag.thumb_face_id,
    # suggested_tag_id).
    tag = relationship("Tag", foreign_keys=[tag_id])
    suggested_tag = relationship("Tag", foreign_keys=[suggested_tag_id])


class Album(Base):
    """Kurerad, ordnad samling foton från flera källor. Egen ordning (position)
    oberoende av datum - skild från taggar (beskrivande) och seq (kronologisk)."""
    __tablename__ = "albums"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=_now)
    # PDF-/layoutinställningar (redigeras i layoutvyn, används av PDF-exporten).
    layout = Column(Integer, default=4)            # bilder per sida (1/2/4/6)
    page_format = Column(String, default="a4p")    # a4p | a4l | a5p
    trailing_blanks = Column(Integer, default=0)   # tomma sidor sist (häfteslayout)
    subtitle = Column(String, default="")
    caption_fields = Column(String, default="date,place,persons")
    cover_photo_id = Column(
        Integer, ForeignKey("photos.id", ondelete="SET NULL"), nullable=True
    )

    entries = relationship(
        "AlbumPhoto", back_populates="album",
        cascade="all, delete-orphan", order_by="AlbumPhoto.position",
    )


class AlbumPhoto(Base):
    __tablename__ = "album_photos"

    album_id = Column(
        Integer, ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True
    )
    photo_id = Column(
        Integer, ForeignKey("photos.id", ondelete="CASCADE"), primary_key=True
    )
    position = Column(Integer, nullable=False, default=0)
    # Om satt: detta foto INLEDER ett avsnitt med denna rubrik (avsnittet löper
    # till nästa rubrik). section_layout kan överstyra albumets layout för avsnittet.
    section_heading = Column(String, nullable=True)
    section_layout = Column(Integer, nullable=True)
    # Per-foto bildtextfält i detta album. None = använd albumets standard;
    # "" = ingen bildtext; "date,place" = just dessa fält.
    caption_fields = Column(String, nullable=True)
    # Antal tomma sidor som infogas FÖRE detta fotos sida (för häfteslayout).
    blank_before = Column(Integer, default=0)

    album = relationship("Album", back_populates="entries")
    photo = relationship("Photo")


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
        if not _column_exists(conn, "photos", "is_negative"):
            conn.exec_driver_sql(
                "ALTER TABLE photos ADD COLUMN is_negative INTEGER DEFAULT 0"
            )
        if not _column_exists(conn, "photos", "paired_with_id"):
            conn.exec_driver_sql(
                "ALTER TABLE photos ADD COLUMN paired_with_id INTEGER"
            )
        for _c, _t in (("gps_lat", "FLOAT"), ("gps_lon", "FLOAT"),
                       ("gps_radius_m", "INTEGER"), ("date_month", "INTEGER"),
                       ("date_precision", "VARCHAR"),
                       ("is_pair_primary", "INTEGER"),
                       ("place_id", "INTEGER")):
            if not _column_exists(conn, "photos", _c):
                conn.exec_driver_sql(f"ALTER TABLE photos ADD COLUMN {_c} {_t}")
        if not _column_exists(conn, "tags", "parent_id"):
            conn.exec_driver_sql("ALTER TABLE tags ADD COLUMN parent_id INTEGER")
        if not _column_exists(conn, "tags", "thumb_face_id"):
            conn.exec_driver_sql(
                "ALTER TABLE tags ADD COLUMN thumb_face_id INTEGER"
            )
        for _c in ("born", "died", "aliases", "bio"):
            if not _column_exists(conn, "tags", _c):
                conn.exec_driver_sql(f"ALTER TABLE tags ADD COLUMN {_c} VARCHAR DEFAULT ''")
        if not _column_exists(conn, "tags", "placeholder"):
            conn.exec_driver_sql("ALTER TABLE tags ADD COLUMN placeholder INTEGER DEFAULT 0")
            # Befintliga "Okänd-N"-personer markeras som platshållare (en gång).
            conn.exec_driver_sql(
                "UPDATE tags SET placeholder=1 WHERE kind='person' AND name LIKE 'Okänd-%'"
            )
        if not _column_exists(conn, "photos", "back_of_id"):
            conn.exec_driver_sql("ALTER TABLE photos ADD COLUMN back_of_id INTEGER")
        if not _column_exists(conn, "photos", "phash"):
            conn.exec_driver_sql("ALTER TABLE photos ADD COLUMN phash VARCHAR")
        if not _column_exists(conn, "photos", "seq"):
            conn.exec_driver_sql("ALTER TABLE photos ADD COLUMN seq INTEGER")
        if not _column_exists(conn, "album_photos", "section_heading"):
            conn.exec_driver_sql(
                "ALTER TABLE album_photos ADD COLUMN section_heading VARCHAR"
            )
        if not _column_exists(conn, "album_photos", "section_layout"):
            conn.exec_driver_sql(
                "ALTER TABLE album_photos ADD COLUMN section_layout INTEGER"
            )
        if not _column_exists(conn, "album_photos", "caption_fields"):
            conn.exec_driver_sql(
                "ALTER TABLE album_photos ADD COLUMN caption_fields VARCHAR"
            )
        if not _column_exists(conn, "albums", "layout"):
            conn.exec_driver_sql("ALTER TABLE albums ADD COLUMN layout INTEGER DEFAULT 4")
        if not _column_exists(conn, "albums", "subtitle"):
            conn.exec_driver_sql("ALTER TABLE albums ADD COLUMN subtitle VARCHAR DEFAULT ''")
        if not _column_exists(conn, "albums", "caption_fields"):
            conn.exec_driver_sql(
                "ALTER TABLE albums ADD COLUMN caption_fields VARCHAR DEFAULT 'date,place,persons'"
            )
        if not _column_exists(conn, "albums", "cover_photo_id"):
            conn.exec_driver_sql("ALTER TABLE albums ADD COLUMN cover_photo_id INTEGER")
        if not _column_exists(conn, "albums", "page_format"):
            conn.exec_driver_sql("ALTER TABLE albums ADD COLUMN page_format VARCHAR DEFAULT 'a4p'")
        if not _column_exists(conn, "albums", "trailing_blanks"):
            conn.exec_driver_sql("ALTER TABLE albums ADD COLUMN trailing_blanks INTEGER DEFAULT 0")
        if not _column_exists(conn, "album_photos", "blank_before"):
            conn.exec_driver_sql("ALTER TABLE album_photos ADD COLUMN blank_before INTEGER DEFAULT 0")
        if not _column_exists(conn, "face_regions", "source"):
            conn.exec_driver_sql(
                "ALTER TABLE face_regions ADD COLUMN source VARCHAR DEFAULT 'manual'"
            )
        if not _column_exists(conn, "face_regions", "confirmed"):
            conn.exec_driver_sql(
                "ALTER TABLE face_regions ADD COLUMN confirmed INTEGER DEFAULT 1"
            )
        if not _column_exists(conn, "face_regions", "embedding"):
            conn.exec_driver_sql("ALTER TABLE face_regions ADD COLUMN embedding BLOB")
        if not _column_exists(conn, "face_regions", "det_score"):
            conn.exec_driver_sql("ALTER TABLE face_regions ADD COLUMN det_score FLOAT")
        if not _column_exists(conn, "face_regions", "suggested_tag_id"):
            conn.exec_driver_sql(
                "ALTER TABLE face_regions ADD COLUMN suggested_tag_id INTEGER"
            )
        if not _column_exists(conn, "photos", "ai_faces_at"):
            conn.exec_driver_sql("ALTER TABLE photos ADD COLUMN ai_faces_at DATETIME")
        if not _column_exists(conn, "photos", "ai_exclude"):
            conn.exec_driver_sql("ALTER TABLE photos ADD COLUMN ai_exclude INTEGER DEFAULT 0")
        _make_face_tag_id_nullable(conn)

    _rebase_photo_paths()


def _make_face_tag_id_nullable(conn) -> None:
    """Gör face_regions.tag_id nullbar (för obekräftade AI-ansikten utan namn).
    SQLite kan inte släppa NOT NULL via ALTER - bygg om tabellen om den gamla
    har NOT NULL. Idempotent (hoppar över om redan nullbar)."""
    info = conn.exec_driver_sql("PRAGMA table_info(face_regions)").fetchall()
    tag_col = next((r for r in info if r[1] == "tag_id"), None)
    if tag_col is None or tag_col[3] == 0:  # saknas eller redan nullbar
        return
    cols = "id, photo_id, tag_id, x, y, w, h, created_at, source, confirmed, embedding, suggested_tag_id"
    conn.exec_driver_sql("""
        CREATE TABLE face_regions_new (
            id INTEGER PRIMARY KEY,
            photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            x FLOAT NOT NULL, y FLOAT NOT NULL, w FLOAT NOT NULL, h FLOAT NOT NULL,
            created_at DATETIME,
            source VARCHAR DEFAULT 'manual',
            confirmed INTEGER DEFAULT 1,
            embedding BLOB,
            suggested_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
        )
    """)
    conn.exec_driver_sql(
        f"INSERT INTO face_regions_new ({cols}) SELECT {cols} FROM face_regions"
    )
    conn.exec_driver_sql("DROP TABLE face_regions")
    conn.exec_driver_sql("ALTER TABLE face_regions_new RENAME TO face_regions")
    conn.exec_driver_sql(
        "CREATE INDEX ix_face_regions_photo_id ON face_regions (photo_id)"
    )


def _rebase_photo_paths() -> None:
    """Räkna om varje fotos absoluta sökväg från PHOTO_DIR + folder + filename.

    Scanningen lägger alltid foton under PHOTO_DIR, så den absoluta sökvägen är
    alltid PHOTO_DIR/folder/filename. När PHOTO_DIR byts (t.ex. flytt till
    Unraid där fotomappen monteras på /photos) pekar de lagrade absoluta
    sökvägarna fel - den här rebaseringen gör en medhavd databas portabel.
    Idempotent: rör bara rader som faktiskt skiljer sig."""
    import logging

    log = logging.getLogger("fotoscan")
    with engine.begin() as conn:
        rows = conn.exec_driver_sql(
            "SELECT id, folder, filename, path FROM photos"
        ).fetchall()
        changed = 0
        for pid, folder, filename, path in rows:
            expected = str((PHOTO_DIR / folder / filename) if folder
                           else (PHOTO_DIR / filename))
            if expected != path:
                conn.exec_driver_sql(
                    "UPDATE photos SET path = ? WHERE id = ?", (expected, pid)
                )
                changed += 1
    if changed:
        log.info("Rebaserade %d fotosökvägar mot PHOTO_DIR=%s", changed, PHOTO_DIR)
