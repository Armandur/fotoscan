# CLAUDE.md - Fotoscan

Metadataverktyg för gamla foton/negativ. SQLite är sanningskällan; bildfiler
läses orörda på plats (flyttas/döps/skrivs aldrig till).

## Stack
- Python 3.12 + FastAPI (uvicorn), SQLAlchemy ORM, SQLite
- Jinja2 + vanilla JS + Bootstrap 5.3 (`data-bs-theme="dark"`) + Bootstrap Icons,
  **självhostade** under `static/vendor/` (inte CDN - undviker FOUC/vit bakgrund
  och funkar offline). Ingen bundler. `static/css/style.css` kompletterar bara
  Bootstrap (galleri-grid, autocomplete-dropdown, detaljvyns bild).
- Pillow för thumbnails och EXIF-datum; `pillow-heif` (registreras i
  `scanner.py`) ger HEIC/HEIF-stöd (iPhone-foton)
- `insightface` + `onnxruntime` (CPU) för AI-ansiktsdetektering/igenkänning
  (modellpack buffalo_l laddas till `DATA_DIR/insightface`)
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
    faces_ai.py        AI-ansiktsjobb (bakgrundstråd) + granskning (/faces/review fotolista, /faces/review/{id} per foto)
    persons.py         personvy (lista/detalj), namnbyte, merge, borttagning
    tags.py            /api/tags (autocomplete) + taggvy (lista/detalj/skapa/byt namn/ta bort)
    places.py          Place-tabell: vy (lista/detalj), byt namn/merge, ta bort, get_or_create_place, /map + /api/map/points
    albums.py          Album + AlbumPhoto: vy (lista/detalj=foto-ordning), layoutvy (WYSIWYG-sidor + avsnitt), inställningar, PDF
    timeline.py        tidslinjevy grupperad per år/månad (date_year/month/precision)
    pairing.py         para ihop negativ<->foto: kandidater, pair (merge), unpair
    backside.py        baksides-koppling (back_of_id): kandidater, koppla, koppla loss
    dashboard.py       /dashboard: översikt + saknar-statistik; /review-flödet ligger i photos.py
    duplicates.py      /duplicates: grupperar liknande foton via phash (services/dupes.py); rena foto+negativ-par utesluts
    backup.py          GET /api/backup: konsekvent SQLite-snapshot (VACUUM INTO) som zip
    geo.py             /api/geocode (proxy mot OSM Nominatim för platssökning)
  services/
    filtering.py       apply_dimensions + sort_order (delas av galleri/person/tagg/plats/tidslinje)
    context.py         bläddringskontext (ctx=person/tag/place/timeline/album) för prev/next i detaljvyn
    scanner.py         scan_directory, load_oriented, render_photo, write_thumbnail, _read_exif_date
    exporter.py        export_photo, export_many (exiftool, inkl. MWG-rs regioner)
    adjust.py          apply_adjustments, has_adjustments (färg-/tonpipeline, Pillow)
    dupes.py           dHash (perceptuell hash, ren Pillow) + hamming + group_similar
    faces_ai.py        InsightFace: detect_in_photo, embedding<->bytes, iou, Matcher/build_matcher
    pdf_album.py       render_album_pdf (weasyprint HTML/CSS -> PDF, layout + bildtext)
  templates/           base/index/photo.html; _cards.html + _filterbar.html (delade macron)
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
  many-to-many via `photo_tags`. Hierarki (`parent_id`) gäller bara `kind="tag"`.
- **Oidentifierade personer** (`Tag.placeholder`=1): sätts när en ansiktsruta
  skapas utan namn ("Okänd-N"), nollställs vid namnbyte. Skrivs INTE ut med namn i
  album-bildtexten, och /persons visar dem i en egen "Oidentifierade"-sektion
  (skild från "Identifierade"). Sektionerna pagineras var för sig (`ip`/`up`-
  param, 60/sida). Flaggan ersätter att tolka namnet "Okänd-N".
- **Personmetadata** (på `Tag`, används när kind=person): `born`/`died` (fritext),
  `aliases` (kommaseparerade, sökbara i `/api/persons`), `bio`. Familjelänkar i
  `PersonLink` (person<->person, relation "parent"/"partner"; barn = omvänd parent).
  Redigeras i personvyn; merge pekar om länkar, delete städar dem.
