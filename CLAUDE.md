# CLAUDE.md - Fotoscan

Metadataverktyg för gamla foton/negativ. SQLite är sanningskällan; bildfiler
läses orörda på plats (flyttas/döps/skrivs aldrig till).

## Stack
- Python 3.12 + FastAPI (uvicorn), SQLAlchemy ORM, SQLite
- Jinja2 + vanilla JS + Bootstrap 5.3 (`data-bs-theme="dark"`) + Bootstrap Icons,
  **självhostade** under `static/vendor/` (inte CDN - undviker FOUC/vit bakgrund
  och funkar offline). Ingen bundler. `static/css/style.css` kompletterar bara
  Bootstrap (galleri-grid, autocomplete-dropdown, detaljvyns bild).
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
    faces.py           ansiktsregioner: CRUD, /api/persons, /api/faces/{id}/thumb
    persons.py         personvy (lista/detalj), namnbyte, merge, borttagning
    tags.py            /api/tags (autocomplete) + taggvy (lista/detalj/skapa/byt namn/ta bort)
    places.py          Place-tabell: vy (lista/detalj), byt namn/merge, ta bort, get_or_create_place
    timeline.py        tidslinjevy grupperad per år/månad (date_year/month/precision)
    pairing.py         para ihop negativ<->foto: kandidater, pair (merge), unpair
    geo.py             /api/geocode (proxy mot OSM Nominatim för platssökning)
  services/
    scanner.py         scan_directory, load_oriented, render_photo, write_thumbnail, _read_exif_date
    exporter.py        export_photo, export_many (exiftool, inkl. MWG-rs regioner)
    adjust.py          apply_adjustments, has_adjustments (färg-/tonpipeline, Pillow)
  templates/           base/index/photo.html
  static/css|js/       style.css, utils.js (apiFetch/showToast/escapeHtml), photo.js, faces.js, adjust.js
