import json
import urllib.parse
import urllib.request

from fastapi import APIRouter, HTTPException

router = APIRouter()

_NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Nominatims användarvillkor kräver en identifierande User-Agent.
_UA = "fotoscan/0.1 (personligt arkivverktyg)"


@router.get("/api/geocode")
def geocode(q: str = ""):
    """Proxy mot OpenStreetMap Nominatim för adress-/platssökning.

    Görs på servern för att slippa CORS och kunna sätta en korrekt User-Agent.
    """
    q = q.strip()
    if not q:
        return []
    url = f"{_NOMINATIM}?" + urllib.parse.urlencode({
        "q": q, "format": "json", "limit": "6", "addressdetails": "0",
    })
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.load(resp)
    except Exception:
        raise HTTPException(502, "Kunde inte nå platssökningen just nu")
    return [
        {
            "name": item.get("display_name", ""),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
        }
        for item in data if "lat" in item and "lon" in item
    ]