- **Hierarkiska taggar** (`Tag.parent_id`): taggar bildar ett träd. Namn förblir
  unika (leaf-namn får inte dubbleras under olika föräldrar). Tagg-vyn visar ett
  träd-UI där förälder kan väljas med cykelskydd. Detaljvyn (`/tags/{id}`) visar
  foton för taggen OCH alla dess ättlingar rekursivt. Export skriver pipe-
  separerad sökväg till `-XMP-lr:HierarchicalSubject` (t.ex. "Familj|Farfar").
  Personer förblir platta.
- **Metadatafält:** date_text, date_year, plats (Place), source (vem fotot kommer
  från), notes, taggar/personer. (Arkivnummer fanns tidigare men togs bort.)
- **Plats normaliserad** (`Place`-tabell, `Photo.place_id`): plats är en egen
  återanvändbar entitet. `Photo.location` är en synkad namn-cache (för sök/kort).
  `update_photo` gör get_or_create_place. Fotots egen GPS (`gps_lat/lon`) är
  frikopplad - grov plats vs exakt fotografposition.
- **Rotation i DB** (`Photo.rotation`, grader medurs). `/image/{id}` roterar
  on-the-fly när rotation != 0; thumbnail regenereras vid rotation.
- **Icke-webb-native format** (TIFF/BMP/HEIC/HEIF ...): `/image` renderar dem
  till JPEG on-the-fly (cachas i RENDER_DIR), eftersom webbläsare inte visar dem
  inline. `_WEB_NATIVE` i `photos.py` listar de format som serveras orörda
  (jpg/jpeg/png/gif/webp). HEIC kräver `pillow-heif` (registrerad i `scanner.py`).
- **Baksides-koppling** (`Photo.back_of_id`): en skanning av ett fotos baksida
  (handskrivna namn/datum) kopplas till framsidan som ett stöd-foto. Delar INGEN
  metadata och döljs i alla listningar (`apply_dimensions` filtrerar bort
  `back_of_id != None` alltid). Hanteras i detaljvyn (`backside.py` + `backside.js`):
  visa/förstora baksidan, koppla via kandidatsök, koppla loss. Andra själv-FK:n på
  photos (efter `paired_with_id`) - inga ORM-relationer på dem, slås upp via query.
- **Ta bort foto ur katalogen** (`DELETE /api/photos/{id}` i detaljvyn,
  `POST /api/photos/batch-delete` som massåtgärd): tar bort katalogposten +
  diskcache (thumb/render/ansikts-crops) men rör ALDRIG originalfilen. OBS:
  ligger originalet kvar i PHOTO_DIR läggs det tillbaka vid nästa scan - filen
  måste tas bort ur fotomappen separat. SQLite-FK:erna är inte påslagna, så
  gemensam helper `_delete_photo(db, photo, del_ids)` städar alla kopplingar
  explicit: nollar partnerns `paired_with_id`, baksidors `back_of_id`,
  `Album.cover_photo_id` och `Tag.thumb_face_id` som pekar på fotots ansikten,
  samt raderar `AlbumPhoto`-rader (ansiktsrutor + `photo_tags` via ORM-cascade).
  `del_ids` (alla foton i samma operation) hoppas över i referens-nollningen så
  hopparade/baksides-foton i samma batch inte rörs i onödan. Cachestädning
  (`_purge_photo_cache`) sker efter commit. Mappträdet byggs om från
  `DISTINCT Photo.folder` vid varje sidladdning, så en tom mapp försvinner ur
  trädet automatiskt efter borttag (galleriet reloadar).
- **Granskningsläge** (`/review` i `photos.py`): redirectar till första ogranskade
  (`?reviewed=no&review=1`); detaljvyns "Spara & granska" går vidare via `/review`.
  Återanvänder detaljformuläret. Dashboard (`/dashboard`) ger översikt + `missing`-
  filter (date/place/person) i galleriet för att fylla luckor.
