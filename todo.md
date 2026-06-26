# Fotoscan - todo

## Planerat

### Personvyn (/persons + /persons/{n})
- [x] **Sök, filtrering & sortering i /persons.** `q` (namn/alias), `filt`
  (all/identified/unknown/has_photos/no_photos/has_family), `sort`
  (name/count/born/died) server-side; sektionspagineringen behållen.
- [x] **Kort- vs listvy i /persons.** Växla kort/lista, sparat i localStorage
  (`personsView`), CSS-toggle på `#persons-wrap`.
- [x] **Mer metadata på personkort + i listvy.** Född–död, antal foton,
  familjelänk-antal, alias visas på kort och i listrad.
- [x] **Släktträd-vy på /persons/{n}.** Familj-sektionen visar nu föräldrar/
  personen+partner/barn som ett litet träd med tumnaglar (`_relations` ger
  `region_id`).

### Karta/GPS
- [ ] **Förvald kartposition från Plats.** När GPS-kartan öppnas i detaljvyn och
  fotot har en Plats med beräknad medelposition (`place_avg_gps`, visas redan i
  detaljvyns `place_gps`), zooma Leaflet direkt dit i stället för default-vyn -
  så slipper man adressök som ett extra moment. Återanvänd den positionen.

### AI-ansiktsigenkänning - vidareutveckling
- [x] **Klustra okända ansikten.** `/faces/clusters` + `/api/faces/ai/clusters`
  grupperar obekräftade AI-ansikten på embedding-likhet (`cluster_embeddings`,
  girig seed-gruppering, justerbar känslighet) så en hel grupp namnges på en gång
  (`/api/faces/ai/cluster-name`). Avmarkera enstaka crops, namnförslag per grupp
  (med tumnagel) via matchning mot kända personer, crops lyder S/M/L + hover-zoom.
- [ ] **Auto-/massbekräfta höga träffar.** "Bekräfta alla förslag över likhet X"
  (t.ex. 0.6), eller per person, för att snabba upp granskningen.
- [x] **Förslag i fotolistan.** `/faces/review`-korten visar namnförslag per foto
  (badges med tumnagel + antal, från lagrade `suggested_tag_id`), och listan kan
  sorteras "efter förslag" så samma person hamnar nära.
- [x] **"Uppdatera förslag"-pass.** `POST /api/faces/ai/refresh-suggestions` räknar
  om `suggested_tag_id` för alla pending mot nuvarande modell utan omdetektering;
  knapp "Uppdatera förslag" i listvyn.
- [x] **"Hitta fler foton med denna person".** `/persons/{id}` har en knapp som
  kör personens centroid mot obekräftade AI-ansikten (`GET /api/persons/{id}/
  find-faces`) och listar kandidater (crops + likhet + öppna-foto-länk) att
  av/på-markera och bekräfta i klump (via `cluster-name`).
- [x] **Auto-välj bästa tumnagel** för person: `_best_region_id` väljer störst
  ansiktsarea med `det_score` (lagras vid AI-detektering) som tiebreaker, om ingen
  manuell tumnagel (`thumb_face_id`) är vald.
- [ ] **Verktyg för att utreda felmatchningar.** Diagnos/debug av igenkänningen:
  varför ett ansikte fick (eller missade) ett förslag - visa likhetspoäng mot
  kandidatpersoner, inspektera en persons referens-embeddings, och hitta avvikare
  inom en person (ett bekräftat ansikte som ligger långt från personens centroid
  = troligen feltaggat) för att kunna rätta. Ger insyn i varför AI:n matchar fel.
- [ ] **Kör AI automatiskt vid scan** (valbart) så kön alltid är aktuell.
- [ ] **GPU på Unraid** för snabbare detektering om volymen växer (2070ti kan
  delas mellan containrar via NVIDIA Container Toolkit; onödigt för nuvarande skala).

