"""Delad galleri-filtrering/sortering, återanvänd av galleri, person-, tagg-,
plats- och tidslinjevyer."""
from sqlalchemy import or_

from app.database import Photo


def sort_order(sort: str):
    """Order-by-uttryck för en fotolista. Okänt datum hamnar sist.

    date_text ("YYYY-MM-DD") används som tiebreaker efter år/månad så att dagen
    sorteras rätt (vi lagrar inte dagen i en egen kolumn)."""
    if sort == "date_desc":
        return [Photo.date_year.is_(None), Photo.date_year.desc(),
                Photo.date_month.is_(None), Photo.date_month.desc(),
                Photo.date_text.desc(), Photo.filename]
    if sort == "name":
        return [Photo.folder, Photo.filename]
    if sort == "added":
        return [Photo.id]
    return [Photo.date_year.is_(None), Photo.date_year,
            Photo.date_month.is_(None), Photo.date_month,
            Photo.date_text, Photo.filename]


def apply_dimensions(query, reviewed="", ptype="", paired="", separate=False):
    """Lägg på filterdimensionerna (granskat/typ/hopparat) + gruppering på en
    befintlig Photo-query. separate=False döljer sekundären i hopparade par.
    Baksides-skanningar (back_of_id satt) är stöd-foton och döljs alltid."""
    query = query.filter(Photo.back_of_id.is_(None))
    if not separate:
        query = query.filter(
            or_(Photo.paired_with_id.is_(None), Photo.is_pair_primary == 1)
        )
    if reviewed == "yes":
        query = query.filter(Photo.reviewed_at.isnot(None))
    elif reviewed == "no":
        query = query.filter(Photo.reviewed_at.is_(None))
    if ptype == "negative":
        query = query.filter(Photo.is_negative == 1)
    elif ptype == "photo":
        query = query.filter(Photo.is_negative == 0)
    if paired == "yes":
        query = query.filter(Photo.paired_with_id.isnot(None))
    elif paired == "no":
        query = query.filter(Photo.paired_with_id.is_(None))
    return query