- **Album** (`Album` + `AlbumPhoto` med `position`): kurerad, ordnad samling foton
  från flera källor, visad i egen ordning oberoende av datum. Skild från taggar
  (beskrivande) och `seq` (kronologisk). Ett foto kan ligga i flera album. Vy med
  dra-och-släpp-ordning (`/api/albums/{id}/reorder`), lägg till via galleriets
  åtgärdsmeny ("Lägg till i album", markerade foton). `routes/albums.py`. Två vyer:
  **/albums/{id}** = fotovy (bara ordning/ta bort/byt namn), **/albums/{id}/layout**
  = WYSIWYG-layoutvy (sidlista + stora A4-sidor; avsnitt, layout, bildtext, undertitel
  hanteras här). Inställningar persisteras på albumet (`layout`/`subtitle`/
  `caption_fields`) via `POST /api/albums/{id}/settings` så vyn och PDF:en matchar.
- **PDF-album** (`services/pdf_album.py`, `GET /albums/{id}/pdf`): weasyprint
  renderar en Jinja-mall (`album_pdf.html`, `@page A4`) till PDF. `build_pages`
  delar albumet i sidor (delas av layoutvyn och PDF:en -> äkta WYSIWYG). PDF:en
  defaultar från albumets sparade inställningar. Titelsida +
  global layout (1/2/4/6 bilder per A4) + valbara bildtextfält. **Avsnitt**:
  `AlbumPhoto.section_heading` (+ valfri `section_layout`) gör att fotot inleder
  ett avsnitt - rubrik överst på ny sida, egen layout för avsnittet. Foton chunkas
  per avsnitt. Varje foto renderas till en temp-JPEG (~1600px) som bäddas in.
  Kräver libpango/cairo (i Docker-imagen). OBS: i mallen heter sid-cellerna
  `page.cells` (inte `items` - krockar med dict.items i Jinja). Bildtext: rader är
  `{key, text}`; plats/personer/taggar får ikoner (Bootstrap-icons-fonten laddas i
  PDF:en via @font-face, codepoints i mallen), anteckning får styckebrytning.
  Per-foto bildtext-override (`AlbumPhoto.caption_fields`). Titelsidesbild
  (`Album.cover_photo_id`). Sidformat (`Album.page_format`: a4p/a4l/a5p) styr
  @page + den låsta sidan. Layoutvyns sida är låst (cm/pt) och zoomas via CSS
  `zoom` (proportionellt); uppslagsvy = klient-toggle (klass `spread`) med ledande
  tom plats för recto/verso. Avsnitt sätts per foto i layoutvyn (kan börja mitt på
  en sida -> bryter till ny sida). Tomma sidor: `AlbumPhoto.blank_before` (före ett
  foto) + `Album.trailing_blanks` (sist); `build_pages` infogar dem som blank-sidor.
  Formatspec i `pdf_album.PAGE_FORMATS` (delas av PDF + layoutvy).
- **Manuell ordning** (`Photo.seq`): tiebreaker i datum-sorteringen (år -> månad
  -> seq -> date_text -> filnamn, i `services/filtering.sort_order` + timeline),
  för foton som skannats i oordning med grovt datum. Sätts via "Ordna"-läget i
  galleriet (dra-och-släpp -> `POST /api/photos/reorder` sätter seq = listindex).
  seq nollställs aldrig automatiskt; ett globalt heltal räcker då år/månad alltid
  dominerar sorteringen.
- **prev/next** i detaljvyn beräknas från samma sortering som galleriet
  (`_ordered_ids`) - OK för projektets skala (<1000 foton). Öppnas en bild från
  en annan vy bär kort-länken `?ctx=person|tag|place|timeline|album[&ctx_id=N]`
  (+ aktiva filter); då går prev/next genom DEN listan i stället
  (`services/context.py`, `context_ordered_ids`), och bakåtknappen leder till
  ursprungsvyn. Korten får querystringen via `card_qs` -> `_cards.html`-macrots
  `qs`-arg. Galleriets egna kort (i index.html, ej macrot) bär folder+qbase som
  förut. `ctx=album` är specialfall: bläddrar i albumets kurerade ordning
  (`AlbumPhoto.position`), utan dimensions-/sorteringsfilter; albumvyns kort
  länkar `?ctx=album&ctx_id={album.id}`.
