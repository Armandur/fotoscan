# CLAUDE.md - Fotoscan

Metadataverktyg för gamla foton/negativ. SQLite är sanningskällan; bildfiler
läses orörda på plats (flyttas/döps/skrivs aldrig till).

## Stack
- Python 3.12 + FastAPI (uvicorn), SQLAlchemy ORM, SQLite
- Jinja2 + vanilla JS + Bootstrap 5.3 (CDN, `data-bs-theme="dark"`) + Bootstrap
  Icons (CDN). Ingen bundler. `static/css/style.css` kompletterar bara Bootstrap
  (galleri-grid, autocomplete-dropdown, detaljvyns bild).
- Pillow för thumbnails och EXIF-datum
- `uv` för beroenden/körning

## Filstruktur
```
app/
  main.py              app, lifespan (init_db), router-registrering
  config.py            env: PHOTO_DIR, DATA_DIR, EXPORT_DIR, PORT; THUMB_SIZE, extensions
  database.py          SQLAlchemy-modeller (Photo, Tag, photo_tags), init_db + ALTER-guards
  schemas.py           Pydantic (PhotoUpdate, TagItem)
  deps.py              get_db
  routes/
    photos.py          galleri, detalj, uppdatering, bild/thumb-servering, rotation
    scan.py            POST /api/scan
    tags.py            GET /api/tags (autocomplete)
    export.py          POST /api/photos/{id}/export, POST /api/export
  services/
    scanner.py         scan_directory, load_oriented, make_thumbnail, _read_exif_date
    exporter.py        export_photo, export_many (exiftool-subprocess)
  templates/           base/index/photo.html
  static/css|js/       style.css, utils.js (apiFetch/showToast/escapeHtml), photo.js
data/                  fotoscan.db + thumbnails/ (gitignored)
photos/                exempel/testbilder (gitignored)
```

## Designbeslut
- **Metadata i DB, inte i filerna.** Snabb sökning, ångerbart, funkar för
  negativ utan EXIF. Inbäddning/export till EXIF/XMP är en framtida funktion.
- **Datum som fritext + valfritt år.** `date_text` ("ca 1975") för människor,
  `date_year` (int, nullable) för sortering/filtrering.
- **Personer och taggar i samma tabell** (`Tag.kind` = "person" | "tag"),
  many-to-many via `photo_tags`.
- **Metadatafält:** date_text, date_year, location, source (vem fotot kommer
  från), notes, taggar/personer. (Arkivnummer fanns tidigare men togs bort.)
- **Rotation i DB** (`Photo.rotation`, grader medurs). `/image/{id}` roterar
  on-the-fly när rotation != 0; thumbnail regenereras vid rotation.
- **prev/next** i detaljvyn beräknas från samma sortering som galleriet
  (`_ordered_ids`) - OK för projektets skala (<1000 foton).
- **Inbäddat EXIF-datum** (`Photo.exif_datetime`): råa `DateTimeOriginal` läses
  en gång vid scan ur Exif-sub-IFD:n (0x8769, inte topp-IFD:n!) och skrivs
  aldrig över. Visas read-only i detaljvyn med en "Använd"-knapp.
- **Export** (`services/exporter.py`): kopierar originalet till `EXPORT_DIR` och
  bäddar in metadata i kopian via `exiftool` (XMP primärt, EXIF-datum + GPS som
  komplement). Originalen rörs aldrig. Kräver `exiftool` installerat (finns i
  Docker-imagen). Rotation skrivs som EXIF Orientation (antar att originalet
  saknar egen Orientation - sant för de flesta scans).

## Deployment
- Single-container Docker på Unraid (TERVO2), image till GHCR. `Dockerfile`
  apt-installerar `libimage-exiftool-perl`. `docker-compose.yml` = drift (GHCR-
  image, volymer för /data, /export, read-only /photos), `docker-compose.dev.yml`
  = lokal build med --reload.

## Fallgropar
- `Jinja2Templates.TemplateResponse` kräver nya signaturen
  `TemplateResponse(request, "namn.html", {...})` - request först, inte i context.
- **Använd inte `form.elements.X` i JS** - obscuras headless-motor exponerar inte
  `form.elements`. Använd `form.querySelector('[name="X"]')` (helpern `field()` i
  photo.js). Fungerar i riktiga webbläsare oavsett.

## Vanliga förändringar
- Nytt metadatafält: kolumn i `database.py` (+ ALTER-guard i `init_db`),
  fält i `schemas.PhotoUpdate`, hantering i `routes/photos.update_photo`,
  input i `photo.html`, insamling i `photo.js:collect()`.
- Verifiera efter ändring: `uv run python -c "from app.main import app"` +
  starta server och browser-testa via `obscura fetch http://ubuntu-ai:8810/...`.
