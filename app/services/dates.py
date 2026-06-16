import re

# Svenska månadsnamn -> månadsnummer.
_MONTHS_SV = {
    "januari": 1, "jan": 1, "februari": 2, "feb": 2, "mars": 3, "mar": 3,
    "april": 4, "apr": 4, "maj": 5, "juni": 6, "jun": 6, "juli": 7, "jul": 7,
    "augusti": 8, "aug": 8, "september": 9, "sept": 9, "sep": 9,
    "oktober": 10, "okt": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}
# Årstid -> representativ månad (för sortering).
_SEASONS_SV = {
    "våren": 3, "vår": 3, "varen": 3, "var": 3,
    "sommaren": 6, "sommar": 6,
    "hösten": 9, "höst": 9, "hosten": 9, "host": 9,
    "vintern": 12, "vinter": 12,
}


def parse_date_text(text: str | None) -> tuple[int | None, int | None, str]:
    """Härled (year, month, precision) ur ett fritext-datum.

    precision: 'day' | 'month' | 'season' | 'year' | '' (okänt).
    Exempel:
      "2026-06-16"     -> (2026, 6, 'day')
      "2026-06"        -> (2026, 6, 'month')
      "2026"           -> (2026, None, 'year')
      "juni 2026"      -> (2026, 6, 'month')
      "sommaren 1962"  -> (1962, 6, 'season')
      "ca 1975"        -> (1975, None, 'year')
      "1970-talet"     -> (1970, None, 'year')
    """
    if not text:
        return None, None, ""
    t = text.strip().lower()

    # ISO-aktigt: YYYY-MM-DD eller YYYY-MM (även / och . som separator).
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?", t)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), m.group(3)
        if 1 <= month <= 12:
            return year, month, "day" if day else "month"
        return year, None, "year"

    # Ett 4-siffrigt år någonstans (ca 1975, 1970-talet, sommaren 1962 ...).
    ym = re.search(r"\b(\d{4})\b", t)
    year = int(ym.group(1)) if ym else None

    for word, mon in _SEASONS_SV.items():
        if re.search(rf"\b{word}\b", t):
            return (year, mon, "season") if year else (None, None, "")

    for word, mon in _MONTHS_SV.items():
        if re.search(rf"\b{word}\b", t):
            return (year, mon, "month") if year else (None, None, "")

    if year:
        return year, None, "year"
    return None, None, ""