- **Inbäddat EXIF-datum** (`Photo.exif_datetime`): råa `DateTimeOriginal` läses
  en gång vid scan ur Exif-sub-IFD:n (0x8769, inte topp-IFD:n!) och skrivs
  aldrig över. Visas read-only i detaljvyn med en "Använd"-knapp. OBS: klockslag
  rensades en gång (skanntid = skräp) så lagrade värden är datum-only `YYYY:MM:DD`;
  "Använd" hanterar både med och utan tid.
- **Ansiktstaggning** (`Photo.faces` -> `FaceRegion`): normaliserade koordinater
  (0-1, övre vänstra hörnet) relativt den VISADE bilden. Rita ruta i detaljvyn ->
  personsök med ansikts-thumbnails (`/api/persons` + `/api/faces/{id}/thumb`).
  Tomt namn -> "Okänd-N" (platshållare). Vid rotation transformeras regionerna i
  `rotate_photo`. Export skriver MWG-rs Regions (center-koordinater) via exiftool.
  En persons tumnagel kan väljas (`Tag.thumb_face_id` -> en `FaceRegion`); annars
  auto = senaste ansiktet (`_avatar_region_id`, validerar att valet finns kvar).
  Vald tumnagel skrivs aldrig över av nya ansikten. Ansikts-crops cachas på disk
  (`THUMB_DIR/face_{region_id}.jpg`, `scanner.face_thumb_path`), invalideras vid
  flytt/rotation/radering - så /persons inte renderar om från originalen varje gång.
  OBS: `thumb_face_id` ger en andra FK-väg tags<->face_regions, så
  `FaceRegion.tag` måste ange `foreign_keys=[tag_id]`.
- **AI-ansiktsigenkänning** (`services/faces_ai.py` + `routes/faces_ai.py`,
  `/faces/review`): InsightFace (buffalo_l, CPU) detekterar ansikten och
  beräknar 512-d embeddings. `FaceRegion` utökad med `source` (manual/ai),
  `confirmed` (0/1), `embedding` (bytes), `suggested_tag_id` (AI:ns gissning);
  `Photo.ai_faces_at` markerar behandlade foton. **Modellen tränas inte** - vi
  gör k-NN/centroid-matchning: bekräftade, namngivna ansiktens embeddings bildar
  per-person medel-embedding (`build_matcher`), nya ansikten får namnförslag via
  cosine-likhet (tröskel 0.40). Manuellt markerade rutor är alltså referensdata
  som förbättrar igenkänningen ju fler man bekräftar. Batch-jobb i bakgrundstråd
  (`_run_job`, modul-global `JOB`-status): **ett inkrementellt pass** - varje foto
  detekteras (på nedskalad bild, max 1600px, för fart), bekräftade rutor får
  backfillade embeddings via IoU-matchning, förslagsrutor skapas, och fotot
  markeras klart med **en commit per foto**. Granskningskön fylls därmed löpande
  och ett avbrutet jobb behåller allt som hunnit bli klart (kraschsäkert - viktigt
  eftersom dev-serverns `--reload` dödar tråden vid filändring). Detekterade rutor
  utökas med marginal (`_PAD_*`, mer upptill för hår) så rutor/tumnaglar visar
  hela huvudet; embeddingen tas från den tighta detekteringen.
  **AI-rutor är obekräftade** (`confirmed=0`) och **räknas inte** in i personer/
  export/album förrän de bekräftas i granskningen - därför filtrerar alla
  läsställen på `confirmed=1` (faces/persons/context/exporter/pdf_album). Bekräfta
  = sätt `tag_id` + `confirmed=1`; avvisa = `DELETE /api/faces/{id}`.
  Granskning i två nivåer: `/faces/review` listar foton med obekräftade ansikten
  (`/api/faces/ai/photos`, foto-thumb + ansikts-crops); `/faces/review/{photo_id}`
  visar hela bilden med numrerade rutor + en turordningslista per ansikte
  (`/api/faces/ai/photo/{id}` ger rutor + live-beräknade topp-förslag via
  `Matcher.topk`) där man bekräftar förslag/söker/skapar person eller avvisar.
  Per-foto-vyn visar även redan bekräftade/manuella rutor som kontext (blå
  streckade, med namn), har håll-för-att-dölja-alla-rutor (knapp/H, momentant) och
  döljer klara ansikten ur listan (toggle "visa även klara", av som default;
  listan skrollar vid många). OBS:
  `tag_id` är nullbar (obekräftade utan match saknar person) - kräver tabell-
  ombyggnad i SQLite (`_make_face_tag_id_nullable`, eftersom ALTER inte kan släppa
  NOT NULL). Tredje FK-vägen (`suggested_tag_id`) -> `foreign_keys` på relationerna.
