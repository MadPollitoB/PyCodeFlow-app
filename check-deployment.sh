#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — Deployment verificatiescript v2026.2.41.0
# Gebruik: bash check-deployment.sh
# Voer uit vanuit /volume3/docker/pycodeflow/
# Sprint 27a-g: grep-regex fixes (backslash-pipe → pipe of -e flags)
# ═══════════════════════════════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
WEB="$BASE/web"
PUB="$WEB/public"
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
    if [[ "$lines" -lt "$min" ]]; then
      fail "$label — te klein ($lines regels, min $min verwacht)"
    else
      ok "$label ($lines regels)"
    fi
  fi
}

# 27g: check_contains herschreven — gebruikt grep -q -e voor multi-patronen
# Gebruik: check_contains file "patroon" label
# Of voor multi-patroon: check_contains_any file label patroon1 patroon2 ...
check_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    ok "$label"
  else
    fail "$label — niet gevonden in $(basename $file)"
  fi
}

check_contains_any() {
  local file="$1" label="$2"
  shift 2
  local found=0
  for pat in "$@"; do
    if grep -q "$pat" "$file" 2>/dev/null; then
      found=1; break
    fi
  done
  if [[ $found -eq 1 ]]; then ok "$label"; else fail "$label — niet gevonden in $(basename $file)"; fi
}

check_not_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    fail "$label — verboden patroon gevonden"
  else
    ok "$label"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  PyCodeFlow — Deployment Verificatie v2026.2.41.0"
echo "  $(date '+%d/%m/%Y %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════"

