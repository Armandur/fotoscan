# Fotoscan - todo

## Planerat
- [ ] **Dubblett-/liknande-detektering.** Perceptuell hash (t.ex. pHash) för att
  hitta foton som skannats två gånger eller är nära dubbletter.
- [ ] **Manuellt klockslagsfält (om behov).** Idag finns inget fält för att
  ange tid på dygnet - skanntiden rensades bort (skräp). Om vi vill kunna sätta
  ett riktigt klockslag på ett foto: eget fält + skriv det till DateTimeOriginal
  vid export i stället för dagens 00:00:00.
- [ ] **Mer metadata på personer.** Idag är en person bara en tagg (namn). I
  framtiden: födelse-/dödsår, relation, alias/smeknamn, anteckningar, ev. länk
  mellan personer (familj). Kräver en egen Person-modell (eller utökad Tag) -
  migrera person-taggar dit. Exportera till XMP där det går (PersonInImage med
  detaljer / MWG).
- [ ] **Ansiktstaggning steg 2 - AI.** Automatisk ansiktsdetektering +
  igenkänning (face_recognition/dlib eller InsightFace) som ger förslag att
  bekräfta. CPU-only på VM:en (ingen GPU) men görbart för <1000 foton som
  batch-jobb. Bygger på steg 1:s `FaceRegion` + "Okänd-N"-platshållare.
- [ ] Färgkorrigering vidare: ev. histogram, manuell vitbalans-pipett, auto-
  färgstick (OpenCV/scikit-image om Pillow inte räcker). (Live-preview för alla
  reglage inkl. gamma/per-kanal är klar via server-render-preview.)
- [ ] Sidecar `.xmp` som exportalternativ för format utan inbäddning (t.ex. RAW).
- [ ] CI/CD: GitHub Actions som bygger image till ghcr.io/armandur/fotoscan.
- [ ] Hantera HEIC ordentligt (kräver pillow-heif).
- [ ] Backup/databasexport.

## Deployment
- Tanken är att deploya på Unraid-servern (TERVO2) som en monolitisk
  single-container Docker-image (image till GHCR). `exiftool`
  (libimage-exiftool-perl) måste installeras i imagen för exportfunktionen.
- Persistenta volymer för `DATA_DIR` (databas + thumbnails) och read-only-mount
  för fotomappen som ska scannas.

## Klart
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