- **Färg-/tonjustering** (`Photo.adj_*` + `auto_tone`, `services/adjust.py`):
  multiplikatorer (1.0 = oförändrat) för ljusstyrka/kontrast/gamma/mättnad +
  per-kanal RGB, samt auto-ton (`ImageOps.autocontrast`). Renderas on-the-fly i
  `/image` (och thumbnail). Live-preview i UI via nedskalad server-rendering
  (`/api/photos/{id}/preview`, debounce 200 ms) - klarar gamma/per-kanal som CSS
  inte gör. Sparas AUTOMATISKT (debounce 700 ms i `adjust.js`) via
  `POST /adjust` - ingen Tillämpa-knapp; en statusrad visar Ändrat/Sparar/Sparat.
  Auto fyller bara reglagen (förslag), Återställ nollar till 1.0. Kortkommandon
  C/A/X, samt O (håll) = visa bilden utan justering (`/image?raw=1`) för jämförelse.
  Byter man bild innan debouncen sparat flushas ändringen via `navigator.sendBeacon`
  på `pagehide`. Den visade bildstorleken låses under preview (den nedskalade
  1200px-bilden skulle annars krympa i fönstret), låses upp när fullbilden laddats.
  Bakas in vid export (då re-kodas filen; utan justeringar behålls bit-kopian).
  OBS: `Image.point()` på RGB kräver lut med 256*bands poster.
- **Mappnavigering**: galleriet har en trädvy (`_build_folder_tree` av distinkta
  `Photo.folder`-sökvägar) med expanderbara noder. `recursive`-toggle inkluderar
  undermappar (`folder == X OR folder LIKE X/%`). `_filtered_query` delas av
  galleri och batch-åtgärder.
- **Massåtgärder**: urvalsläge i galleriet + `POST /api/photos/batch` (id-lista
  eller hela filtret), samlade i en "Åtgärder"-dropdown i batch-baren. Åtgärder
  (alla None/tom = oförändrat): `set_negative`, `set_reviewed`, `add_tags`/
  `remove_tags` (tagg el. person), `set_date` (date_text -> härledda fält),
  `set_location` (get_or_create_place), `add_to_album` (lägg i album, funkar med
  både markerade och "alla i filtret"). Destruktiv borttagning ligger i samma
  meny men går mot egen endpoint (`batch-delete`, se "Ta bort foto ur katalogen"). Galleri-söket (`q`) träffar även tagg-/
  personnamn (`Photo.tags.any(Tag.name ...)`) utöver filnamn/mapp/plats/notis/
  datum/källa. Tagg-/person-/plats-fälten har
  autocomplete via native `<datalist>` som fylls från `/api/tags`/`/api/places`
  när menyn öppnas. Datum/plats/taggar speglas till hopparad partner via
  `_sync_pair_metadata`. OBS: filterfältet heter `reviewed` (sträng), åtgärden
  `set_reviewed` (bool) - tidigare krock fixad.
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
  - **Datum:** XMP `photoshop:DateCreated` byggs av vår kurerade `date_text`/
    härledda fält via `dates.iso_date_for_export` med rätt precision
    (`YYYY`/`YYYY-MM`/`YYYY-MM-DD`) - INTE av filens inbäddade tid. EXIF
    `DateTimeOriginal`/`CreateDate`/`ModifyDate` normaliseras: vid dag-precision
    sätts `YYYY:MM:DD 00:00:00` (skanntiden skrivs över, inget riktigt klockslag
    finns), annars raderas fälten så ingen skanntid läcker in i kopian.
  - **Par:** `export_with_pair` exporterar både huvudbild (eget namn) och negativ
    (`{huvudbild}-negativ`, egen filändelse). Negativ får aldrig ansiktsrutor.
  - **Taggar:** platt `dc:Subject` + `lr:HierarchicalSubject` (pipe-separerad
    sökväg) per tagg; personer som `iptcExt:PersonInImage`.