- [ ] **Albumexport till mapp + metadatafil.** Exportera ett albums bilder till
  en mapp i albumets ordning (filnamn med löpnummer-prefix så ordningen bevaras),
  plus en mänskligt läsbar metadatafil (.txt och/eller .xlsx) med info per bild
  (ordning, filnamn, datum, plats, personer, taggar, källa, anteckning) som man
  kan läsa bredvid bilderna. Bygger på `AlbumPhoto.position` + `caption_lines`.
- [ ] **PDF-album: full per-sida-kontroll.** I layoutvyn: låt varje enskild A4-sida
  få egen layout (utöver dagens global + per-avsnitt-layout), och ev. live-redigering
  i stället för spara-och-ladda-om. Bygger på WYSIWYG-layoutvyn.
- [ ] **Manuellt klockslagsfält (om behov).** Idag finns inget fält för att
  ange tid på dygnet - skanntiden rensades bort (skräp). Om vi vill kunna sätta
  ett riktigt klockslag på ett foto: eget fält + skriv det till DateTimeOriginal
  vid export i stället för dagens 00:00:00.
- [x] **Ansiktstaggning steg 2 - AI.** InsightFace (buffalo_l, CPU) detekterar
  ansikten + 512-d embeddings; namnförslag via cosine-matchning mot bekräftade
  personers medel-embedding (modellen tränas inte - k-NN/centroid). Bakgrunds-
  batchjobb + granskningskö (`/faces/review`) där förslag bekräftas/avvisas.
  Obekräftade AI-rutor räknas inte i katalogen. `services/faces_ai.py` +
  `routes/faces_ai.py`. (Möjlig vidareutveckling: GPU på Unraid, klustring av
  okända, automatisk omkörning vid scan.)
- [ ] Färgkorrigering vidare: ev. histogram, manuell vitbalans-pipett, auto-
  färgstick (OpenCV/scikit-image om Pillow inte räcker). (Live-preview för alla
  reglage inkl. gamma/per-kanal är klar via server-render-preview.)
- [ ] Sidecar `.xmp` som exportalternativ för format utan inbäddning (t.ex. RAW).
- [ ] **Filen som portabel sanningskälla -> separat visnings-app.** Mål: "har du
  filen har du metadatan", och en färdig samling ska kunna delas med släkten utan
  åtkomst till kurerings-appen. Lösning i två delar (ersätter idén om metadata-
  import tillbaka in i fotoscan):
  1. **Fotoscan: säkerställ komplett metadata-inbäddning vid export.** Verifiera
     att ALLT skrivs till filen vid export (`services/exporter.py`) - personer,
     taggar (platt + hierarkisk), plats, datum, anteckning, källa, GPS,
     ansiktsregioner (MWG-rs). Det mesta finns; kontrollera att inget tappas så
     den exporterade filen verkligen är komplett och självbärande.
  2. **Ny, fristående visnings-app** (eget litet projekt, INTE i fotoscan): pekar
     på en mapp exporterade foton, läser den inbäddade metadatan (XMP/EXIF/MWG-rs
     via exiftool), bygger ett eget index och visar read-only galleri/personer/
     karta/tidslinje. Ingen koppling till fotoscans DB. Tunn, delbar/hostbar för
     släkten. Här bor metadata-LÄSningen - fotoscan förblir rent kurerings-verktyg.
  Konsekvens: ingen round-trip-import behövs i fotoscan; DB-backup förblir
  fotoscans interna portabilitet, export+visnings-app är delningsvägen.
- [x] **Hantera HEIC/HEIF.** `pillow-heif` registreras i `scanner.py` så Pillow
  kan öppna iPhone-foton; `.heic`/`.heif` i SUPPORTED_EXTENSIONS. Scan, EXIF-datum,
  thumbnail, `/image` (renderas till JPEG) och export verifierade.

## Deployment
- [x] **CI/CD.** `.github/workflows/docker-publish.yml` bygger och pushar imagen
  till `ghcr.io/armandur/fotoscan` vid push till main (latest/main/sha), vid
  `v*`-taggar (semver) och manuellt. GHCR-login via `GITHUB_TOKEN`, gha-cache.
