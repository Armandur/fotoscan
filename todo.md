# Fotoscan - todo

## Planerat
- [ ] **Foto-/färgkorrigering.** Två lägen: (a) "Auto" likt IrfanView
  (ett klick), och (b) detaljerad med ljusstyrka, kontrast, gamma samt
  per-kanal-justering (RGB) för färgfoton.
  Bibliotek: **Pillow räcker troligen** (redan beroende) - `ImageEnhance`
  (Brightness/Contrast/Color/Sharpness), `ImageOps.autocontrast`/`equalize`
  för Auto, och `Image.point()` (ev. med numpy) för gamma och per-kanal-kurvor.
  OpenCV/scikit-image bara om vi vill ha mer avancerat (t.ex. histogram-
  utjämning per kanal, vitbalans, automatisk färgstick-korrigering).
  Princip (samma som rotation): spara justeringarna i DB, **rendera on-the-fly**
  i `/image` och `/thumb`, och **skriv först vid export** - originalfilen ändras
  aldrig. Värd att samla bild-transformeringen (rotation + färg) i en gemensam
  pipeline i `scanner.load_oriented`/exportern.
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