## Deployment
- Single-container Docker på Unraid (TERVO2), image till GHCR. `Dockerfile`
  apt-installerar `libimage-exiftool-perl`. `docker-compose.yml` = drift (GHCR-
  image, volymer för /data, /export, read-only /photos), `docker-compose.dev.yml`
  = lokal build med --reload.
- **CI/CD:** `.github/workflows/docker-publish.yml` bygger/pushar imagen till
  `ghcr.io/armandur/fotoscan` (push main -> latest/main/sha; `v*`-taggar ->
  semver; manuell). Login via `GITHUB_TOKEN`, gha-cache. Se `DOCKER.md`.
- **Backup** (`routes/backup.py`, `GET /api/backup`): `VACUUM INTO` ger en
  konsekvent DB-ögonblicksbild som zippas och laddas ner (knapp i /dashboard).
  Bilder/thumbnails ingår inte - DB:n är sanningskällan.
- **Portabel migrering:** `Photo.path` är absolut men `folder`/`filename` är
  portabla. `database._rebase_photo_paths()` (körs i `init_db`) räknar om varje
  sökväg till `PHOTO_DIR/folder/filename` - idempotent, rör bara rader som
  skiljer sig. Gör en medhavd databas direkt körbar när fotomappen monteras på
  annan plats (t.ex. /photos). `/thumb` self-healar saknad thumbnail ur
  originalet. Flytt-steg i `DOCKER.md`.

## Prod vs dev (sedan 2026-06-18)
Det finns nu en **skarp container på Unraid (TERVO2)** med riktig data (släkt-
och jobbfoton). Datan i denna VM (`~/workspace/fotoscan/data/`) är kvar som
**dev/test-data** - de två databaserna är separata och divergerar. Anta aldrig
att dev-ID:n eller dev-innehåll matchar prod.

Tänk på följande vid ändringar:
- **Schema/migreringar körs automatiskt mot prod-DB:n vid uppstart** (`init_db`
  -> `create_all` + ALTER-guards, ingen Alembic). En ny image som prod hämtar
  och startar kör alltså migreringen direkt. Därför: nya kolumner/tabeller MÅSTE
  ha idempotenta ALTER-/`_column_exists`-guards, och alla data-backfills i
  `init_db` (t.ex. placeholder-flaggan, `_rebase_photo_paths`) måste vara säkra
  och idempotenta att köra om på den riktiga datan. Inga destruktiva engångs-
  skript i startvägen.
- **Backa upp prod före riskabla migreringar:** hämta `/api/backup` från prod-
  instansen först, så finns en återställningspunkt.
- **Release-styrning:** push till main bygger `:latest`. För att kontrollera NÄR
  prod uppdateras, överväg att pinna prod mot en `v*`-tagg (semver) i stället
  för `:latest`, och uppdatera medvetet. Testa alltid på dev-VM:en först.
- **Aldrig destruktiva tester mot prod.** Den här VM:en är lekplatsen; prod-
  containern och dess `/data`-volym + read-only `/photos` lämnas i fred.
- Prod-detaljer (host, portar, volymsökvägar) hör hemma i `DOCKER.md`, inte här.

## Konventioner
- **Använd aldrig `alert()` eller `confirm()`** - använd Bootstrap-modaler.
  För bekräftelser finns `showConfirm(message, {okLabel, okClass})` i `utils.js`
  som returnerar en `Promise<boolean>`.
- **Avsluta alltid varje svar med den körande appens fulla adress** så Rasmus
  kan klicka på länken (även från telefonen via Tailscale): `http://ubuntu-ai:8810`
  (dev-servern). Skriv ut hela `http://HOSTNAME:PORT`, aldrig bara porten eller
  localhost.

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
