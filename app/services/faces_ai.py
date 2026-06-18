"""Ansiktsdetektering + igenkänning (InsightFace, CPU).

Modellen laddas lat (första anropet) och cachas i processen. Modellpacken
buffalo_l laddas ner till DATA_DIR/insightface första gången och persisterar
på volymen. Koordinater normaliseras (0-1) mot den VISADE bilden (efter
EXIF-orientering + rotation) precis som manuella ansiktsrutor, så de kan
visas/sparas på samma sätt.
"""
import logging

import numpy as np

from app.config import DATA_DIR
from app.services.scanner import load_oriented

logger = logging.getLogger("fotoscan.faces_ai")

_MODEL_DIR = DATA_DIR / "insightface"
_app = None


def _get_app():
    """Lat-initierad FaceAnalysis (dyr att ladda, ~13s). CPU."""
    global _app
    if _app is None:
        from insightface.app import FaceAnalysis

        _MODEL_DIR.mkdir(parents=True, exist_ok=True)
        app = FaceAnalysis(
            name="buffalo_l", root=str(_MODEL_DIR),
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(640, 640))
        _app = app
        logger.info("InsightFace laddad (buffalo_l, CPU)")
    return _app


def emb_to_bytes(emb: np.ndarray) -> bytes:
    return np.asarray(emb, dtype=np.float32).tobytes()


def bytes_to_emb(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


def _normalize(emb: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(emb)
    return emb / n if n else emb


def detect_in_photo(photo) -> list[dict]:
    """Detektera ansikten i ett foto. Returnerar en lista med dicts:
    {x, y, w, h (normaliserade), embedding (np.float32 512-d), det_score}."""
    img = load_oriented(photo.path if isinstance(photo.path, str) else str(photo.path),
                        photo.rotation or 0)
    W, H = img.size
    arr = np.asarray(img)[:, :, ::-1]  # RGB -> BGR
    out = []
    for f in _get_app().get(arr):
        x1, y1, x2, y2 = f.bbox
        x1, y1 = max(0.0, x1), max(0.0, y1)
        x2, y2 = min(float(W), x2), min(float(H), y2)
        if x2 <= x1 or y2 <= y1:
            continue
        out.append({
            "x": x1 / W, "y": y1 / H,
            "w": (x2 - x1) / W, "h": (y2 - y1) / H,
            "embedding": np.asarray(f.embedding, dtype=np.float32),
            "det_score": float(f.det_score),
        })
    return out


def iou(a: dict, b) -> float:
    """Overlap (IoU) mellan en detektering (dict x/y/w/h) och en FaceRegion."""
    ax1, ay1, ax2, ay2 = a["x"], a["y"], a["x"] + a["w"], a["y"] + a["h"]
    bx1, by1, bx2, by2 = b.x, b.y, b.x + b.w, b.y + b.h
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a["w"] * a["h"] + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union else 0.0


class Matcher:
    """Föreslår person för en embedding via cosine-likhet mot referenspersoners
    medel-embedding (byggs av bekräftade, namngivna ansikten)."""

    def __init__(self, refs: dict[int, np.ndarray], threshold: float = 0.40):
        # refs: tag_id -> normaliserad medel-embedding
        self.threshold = threshold
        self.ids = list(refs.keys())
        self.mat = (
            np.stack([refs[i] for i in self.ids]) if self.ids else None
        )

    def suggest(self, emb: np.ndarray) -> tuple[int | None, float]:
        if self.mat is None:
            return None, 0.0
        sims = self.mat @ _normalize(emb)
        idx = int(np.argmax(sims))
        best = float(sims[idx])
        if best >= self.threshold:
            return self.ids[idx], best
        return None, best

    def topk(self, emb: np.ndarray, k: int = 4, floor: float = 0.20) -> list[tuple[int, float]]:
        """De k bästa personmatchningarna (tag_id, likhet) över ett lågt golv -
        för att visa flera förslag att välja bland i granskningen."""
        if self.mat is None:
            return []
        sims = self.mat @ _normalize(emb)
        order = np.argsort(sims)[::-1][:k]
        return [(self.ids[i], float(sims[i])) for i in order if sims[i] >= floor]


def build_matcher(face_rows: list[tuple[int, bytes]], threshold: float = 0.40) -> Matcher:
    """face_rows: (tag_id, embedding-bytes) för bekräftade, namngivna ansikten."""
    per_person: dict[int, list[np.ndarray]] = {}
    for tag_id, emb_bytes in face_rows:
        if tag_id is None or not emb_bytes:
            continue
        per_person.setdefault(tag_id, []).append(_normalize(bytes_to_emb(emb_bytes)))
    refs = {tid: _normalize(np.mean(v, axis=0)) for tid, v in per_person.items()}
    return Matcher(refs, threshold)
