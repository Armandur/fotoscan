# Fotoscan

Verktyg för att lägga metadata på gamla foton och negativ - fotodatum (även
ungefärligt), personer, taggar, plats och anteckningar. Byggt för att
strukturera släktfotografier samt scannade foton/negativ från jobbet.

## Så funkar det

- Peka `PHOTO_DIR` mot en mapp med bilder och klicka **Scanna mapp**.
- Originalfilerna läses bara - de flyttas, döps om eller skrivs aldrig till.
- All metadata lagras i en SQLite-databas (`DATA_DIR/fotoscan.db`). Det gör
  sökning snabb, allt är ångerbart, och negativ utan EXIF fungerar lika bra.
- Rotation lagras också i databasen och appliceras på thumbnail och visning;
  originalet på disk förblir orört.
- Senare kan metadatan exporteras/bäddas in i filerna (EXIF/XMP) - se `todo.md`.

## Kör lokalt

```bash
cp .env.example .env      # justera PHOTO_DIR vid behov
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8810
```

Öppna sedan `http://ubuntu-ai:8810`.

## Kortkommandon (detaljvy)

| Tangent | Funktion |
|---------|----------|
| `J` / `→` | Nästa foto |
| `K` / `←` | Föregående foto |
| `R` / `Shift+R` | Rotera medurs / moturs |
| `Ctrl+S` | Spara |
| `Ctrl+Enter` | Spara och markera granskad |
| `D` `L` `P` `T` `N` | Hoppa till datum/plats/personer/taggar/anteckningar |
| `G` | Tillbaka till galleri |
| `Esc` | Lämna fält / stäng dialog |
| `?` | Visa hjälp |

## Export

Knappen **Exportera** (i detaljvyn) eller **Exportera granskade** (i galleriet)
kopierar foton till `EXPORT_DIR` och bäddar in metadatan i kopiorna som **XMP**
(personer, taggar, plats, beskrivning, källa, datum) plus `EXIF:DateTimeOriginal`
när ett exakt datum finns. Originalen rörs aldrig. Kräver `exiftool` på servern
(ingår i Docker-imagen; lokalt: `sudo apt install libimage-exiftool-perl`).

## Säkerhetskopiering

Översikt -> **Ladda ner backup** (eller `GET /api/backup`) ger en zip med en
konsekvent ögonblicksbild av databasen. Originalbilder och thumbnails ingår
inte - de regenereras ur fotomappen. Se `DOCKER.md` för hur man flyttar
databasen till en ny miljö.

## Docker (Unraid)

```bash
# Drift (hämtar image från GHCR) - justera fotomappen i docker-compose.yml
docker compose pull && docker compose up -d

# Lokal utveckling (bygger image, --reload)
docker compose -f docker-compose.dev.yml up --build
```

Imagen byggs och publiceras automatiskt till `ghcr.io/armandur/fotoscan` av
GitHub Actions. Fullständiga deploy- och flyttsteg finns i `DOCKER.md`.

## Miljövariabler

| Variabel | Default | Beskrivning |
|----------|---------|-------------|
| `PHOTO_DIR` | `./photos` | Mapp som scannas (läses orörda) |
| `DATA_DIR` | `./data` | Databas + thumbnails |
| `EXPORT_DIR` | `./export` | Exporterade kopior med inbäddad metadata |
| `PORT` | `8810` | Utvecklingsserverns port |
