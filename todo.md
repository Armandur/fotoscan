# Fotoscan - todo

## Planerat
- [ ] **Para ihop negativ + skannat foto (samma motiv).** Länka två (eller
  flera) foton som representerar samma bild. Designidé: en självrefererande
  länk (photo_links eller group_id). Vid hopparning: slå samman metadatan -
  om båda har värden i samma fält och de skiljer sig, visa en diff-/merge-vy
  där man väljer vilket värde som gäller (eller behåller båda för taggar/
  personer). Ansiktsregioner hör till respektive bild men personlistan kan
  delas. Fundera på vilken bild som är "primär" vid export.
  Förfinat:
    - Flagga/tagg på foto: "skannat negativ" (eget fält, t.ex. is_negative),
      används för att hitta negativ att para ihop.
    - Sökläge för matchning: redan matchade negativ visas INTE som default i
      sökträfflistan, men en toggle kan visa även redan matchade.
- [ ] **Mer metadata på personer.** Idag är en person bara en tagg (namn). I
  framtiden: födelse-/dödsår, relation, alias/smeknamn, anteckningar, ev. länk
  mellan personer (familj). Kräver en egen Person-modell (eller utökad Tag) -
  migrera person-taggar dit. Exportera till XMP där det går (PersonInImage med
  detaljer / MWG).
- [ ] **Ansiktstaggning steg 2 - AI.** Automatisk ansiktsdetektering +
  igenkänning (face_recognition/dlib eller InsightFace) som ger förslag att
  bekräfta. CPU-only på VM:en (ingen GPU) men görbart för <1000 foton som
  batch-jobb. Bygger på steg 1:s `FaceRegion` + "Okänd-N"-platshållare.
- [ ] Färgkorrigering vidare: live-preview för gamma/per-kanal (CSS klarar bara
  ljus/kontrast/mättnad), ev. histogram, vitbalans, auto-färgstick (OpenCV/
  scikit-image om Pillow inte räcker).
- [ ] Sidecar `.xmp` som exportalternativ för format utan inbäddning (t.ex. RAW).
- [ ] GPS-koordinater till EXIF/XMP vid export (när kartstöd finns).
- [ ] CI/CD: GitHub Actions som bygger image till ghcr.io/armandur/fotoscan.
- [ ] Galleri-navigering med tangentbord (pilar/Enter för att öppna).
- [ ] Bulk-redigering: sätt datum/tagg på flera markerade foton.
- [ ] Kartstöd för plats (koordinater).
- [ ] Hantera HEIC ordentligt (kräver pillow-heif).
- [ ] Backup/databasexport.

## Deployment
- Tanken är att deploya på Unraid-servern (TERVO2) som en monolitisk
  single-container Docker-image (image till GHCR). `exiftool`
  (libimage-exiftool-perl) måste installeras i imagen för exportfunktionen.
- Persistenta volymer för `DATA_DIR` (databas + thumbnails) och read-only-mount
  för fotomappen som ska scannas.

## Klart
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
