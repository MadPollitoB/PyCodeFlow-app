#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — PostgreSQL backup (sprint 30d)
# Maakt een gecomprimeerde dump van de database met retentie.
#
# Gebruik:
#   bash backup-db.sh                 → maakt een backup, ruimt oude op
#   Via cron (dagelijks 02:00):       → pycodeflow.sh optie 16 → 2
#
# Retentie: standaard 7 dagen (aanpasbaar via BACKUP_RETENTION_DAYS in .env).
# ═══════════════════════════════════════════════════════════════════════════════
set -u

# Bepaal de projectroot (script staat in scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$BASE/backups"
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') | $1" >> "$LOG"
}

# Lees configuratie uit .env
get_env() { grep -E "^$1=" "$BASE/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

PG_PW="$(get_env POSTGRES_PASSWORD)"
RETENTION_DAYS="$(get_env BACKUP_RETENTION_DAYS)"
[[ -z "$RETENTION_DAYS" ]] && RETENTION_DAYS=7

PG_CONTAINER="pycodeflow-postgres-1"
PG_USER="pycodeflow"
PG_DB="pycodeflow"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
OUTFILE="$BACKUP_DIR/pycodeflow-${TIMESTAMP}.sql.gz"

# ── Backup maken ──────────────────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
  log "FOUT: postgres-container '$PG_CONTAINER' draait niet — backup overgeslagen"
  echo "❌ Postgres-container draait niet — backup overgeslagen" >&2
  exit 1
fi

if docker exec -e PGPASSWORD="$PG_PW" "$PG_CONTAINER" \
     pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges 2>>"$LOG" \
     | gzip > "$OUTFILE"; then
  SIZE="$(du -h "$OUTFILE" 2>/dev/null | cut -f1)"
  # Controleer dat het bestand niet leeg is (mislukte dump geeft ~20 bytes gzip)
  RAWSIZE="$(stat -c%s "$OUTFILE" 2>/dev/null || echo 0)"
  if [[ "$RAWSIZE" -lt 100 ]]; then
    log "FOUT: backup lijkt leeg ($RAWSIZE bytes) — verwijderd"
    rm -f "$OUTFILE"
    echo "❌ Backup mislukt (lege dump)" >&2
    exit 1
  fi
  log "OK: $(basename "$OUTFILE") ($SIZE)"
  echo "✅ Backup gemaakt: $(basename "$OUTFILE") ($SIZE)"
else
  log "FOUT: pg_dump mislukt"
  rm -f "$OUTFILE"
  echo "❌ pg_dump mislukt — zie $LOG" >&2
  exit 1
fi

# ── Oude backups opruimen (retentie) ──────────────────────────────────────────
DELETED="$(find "$BACKUP_DIR" -name "pycodeflow-*.sql.gz" -mtime "+${RETENTION_DAYS}" -print 2>/dev/null)"
if [[ -n "$DELETED" ]]; then
  echo "$DELETED" | while read -r old; do
    rm -f "$old"
    log "Opgeruimd (>${RETENTION_DAYS}d): $(basename "$old")"
  done
fi

COUNT="$(find "$BACKUP_DIR" -name "pycodeflow-*.sql.gz" 2>/dev/null | wc -l)"
log "Totaal backups bewaard: $COUNT (retentie ${RETENTION_DAYS}d)"
exit 0
