#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  PyCodeFlow — PostgreSQL Backup Script (Sprint 19i)
#  Dagelijks automatisch uitgevoerd via cron (02:00)
#  Installeer via: bash pycodeflow.sh → optie 16
#
#  Cron entry (automatisch ingesteld):
#  0 2 * * * /volume3/docker/pycodeflow/scripts/backup-db.sh
# ═══════════════════════════════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
BACKUP_DIR="$BASE/backups"
LOG="$BACKUP_DIR/backup.log"
ENV_FILE="$BASE/.env"
BEWAAR_DAGEN=7

# Laad .env variabelen
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) 2>/dev/null
fi

WEBHOOK_URL="${WEBHOOK_URL:-}"
PG_PW="${POSTGRES_PASSWORD:-}"
DATUM=$(date +%Y%m%d-%H%M)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
BESTAND="$BACKUP_DIR/pycodeflow-$DATUM.sql.gz"

mkdir -p "$BACKUP_DIR"

if [[ -z "$PG_PW" ]]; then
  echo "[$TIMESTAMP] ❌ POSTGRES_PASSWORD niet ingesteld in .env" >> "$LOG"
  exit 1
fi

# ── Backup uitvoeren ─────────────────────────────────────────────────────────
docker exec pycodeflow-postgres-1 \
  pg_dump -U pycodeflow pycodeflow 2>/dev/null | gzip > "$BESTAND"

if [[ $? -eq 0 ]] && [[ -s "$BESTAND" ]]; then
  GROOTTE=$(du -sh "$BESTAND" | cut -f1)
  echo "[$TIMESTAMP] ✅ Backup OK — $(basename $BESTAND) ($GROOTTE)" >> "$LOG"
else
  rm -f "$BESTAND"
  echo "[$TIMESTAMP] ❌ Backup MISLUKT" >> "$LOG"
  if [[ -n "$WEBHOOK_URL" ]]; then
    curl -sf --max-time 10 -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d '{"text":"🚨 PyCodeFlow: database backup MISLUKT!"}' > /dev/null 2>&1
  fi
  exit 1
fi

# ── Oude backups verwijderen ─────────────────────────────────────────────────
VOOR_DELETE=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${BEWAAR_DAGEN}" -delete
NA_DELETE=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
VERWIJDERD=$((VOOR_DELETE - NA_DELETE))

if [[ $VERWIJDERD -gt 0 ]]; then
  echo "[$TIMESTAMP] 🗑 $VERWIJDERD oude backup(s) verwijderd (>${BEWAAR_DAGEN} dagen)" >> "$LOG"
fi

# ── Log rotatie: max 500 regels ──────────────────────────────────────────────
if [[ -f "$LOG" ]] && [[ $(wc -l < "$LOG") -gt 500 ]]; then
  tail -200 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi

echo "[$TIMESTAMP] Backups bewaard: $(find $BACKUP_DIR -name '*.sql.gz' | wc -l)" >> "$LOG"