- [x] **Backup/databasexport.** `GET /api/backup` (`routes/backup.py`) ger en zip
  med en konsekvent SQLite-ögonblicksbild (`VACUUM INTO`). Knapp i /dashboard.
  Originalbilder/thumbnails ingår inte - de regenereras.
- [x] **Portabel migrering.** Fotosökvägar rebaseras automatiskt mot `PHOTO_DIR`
  vid uppstart (`_rebase_photo_paths`), så en medhavd databas funkar direkt när
  fotomappen monteras på annan plats (t.ex. `/photos`). Thumbnails self-healar
  i `/thumb` ur originalet vid miss. Fullständiga steg i `DOCKER.md`.
- Drift: monolitisk single-container på Unraid (TERVO2), image från GHCR.
  `exiftool` + libpango/cairo ingår i imagen. Persistenta volymer för `DATA_DIR`
  (databas + thumbnails) och read-only-mount för fotomappen. Se `DOCKER.md`.

## Klart
- [x] **Mer metadata på personer.** Tag utökad med född/död (fritext), alias/
  smeknamn (sökbara), anteckningar. Familjelänkar person<->person (`PersonLink`:
  förälder/barn/partner, dubbelriktad visning). Redigeras i personvyn. (Ev.
  XMP-export av persondetaljer = framtida.)
- [x] **Personer i bildtext efter ansiktsposition.** I album-bildtexten sorteras
  personer med ansiktsruta vänster->höger (lägsta x först); de utan ruta sist på
  namn. `_persons_ordered` i `pdf_album`.
- [x] **Album-format + uppslag + tomma sidor.** Sidformat (`Album.page_format`:
  A4 stående/liggande, A5 stående) styr @page + den låsta sidan. Uppslagsvy (två
  sidor sida vid sida) i huvudvy + bläddermeny med recto/verso (titel ensam som
  höger sida via ledande tom plats). Tomma sidor: `AlbumPhoto.blank_before`
  (tomma sidor före ett foto) + `Album.trailing_blanks` (sist) för häfteslayout -
  syns i layoutvyn och PDF:en.
- [x] **Avsnitt per bild + dra-om i layoutvyn.** Avsnitt sätts nu per foto i
  layoutvyn (knapp på varje bild) - ett avsnitt kan börja vid valfri bild och
  bryter då till ny sida vid just den (resten av föregående sida lämnas). Bilderna
  kan dras om direkt i layoutvyn (över sidgränser) -> reorder + omräkning.
- [x] **PDF-album-export.** weasyprint (HTML/CSS -> PDF). Titelsida + global
  layout (1/2/4/6 bilder per A4) + valbara bildtextfält (datum/plats/personer/
  taggar/källa/anteckning/filnamn) + undertitel. **Avsnitt med rubriker**
  (`AlbumPhoto.section_heading`) som börjar på ny sida med **egen layout per
  avsnitt** (`section_layout`); sätts via flagg-knapp i albumvyn. Konfig-modal +
  `GET /albums/{id}/pdf`. `services/pdf_album.py` + `templates/album_pdf.html`.
  Docker-imagen har libpango/cairo. **WYSIWYG-layoutvy** (`/albums/{id}/layout`):
  sidlista + stora A4-sidor, avsnitt/layout/bildtext/undertitel hanteras där och
  persisteras på albumet; fotovyn (`/albums/{id}`) är bara foto-ordning. (Full
  per-sida-layout = framtida steg.)
- [x] **Album (kurerade, ordnade samlingar).** Egen Album-/AlbumPhoto-modell med
  position; foton från flera källor, egen ordning oavsett datum, ett foto kan
  ligga i flera album. /albums + /albums/{id} med dra-och-släpp-ordning, lägg
  till via galleriets åtgärdsmeny. Skild från taggar och seq. `routes/albums.py`.
