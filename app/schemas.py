from pydantic import BaseModel, Field


class TagItem(BaseModel):
    name: str
    kind: str = "tag"


class PersonRename(BaseModel):
    name: str


class NameIn(BaseModel):
    name: str


class PlaceRename(BaseModel):
    old: str
    new: str


class PersonMerge(BaseModel):
    into_id: int


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
    reviewed: str = ""
    ptype: str = ""
    paired: str = ""
    folder: str = "*"
    recursive: bool = False
    separate: bool = False
    # Åtgärder (None = lämna oförändrat).
    is_negative: bool | None = None
    reviewed: bool | None = None


class PairRequest(BaseModel):
    other_id: int
    # Vid konflikt: {fältnamn: "a" | "b"} - vilket fotos värde som vinner.
    resolutions: dict[str, str] = Field(default_factory=dict)
