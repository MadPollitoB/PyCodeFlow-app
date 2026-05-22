#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — Deployment verificatiescript
# Gebruik: bash check-deployment.sh
# Voer uit vanuit /volume3/docker/pycodeflow/
# ═══════════════════════════════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
WEB="$BASE/web"
PASS=0
FAIL=0
WARN=0

# Kleuren
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
BOLD="\033[1m"
RESET="\033[0m"

ok()   { echo -e "  ${GREEN}✅ $1${RESET}"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}❌ $1${RESET}"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠️  $1${RESET}"; WARN=$((WARN+1)); }
info() { echo -e "  ${BLUE}ℹ️  $1${RESET}"; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

# ── Bestanden ─────────────────────────────────────────────────────────────────
check_file() {
  local path="$1"
  local desc="$2"
  local min_lines="${3:-0}"
  if [ ! -f "$path" ]; then
    fail "$desc — NIET GEVONDEN: $path"
    return
  fi
  local lines
  lines=$(wc -l < "$path")
  if [ "$min_lines" -gt 0 ] && [ "$lines" -lt "$min_lines" ]; then
    warn "$desc — bestand lijkt leeg of onvolledig ($lines regels, verwacht ≥ $min_lines)"
    return
  fi
  ok "$desc ($lines regels)"
}

check_dir() {
  local path="$1"
  local desc="$2"
  if [ ! -d "$path" ]; then
    fail "$desc — MAP NIET GEVONDEN: $path"
  else
    ok "$desc"
  fi
}

check_writable() {
  local path="$1"
  local desc="$2"
  if [ ! -d "$path" ]; then
    fail "$desc — MAP NIET GEVONDEN: $path"
  elif [ ! -w "$path" ]; then
    fail "$desc — GEEN SCHRIJFRECHTEN op $path"
  else
    ok "$desc (schrijfbaar)"
  fi
}

# ── Inhoud checks ─────────────────────────────────────────────────────────────
check_contains() {
  local path="$1"
  local pattern="$2"
  local desc="$3"
  if [ ! -f "$path" ]; then
    fail "$desc — bestand niet gevonden"
    return
  fi
  if grep -q "$pattern" "$path"; then
    ok "$desc"
  else
    fail "$desc — patroon niet gevonden: $pattern"
  fi
}

check_not_contains() {
  local path="$1"
  local pattern="$2"
  local desc="$3"
  if [ ! -f "$path" ]; then
    return
  fi
  if grep -q "$pattern" "$path"; then
    warn "$desc — bevat nog: $pattern"
  else
    ok "$desc"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo "  PyCodeFlow — Deployment Verificatie"
echo "  $(date '+%d/%m/%Y %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════"
echo -e "${RESET}"

# ── 1. Basisstructuur ─────────────────────────────────────────────────────────
header "1. Basisstructuur"
check_dir  "$BASE"                  "Hoofdmap pycodeflow"
check_dir  "$WEB"                   "Web map"
check_dir  "$BASE/runner"           "Runner map"
check_dir  "$BASE/logs"             "Logs map (stresstest)"
check_writable "$BASE/data"         "Data map (SQLite)"

# ── 2. Docker bestanden ───────────────────────────────────────────────────────
header "2. Docker"
check_file "$BASE/docker-compose.yml"       "docker-compose.yml"          10
check_file "$BASE/docker-compose.prod.yml"  "docker-compose.prod.yml"      5
check_file "$BASE/.env"                     ".env bestand"                 3
check_file "$BASE/web/Dockerfile"           "web/Dockerfile"               5
check_file "$BASE/runner/Dockerfile"        "runner/Dockerfile"            5

# docker-compose volume checks
check_contains "$BASE/docker-compose.yml" "./logs:/app/logs"  "docker-compose: logs volume aanwezig"
check_contains "$BASE/docker-compose.yml" "./data:/app/data"  "docker-compose: data volume aanwezig"

# ── 3. Server bestanden ───────────────────────────────────────────────────────
header "3. Server (web)"
check_file "$WEB/server.js"          "server.js"                          500
check_file "$WEB/package.json"       "package.json"

# Kritieke inhoud server.js
check_contains "$WEB/server.js" "better-sqlite3\|dbModule"      "server.js: SQLite integratie aanwezig"
check_contains "$WEB/server.js" "schedulePersist"               "server.js: sessie-persistentie aanwezig"
check_contains "$WEB/server.js" "runRateLimit"                  "server.js: rate limiting aanwezig"
check_contains "$WEB/server.js" "teacher-login.html"            "server.js: custom login route aanwezig"
check_contains "$WEB/server.js" "api/teacher-logout"            "server.js: logout endpoint aanwezig"
check_contains "$WEB/server.js" "api/monitoring"                "server.js: monitoring endpoint aanwezig"
check_contains "$WEB/server.js" "stress-test"                   "server.js: stresstest endpoints aanwezig"
check_contains "$WEB/server.js" "free_run_request"              "server.js: vrije editor aanwezig"
check_contains "$WEB/server.js" "loadActiveSessions\|loadPersistedSessions" "server.js: sessie herstel bij opstarten"

# package.json
check_contains "$WEB/package.json" "better-sqlite3"             "package.json: better-sqlite3 dependency"
check_contains "$WEB/package.json" "socket.io"                  "package.json: socket.io dependency"
check_contains "$WEB/package.json" "express"                    "package.json: express dependency"

# ── 4. Database module ────────────────────────────────────────────────────────
header "4. Database module"
check_file "$WEB/db/database.js"     "db/database.js"                     50
check_contains "$WEB/db/database.js" "CREATE TABLE IF NOT EXISTS teachers" "database.js: teachers tabel"
check_contains "$WEB/db/database.js" "CREATE TABLE IF NOT EXISTS sessions" "database.js: sessions tabel"
check_contains "$WEB/db/database.js" "persistSession"                      "database.js: persistSession functie"
check_contains "$WEB/db/database.js" "loadActiveSessions"                  "database.js: loadActiveSessions functie"

# ── 5. Scripts ────────────────────────────────────────────────────────────────
header "5. Scripts"
check_file "$WEB/scripts/hash-password.js"      "scripts/hash-password.js"       5
check_file "$WEB/scripts/manage-teacher.js"     "scripts/manage-teacher.js"      30
check_file "$WEB/scripts/migrate-env-to-db.js"  "scripts/migrate-env-to-db.js"   20

# ── 6. Public bestanden ───────────────────────────────────────────────────────
header "6. Public bestanden"
PUBLIC="$WEB/public"
check_file "$PUBLIC/index.html"           "index.html"
check_file "$PUBLIC/student-start.html"   "student-start.html"
check_file "$PUBLIC/student-app.html"     "student-app.html"
check_file "$PUBLIC/free-editor.html"     "free-editor.html"
check_file "$PUBLIC/teacher-login.html"   "teacher-login.html"
check_file "$PUBLIC/teacher-sessions.html" "teacher-sessions.html"
check_file "$PUBLIC/teacher-app.html"     "teacher-app.html"
check_file "$PUBLIC/monitoring.html"      "monitoring.html"
check_file "$PUBLIC/app.js"               "app.js"                         500
check_file "$PUBLIC/styles.css"           "styles.css"                     50

# app.js inhoud
# ── Sprint 1-4 features ─────────────────────────────────────────────────────
check_contains "$PUBLIC/app.js" "free-editor"             "app.js: vrije editor handler"
check_contains "$PUBLIC/app.js" "run_rate_limited"        "app.js: rate limit feedback"
check_contains "$PUBLIC/app.js" "freeStudentName"         "app.js: vrije sessie localStorage"
check_contains "$PUBLIC/app.js" "isExamMode"              "app.js: examenmodus logica"

# ── Sprint 3 features ────────────────────────────────────────────────────────
check_contains "$PUBLIC/app.js" "student_tab_hidden"      "app.js: tab-detectie examenmodus"
check_contains "$PUBLIC/app.js" "visibilitychange"        "app.js: tab visibility event"
check_contains "$PUBLIC/app.js" "Ctrl.*Enter\|ctrlKey"    "app.js: Ctrl+Enter shortcut"

# ── Sprint 4 features ────────────────────────────────────────────────────────
check_contains "$PUBLIC/app.js" "student_raise_hand"      "app.js: hand opsteken"
check_contains "$PUBLIC/app.js" "setHandUI"               "app.js: hand UI toggle"
check_contains "$PUBLIC/app.js" "teacher_start_timer"     "app.js: countdown timer"
check_contains "$PUBLIC/app.js" "scheduleSyntaxCheck"     "app.js: syntax check"
check_contains "$PUBLIC/app.js" "renderStudentList"       "app.js: herbruikbare studentenlijst"
check_contains "$PUBLIC/app.js" "sessions_updated"        "app.js: auto-refresh sessies"

# ── Sprint 5 features ────────────────────────────────────────────────────────
check_contains "$PUBLIC/app.js" "announcement-chip"       "app.js: aankondigingen chip-grid"
check_contains "$PUBLIC/app.js" "student_mark_done"       "app.js: klaar-knop"
check_contains "$PUBLIC/app.js" "teacher_send_snippet"    "app.js: snippet broadcast"
check_contains "$PUBLIC/app.js" "student-autosave"        "app.js: autosave indicator"

# ── Sprint 8 features ────────────────────────────────────────────────────────
check_contains "$WEB/db/database.js" "code_snapshots"        "database.js: code_snapshots tabel"
check_contains "$WEB/db/database.js" "saveSnapshot"          "database.js: saveSnapshot functie"
check_contains "$WEB/db/database.js" "getSnapshots"          "database.js: getSnapshots functie"
check_contains "$WEB/server.js" "maybeSnapshot"              "server.js: snapshot debounce helper"
check_contains "$WEB/server.js" "api/sessions.*history"      "server.js: history endpoint"
check_contains "$WEB/server.js" "teacher_join_as_observer"   "server.js: observer rol handler"
check_contains "$WEB/server.js" "testRunnerApiIntegration"   "server.js: runner API integratietest"
check_contains "$WEB/server.js" "runner-api"                 "server.js: runner-api in validTypes"
check_contains "$PUBLIC/app.js" "showHistoryPlayback"        "app.js: code history playback functie"
check_contains "$PUBLIC/app.js" "data-show-history"          "app.js: history knop in studentenlijst"
check_contains "$PUBLIC/app.js" "data-observe-session"       "app.js: observer sessie knop"
check_contains "$PUBLIC/app.js" "Herstel annotaties bij reconnect" "app.js: annotaties bij reconnect"

# ── Sprint 7 features ────────────────────────────────────────────────────────
check_file "$WEB/templates.json"                          "templates.json aanwezig"
check_contains "$WEB/server.js" "api/templates"           "server.js: templates endpoint"
check_contains "$WEB/server.js" "templateCode"            "server.js: template bij sessie aanmaak"
check_contains "$WEB/public/styles.css" "data-theme"      "styles.css: dark mode variabelen"
check_contains "$PUBLIC/app.js" "dark-mode-toggle"        "app.js: dark mode toggle"
check_contains "$PUBLIC/app.js" "pycodeflow_theme"        "app.js: dark mode localStorage"
check_contains "$PUBLIC/app.js" "run_error"               "app.js: run_error handler"
check_contains "$PUBLIC/app.js" "teacher_send_annotation" "app.js: annotatie versturen"
check_contains "$PUBLIC/app.js" "annotation_added"        "app.js: annotatie ontvangen"
check_contains "$PUBLIC/app.js" "loadTemplates"           "app.js: templates laden"
check_contains "$WEB/server.js" "teacher_send_annotation" "server.js: annotatie handler"
check_contains "$WEB/server.js" "teacher_clear_annotations" "server.js: annotaties wissen"

# ── Sprint 6 features ────────────────────────────────────────────────────────
check_contains "$WEB/server.js" "checkIpRateLimit"        "server.js: IP rate limiting vrije editor"
check_contains "$WEB/server.js" "GET.*\/health"           "server.js: health check endpoint"
check_contains "$WEB/server.js" "requireCsrf"             "server.js: CSRF bescherming"
check_contains "$BASE/runner/app.py" "preexec_fn\|_set_rlimits\|RLIMIT" "runner/app.py: rlimit sandboxing aanwezig"
check_contains "$WEB/server.js" "logFreeRun"              "server.js: auditlog vrije sessie"
check_contains "$WEB/server.js" "nextRevision"            "server.js: revisie race condition fix"
check_contains "$WEB/server.js" "testWebSocketLoad"       "server.js: WebSocket belastingstest"
check_contains "$WEB/server.js" "testHttpBenchmark"       "server.js: HTTP benchmark test"
check_contains "$WEB/server.js" "testRateLimitVerification" "server.js: rate limit verificatie test"
check_contains "$WEB/package.json" "socket.io-client"    "package.json: socket.io-client dependency"

# ── monitoring.html checks ───────────────────────────────────────────────────
check_contains "$PUBLIC/monitoring.html" "stress-type"         "monitoring.html: stresstest dropdown"
check_contains "$PUBLIC/monitoring.html" "EventSource"         "monitoring.html: SSE client"
check_contains "$PUBLIC/monitoring.html" "autocheck-badge"     "monitoring.html: autocheck badge"
check_contains "$PUBLIC/monitoring.html" "ramp-up"             "monitoring.html: ramp-up test optie"
check_contains "$PUBLIC/monitoring.html" "websocket"           "monitoring.html: WebSocket test optie"
check_contains "$PUBLIC/monitoring.html" "rate-limit"          "monitoring.html: rate limit test optie"
check_contains "$PUBLIC/monitoring.html" "renderHistoryChart"  "monitoring.html: historiek grafiek"
check_contains "$PUBLIC/monitoring.html" "setMaxSafeParams"    "monitoring.html: max veilig knop"

# ── 7. .env checks ───────────────────────────────────────────────────────────
header "7. .env configuratie"
ENV="$BASE/.env"
if [ -f "$ENV" ]; then
  check_contains "$ENV" "POC_BASIC_COOKIE_SECRET"  ".env: cookie secret aanwezig"
  check_contains "$ENV" "CLOUDFLARE_TUNNEL_TOKEN"  ".env: Cloudflare tunnel token aanwezig"

  # Waarschuw als credentials nog in .env staan (zijn ze nu optioneel na migratie)
  if grep -q "^POC_BASIC_USER=" "$ENV" || grep -q "^POC_BASIC_PASS_HASH=" "$ENV"; then
    warn ".env: POC_BASIC_USER/PASS_HASH nog aanwezig — kunnen verwijderd worden na DB-migratie"
  else
    ok ".env: credentials gemigreerd naar database (niet meer in .env)"
  fi
fi

# ── 8. SQLite database ────────────────────────────────────────────────────────
header "8. SQLite database"
DB_FILE="$BASE/data/pycodeflow.db"
if [ -f "$DB_FILE" ]; then
  DB_SIZE=$(du -k "$DB_FILE" | cut -f1)
  ok "pycodeflow.db aanwezig (${DB_SIZE} KB)"

  # Check of sqlite3 CLI beschikbaar is voor inhoud verificatie
  if command -v sqlite3 &>/dev/null; then
    TEACHER_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM teachers;" 2>/dev/null || echo "?")
    SESSION_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM sessions WHERE deleted=0 AND closed=0;" 2>/dev/null || echo "?")
    if [ "$TEACHER_COUNT" = "?" ]; then
      warn "sqlite3 CLI beschikbaar maar kon database niet lezen"
    elif [ "$TEACHER_COUNT" -eq 0 ]; then
      fail "Geen leerkrachtenaccounts in database — voer migrate-env-to-db.js uit"
    else
      ok "Leerkrachtenaccounts: $TEACHER_COUNT"
      info "Actieve sessies in database: $SESSION_COUNT"
    fi
  else
    info "sqlite3 CLI niet beschikbaar — kan database-inhoud niet verifiëren"
    info "Voer 'docker compose exec web node scripts/manage-teacher.js list' uit om te verifiëren"
  fi
else
  warn "pycodeflow.db nog niet aanwezig — wordt aangemaakt bij eerste serverstart"
fi

# ── 9. Docker container status ────────────────────────────────────────────────
header "9. Docker containers"
if command -v docker &>/dev/null; then
  cd "$BASE" 2>/dev/null

  WEB_STATUS=$(docker compose ps web --format "{{.Status}}" 2>/dev/null | head -1)
  RUNNER_STATUS=$(docker compose ps runner --format "{{.Status}}" 2>/dev/null | head -1)

  if echo "$WEB_STATUS" | grep -qi "running\|up"; then
    ok "web container: $WEB_STATUS"
  elif [ -z "$WEB_STATUS" ]; then
    warn "web container: niet gestart (of docker compose niet beschikbaar)"
  else
    fail "web container: $WEB_STATUS"
  fi

  if echo "$RUNNER_STATUS" | grep -qi "running\|up"; then
    ok "runner container: $RUNNER_STATUS"
  elif [ -z "$RUNNER_STATUS" ]; then
    warn "runner container: niet gestart"
  else
    fail "runner container: $RUNNER_STATUS"
  fi

  # Controleer op recente errors in logs
  ERRORS=$(docker compose logs web --tail=20 2>/dev/null | grep -i "syntaxerror\|cannot find module\|reference.*error\|exit 1" | wc -l)
  if [ "$ERRORS" -gt 0 ]; then
    fail "web logs bevatten $ERRORS recente fout(en) — controleer met: docker compose logs web --tail=30"
  else
    ok "Geen kritieke fouten in recente web logs"
  fi
else
  warn "Docker niet beschikbaar via CLI — sla container check over"
fi

# ── Samenvatting ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Samenvatting${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}✅ Geslaagd : $PASS${RESET}"
echo -e "  ${YELLOW}⚠️  Waarschuwingen: $WARN${RESET}"
echo -e "  ${RED}❌ Gefaald  : $FAIL${RESET}"
echo ""

if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}🎉 Alles in orde — deployment is correct.${RESET}"
elif [ "$FAIL" -eq 0 ]; then
  echo -e "  ${YELLOW}${BOLD}⚡ Deployment OK maar bekijk de waarschuwingen.${RESET}"
else
  echo -e "  ${RED}${BOLD}🚨 $FAIL probleem/problemen gevonden — herstel voor gebruik.${RESET}"
fi

echo ""
