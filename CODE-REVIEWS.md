# Kodgranskningar

Nyast först. Varje fynd markeras åtgärdat/avfärdat med commit-ref.

## 2026-06-17 - Genomgång av hela kodbasen (Claude)

Alla filer under 600 rader (photos.py störst, 531). Granskning gjord direkt,
ingen Gemini-delegering. Inga TODO/alert/confirm/console.log i egen kod.

### Åtgärdat
- **Hopparning gav inkonsekvent datum/plats.** `_MERGE_FIELDS` slog samman
  `date_text` och `date_year` var för sig (kunde divergera) och `location` utan
  `place_id` (bröt platsnormaliseringen). Nu slås bara `date_text` samman och
  `date_year/month/precision` härleds ur den; `place_id` normaliseras via
  `get_or_create_place`. Åtgärdat i samma commit som denna fil.
- **Svalda fel utan loggning.** `scanner.scan_directory` och
  `exporter.export_many` räknade `errors` men loggade inget. Lade till
  `logger.exception(...)` i båda. Samma commit.

### Avfärdat / medvetet lämnat
- **Nya scans återinför klockslag i `exif_datetime`.** Export ignorerar den
  inbäddade tiden helt (datum byggs av kurerad `date_text`), så det påverkar bara
  read-only-visningen. Lämnas tills ett ev. manuellt klockslagsfält byggs.
- **SQLite utan `PRAGMA foreign_keys=ON`.** ondelete-reglerna är inte DB-tvingade,
  men hanteras i kod och foton raderas aldrig. Dangling `Tag.thumb_face_id`
  valideras vid läsning. Låg risk - lämnas.
