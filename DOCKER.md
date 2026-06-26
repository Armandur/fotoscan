# Docker & deployment

Fotoscan körs som en monolitisk single-container på Unraid (TERVO2). Imagen
byggs av GitHub Actions och publiceras till GHCR.

## Bygg & publicering (CI/CD)

`.github/workflows/docker-publish.yml` bygger och pushar imagen vid:

- push till `main` -> taggar `latest` + `main` + `sha-<kort>`
- push av en tagg `v*` (t.ex. `v1.2.0`) -> semver-taggar `1.2.0` + `1.2` + `sha-<kort>`
- manuell körning (workflow_dispatch)

Imagen hamnar på `ghcr.io/armandur/fotoscan`. Inga hemligheter behövs -
workflowen loggar in mot GHCR med det inbyggda `GITHUB_TOKEN` (kräver att
repo-paketet är kopplat och att Actions har `packages: write`, vilket
workflowen sätter).

Första gången paketet skapas är det privat. Gör det publikt (eller ge Unraid
en PAT med `read:packages`) så att `docker pull` fungerar på servern. Annars:

```bash
echo <PAT> | docker login ghcr.io -u armandur --password-stdin
```

## Drift på Unraid

`docker-compose.yml` beskriver driften:

```bash
docker compose pull        # hämta senaste image
docker compose up -d
```

Volymer:

| Container-sökväg | Värd (justera) | Beskrivning |
|------------------|----------------|-------------|
| `/data` | `./data` | Databas + thumbnails (persistent) |
| `/export` | `./export` | Exporterade kopior |
| `/photos` (ro) | `/mnt/user/foton` | Fotomappen som scannas, **read-only** |

Porten är `8810`. `exiftool`, libpango/cairo m.m. ingår redan i imagen.

## Flytt hit (migrera databasen)

Databasen är sanningskällan. Bilder och thumbnails behöver **inte** flyttas -
thumbnails regenereras automatiskt ur fotomappen vid behov.

1. **Backup på gamla miljön:** Översikt -> *Ladda ner backup*
   (eller `GET /api/backup`). Du får en zip med `fotoscan.db`.
2. **Lägg databasen på plats:** packa upp och lägg `fotoscan.db` i den mapp som
   monteras som `/data` (t.ex. `./data/fotoscan.db` bredvid compose-filen).
3. **Montera samma fotostruktur under `/photos`.** Sökvägarna lagras relativt
   `PHOTO_DIR`, så bara den relativa mappstrukturen måste stämma. Låg t.ex.
   fotot under `Bilder/Fotopärm/x.jpg` i gamla miljön ska det ligga på
   `/photos/Bilder/Fotopärm/x.jpg` i containern.
4. **Starta containern.** Vid uppstart rebaseras alla fotosökvägar automatiskt
   mot `PHOTO_DIR=/photos` (`_rebase_photo_paths` i `database.py`) - inget
   manuellt fixande av absoluta sökvägar behövs.
5. Bläddra i galleriet. Saknade thumbnails fylls i on-demand första gången de
   visas. Vill du värma cachen direkt: kör en ny scan (idempotent - befintliga
   foton hoppas över på sökväg).

### Om mappstrukturen måste ändras

Rebaseringen utgår från `PHOTO_DIR/folder/filename`. Den hanterar att hela
fotoroten flyttas (annan mount-punkt), men inte att enskilda undermappar döps
om. Behåll samma relativa struktur under `/photos`, så stämmer allt.

## Originalen i Google Drive (rclone-mount)

Fotoscan rör aldrig originalfilerna, så fotomappen kan ligga i molnet via en
**read-only rclone-mount** på Unraid-hosten - originalen bor kvar i Google Drive,
inget byggs in i imagen. Appen ser mounten som en vanlig mapp.

**Princip:**
1. Installera/konfigurera rclone på hosten (Unraid: pluginet "rclone" eller
   binär), skapa ett gdrive-remote (`drive.readonly`-scope räcker, eget OAuth
   client_id rekommenderas för att slippa kvotstrul).
2. Montera read-only med `--allow-other` (+ `user_allow_other` i `/etc/fuse.conf`)
   så containern (annan uid) kan läsa, och `--vfs-cache-mode full` för att cacha
   lästa filer lokalt. Montera till en egen sökväg, t.ex. `/mnt/disks/gdrive`
   (undvik `/mnt/user/...` - shfs + FUSE krånglar).
3. Bind-montera mounten in i containern som `/photos:ro` **med slave-propagation**
   (annars ser containern en tom/stale mapp). Mounten måste finnas innan
   containern startar.

**Prestanda:** thumbnails, renderingar och ansikts-crops cachas i `/data` efter
första bearbetningen, så GDrive läses tungt bara vid första scan/thumbnail-
genereringen; därefter träffar bläddring nästan aldrig nätet. Värm gärna cachen
med en scan direkt efter mount.

Steg-för-steg-guide (efemär, byggs vid behov med
`obscura`/`python -m http.server` i `tmp/`) - be om "rclone-Unraid-guiden".