# ── 1. Basisstructuur ─────────────────────────────────────────────────────────
header "1. Basisstructuur"
[[ -d "$BASE" ]]       && ok "Hoofdmap pycodeflow"     || fail "Hoofdmap niet gevonden: $BASE"
[[ -d "$WEB" ]]        && ok "Web map"                 || fail "Web map niet gevonden"
[[ -d "$BASE/runner" ]] && ok "Runner map"             || fail "Runner map niet gevonden"
[[ -d "$BASE/logs" ]]  && ok "Logs map"                || { mkdir -p "$BASE/logs"; ok "Logs map aangemaakt"; }
[[ -d "$BASE/pgdata" ]] && ok "pgdata map"             || warn "pgdata/ niet gevonden — wordt aangemaakt bij eerste start"
[[ -d "$PUB/assets" ]] && ok "public/assets map"       || fail "public/assets map niet gevonden"
# Sprint 29: VERSION-bestand voor deploy-automatisering
if [[ -f "$BASE/VERSION" ]]; then
  VER_CONTENT=$(tr -d '[:space:]' < "$BASE/VERSION")
  if [[ "$VER_CONTENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    ok "VERSION-bestand aanwezig ($VER_CONTENT)"
  else
    fail "VERSION-bestand ongeldig formaat: $VER_CONTENT"
  fi
else
  warn "VERSION-bestand niet gevonden — versie valt terug op .env"
fi
[[ -f "$BASE/sync-version.sh" ]] && ok "sync-version.sh aanwezig" || warn "sync-version.sh niet gevonden"

# ── 2. Docker ─────────────────────────────────────────────────────────────────
header "2. Docker"
check_file "$BASE/docker-compose.yml" "docker-compose.yml" 10
check_file "$BASE/.env"               ".env bestand"       5
check_file "$WEB/Dockerfile"          "web/Dockerfile"     5
check_file "$BASE/runner/Dockerfile"  "runner/Dockerfile"  5

check_contains "$BASE/docker-compose.yml" "postgres:"        "docker-compose: postgres service"
check_contains "$BASE/docker-compose.yml" "web:"             "docker-compose: web service"
check_contains "$BASE/docker-compose.yml" "runner:"          "docker-compose: runner service"
check_contains "$BASE/docker-compose.yml" "cloudflared:"     "docker-compose: cloudflared service"
check_contains "$BASE/docker-compose.yml" "pg_isready"       "docker-compose: postgres healthcheck"

# ── 3. .env configuratie ──────────────────────────────────────────────────────
header "3. .env configuratie"
check_contains "$BASE/.env" "POSTGRES_PASSWORD="       ".env: POSTGRES_PASSWORD"
check_contains "$BASE/.env" "CLOUDFLARE_TUNNEL_TOKEN=" ".env: Cloudflare token"
check_contains "$BASE/.env" "RUNNER_URL="              ".env: RUNNER_URL"
check_contains "$BASE/.env" "POC_BASIC_COOKIE_SECRET=" ".env: cookie secret"
check_contains "$BASE/.env" "SCHOOL_NAME="             ".env: schoolnaam"
check_contains "$BASE/.env" "LOG_RETENTION_DAYS="      ".env: log retentie"
check_contains "$BASE/.env" "APP_VERSION_MINOR="       ".env: versienummer aanwezig"

if grep -q "POSTGRES_PASSWORD=KIES_EEN_STERK_WACHTWOORD" "$BASE/.env" 2>/dev/null; then
  fail ".env: POSTGRES_PASSWORD nog op standaardwaarde — wijzig dit!"
fi
if grep -q "CLOUDFLARE_TUNNEL_TOKEN=JOUW" "$BASE/.env" 2>/dev/null; then
  fail ".env: CLOUDFLARE_TUNNEL_TOKEN nog op standaardwaarde"
fi
if grep -q "^DATABASE_URL=" "$BASE/.env" 2>/dev/null; then
  warn ".env: DATABASE_URL aanwezig — niet meer nodig"
fi

# ── 4. Server ─────────────────────────────────────────────────────────────────
header "4. Server (web)"
check_file "$WEB/server.js"    "server.js"    100
check_file "$WEB/package.json" "package.json" 5

check_contains "$WEB/package.json" '"pg"'        "package.json: pg"
check_contains "$WEB/package.json" '"pdfkit"'    "package.json: pdfkit"
check_contains "$WEB/package.json" '"express"'   "package.json: express"
check_contains "$WEB/package.json" '"socket.io"' "package.json: socket.io"
check_contains "$WEB/package.json" '"dotenv"'    "package.json: dotenv"

check_contains "$WEB/server.js" "POSTGRES_PASSWORD"       "server.js: PostgreSQL configuratie"
check_contains "$WEB/server.js" "loadActiveSessions"      "server.js: sessie herstel"
check_contains "$WEB/server.js" "429"                     "server.js: rate limiting"
check_contains "$WEB/server.js" "requireTeacherAuth"      "server.js: auth middleware"
check_contains "$WEB/server.js" "/health"                 "server.js: health endpoint"
check_contains "$WEB/server.js" "cleanOldLogs"            "server.js: log rotatie"
check_contains "$WEB/server.js" "quiz_bank"               "server.js: quiz module"
check_contains "$WEB/server.js" "Content-Security-Policy" "server.js: CSP headers"
check_contains "$WEB/server.js" "worker-src"              "server.js: CSP worker-src"
check_contains "$WEB/server.js" "cdnjs.cloudflare.com"   "server.js: CSP marked.js/DOMPurify CDN"
check_contains "$PUB/quiz-student.html" "DOMPurify" "quiz-student.html: DOMPurify XSS-beveiliging (sprint 28c)"
check_contains "$PUB/quiz-review.html"  "DOMPurify" "quiz-review.html: DOMPurify XSS-beveiliging (sprint 28c)"
check_contains "$WEB/server.js" "unarchive"               "server.js: vraag herstellen"
check_contains "$WEB/server.js" "api/admin/db/tables"     "server.js: DB viewer endpoint"
check_contains "$WEB/server.js" "DB_VIEWER_TABLES"        "server.js: DB viewer whitelist"
check_contains "$WEB/server.js" "DB_VIEWER_MASKED"        "server.js: DB viewer maskering"
check_contains "$WEB/server.js" "selectedChoices"         "server.js: keuze-antwoorden"
check_contains "$WEB/server.js" "monaco-env.js"           "server.js: Monaco endpoint"
check_contains "$WEB/server.js" "requireCsrf"             "server.js: CSRF middleware"
check_contains "$WEB/server.js" "X-Frame-Options"         "server.js: clickjacking bescherming"
# 27m: bootstrap admin check
check_contains "$WEB/server.js" "bootstrap"               "server.js: bootstrap admin bij lege DB (sprint 27m)"
check_contains "$WEB/server.js" "loadVersionFromFile"    "server.js: VERSION-bestand support (sprint 29)"
# Hotfix v2026.2.41.1: loadVersionFromFile draait vóór de logger bestaat en mag
# dus GEEN log.* gebruiken (anders TDZ-crash bij opstart). Guard hierop.
if awk '/^function loadVersionFromFile/,/^}/' "$WEB/server.js" | grep -q "log\.\(info\|warn\|error\|debug\)"; then
  fail "server.js: loadVersionFromFile gebruikt log.* vóór logger-init (TDZ-crash!)"
else
  ok "server.js: loadVersionFromFile gebruikt geen log.* vóór init (hotfix 41.1)"
fi
# 27l: query export in database.js
check_contains "$WEB/db/database.js" "module.exports" "database.js: module.exports aanwezig"

# ── 5. Database module ────────────────────────────────────────────────────────
header "5. Database module"
check_file "$WEB/db/database.js" "db/database.js" 50
check_contains "$WEB/db/database.js" "quiz_bank"             "database.js: quiz_bank"
check_contains "$WEB/db/database.js" "quiz_answers"          "database.js: quiz_answers"
check_contains "$WEB/db/database.js" "quiz_meta"             "database.js: quiz_meta"
check_contains "$WEB/db/database.js" "teachers"              "database.js: teachers"
check_contains "$WEB/db/database.js" "persistSession"        "database.js: persistSession"
check_contains "$WEB/db/database.js" "loadActiveSessions"    "database.js: loadActiveSessions"
check_contains "$WEB/db/database.js" "POSTGRES_PASSWORD"     "database.js: auto connectionString"
check_contains "$WEB/db/database.js" "unarchiveQuizQuestion" "database.js: vraag herstellen"
check_contains "$WEB/db/database.js" "archived"              "database.js: archived kolom"
check_contains "$WEB/db/database.js" "choices_json"          "database.js: keuze-opties"
check_contains "$WEB/db/database.js" "selected_choices"      "database.js: antwoorden keuze"

# ── 6. Scripts ────────────────────────────────────────────────────────────────
header "6. Scripts"
check_file "$WEB/scripts/manage-teacher.js" "manage-teacher.js" 50
# 27e fix: aparte grep-calls i.p.v. \|
check_contains_any "$WEB/scripts/manage-teacher.js" \
  "manage-teacher.js: PostgreSQL verbinding" \
  "POSTGRES_PASSWORD" "DATABASE_URL"

# Legacy scripts mogen niet meer bestaan
[[ ! -f "$WEB/scripts/migrate-env-to-db.js" ]]   && ok "migrate-env-to-db.js verwijderd" \
  || warn "migrate-env-to-db.js aanwezig — verwijder via optie 18 pycodeflow.sh"
[[ ! -f "$WEB/scripts/migrate-sqlite-to-pg.js" ]] && ok "migrate-sqlite-to-pg.js verwijderd" \
  || warn "migrate-sqlite-to-pg.js aanwezig — verwijder via optie 18 pycodeflow.sh"
[[ ! -f "$WEB/scripts/hash-password.js" ]]        && ok "hash-password.js verwijderd" \
  || warn "hash-password.js aanwezig — verwijder via optie 18 pycodeflow.sh"
[[ ! -f "$WEB/run_wrapper.py" ]]                   && ok "run_wrapper.py verwijderd" \
  || warn "run_wrapper.py aanwezig — verwijder via optie 18 pycodeflow.sh"

# ── 7. Public bestanden ───────────────────────────────────────────────────────
header "7. Public bestanden"
for f in index.html teacher-login.html teacher-sessions.html teacher-app.html \
          student-start.html student-app.html free-editor.html \
          monitoring.html admin.html app.js styles.css; do
  check_file "$PUB/$f" "$f" 10
done

header "7b. Quiz module"
for f in quiz-bank.html quiz-teacher.html quiz-student.html quiz-review.html quiz-archive.html; do
  check_file "$PUB/$f" "$f" 50
done

header "7c. Assets & config"
check_file "$WEB/templates.json" "templates.json (in web/)" 5
[[ -f "$PUB/assets/logo.svg" ]]    && ok "assets/logo.svg"    || fail "assets/logo.svg niet gevonden"
[[ -f "$PUB/assets/favicon.png" ]] && ok "assets/favicon.png" || fail "assets/favicon.png niet gevonden"
info "monaco-env.js: dynamisch via /monaco-env.js endpoint (geen statisch bestand)"

# ── 8. app.js integriteitscontroles (sprint 26 rootcause-check) ───────────────
header "8. app.js integriteitscontroles"
for fn in pyAlert pyToast pyConfirm toggleShortcutsOverlay \
          copyToClipboard getEditorValue setEditorValue loadSessions \
          deleteSession toggleSessionBlock renderSessions renderStudentList \
          setTab enableInput disableInput emitConfigChange; do
  check_contains "$PUB/app.js" "window\.$fn" "app.js: window.$fn"
done

# student-start.html in socketPages (sprint 26.1)
check_contains "$PUB/app.js" "student-start" "app.js: student-start.html in socketPages"
# Sprint 30-cfg: Toepassen-knop config functies
check_contains "$PUB/app.js" "applyConfigChanges" "app.js: applyConfigChanges (sprint 30-cfg)"
check_contains "$PUB/app.js" "markConfigDirty" "app.js: markConfigDirty (sprint 30-cfg)"
check_contains "$WEB/server.js" "teacher_apply_session_config" "server.js: apply-config handler (sprint 30-cfg)"
# Sprint 29c: geen lege catch-blokken meer
if grep -qE "catch \{\}" "$PUB/app.js"; then
  fail "app.js: lege catch{} blokken aanwezig (sprint 29c)"
else
  ok "app.js: geen lege catch-blokken (sprint 29c)"
fi
# Sprint 29a: teacher-grid JSON-parse fallback
check_contains "$PUB/teacher-grid.html" "readStoredSessionCode" "teacher-grid.html: sessiecode JSON-parse fix (sprint 29a)"
# Sprint 29p2: editor-config live update + vragenbank exports vóór init
check_contains "$PUB/app.js" "29p2" "app.js: editor-config live update (sprint 29p2-a)"
check_contains "$PUB/quiz-teacher.html" "opt-card" "quiz-teacher.html: opt-card layout (sprint 29p2-c)"
check_contains "$PUB/app.js" "applyConfigChanges" "app.js: config Toepassen-knop (sprint 30-cfg)"
check_contains "$WEB/server.js" "teacher_apply_session_config" "server.js: apply-config handler (sprint 30-cfg)"
check_contains "$PUB/app.js" "copyContextual" "app.js: contextuele kopieerknop (sprint 30-copy)"

# 27j: editor thema toggle verwijderd
if grep -q "toggleEditorTheme\b" "$PUB/teacher-app.html" 2>/dev/null; then
  warn "teacher-app.html: editor theme toggle nog aanwezig (sprint 27j)"
else
  ok "teacher-app.html: editor theme toggle verwijderd (sprint 27j)"
fi

# ── 9. Beveiliging ────────────────────────────────────────────────────────────
header "9. Beveiliging"
check_contains "$WEB/server.js" "Content-Security-Policy" "CSP header"
check_contains "$WEB/server.js" "X-Frame-Options.*DENY"   "Clickjacking (X-Frame-Options: DENY)"
check_contains "$WEB/server.js" "nosniff"                 "MIME sniffing bescherming"
check_contains "$WEB/server.js" "SameSite=Strict"         "Cookie SameSite=Strict"
check_contains "$WEB/server.js" "HttpOnly"                "Cookie HttpOnly"
check_contains "$WEB/server.js" "requireCsrf"             "CSRF middleware"
check_contains "$WEB/server.js" "X-CSRF-Token"            "CSRF token header"
check_not_contains "$WEB/server.js" "'unsafe-eval'"       "CSP: unsafe-eval afwezig"
check_contains "$WEB/server.js" "429"                     "Rate limiting"
check_contains "$WEB/server.js" "SESSION_MAX_AGE_SECONDS" "server.js: sessie Max-Age op cookie (sprint 30a)"
check_contains "$WEB/server.js" "upgrade-insecure-requests" "server.js: CSP upgrade-insecure-requests (sprint 30c)"
check_contains "$WEB/server.js" "Content-Security-Policy-Report-Only" "server.js: Report-Only CSP (sprint 30b-A)"
check_contains "$WEB/db/database.js" "tags TEXT NOT NULL" "database.js: quiz_bank tags kolom (sprint 33d)"
check_contains "$WEB/server.js" "export/csv" "server.js: CSV scores-export (sprint 33a)"
check_contains "$PUB/quiz-review.js" "renderProgressChart" "quiz-review.js: voortgangsgrafiek (sprint 33b)"
[[ -f "$WEB/lib/review-token.js" ]] && ok "lib/review-token.js aanwezig (sprint 37d)" || fail "review-token.js ONTBREEKT (sprint 37d)"
check_contains "$WEB/db/database.js" "review_mode" "database.js: review_mode kolom (sprint 37d)"
check_contains "$WEB/server.js" "requireReviewToken" "server.js: nakijk-token guard (sprint 37d)"
check_contains "$WEB/server.js" "review-login" "server.js: leerling nakijk-login (sprint 37d)"
[[ -f "$WEB/lib/review-result.js" ]] && ok "lib/review-result.js aanwezig (sprint 37a)" || fail "review-result.js ONTBREEKT (sprint 37a)"
check_contains "$WEB/db/database.js" "getMyResult" "database.js: getMyResult LEFT JOIN (sprint 37a)"
check_contains "$WEB/server.js" "onthulJuisteAntwoorden: true" "server.js: juiste antwoorden onthuld in nakijk (sprint 37b)"
check_contains "$WEB/db/database.js" "getQuizBankByIds" "database.js: bankvragen ophalen voor snapshot (sprint 37b)"
check_contains "$WEB/server.js" "question/:questionId/model" "server.js: modelcode-endpoint (sprint 37b)"
check_contains "$WEB/public/quiz-bank.html" "q-model" "quiz-bank: modelantwoord-veld (sprint 37b)"
check_contains "$WEB/db/database.js" "a.teacher_comment" "database.js: commentaar in my-result (sprint 37c)"
check_contains "$WEB/lib/review-result.js" "algemeenCommentaar" "review-result: algemeen commentaar (sprint 37c)"
check_contains "$WEB/db/database.js" "duplicateQuizQuestion" "database.js: vraag dupliceren (sprint 38)"
check_contains "$WEB/server.js" "bank/:id/duplicate" "server.js: dupliceer-endpoint (sprint 38)"
check_contains "$WEB/public/quiz-bank.js" "q-btn-duplicate" "quiz-bank: dupliceer-knop (sprint 38)"
check_contains "$WEB/db/database.js" "class_memberships" "database.js: class_memberships tabel (sprint 40)"
check_contains "$WEB/db/database.js" "addStudentToClass" "database.js: membership-koppeling (sprint 40)"
check_contains "$WEB/db/database.js" "getSchoolYears" "database.js: schooljaren-functie (sprint 41)"
check_contains "$WEB/db/database.js" "isClassArchived" "database.js: read-only check (sprint 41)"
check_contains "$WEB/server.js" "school-years" "server.js: schooljaren-endpoint (sprint 41)"
check_contains "$WEB/server.js" "gearchiveerd schooljaar" "server.js: read-only afdwinging (sprint 41)"
check_contains "$WEB/public/admin.js" "loadSchoolYears" "admin.js: schooljaar-selector (sprint 41)"
if grep -q "s.class_id" "$WEB/db/database.js"; then
  fail "database.js: oude students.class_id nog in gebruik (sprint 40 incompleet)"
else
  ok "database.js: geen students.class_id meer (sprint 40)"
fi
if grep -q "my-result/:studentId" "$WEB/server.js"; then
  fail "server.js: studentId in URL bij my-result (moet uit token komen!)"
else
  ok "server.js: geen studentId in nakijk-URL (sprint 37d)"
fi
if grep -rq "<script>" "$PUB"/*.html; then
  fail "Er zijn nog inline <script> blokken (sprint 30b-A verwacht 0)"
else
  ok "Geen inline <script> blokken meer (sprint 30b-A)"
fi
[[ -f "$BASE/scripts/backup-db.sh" ]] && ok "scripts/backup-db.sh aanwezig (sprint 30d)" || fail "backup-db.sh ONTBREEKT (sprint 30d)"
check_contains "$WEB/db/database.js" "withTransaction" "database.js: transactie-helper (sprint 36a)"
check_contains "$PUB/app.js" "_lsKey" "app.js: localStorage prefix-helper (sprint 31b)"
check_contains "$PUB/app.js" "migrateLegacyKeys" "app.js: localStorage migratie (sprint 31b)"
[[ -f "$WEB/lib/logger.js" ]] && ok "lib/logger.js aanwezig (sprint 32b)" || fail "logger.js ONTBREEKT (sprint 32b)"
check_contains "$WEB/server.js" "createLogger" "server.js: logger geïntegreerd (sprint 32b)"
for pjs in monitoring quiz-bank quiz-student quiz-review quiz-teacher quiz-archive admin teacher-grid; do
  [[ -f "$PUB/$pjs.js" ]] && ok "$pjs.js geëxtraheerd (sprint 32a)" || fail "$pjs.js ONTBREEKT (sprint 32a)"
done
if grep -qE "[^y]alert\(|[^y]confirm\(" "$PUB/app.js" | grep -v "pyAlert\|pyConfirm\|window\."; then
  warn "app.js: nog browser alert()/confirm() (sprint 31c)"
else
  ok "app.js: geen browser alert/confirm (sprint 31c)"
fi
if grep -qE "\{ hash, salt \} = createPasswordHash" "$WEB/server.js"; then
  fail "server.js: oude hash-destructuring (hash-mismatch bug!)"
else
  ok "server.js: hash-formaat consistent (sprint 36)"
fi
if grep -qE "\"\^" "$WEB/package.json"; then
  warn "package.json: nog ^caret versies (sprint 36d: pin exact)"
else
  ok "package.json: dependencies gepind (sprint 36d)"
fi

# 27b fix: aparte grep-calls i.p.v. safeEqual\|timingSafeEqual
check_contains_any "$WEB/server.js" "Timing-safe vergelijking" \
  "safeEqual" "timingSafeEqual"

# 27c fix: aparte grep-calls voor runner rlimits
check_contains_any "$BASE/runner/app.py" "Runner: sandbox rlimits" \
  "RLIMIT" "rlimit"

# 27d fix: aparte grep-calls voor runner process
check_contains_any "$BASE/runner/app.py" "Runner: process beheersing" \
  "subprocess" "SIGKILL"

# ── 10. Runner ────────────────────────────────────────────────────────────────
header "10. Runner"
check_file "$BASE/runner/app.py" "runner/app.py" 50
check_contains "$BASE/runner/app.py" "RLIMIT_NOFILE" "runner: bestandslimiet"
check_contains "$BASE/runner/app.py" "RLIMIT_NPROC"  "runner: proceslimiet"
check_contains "$BASE/runner/app.py" "RLIMIT_FSIZE"  "runner: bestandsgrootte limiet"
check_contains "$BASE/runner/app.py" "_safe_import"  "runner: verboden module-import"
check_contains "$BASE/runner/app.py" "SIGKILL"       "runner: forceer-stop bij timeout"

# ── 11. Docker containers ─────────────────────────────────────────────────────
header "11. Docker containers"
web_st=$(docker inspect --format='{{.State.Status}}' pycodeflow-web-1       2>/dev/null || echo "niet gevonden")
run_st=$(docker inspect --format='{{.State.Status}}' pycodeflow-runner-1    2>/dev/null || echo "niet gevonden")
pg_st=$(docker inspect  --format='{{.State.Status}}' pycodeflow-postgres-1  2>/dev/null || echo "niet gevonden")
cf_st=$(docker inspect  --format='{{.State.Status}}' pycodeflow-cloudflared-1 2>/dev/null || echo "niet gevonden")

[[ "$web_st" == "running" ]] && ok "web container: actief"         || fail "web container: $web_st"
[[ "$run_st" == "running" ]] && ok "runner container: actief"      || fail "runner container: $run_st"
[[ "$pg_st"  == "running" ]] && ok "postgres container: actief"    || fail "postgres container: $pg_st"
[[ "$cf_st"  == "running" ]] && ok "cloudflared container: actief" || warn "cloudflared container: $cf_st"

if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  ok "Web server bereikbaar op :3000"
  VERSION=$(curl -sf http://localhost:3000/api/version 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','?'))" 2>/dev/null || echo "?")
  info "Actieve versie: v$VERSION"
else
  fail "Web server NIET bereikbaar op :3000"
fi

if curl -sf http://localhost:3000/monaco-env.js | grep -q "MonacoEnvironment" 2>/dev/null; then
  ok "Monaco ESM worker endpoint bereikbaar"
else
  warn "Monaco ESM worker endpoint niet bereikbaar"
fi

PG_PW=$(grep "^POSTGRES_PASSWORD=" "$BASE/.env" 2>/dev/null | cut -d= -f2-)
if docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -c "SELECT 1" > /dev/null 2>&1; then
  ok "PostgreSQL bereikbaar"

  TABLE_COUNT=$(docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
  TABLE_COUNT=$(echo "$TABLE_COUNT" | tr -d '[:space:]')
  [[ "$TABLE_COUNT" -ge 15 ]] && ok "PostgreSQL: $TABLE_COUNT tabellen (verwacht ≥15)" \
    || warn "PostgreSQL: $TABLE_COUNT tabellen — schema mogelijk niet volledig"

  for tbl in teachers classes students sessions quiz_bank quiz_meta quiz_answers audit_log; do
    EXISTS=$(docker exec pycodeflow-postgres-1 \
      psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
      -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='$tbl' AND table_schema='public');" \
      2>/dev/null | tr -d '[:space:]' || echo "f")
    [[ "$EXISTS" == "t" ]] && ok "Tabel $tbl" || fail "Tabel $tbl ONTBREEKT"
  done

  ARCHIVED_COL=$(docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='quiz_bank' AND column_name='archived');" \
    2>/dev/null | tr -d '[:space:]' || echo "f")
  [[ "$ARCHIVED_COL" == "t" ]] && ok "quiz_bank.archived kolom aanwezig" \
    || fail "quiz_bank.archived kolom ONTBREEKT"

  TEACHER_COUNT=$(docker exec pycodeflow-postgres-1 \
    psql "postgresql://pycodeflow:${PG_PW}@localhost/pycodeflow" \
    -tAc "SELECT COUNT(*) FROM teachers;" 2>/dev/null | tr -d '[:space:]' || echo "0")
  if [[ "$TEACHER_COUNT" -gt 0 ]]; then
    ok "Leerkrachten in database: $TEACHER_COUNT"
  else
    # 27f: duidelijkere melding — normaal bij verse installatie
    warn "Geen leerkrachten in database"
    info "  → Verse installatie: gebruik pycodeflow.sh optie 19b of 10 om een admin aan te maken"
    info "  → Of start de server — bij lege DB wordt auto-bootstrap geprobeerd (sprint 27m)"
  fi
else
  fail "PostgreSQL NIET bereikbaar"
fi

# 27a fix: ERRORS berekening zonder || echo 0 probleem
ERRORS=0
if docker logs pycodeflow-web-1 --tail=30 2>/dev/null | \
   grep -qE "FATAL|MODULE_NOT_FOUND|Cannot find module|SyntaxError|ReferenceError"; then
  ERRORS=1
fi
if [[ "$ERRORS" -eq 0 ]]; then
  ok "Geen kritieke fouten in recente web logs"
else
  fail "Kritieke fouten in web logs — check: docker compose logs web --tail=30"
fi

# ── 12. Log rotatie ───────────────────────────────────────────────────────────
header "12. Log rotatie"
check_contains "$WEB/server.js" "cleanOldLogs"     "server.js: log cleanup"
check_contains "$BASE/.env"     "LOG_RETENTION_DAYS" ".env: LOG_RETENTION_DAYS"
LOG_COUNT=$(find "$BASE/logs" -name "*.log" 2>/dev/null | wc -l)
STALE_COUNT=$(find "$BASE/logs" -name "*.log" -mtime +7 2>/dev/null | wc -l)
info "Logbestanden: $LOG_COUNT totaal, $STALE_COUNT ouder dan 7 dagen"
[[ "$STALE_COUNT" -gt 10 ]] && warn "Veel stale logs ($STALE_COUNT) — optie 18 pycodeflow.sh"

# ── 13. Beheertool & documentatie ─────────────────────────────────────────────
header "13. Beheertool & documentatie"
check_file "$BASE/pycodeflow.sh"         "pycodeflow.sh"          50
check_contains "$BASE/pycodeflow.sh" "actie_opschonen"  "pycodeflow.sh: optie 18 opschonen"
check_contains "$BASE/pycodeflow.sh" "actie_db_beheer"  "pycodeflow.sh: optie 19 DB-beheer (sprint 27n)"
check_file "$BASE/check-deployment.sh"   "check-deployment.sh"   50
check_file "$BASE/install.md"            "install.md"             5
check_file "$BASE/changelog.md"          "changelog.md"           10
check_file "$BASE/sprintlog.md"          "sprintlog.md"           10
check_file "$BASE/technical-readme.md"   "technical-readme.md"    10
check_file "$BASE/test-readme.md"        "test-readme.md"         10
check_file "$BASE/security-testplan.md"  "security-testplan.md"   10
[[ -f "$BASE/Opschonen-Lokaal.ps1" ]] && ok "Opschonen-Lokaal.ps1 aanwezig" \
  || warn "Opschonen-Lokaal.ps1 niet gevonden"

# ── 14. Testbasis (sprint 34) ─────────────────────────────────────────────────
header "14. Testbasis (sprint 34)"
[[ -f "$WEB/lib/auth.js" ]]       && ok "lib/auth.js aanwezig"       || fail "lib/auth.js ONTBREEKT"
[[ -f "$WEB/lib/scoring.js" ]]    && ok "lib/scoring.js aanwezig"    || fail "lib/scoring.js ONTBREEKT"
[[ -f "$WEB/lib/validation.js" ]] && ok "lib/validation.js aanwezig" || fail "lib/validation.js ONTBREEKT"
[[ -f "$WEB/tests/auth.test.js" ]]       && ok "tests/auth.test.js aanwezig"       || fail "auth tests ONTBREKEN"
[[ -f "$WEB/tests/scoring.test.js" ]]    && ok "tests/scoring.test.js aanwezig"    || fail "scoring tests ONTBREKEN"
[[ -f "$WEB/tests/validation.test.js" ]] && ok "tests/validation.test.js aanwezig" || fail "validation tests ONTBREKEN"
[[ -f "$BASE/runner/test_sandbox.py" ]]  && ok "runner sandbox-tests aanwezig"     || fail "sandbox tests ONTBREKEN"
[[ -f "$BASE/run-tests.sh" ]]            && ok "run-tests.sh (CI) aanwezig"        || fail "run-tests.sh ONTBREEKT"
[[ -f "$BASE/.github/workflows/ci.yml" ]] && ok "GitHub Actions CI-workflow aanwezig" || warn "CI-workflow niet gevonden (optioneel)"
check_contains "$WEB/package.json" '"test"' "package.json: test-script"
# Draai de unit tests als node beschikbaar is
if command -v node >/dev/null 2>&1 && [[ -d "$WEB/tests" ]]; then
  if (cd "$WEB" && node --test 2>&1 | grep -q "# fail 0"); then
    ok "Unit tests slagen ($(cd "$WEB" && node --test 2>&1 | grep -oE "# pass [0-9]+" | grep -oE "[0-9]+") tests)"
  else
    fail "Unit tests FALEN — draai: cd web && node --test"
  fi
fi

# ── Samenvatting ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Samenvatting"
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ Geslaagd       : $PASS${RESET}"
echo -e "  ${YELLOW}⚠️  Waarschuwingen : $WARN${RESET}"
echo -e "  ${RED}❌ Gefaald        : $FAIL${RESET}"
echo ""
if [[ $FAIL -eq 0 && $WARN -eq 0 ]]; then
  echo -e "  ${GREEN}🎉 Alles in orde — PyCodeFlow is klaar voor gebruik!${RESET}"
elif [[ $FAIL -eq 0 ]]; then
  echo -e "  ${YELLOW}✅ Geen kritieke fouten — PyCodeFlow werkt.${RESET}"
  echo -e "  ${YELLOW}   Bekijk de waarschuwingen hierboven.${RESET}"
else
  echo -e "  ${RED}🚨 $FAIL probleem/problemen gevonden.${RESET}"
  echo -e "  ${RED}   Veelvoorkomende oorzaken:${RESET}"
  echo -e "  ${RED}   • .env niet correct ingevuld${RESET}"
  echo -e "  ${RED}   • Docker containers niet actief → pycodeflow.sh optie 2${RESET}"
  echo -e "  ${RED}   • Bestanden niet gedeployed${RESET}"
fi
echo ""