- [x] **Manuell ordning (dra-och-släpp).** `Photo.seq` är en tiebreaker i datum-
  sorteringen (år -> månad -> seq -> date_text -> filnamn), så foton som skannats
  i oordning och bara har grovt datum (år/år+månad) kan ordnas manuellt. "Ordna"-
  läge i galleriet: dra korten, seq sparas via `POST /api/photos/reorder`.
- [x] **Dubblett-/liknande-detektering.** dHash (ren Pillow) på `Photo.phash`,
  beräknad från thumbnailen vid scan + backfill. /duplicates grupperar liknande
  foton (union-find på Hamming-avstånd, justerbar känslighet). `services/dupes.py`,
  `routes/duplicates.py`. Hittar t.ex. samma bild skannad som både foto och negativ.
- [x] **Kartöversikt.** /map: en Leaflet-markör per plats med representativ GPS
  (snitt av platsens fotons GPS), popup med namn + antal + länk till platsens
  foton. Lagerväxling (Karta/Satellit/Topografisk). `/api/map/points` i places.py,
  `map_overview.js`. (Leaflet kan ej obscura-testas - kräver riktig webbläsare.)
- [x] **Baksides-koppling.** `Photo.back_of_id` -> ett stöd-foto (skanning av
  baksidan) kopplas till framsidan. Döljs i alla listningar (apply_dimensions),
  delar ingen metadata. Detaljvyn visar baksidan (klicka för lightbox/läs) +
  koppla/koppla-loss; den egna sidan visar "baksidan till X". `routes/backside.py`.
- [x] **Att-göra-dashboard.** /dashboard: antal foton, andel granskade, antal som
  saknar datum/plats/personer (med saknar-filter i galleriet), foton per decennium.
- [x] **Granskningsläge / triage.** /review hoppar till första ogranskade
  (`reviewed=no&review=1`); "Spara & granska" går vidare till nästa via /review.
  Banner med antal kvar + Avsluta. Återanvänder detaljvyns formulär/kortkommandon.
- [x] **Fler massåtgärder + meny.** Batch-baren har nu en "Åtgärder"-dropdown:
  markera/avmarkera negativ + granskad, lägg till/ta bort tagg eller person,
  sätt datum, sätt plats - på urval eller hela filtret. Datum/plats/taggar är
  delad metadata och speglas till hopparad partner. (Fixade även namnkrocken
  reviewed/filter i BatchUpdate -> set_negative/set_reviewed.)
- [x] **Lightbox-zoom.** Förstora-lightboxen: zoom med mushjul (mot pekaren),
  panorering genom att dra, dubbelklick växlar zoom, klick på bakgrunden/Esc
  stänger. Översiktskarta nere till höger med gul viewport-rektangel (klickbar
  för att panorera). Allt i `utils.js` + base.html-markup + style.css.
- [x] **Välj tumnagel för en person.** `Tag.thumb_face_id` pekar ut en vald
  ansiktsregion; annars auto (senaste ansiktet). Väljare i personvyn (ansikts-
  strip + Auto), endpoint `POST /api/persons/{id}/thumb`.
- [x] **Bläddringskontext från ursprungsvyn.** Öppnas en bild från person-/tagg-/
  plats-/tidslinjevyn går prev/next genom just den listan (`services/context.py`,
  `?ctx=...&ctx_id=...`), inte hela galleriet. Bakåtknappen leder till
  ursprungsvyn. Filter (granskat/typ/hopparat/separat/sort) bärs med.
- [x] **Par-export.** Exportera en parad bild exporterar båda: huvudbilden under
  sitt namn, negativet som `{huvudbild}-negativ` (egen filändelse). Negativ får
  samma metadata men aldrig ansiktsrutor (kan vara skannat i annan dimension).
- [x] **Hierarkiska taggar.** Taggar (Tag-modellen, kind="tag") bildar ett träd
  via parent_id. Träd-UI i tagg-vyn, cykelskydd vid föräldraval. Detaljvy visar
  foton för tagg + ättlingar. Export skriver lr:HierarchicalSubject (pipe-sep).
