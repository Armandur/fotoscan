from pydantic import BaseModel, Field


class TagItem(BaseModel):
    name: str
    kind: str = "tag"


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
    date_year: int | None = None
    location: str = ""
    notes: str = ""
    source: str = ""
    # Hela uppsättningen taggar/personer för fotot (ersätter befintliga).
    tags: list[TagItem] = Field(default_factory=list)
    mark_reviewed: bool = False
