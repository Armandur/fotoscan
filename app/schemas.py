from pydantic import BaseModel, Field


class TagItem(BaseModel):
    name: str
    kind: str = "tag"


class PersonRename(BaseModel):
    name: str


class NameIn(BaseModel):
    name: str
    parent_id: int | None = None


class TagParentUpdate(BaseModel):
    parent_id: int | None = None


class PlaceRename(BaseModel):
    old: str
    new: str


class PersonMerge(BaseModel):
    into_id: int


class PersonThumb(BaseModel):
    # None = återställ till auto (senaste ansiktet).
    face_id: int | None = None


class FaceBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class PhotoAdjust(BaseModel):
    auto_tone: bool = False
    adj_brightness: float = 1.0
    adj_contrast: float = 1.0
    adj_gamma: float = 1.0
    adj_saturation: float = 1.0
    adj_red: float = 1.0
    adj_green: float = 1.0
    adj_blue: float = 1.0


class FaceRegionIn(BaseModel):
    person: str
    x: float
    y: float
    w: float
    h: float


class PhotoUpdate(BaseModel):
    date_text: str = ""
    location: str = ""
    notes: str = ""
    source: str = ""
    is_negative: bool = False
    gps_lat: float | None = None
    gps_lon: float | None = None
    gps_radius_m: int | None = None
    # Hela uppsättningen taggar/personer för fotot (ersätter befintliga).
    tags: list[TagItem] = Field(default_factory=list)
    mark_reviewed: bool = False


class BatchUpdate(BaseModel):
    ids: list[int] = Field(default_factory=list)
    # Applicera på alla foton i nuvarande filter i stället för en id-lista.
    use_filter: bool = False
    q: str = ""
    reviewed: str = ""      # filter: ""|"yes"|"no"
    ptype: str = ""
    paired: str = ""
    folder: str = "*"
    recursive: bool = False
    separate: bool = False
    missing: str = ""       # filter: ""|"date"|"place"|"person"
    # Åtgärder (None/tom = lämna oförändrat).
    set_negative: bool | None = None
    set_reviewed: bool | None = None
    add_tags: list[TagItem] = Field(default_factory=list)
    remove_tags: list[TagItem] = Field(default_factory=list)
    set_date: str | None = None       # date_text (härleds till år/månad/precision)
    set_location: str | None = None   # platsnamn (get_or_create_place)
    add_to_album: int | None = None   # lägg foton i detta album


class PairRequest(BaseModel):
    other_id: int
    # Vid konflikt: {fältnamn: "a" | "b"} - vilket fotos värde som vinner.
    resolutions: dict[str, str] = Field(default_factory=dict)


class BackLink(BaseModel):
    other_id: int


class ReorderRequest(BaseModel):
    # Foto-id i önskad ordning; seq sätts till listindex.
    ids: list[int] = Field(default_factory=list)


class AlbumPhotosIn(BaseModel):
    photo_ids: list[int] = Field(default_factory=list)


class SectionIn(BaseModel):
    # Tom rubrik = ta bort avsnittsstarten. layout None = använd albumets standard.
    heading: str = ""
    layout: int | None = None
    blank_before: int = 0   # tomma sidor som infogas före detta fotos sida


class AlbumSettingsIn(BaseModel):
    layout: int = 4
    page_format: str = "a4p"
    trailing_blanks: int = 0
    subtitle: str = ""
    caption_fields: str = "date,place,persons"


class CaptionIn(BaseModel):
    use_default: bool = True
    fields: str = ""


class CoverIn(BaseModel):
    photo_id: int | None = None