data/                  fotoscan.db + thumbnails/ (gitignored)
photos/                exempel/testbilder (gitignored)
```

## Designbeslut
- **Metadata i DB, inte i filerna.** Snabb sökning, ångerbart, funkar för
  negativ utan EXIF. Inbäddning/export till EXIF/XMP är en framtida funktion.
- **Datum som fritext + härledda fält.** `date_text` ("ca 1975", "sommaren 1962",
  "2003-10-01") för människor. `services/dates.parse_date_text` härleder
  `date_year`, `date_month` och `date_precision` (day/month/season/year/"") vid
  scan och sparning - hanterar ofullständiga datum och årstider. Underlag för
  framtida tidslinjevy.
- **Personer och taggar i samma tabell** (`Tag.kind` = "person" | "tag"),
  many-to-many via `photo_tags`.
- **Metadatafält:** date_text, date_year, plats (Place), source (vem fotot kommer
  från), notes, taggar/personer. (Arkivnummer fanns tidigare men togs bort.)
- **Plats normaliserad** (`Place`-tabell, `Photo.place_id`): plats är en egen
  återanvändbar entitet. `Photo.location` är en synkad namn-cache (för sök/kort).
  `update_photo` gör get_or_create_place. Fotots egen GPS (`gps_lat/lon`) är
  frikopplad - grov plats vs exakt fotografposition.
- **Rotation i DB** (`Photo.rotation`, grader medurs). `/image/{id}` roterar
  on-the-fly när rotation != 0; thumbnail regenereras vid rotation.
- **prev/next** i detaljvyn beräknas från samma sortering som galleriet
  (`_ordered_ids`) - OK för projektets skala (<1000 foton).
- **Inbäddat EXIF-datum** (`Photo.exif_datetime`): råa `DateTimeOriginal` läses
  en gång vid scan ur Exif-sub-IFD:n (0x8769, inte topp-IFD:n!) och skrivs
  aldrig över. Visas read-only i detaljvyn med en "Använd"-knapp.
- **Ansiktstaggning** (`Photo.faces` -> `FaceRegion`): normaliserade koordinater
  (0-1, övre vänstra hörnet) relativt den VISADE bilden. Rita ruta i detaljvyn ->
  personsök med ansikts-thumbnails (`/api/persons` + `/api/faces/{id}/thumb`).
  Tomt namn -> "Okänd-N" (platshållare). Vid rotation transformeras regionerna i
  `rotate_photo`. Export skriver MWG-rs Regions (center-koordinater) via exiftool.
- **Färg-/tonjustering** (`Photo.adj_*` + `auto_tone`, `services/adjust.py`):
  multiplikatorer (1.0 = oförändrat) för ljusstyrka/kontrast/gamma/mättnad +
  per-kanal RGB, samt auto-ton (`ImageOps.autocontrast`). Renderas on-the-fly i
  `/image` (och thumbnail), live-preview i UI via CSS-filter på `/image?raw=1`.
  Bakas in vid export (då re-kodas filen; utan justeringar behålls bit-kopian).
  OBS: `Image.point()` på RGB kräver lut med 256*bands poster.
- **Mappnavigering**: galleriet har en trädvy (`_build_folder_tree` av distinkta
  `Photo.folder`-sökvägar) med expanderbara noder. `recursive`-toggle inkluderar
  undermappar (`folder == X OR folder LIKE X/%`). `_filtered_query` delas av
  galleri och batch-åtgärder.
- **Massåtgärder**: urvalsläge i galleriet + `POST /api/photos/batch` (id-lista
  eller hela filtret). Just nu: markera/avmarkera negativ och granskad.
- **Position/karta** (`Photo.gps_lat/gps_lon/gps_radius_m`): fotografens position
  sätts via en Leaflet/OSM-karta (självhostad under `static/vendor/leaflet/`,
  `map.js`). Adress-sök går via backend-proxyn `/api/geocode` (Nominatim, med
  korrekt User-Agent). Exporteras som EXIF GPS + `GPSHPositioningError` (radie).
  OBS: Leaflet kan inte browser-testas i obscura (kastar headless).
- **Hopparning som kombination**: ett par (foto + negativ) delar metadata.
  `Photo.is_pair_primary` (1=fotot/primär, 0=negativet) avgör vem som
  representerar paret. Delad metadata (`_SHARED_META` + taggar) speglas till
  partnern vid sparning (`_sync_pair_metadata`). Galleriet grupperar: sekundären
  döljs om inte `separate`-toggeln är på (`_filtered_query`). Per-bild-fält
  (is_negative, rotation, justeringar) delas inte.
- **Hopparning** (`Photo.is_negative`, `Photo.paired_with_id`): symmetrisk 1:1-
  länk mellan ett negativ och dess skannade foto. Vid hopparning slås metadatan
  samman (fält som bara en har auto-fylls; konflikter löses i en diff-vy;
  taggar/personer union) och appliceras på båda. Sökkandidater exkluderar redan
  hopparade som default (toggle visar dem). Se `routes/pairing.py`.
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

## Konventioner
- **Använd aldrig `alert()` eller `confirm()`** - använd Bootstrap-modaler.
  För bekräftelser finns `showConfirm(message, {okLabel, okClass})` i `utils.js`
  som returnerar en `Promise<boolean>`.

## Fallgropar
- `Jinja2Templates.TemplateResponse` kräver nya signaturen
  `TemplateResponse(request, "namn.html", {...})` - request först, inte i context.
- **Använd inte `form.elements.X` i JS** - obscuras headless-motor exponerar inte
  `form.elements`. Använd `form.querySelector('[name="X"]')` (helpern `field()` i
  photo.js). Fungerar i riktiga webbläsare oavsett.
- **`querySelector` på ett ej inkopplat element returnerar null i obscura** (t.ex.
  efter `el.innerHTML = ...` innan `appendChild`). Bygg DOM med `createElement` +
  `addEventListener`, eller appenda först. Gäller bara obscura, inte riktiga
  webbläsare - men createElement-vägen är robust överallt (se `faces.js:makeBox`).

## Vanliga förändringar
- Nytt metadatafält: kolumn i `database.py` (+ ALTER-guard i `init_db`),
  fält i `schemas.PhotoUpdate`, hantering i `routes/photos.update_photo`,
  input i `photo.html`, insamling i `photo.js:collect()`.
- Verifiera efter ändring: `uv run python -c "from app.main import app"` +
  starta server och browser-testa via `obscura fetch http://ubuntu-ai:8810/...`.
