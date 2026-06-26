#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  PyCodeFlow — Health Monitor (Sprint 19e)
#  Draait elke 5 minuten via cron op de NAS (buiten Docker)
#  Installeert via: bash pycodeflow.sh → optie 15
#
#  Cron entry (automatisch ingesteld via pycodeflow.sh):
#  */5 * * * * /volume3/docker/pycodeflow/health-monitor.sh >> /volume3/docker/pycodeflow/logs/health-monitor.log 2>&1
# ═══════════════════════════════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
LOG="$BASE/logs/health.log"
ENV_FILE="$BASE/.env"

mkdir -p "$BASE/logs"

# Laad .env variabelen
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) 2>/dev/null
fi

WEBHOOK_URL="${WEBHOOK_URL:-}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# ── Check 1: Web server bereikbaar ──────────────────────────────────────────
if ! curl -sf --max-time 10 http://localhost:3000/health > /dev/null 2>&1; then
  echo "[$TIMESTAMP] ❌ FOUT: PyCodeFlow web server NIET bereikbaar op :3000" >> "$LOG"

  # Probeer te herstarten
  cd "$BASE" && docker compose restart web > /dev/null 2>&1
  sleep 15

  # Check opnieuw na herstart
  if curl -sf --max-time 10 http://localhost:3000/health > /dev/null 2>&1; then
    echo "[$TIMESTAMP] ✅ Hersteld: web server opnieuw opgestart" >> "$LOG"
    MSG="⚠️ PyCodeFlow was tijdelijk niet bereikbaar maar is hersteld."
  else
    echo "[$TIMESTAMP] ❌ KRITIEK: web server start niet op na herstart!" >> "$LOG"
    MSG="🚨 PyCodeFlow is NIET bereikbaar en start niet op! Controleer de server."
  fi

  # Webhook notificatie sturen
  if [[ -n "$WEBHOOK_URL" ]]; then
    curl -sf --max-time 10 -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"$MSG\"}" > /dev/null 2>&1 \
      && echo "[$TIMESTAMP] 📨 Notificatie verstuurd naar webhook" >> "$LOG" \
      || echo "[$TIMESTAMP] ⚠️ Webhook notificatie mislukt" >> "$LOG"
  fi
else
  # Alles OK — log enkel om de 24u om log-spam te vermijden
  HOUR=$(date '+%H')
  MIN=$(date '+%M')
  if [[ "$HOUR" == "06" && "$MIN" -lt "10" ]]; then
    echo "[$TIMESTAMP] ✅ PyCodeFlow actief (dagelijkse check)" >> "$LOG"
  fi
fi

# ── Check 2: PostgreSQL bereikbaar ──────────────────────────────────────────
PG_PW="${POSTGRES_PASSWORD:-}"
if [[ -n "$PG_PW" ]]; then
  if ! docker exec pycodeflow-postgres-1 \
      psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
      -c "SELECT 1" > /dev/null 2>&1; then
    echo "[$TIMESTAMP] ❌ FOUT: PostgreSQL niet bereikbaar!" >> "$LOG"
    if [[ -n "$WEBHOOK_URL" ]]; then
      curl -sf --max-time 10 -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d '{"text":"🚨 PyCodeFlow: PostgreSQL database niet bereikbaar!"}' > /dev/null 2>&1
    fi
  fi
fi

# ── Log rotatie: monitor-log max 1000 regels ────────────────────────────────
if [[ -f "$LOG" ]] && [[ $(wc -l < "$LOG") -gt 1000 ]]; then
  tail -500 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