- [x] Representativ GPS per plats (snitt av fotonas GPS) - centrerar kart-modalen
  när fotot saknar egen position; visas på platsdetaljen.
- [x] Normalisera plats: egen Place-tabell + Photo.place_id (location som cache),
  platsvy mot tabellen (byt namn/merge/ta bort), 12 platser migrerade. Foto-GPS
  frikopplad.
- [x] Galleri-tangentnavigering mellan sidor (J/K + pilar).
- [x] Hopparning som kombination: delad metadata (speglas vid sparning),
  grupperad gallerivy (primär=fotot) med "visa separat"-toggle, primär-roll i DB.
- [x] Modulär filterrad (Granskat/Typ/Hopparat som kombineras).
- [x] Kartlager-växling i GPS-kartan (OSM / Satellit (Esri) / Topografisk).
- [x] Större par-modal (modal-xl) som visar utgångsfotot bredvid kandidaterna.
- [x] Infinite-scroll i par-modalen (paginerade kandidater, offset/limit).
- [x] Tidslinjevy: foton grupperade per år/månad (med "okänd månad"/"okänt
  datum"-grupper) + år-snabbnavigering.
- [x] Taggar-vy: lista, detalj, skapa, byt namn (merge), ta bort.
- [x] Platser-vy: lista (grupperar plats-fältet) med sök, detalj per plats,
  byt namn på plats (uppdaterar alla foton).
- [x] Mappträdvy med rekursivt läge (visa undermappars foton).
- [x] Urval + massåtgärder i galleriet (markera negativ/granskad, per urval eller
  hela filtret).
- [x] Kartstöd för plats: Leaflet/OSM-karta (självhostad) för fotografens
  position, adress-sök via Nominatim-proxy, osäkerhetsradie, export till EXIF GPS
  + GPSHPositioningError. (Kartinteraktionen ej obscura-testbar.)
- [x] Hopparning negativ<->foto: negativ-flagga, sök kandidater (matchade dolda
  som default + toggle), metadata-merge med diff-vy vid konflikt, koppla isär.
- [x] Personvy: lista, detalj, namnbyte, merge (söklista med thumbnails),
  borttagning, samt "ta bort sista taggning -> radera person".
- [x] Färg-/tonkorrigering: auto-ton + ljusstyrka/kontrast/gamma/mättnad/per-
  kanal (Pillow). Sparas i DB, renderas on-the-fly med live-preview, bakas in
  vid export. Originalet orört.
- [x] Ansiktstaggning steg 1 (manuell): rita ruta -> personsök med ansikts-
  thumbnails, tomt namn -> Okänd-N, regioner följer rotation, export som MWG-rs.
- [x] Export: kopia med inbäddad XMP (personer/taggar/plats/beskrivning/källa/
  datum) + EXIF:DateTimeOriginal, via exiftool. Originalen orörda. Per foto och
  "exportera granskade". Rotation skrivs som EXIF Orientation.
- [x] Visa inbäddat EXIF-datum (DateTimeOriginal) read-only med "Använd"-knapp.
- [x] Docker: Dockerfile (med exiftool) + docker-compose (drift/dev).
- [x] Frontend på Bootstrap 5.3 (CDN, dark) + Bootstrap Icons.
- [x] Grundskelett: FastAPI + SQLite + Jinja2 + vanilla JS.
- [x] Mappscanning med thumbnail-generering och EXIF-datumutläsning.
- [x] Galleri med sök och filter (granskad/ej granskad).
- [x] Detaljvy: redigera datum (fritext + år), plats, personer, taggar,
  källa, anteckningar.
- [x] Rotation (lagras i DB, originalfil orörd).
- [x] Kortkommandon (navigering, fält-hopp, rotation, spara).
- [x] Autocomplete på befintliga personer/taggar.
