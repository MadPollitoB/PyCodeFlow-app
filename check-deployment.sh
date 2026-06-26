#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — Deployment verificatiescript v2026.2.14
# Gebruik: bash check-deployment.sh
# Voer uit vanuit /volume3/docker/pycodeflow/
# ═══════════════════════════════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
WEB="$BASE/web"
PASS=0; FAIL=0; WARN=0

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"
BLUE="\033[0;34m"; BOLD="\033[1m"; RESET="\033[0m"

ok()     { echo -e "  ${GREEN}✅ $1${RESET}"; PASS=$((PASS+1)); }
fail()   { echo -e "  ${RED}❌ $1${RESET}"; FAIL=$((FAIL+1)); }
warn()   { echo -e "  ${YELLOW}⚠️  $1${RESET}"; WARN=$((WARN+1)); }
info()   { echo -e "  ${BLUE}ℹ️  $1${RESET}"; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

check_file() {
  local path="$1" label="$2" min="${3:-1}"
  if [[ ! -f "$path" ]]; then
    fail "$label — bestand niet gevonden: $path"
  else
    local lines; lines=$(wc -l < "$path")
    if [[ $lines -lt $min ]]; then
      fail "$label — te klein ($lines regels)"
    else
      ok "$label ($lines regels)"
    fi
  fi
}

check_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    ok "$label"
  else
    fail "$label — patroon niet gevonden: $pattern"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  PyCodeFlow — Deployment Verificatie"
echo "  $(date '+%d/%m/%Y %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════"

# ── 1. Basisstructuur ─────────────────────────────────────────────────────────
header "1. Basisstructuur"
[[ -d "$BASE" ]]          && ok "Hoofdmap pycodeflow"       || fail "Hoofdmap pycodeflow niet gevonden: $BASE"
[[ -d "$WEB" ]]           && ok "Web map"                   || fail "Web map niet gevonden"
[[ -d "$BASE/runner" ]]   && ok "Runner map"                || fail "Runner map niet gevonden"
[[ -d "$BASE/logs" ]]     && ok "Logs map"                  || { mkdir -p "$BASE/logs"; ok "Logs map aangemaakt"; }
[[ -d "$BASE/pgdata" ]]   && ok "pgdata map (PostgreSQL)"   || warn "pgdata/ niet gevonden — wordt aangemaakt bij eerste start"

# ── 2. Docker ─────────────────────────────────────────────────────────────────
header "2. Docker"
check_file "$BASE/docker-compose.yml"      "docker-compose.yml"       10
check_file "$BASE/.env"                    ".env bestand"             5
check_file "$WEB/Dockerfile"               "web/Dockerfile"           5
check_file "$BASE/runner/Dockerfile"       "runner/Dockerfile"        5

# Controleer services in docker-compose.yml
check_contains "$BASE/docker-compose.yml" "postgres:"      "docker-compose: postgres service aanwezig"
check_contains "$BASE/docker-compose.yml" "web:"           "docker-compose: web service aanwezig"
check_contains "$BASE/docker-compose.yml" "runner:"        "docker-compose: runner service aanwezig"
check_contains "$BASE/docker-compose.yml" "cloudflared:"   "docker-compose: cloudflared service aanwezig"
check_contains "$BASE/docker-compose.yml" "./logs:/app/logs" "docker-compose: logs volume aanwezig"
check_contains "$BASE/docker-compose.yml" "pg_isready"     "docker-compose: postgres healthcheck aanwezig"

# ── 3. .env configuratie ──────────────────────────────────────────────────────
header "3. .env configuratie"
check_contains "$BASE/.env" "POSTGRES_PASSWORD="           ".env: POSTGRES_PASSWORD aanwezig"
check_contains "$BASE/.env" "CLOUDFLARE_TUNNEL_TOKEN="     ".env: Cloudflare token aanwezig"
check_contains "$BASE/.env" "RUNNER_URL="                  ".env: RUNNER_URL aanwezig"
check_contains "$BASE/.env" "POC_BASIC_COOKIE_SECRET="     ".env: cookie secret aanwezig"
check_contains "$BASE/.env" "SCHOOL_NAME="                 ".env: schoolnaam aanwezig"
check_contains "$BASE/.env" "LOG_RETENTION_DAYS="          ".env: log retentie aanwezig"

# Check of wachtwoord niet meer de standaard is
if grep -q "POSTGRES_PASSWORD=KIES_EEN_STERK_WACHTWOORD" "$BASE/.env" 2>/dev/null; then
  fail ".env: POSTGRES_PASSWORD nog op standaardwaarde — wijzig dit!"
fi

# DATABASE_URL mag er niet meer in (wordt automatisch opgebouwd)
if grep -q "^DATABASE_URL=" "$BASE/.env" 2>/dev/null; then
  warn ".env: DATABASE_URL aanwezig — niet meer nodig, wordt automatisch opgebouwd"
fi

# ── 4. Server (web) ───────────────────────────────────────────────────────────
header "4. Server (web)"
check_file "$WEB/server.js"                "server.js"                100
check_file "$WEB/package.json"             "package.json"             5

# package.json: correcte dependencies
check_contains "$WEB/package.json" "\"pg\""         "package.json: pg dependency"
check_contains "$WEB/package.json" "\"pdfkit\""     "package.json: pdfkit dependency"
check_contains "$WEB/package.json" "\"express\""    "package.json: express dependency"
check_contains "$WEB/package.json" "\"socket.io\""  "package.json: socket.io dependency"
check_contains "$WEB/package.json" "\"dotenv\""     "package.json: dotenv dependency"

# server.js: kernfunctionaliteit
check_contains "$WEB/server.js" "POSTGRES_PASSWORD"          "server.js: PostgreSQL configuratie"
check_contains "$WEB/server.js" "loadActiveSessions"         "server.js: sessie herstel bij opstarten"
check_contains "$WEB/server.js" "rate.*limit\|rateLimit"     "server.js: rate limiting"
check_contains "$WEB/server.js" "requireTeacherAuth"         "server.js: authenticatie middleware"
check_contains "$WEB/server.js" "/health"                    "server.js: health check endpoint"
check_contains "$WEB/server.js" "monitoring"                 "server.js: monitoring endpoint"
check_contains "$WEB/server.js" "cleanOldLogs"               "server.js: log rotatie (sprint 17a)"
check_contains "$WEB/server.js" "quiz_bank"                  "server.js: quiz module (sprint 16)"
check_contains "$WEB/server.js" "Content-Security-Policy"    "server.js: CSP headers"
check_contains "$WEB/server.js" "worker-src"                 "server.js: CSP worker-src (Monaco)"

# ── 5. Database module ────────────────────────────────────────────────────────
header "5. Database module"
check_file "$WEB/db/database.js"           "db/database.js"           50

check_contains "$WEB/db/database.js" "quiz_bank"              "database.js: quiz_bank tabel"
check_contains "$WEB/db/database.js" "quiz_answers"           "database.js: quiz_answers tabel"
check_contains "$WEB/db/database.js" "quiz_meta"              "database.js: quiz_meta tabel"
check_contains "$WEB/db/database.js" "teachers"               "database.js: teachers tabel"
check_contains "$WEB/db/database.js" "sessions"               "database.js: sessions tabel"
check_contains "$WEB/db/database.js" "persistSession"         "database.js: persistSession functie"
check_contains "$WEB/db/database.js" "loadActiveSessions"     "database.js: loadActiveSessions functie"
check_contains "$WEB/db/database.js" "POSTGRES_PASSWORD"      "database.js: auto connectionString"

# ── 6. Scripts ────────────────────────────────────────────────────────────────
header "6. Scripts"
check_file "$WEB/scripts/manage-teacher.js" "scripts/manage-teacher.js" 50
check_contains "$WEB/scripts/manage-teacher.js" "POSTGRES_PASSWORD\|DATABASE_URL" \
  "manage-teacher.js: PostgreSQL verbinding"

# ── 7. Public bestanden ───────────────────────────────────────────────────────
header "7. Public bestanden"
for f in index.html teacher-login.html teacher-sessions.html teacher-app.html \
          student-start.html student-app.html free-editor.html \
          monitoring.html admin.html app.js styles.css templates.json; do
  check_file "$WEB/public/$f" "$f" 10
done

# Quiz module bestanden
for f in quiz-bank.html quiz-teacher.html quiz-student.html quiz-review.html quiz-archive.html; do
  check_file "$WEB/public/$f" "$f" 50
done

# Monaco ESM configuratie
check_file "$WEB/public/monaco-env.js" "monaco-env.js" 3 2>/dev/null || \
  info "monaco-env.js wordt dynamisch gegenereerd via /monaco-env.js endpoint"

# ── 8. Runner ─────────────────────────────────────────────────────────────────
header "8. Runner"
check_file "$BASE/runner/app.py"           "runner/app.py"            50
check_contains "$BASE/runner/app.py" "rlimit\|RLIMIT"  "runner/app.py: sandbox rlimits"
check_contains "$BASE/runner/app.py" "BLOCKED_MODULES\|blocked"  "runner/app.py: module beveiliging"

# ── 9. Docker containers ──────────────────────────────────────────────────────
header "9. Docker containers"

web_status=$(docker inspect --format='{{.State.Status}}' pycodeflow-web-1 2>/dev/null || echo "niet gevonden")
runner_status=$(docker inspect --format='{{.State.Status}}' pycodeflow-runner-1 2>/dev/null || echo "niet gevonden")
postgres_status=$(docker inspect --format='{{.State.Status}}' pycodeflow-postgres-1 2>/dev/null || echo "niet gevonden")
cloudflared_status=$(docker inspect --format='{{.State.Status}}' pycodeflow-cloudflared-1 2>/dev/null || echo "niet gevonden")

[[ "$web_status" == "running" ]]         && ok "web container: actief"         || fail "web container: $web_status"
[[ "$runner_status" == "running" ]]      && ok "runner container: actief"      || fail "runner container: $runner_status"
[[ "$postgres_status" == "running" ]]    && ok "postgres container: actief"    || fail "postgres container: $postgres_status"
[[ "$cloudflared_status" == "running" ]] && ok "cloudflared container: actief" || warn "cloudflared container: $cloudflared_status"

# Health check
if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  ok "Web server bereikbaar op :3000"
else
  fail "Web server NIET bereikbaar op :3000"
fi

# PostgreSQL bereikbaar
PG_PW=$(grep "^POSTGRES_PASSWORD=" "$BASE/.env" 2>/dev/null | cut -d= -f2-)
if docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -c "SELECT 1" > /dev/null 2>&1; then
  ok "PostgreSQL bereikbaar en wachtwoord correct"

  # Check tabellen
  TABLE_COUNT=$(docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
  [[ "$TABLE_COUNT" -ge 10 ]] && ok "PostgreSQL: $TABLE_COUNT tabellen aanwezig" \
    || warn "PostgreSQL: slechts $TABLE_COUNT tabellen — schema mogelijk niet volledig"

  # Check leerkrachten
  TEACHER_COUNT=$(docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -tAc "SELECT COUNT(*) FROM teachers;" 2>/dev/null || echo "0")
  [[ "$TEACHER_COUNT" -gt 0 ]] && ok "Leerkrachten in database: $TEACHER_COUNT" \
    || warn "Geen leerkrachten in database — voeg toe via optie 10 in pycodeflow.sh"
else
  fail "PostgreSQL NIET bereikbaar — wachtwoord incorrect of container niet actief"
fi

# Geen kritieke fouten in web logs
ERRORS=$(docker logs pycodeflow-web-1 --tail=20 2>/dev/null | \
  grep -iE "FATALE|MODULE_NOT_FOUND|Cannot find module" | wc -l)
[[ "$ERRORS" -eq 0 ]] && ok "Geen kritieke fouten in recente web logs" \
  || fail "Web logs bevatten $ERRORS kritieke fout(en) — controleer: docker compose logs web --tail=30"

# ── 10. Log rotatie ───────────────────────────────────────────────────────────
header "10. Log rotatie (Sprint 17a)"
check_contains "$WEB/server.js" "cleanOldLogs"  "server.js: log cleanup functie aanwezig"
check_contains "$BASE/.env"     "LOG_RETENTION_DAYS" ".env: LOG_RETENTION_DAYS geconfigureerd"

LOG_COUNT=$(find "$BASE/logs" -name "*.log" 2>/dev/null | wc -l)
info "Logbestanden aanwezig: $LOG_COUNT"

# ── Samenvatting ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Samenvatting"
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ Geslaagd : $PASS${RESET}"
echo -e "  ${YELLOW}⚠️  Waarschuwingen: $WARN${RESET}"
echo -e "  ${RED}❌ Gefaald  : $FAIL${RESET}"
echo ""

if [[ $FAIL -eq 0 && $WARN -eq 0 ]]; then
  echo -e "  ${GREEN}🎉 Alles in orde — PyCodeFlow is klaar voor gebruik!${RESET}"
elif [[ $FAIL -eq 0 ]]; then
  echo -e "  ${YELLOW}✅ Geen kritieke fouten — PyCodeFlow werkt.${RESET}"
  echo -e "  ${YELLOW}   Bekijk de waarschuwingen hierboven.${RESET}"
else
  echo -e "  ${RED}🚨 $FAIL probleem/problemen gevonden — herstel voor gebruik.${RESET}"
fi
echo ""
