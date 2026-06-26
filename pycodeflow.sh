#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  PyCodeFlow — Beheertool
#  Gebruik: bash pycodeflow.sh
#  Bevat: eerste-start setup, PostgreSQL, npm packages, SQLite migratie,
#         versie instellen, start/stop/rebuild, logs, verificatie
# ═══════════════════════════════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
ENV_FILE="$BASE/.env"
COMPOSE_FILE="-f $BASE/docker-compose.yml"
COMPOSE_PROD="-f $BASE/docker-compose.prod.yml"
COMPOSE="docker compose $COMPOSE_FILE"
# Gebruik prod-file enkel als die bestaat
[[ -f "$BASE/docker-compose.prod.yml" ]] && COMPOSE="docker compose $COMPOSE_FILE $COMPOSE_PROD"

# ── Kleuren ──────────────────────────────────────────────────────────────────
BLAUW='\033[1;34m'; GROEN='\033[1;32m'; GEEL='\033[1;33m'
ROOD='\033[1;31m';  RESET='\033[0m';    BOLD='\033[1m'; DIM='\033[2m'

# ── Basis helpers ─────────────────────────────────────────────────────────────
header() {
  clear
  echo -e "${BLAUW}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${BLAUW}║   🐍  PyCodeFlow — Beheertool                ║${RESET}"
  echo -e "${BLAUW}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
}

ok()   { echo -e "  ${GROEN}✓${RESET} $*"; }
warn() { echo -e "  ${GEEL}⚠${RESET} $*"; }
err()  { echo -e "  ${ROOD}✗${RESET} $*"; }
info() { echo -e "  ${DIM}→${RESET} $*"; }
stap() { echo -e "\n  ${BOLD}── $* ──${RESET}"; }
pauze(){ read -rp "  Druk Enter om terug te gaan..." _; }

get_env() { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'; }

set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

versie_display() {
  local j m n b
  j=$(get_env APP_VERSION_YEAR); m=$(get_env APP_VERSION_MAJOR)
  n=$(get_env APP_VERSION_MINOR); b=$(get_env APP_VERSION_BUILD)
  [[ -z "$j" ]] && get_env APP_VERSION || echo "${j}.${m}.${n}.${b}"
}

container_status() {
  docker inspect --format='{{.State.Status}}' "$1" 2>/dev/null || echo "niet gevonden"
}

kleur_status() {
  case "$1" in
    running)      echo -e "${GROEN}● actief${RESET}" ;;
    exited)       echo -e "${ROOD}● gestopt${RESET}" ;;
    "niet gevonden") echo -e "${DIM}● niet aanwezig${RESET}" ;;
    *)            echo -e "${GEEL}● $1${RESET}" ;;
  esac
}

toon_status() {
  local web runner pg
  web=$(container_status pycodeflow-web-1)
  runner=$(container_status pycodeflow-runner-1)
  pg=$(container_status pycodeflow-postgres-1)
  echo -e "  ${BOLD}web:${RESET}      $(kleur_status "$web")"
  echo -e "  ${BOLD}runner:${RESET}   $(kleur_status "$runner")"
  echo -e "  ${BOLD}postgres:${RESET} $(kleur_status "$pg")"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  EERSTE-START SETUP
# ═══════════════════════════════════════════════════════════════════════════════

is_eerste_start() {
  # Eerste start als .env ontbreekt of POSTGRES_PASSWORD niet ingesteld is
  # DATABASE_URL wordt automatisch opgebouwd — niet meer in .env
  [[ ! -f "$ENV_FILE" ]] || ! grep -q "^POSTGRES_PASSWORD=" "$ENV_FILE" ||     [[ -z "$(grep "^POSTGRES_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)" ]]
}

postgres_db_bestaat() {
  # Check of postgres draait EN bereikbaar is met het huidige wachtwoord
  local pw
  pw=$(get_env POSTGRES_PASSWORD)
  [[ -z "$pw" ]] && return 1
  docker exec pycodeflow-postgres-1     psql "postgresql://pycodeflow:${pw}@localhost/pycodeflow"     -c "SELECT 1" > /dev/null 2>&1
}

npm_package_aanwezig() {
  # Check of een npm package geïnstalleerd is in de web container
  docker exec pycodeflow-web-1 \
    node -e "require('$1')" 2>/dev/null
}

setup_eerste_start() {
  header
  echo -e "${BOLD}  ╔══════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}  ║  🚀  Eerste-start configuratie           ║${RESET}"
  echo -e "${BOLD}  ╚══════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  Welkom bij PyCodeFlow! Dit scherm verschijnt enkel"
  echo -e "  bij de eerste installatie. We configureren alles stap"
  echo -e "  voor stap."
  echo ""
  echo -e "  ${DIM}Druk Ctrl+C op elk moment om te annuleren.${RESET}"
  echo ""
  read -rp "  Druk Enter om te starten..." _

  # ── Stap 1: .env aanmaken als die niet bestaat ────────────────────────────
  if [[ ! -f "$ENV_FILE" ]]; then
    stap "Stap 1: .env aanmaken"
    cp "$BASE/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"
    ok ".env aangemaakt"
  else
    stap "Stap 1: Bestaande .env gevonden"
    ok ".env bestaat al — alleen ontbrekende waarden worden toegevoegd"
  fi
  echo ""

  # ── Stap 2: PostgreSQL wachtwoord ────────────────────────────────────────
  stap "Stap 2: PostgreSQL configureren"
  echo ""

  local bestaand_pw
  bestaand_pw=$(get_env POSTGRES_PASSWORD)

  # Verwijder DATABASE_URL uit .env — wordt automatisch opgebouwd
  sed -i '/^DATABASE_URL=/d' "$ENV_FILE" 2>/dev/null

  if [[ -n "$bestaand_pw" ]] && postgres_db_bestaat 2>/dev/null; then
    # Wachtwoord klopt en DB bestaat — alles OK
    ok "PostgreSQL geconfigureerd en bereikbaar"
    info "Wachtwoord: (reeds ingesteld)"
    POSTGRES_PW="$bestaand_pw"

  elif [[ -n "$bestaand_pw" ]] && [[ -d "$BASE/pgdata" ]] && [[ -n "$(ls -A "$BASE/pgdata" 2>/dev/null)" ]]; then
    # pgdata bestaat en is niet leeg — test of wachtwoord klopt
    echo ""
    info "pgdata/ gevonden — wachtwoord controleren..."
    # Start postgres tijdelijk om te testen
    docker compose --project-directory "$BASE" up -d postgres 2>/dev/null
    sleep 8
    if docker exec pycodeflow-postgres-1         psql "postgresql://pycodeflow:${bestaand_pw}@localhost/pycodeflow"         -c "SELECT 1" > /dev/null 2>&1; then
      ok "PostgreSQL wachtwoord correct"
      POSTGRES_PW="$bestaand_pw"
    else
      echo ""
      err "PostgreSQL wachtwoord mismatch!"
      warn "pgdata/ bevat een database met een ander wachtwoord dan in .env staat."
      echo ""
      echo -e "  ${BOLD}Oplossingen:${RESET}"
      echo -e "  ${BOLD}1)${RESET} pgdata/ wissen ${DIM}(aanbevolen als DB nog leeg/onbelangrijk is)${RESET}"
      echo -e "  ${BOLD}2)${RESET} Origineel wachtwoord ingeven"
      echo ""
      read -rp "  Keuze (1/2) [1]: " pw_keuze
      pw_keuze="${pw_keuze:-1}"
      if [[ "$pw_keuze" == "1" ]]; then
        echo ""
        echo -e "  Kies een nieuw PostgreSQL wachtwoord."
        echo -e "  ${DIM}Tip: vermijd uitroeptekens (!) in het wachtwoord.${RESET}"
        local pw1 pw2
        while true; do
          read -rsp "  Nieuw wachtwoord (min. 8 tekens): " pw1; echo ""
          [[ ${#pw1} -lt 8 ]] && { err "Te kort."; continue; }
          read -rsp "  Bevestig: " pw2; echo ""
          [[ "$pw1" != "$pw2" ]] && { err "Komen niet overeen."; continue; }
          break
        done
        docker compose --project-directory "$BASE" stop postgres 2>/dev/null
        info "pgdata/ wissen via Docker..."
        docker run --rm           -v "$BASE/pgdata:/pgdata"           alpine sh -c "rm -rf /pgdata/*" 2>/dev/null
        ok "pgdata/ geleegd"
        POSTGRES_PW="$pw1"
        set_env "POSTGRES_PASSWORD" "$POSTGRES_PW"
        ok "Nieuw wachtwoord ingesteld in .env"
      else
        echo ""
        local orig_pw
        read -rsp "  Origineel wachtwoord: " orig_pw; echo ""
        POSTGRES_PW="$orig_pw"
        set_env "POSTGRES_PASSWORD" "$POSTGRES_PW"
        ok "Wachtwoord bijgewerkt in .env"
      fi
    fi
    echo ""

  elif [[ -n "$bestaand_pw" ]]; then
    # Wachtwoord in .env maar nog geen pgdata — normaal bij eerste keer
    POSTGRES_PW="$bestaand_pw"
    ok "Wachtwoord gevonden in .env: (niet getoond)"

  else
    # Geen wachtwoord — nieuw instellen
    echo -e "  Kies een wachtwoord voor de PostgreSQL database."
    echo -e "  ${DIM}Minimum 8 tekens. Vermijd uitroeptekens (!) in wachtwoorden — dit geeft problemen in bash.${RESET}"
    echo ""
    local pw1 pw2
    while true; do
      read -rsp "  Wachtwoord: " pw1; echo ""
      [[ ${#pw1} -lt 8 ]] && { err "Te kort — minimaal 8 tekens."; continue; }
      if [[ "$pw1" == *"!"* ]]; then
        warn "Uitroepteken (!) gevonden — dit kan problemen geven in bash-commando's."
        read -rp "  Toch gebruiken? (j/n) [n]: " gebruik_uitroep
        [[ ! "${gebruik_uitroep:-n}" =~ ^[jJ]$ ]] && continue
      fi
      read -rsp "  Bevestig wachtwoord: " pw2; echo ""
      [[ "$pw1" != "$pw2" ]] && { err "Komen niet overeen."; continue; }
      break
    done
    POSTGRES_PW="$pw1"
    set_env "POSTGRES_PASSWORD" "$POSTGRES_PW"
    ok "PostgreSQL wachtwoord ingesteld"
  fi
  echo 

  # ── Stap 3: Basisinstellingen .env ───────────────────────────────────────
  stap "Stap 3: Basisinstellingen"
  echo ""

  # Schoolnaam
  local huidig_school
  huidig_school=$(get_env SCHOOL_NAME)
  if [[ -z "$huidig_school" ]]; then
    read -rp "  Schoolnaam (voor PDF export) [Atheneum Hoboken]: " school_input
    set_env "SCHOOL_NAME" "${school_input:-Atheneum Hoboken}"
    ok "Schoolnaam ingesteld: ${school_input:-Atheneum Hoboken}"
  else
    ok "Schoolnaam: $huidig_school"
  fi

  # Leerkracht login
  local huidig_user
  huidig_user=$(get_env POC_BASIC_USER)
  if [[ -z "$huidig_user" ]] || [[ "$huidig_user" == "CHANGE_ME" ]]; then
    echo ""
    echo -e "  ${BOLD}Eerste leerkrachtsaccount:${RESET}"
    info "Dit is de fallback login. Je kan later accounts aanmaken via admin.html"
    local lk_user lk_pw
    read -rp "  Gebruikersnaam [admin]: " lk_user
    lk_user="${lk_user:-admin}"
    read -rsp "  Wachtwoord (min. 8 tekens): " lk_pw; echo ""
    while [[ ${#lk_pw} -lt 8 ]]; do
      err "Wachtwoord te kort."
      read -rsp "  Wachtwoord (min. 8 tekens): " lk_pw; echo ""
    done
    set_env "POC_BASIC_USER" "$lk_user"
    set_env "POC_BASIC_PASS" "$lk_pw"
    ok "Leerkrachtsaccount ingesteld: $lk_user"
  else
    ok "Leerkrachtsaccount: $huidig_user (reeds ingesteld)"
  fi

  # Versie defaults
  [[ -z "$(get_env APP_VERSION_YEAR)" ]]  && set_env "APP_VERSION_YEAR"  "2026"
  [[ -z "$(get_env APP_VERSION_MAJOR)" ]] && set_env "APP_VERSION_MAJOR" "2"
  [[ -z "$(get_env APP_VERSION_MINOR)" ]] && set_env "APP_VERSION_MINOR" "13"
  [[ -z "$(get_env APP_VERSION_BUILD)" ]] && set_env "APP_VERSION_BUILD" "0"
  [[ -z "$(get_env STRESS_TEST_ENABLED)" ]] && set_env "STRESS_TEST_ENABLED" "false"
  [[ -z "$(get_env DB_SSL)" ]]              && set_env "DB_SSL"             "false"
  [[ -z "$(get_env RUNNER_URL)" ]]          && set_env "RUNNER_URL"         "http://runner:5000"

  ok "Versie en overige defaults ingesteld"
  echo ""

  # ── Stap 4: Docker compose (eerste keer bouwen) ───────────────────────────
  stap "Stap 4: Containers bouwen en starten"
  echo ""
  echo -e "  ${GEEL}Dit kan enkele minuten duren bij de eerste keer...${RESET}"
  echo ""

  $COMPOSE --project-directory "$BASE" up --build -d --remove-orphans
  local compose_exit=$?

  if [[ $compose_exit -ne 0 ]]; then
    err "Docker compose mislukt (exit code $compose_exit)"
    err "Controleer de logs met: docker compose logs"
    pauze; return 1
  fi

  # Wacht tot postgres healthy is
  echo ""
  info "Wachten tot PostgreSQL klaar is..."
  local pogingen=0
  while ! docker exec pycodeflow-postgres-1 pg_isready -U pycodeflow -q 2>/dev/null; do
    sleep 2
    pogingen=$((pogingen + 1))
    if [[ $pogingen -gt 30 ]]; then
      err "PostgreSQL start niet op na 60 seconden."
      err "Controleer: docker compose logs postgres"
      pauze; return 1
    fi
    echo -n "."
  done
  echo ""
  ok "PostgreSQL is klaar"
  echo ""

  # ── Stap 5: npm packages ─────────────────────────────────────────────────
  stap "Stap 5: npm packages controleren"
  echo ""
  echo -e "  ${DIM}Packages worden geïnstalleerd via de Dockerfile bij build.${RESET}"
  echo ""

  local packages_ok=true
  for pkg in pg pdfkit express socket.io; do
    if docker exec pycodeflow-web-1 node -e "require('$pkg')" 2>/dev/null; then
      ok "$pkg aanwezig"
    else
      err "$pkg ONTBREEKT — container wordt herbouwd"
      packages_ok=false
    fi
  done

  if ! $packages_ok; then
    echo ""
    info "Container herbouwen met correcte packages (package.json bevat nu pg + pdfkit)..."
    $COMPOSE --project-directory "$BASE" up --build -d web
    echo ""
    # Wacht opnieuw op web
    local p2=0
    while ! curl -sf http://localhost:3000/health > /dev/null 2>&1; do
      sleep 3; p2=$((p2+1))
      [[ $p2 -gt 20 ]] && { err "Web start niet op na rebuild."; pauze; return 1; }
      echo -n "."
    done
    echo ""; ok "Container herbouwd"
  fi
  echo ""

  # ── Stap 6: Database schema ───────────────────────────────────────────────
  stap "Stap 6: Database schema"
  echo ""
  info "Schema wordt aangemaakt bij serverstart (automatisch via initSchema)"

  # Herstart web zodat schema zeker aangemaakt wordt
  docker restart pycodeflow-web-1 > /dev/null 2>&1
  sleep 3

  # Wacht op web
  local web_ok=false
  for i in {1..15}; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
      web_ok=true; break
    fi
    sleep 2; echo -n "."
  done
  echo ""

  if $web_ok; then
    ok "Web server actief en schema aangemaakt"
  else
    warn "Web server reageert nog niet — schema wordt aangemaakt bij eerste request"
  fi
  echo ""

  # ── Stap 7: SQLite migratie (optioneel) ──────────────────────────────────
  stap "Stap 7: SQLite migratie (optioneel)"
  echo ""

  local sqlite_pad
  sqlite_pad=$(find "$BASE" -name "*.db" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$sqlite_pad" ]]; then
    warn "SQLite database gevonden: $sqlite_pad"
    echo ""
    read -rp "  Bestaande data migreren naar PostgreSQL? (j/n) [j]: " do_migrate
    if [[ "${do_migrate:-j}" =~ ^[jJ]$ ]]; then
      info "Migratie starten..."
      docker exec pycodeflow-web-1 \
        node /app/scripts/migrate-sqlite-to-pg.js
      if [[ $? -eq 0 ]]; then
        ok "Migratie geslaagd"
        echo ""
        read -rp "  SQLite bestand bewaren als backup? (j/n) [j]: " bewaar
        if [[ ! "${bewaar:-j}" =~ ^[jJ]$ ]]; then
          mv "$sqlite_pad" "${sqlite_pad}.backup-$(date +%Y%m%d)"
          ok "SQLite hernoemd naar backup"
        else
          ok "SQLite bewaard als backup (wordt niet meer gebruikt)"
        fi
      else
        err "Migratie had problemen — controleer output hierboven"
        warn "SQLite blijft ongewijzigd als fallback"
      fi
    else
      info "Migratie overgeslagen — je kan dit later doen via menu optie 8"
    fi
  else
    ok "Geen SQLite database gevonden — niets te migreren"
  fi
  echo ""

  # ── Stap 8: Eerste leerkracht aanmaken in DB ─────────────────────────────
  stap "Stap 8: Leerkrachtsaccount in database"
  echo ""

  # Check of er al leerkrachten in de DB zitten
  local teacher_count
  teacher_count=$(docker exec pycodeflow-web-1     node /app/scripts/manage-teacher.js list 2>/dev/null | grep -cE "^  " || echo "0")
  # Fallback via psql
  if [[ "$teacher_count" == "0" ]]; then
    local pg_pw
    pg_pw=$(get_env POSTGRES_PASSWORD)
    teacher_count=$(docker exec pycodeflow-postgres-1       psql "postgresql://pycodeflow:${pg_pw}@localhost/pycodeflow"       -tAc "SELECT COUNT(*) FROM teachers;" 2>/dev/null || echo "0")
  fi

  if [[ "$teacher_count" == "0" ]] || [[ -z "$teacher_count" ]]; then
    warn "Nog geen leerkrachten in database"
    local lk_user lk_pw
    lk_user=$(get_env POC_BASIC_USER)
    lk_pw=$(get_env POC_BASIC_PASS)

    if [[ -n "$lk_user" ]] && [[ -n "$lk_pw" ]]; then
      read -rp "  Account '$lk_user' aanmaken in database? (j/n) [j]: " aanmaken
      if [[ "${aanmaken:-j}" =~ ^[jJ]$ ]]; then
        docker exec pycodeflow-web-1           node /app/scripts/manage-teacher.js add "$lk_user" "$lk_pw" "admin"
        if [[ $? -eq 0 ]]; then
          ok "Leerkrachtsaccount aangemaakt in database"
        else
          warn "Account aanmaken mislukt — probeer via admin.html"
        fi
      fi
    fi
  else
    ok "$teacher_count leerkracht(en) al aanwezig in database"
  fi
  echo ""

  # ── Klaar ─────────────────────────────────────────────────────────────────
  echo ""
  echo -e "  ${GROEN}╔══════════════════════════════════════════╗${RESET}"
  echo -e "  ${GROEN}║  ✅  PyCodeFlow is klaar voor gebruik!   ║${RESET}"
  echo -e "  ${GROEN}╚══════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}URL:${RESET}        https://app.pycodeflow.org"
  echo -e "  ${BOLD}Beheer:${RESET}     /admin.html"
  echo -e "  ${BOLD}Vragenbank:${RESET} /quiz-bank.html"
  echo -e "  ${BOLD}Monitoring:${RESET} /monitoring.html"
  echo ""
  pauze
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MENU-ACTIES
# ═══════════════════════════════════════════════════════════════════════════════

actie_start() {
  header
  stap "Start PyCodeFlow"
  echo ""
  $COMPOSE --project-directory "$BASE" up -d
  echo ""
  ok "Gestart."
  echo ""
  pauze
}

actie_stop() {
  header
  stap "Stop PyCodeFlow"
  echo ""
  $COMPOSE --project-directory "$BASE" down
  echo ""
  warn "Gestopt."
  echo ""
  pauze
}

actie_restart() {
  header
  stap "Herstart PyCodeFlow"
  echo ""
  info "Stoppen..."
  $COMPOSE --project-directory "$BASE" down
  echo ""
  info "Starten..."
  $COMPOSE --project-directory "$BASE" up -d
  echo ""
  ok "Herstart voltooid."
  echo ""
  pauze
}

actie_rebuild() {
  header
  stap "Rebuild & Herstart PyCodeFlow"
  echo ""
  warn "Dit rebuildt alle Docker images (kan enkele minuten duren)."
  read -rp "  Doorgaan? (j/n): " bevestig
  [[ ! "$bevestig" =~ ^[jJ]$ ]] && return
  echo ""
  $COMPOSE --project-directory "$BASE" up --build -d
  echo ""
  ok "Rebuild voltooid."
  echo ""
  pauze
}

actie_logs() {
  while true; do
    header
    stap "Logs bekijken"
    echo ""
    # Status per container
    local ws rs ps
    ws=$(container_status pycodeflow-web-1)
    rs=$(container_status pycodeflow-runner-1)
    ps=$(container_status pycodeflow-postgres-1)
    echo -e "  web:      $(kleur_status "$ws")   runner: $(kleur_status "$rs")   postgres: $(kleur_status "$ps")"
    echo ""
    echo -e "  ${BOLD}1)${RESET} Web — live (Ctrl+C om te stoppen)"
    echo -e "  ${BOLD}2)${RESET} Runner — live"
    echo -e "  ${BOLD}3)${RESET} PostgreSQL — live"
    echo -e "  ${BOLD}4)${RESET} Alle containers — live"
    echo -e "  ${BOLD}5)${RESET} Web — laatste 100 regels"
    echo -e "  ${BOLD}6)${RESET} Runner — laatste 100 regels"
    echo -e "  ${BOLD}7)${RESET} PostgreSQL — laatste 100 regels"
    echo -e "  ${BOLD}8)${RESET} Web — enkel fouten (ERROR/FATAL)"
    echo -e "  ${BOLD}9)${RESET} PostgreSQL — verbindingsstatus controleren"
    echo -e "  ${BOLD}0)${RESET} Terug"
    echo ""
    read -rp "  Keuze: " lk
    case "$lk" in
      1) $COMPOSE --project-directory "$BASE" logs -f web ;;
      2) $COMPOSE --project-directory "$BASE" logs -f runner ;;
      3) $COMPOSE --project-directory "$BASE" logs -f postgres ;;
      4) $COMPOSE --project-directory "$BASE" logs -f ;;
      5) $COMPOSE --project-directory "$BASE" logs --tail=100 web; pauze ;;
      6) $COMPOSE --project-directory "$BASE" logs --tail=100 runner; pauze ;;
      7) $COMPOSE --project-directory "$BASE" logs --tail=100 postgres; pauze ;;
      8)
        echo ""
        echo -e "  ${BOLD}Fouten in web logs:${RESET}"
        $COMPOSE --project-directory "$BASE" logs --tail=200 web 2>/dev/null           | grep -iE "error|fatal|exception|crash|cannot find|module not found"           | tail -30
        echo ""
        pauze ;;
      9)
        header
        stap "PostgreSQL verbindingsstatus"
        echo ""
        if docker exec pycodeflow-postgres-1 pg_isready -U pycodeflow -d pycodeflow 2>/dev/null; then
          ok "PostgreSQL bereikbaar en klaar"
          echo ""
          info "Tabellen in database:"
          docker exec pycodeflow-postgres-1             psql -U pycodeflow -d pycodeflow -c "\dt" 2>/dev/null             || err "Kan geen verbinding maken met de database"
          echo ""
          info "Aantal records per tabel:"
          docker exec pycodeflow-postgres-1             psql -U pycodeflow -d pycodeflow -c "
              SELECT 'teachers' AS tabel, COUNT(*) AS aantal FROM teachers
              UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
              UNION ALL SELECT 'students', COUNT(*) FROM students
              UNION ALL SELECT 'classes', COUNT(*) FROM classes
              UNION ALL SELECT 'quiz_bank', COUNT(*) FROM quiz_bank
              UNION ALL SELECT 'quiz_answers', COUNT(*) FROM quiz_answers
              ORDER BY tabel;" 2>/dev/null             || warn "Sommige tabellen bestaan nog niet (schema nog niet aangemaakt)"
        else
          err "PostgreSQL NIET bereikbaar!"
          echo ""
          warn "Controleer:"
          info "1. Is de postgres container actief? (zie status hierboven)"
          info "2. Is POSTGRES_PASSWORD correct in .env?"
          info "3. Probeer: docker compose restart postgres"
        fi
        echo ""
        pauze ;;
      0) return ;;
      *) err "Ongeldige keuze."; sleep 1 ;;
    esac
  done
}

actie_check() {
  header
  stap "Verificatie"
  echo ""
  if [[ -f "$BASE/check-deployment.sh" ]]; then
    bash "$BASE/check-deployment.sh"
  else
    err "check-deployment.sh niet gevonden in $BASE"
  fi
  echo ""
  pauze
}

actie_npm_check() {
  header
  stap "npm packages controleren"
  echo ""

  if ! docker inspect pycodeflow-web-1 &>/dev/null; then
    err "Web container niet actief. Start PyCodeFlow eerst."
    pauze; return
  fi

  echo -e "  ${DIM}Packages worden geïnstalleerd via de Dockerfile bij 'docker compose build'.${RESET}"
  echo -e "  ${DIM}Hier controleren we of ze aanwezig zijn in de draaiende container.${RESET}"
  echo ""

  local alles_ok=true
  for pkg in pg pdfkit express socket.io dotenv; do
    if docker exec pycodeflow-web-1 node -e "require('$pkg')" 2>/dev/null; then
      ok "$pkg"
    else
      err "$pkg ONTBREEKT — container herbouwen nodig"
      alles_ok=false
    fi
  done

  echo ""

  if ! $alles_ok; then
    warn "Eén of meer packages ontbreken in de container."
    read -rp "  Container nu herbouwen? (j/n) [j]: " rebuild
    if [[ "${rebuild:-j}" =~ ^[jJ]$ ]]; then
      info "Herbouwen... (kan enkele minuten duren)"
      $COMPOSE --project-directory "$BASE" up --build -d web
      echo ""
      ok "Container herbouwd. Controleer logs als de server niet start."
    fi
  else
    ok "Alle packages aanwezig"
  fi

  echo ""
  pauze
}

actie_migratie() {
  header
  stap "SQLite → PostgreSQL migratie"
  echo ""

  if ! docker inspect pycodeflow-web-1 &>/dev/null; then
    err "Web container niet actief. Start PyCodeFlow eerst."
    pauze; return
  fi

  local sqlite_pad
  sqlite_pad=$(find "$BASE" -name "*.db" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -z "$sqlite_pad" ]]; then
    warn "Geen SQLite database gevonden."
    info "Verwacht locatie: $BASE/data/pycodeflow.db"
    pauze; return
  fi

  echo -e "  Gevonden: ${GEEL}$sqlite_pad${RESET}"
  echo ""
  read -rp "  Migratie uitvoeren? (j/n): " bevestig
  [[ ! "$bevestig" =~ ^[jJ]$ ]] && return

  echo ""
  docker exec pycodeflow-web-1 node /app/scripts/migrate-sqlite-to-pg.js

  if [[ $? -eq 0 ]]; then
    echo ""
    ok "Migratie geslaagd"
    read -rp "  SQLite als backup bewaren? (j/n) [j]: " bewaar
    if [[ ! "${bewaar:-j}" =~ ^[jJ]$ ]]; then
      mv "$sqlite_pad" "${sqlite_pad}.backup-$(date +%Y%m%d-%H%M)"
      ok "SQLite hernoemd naar backup"
    fi
  else
    err "Migratie mislukt — zie output hierboven"
  fi

  echo ""
  pauze
}

actie_leerkracht() {
  header
  stap "Leerkrachtsaccount aanmaken"
  echo ""

  if ! docker inspect pycodeflow-web-1 &>/dev/null; then
    err "Web container niet actief."
    pauze; return
  fi

  read -rp "  Gebruikersnaam: " lk_user
  [[ -z "$lk_user" ]] && { err "Gebruikersnaam is verplicht."; pauze; return; }

  local lk_pw lk_pw2
  read -rsp "  Wachtwoord (min. 8 tekens): " lk_pw; echo ""
  while [[ ${#lk_pw} -lt 8 ]]; do
    err "Te kort."
    read -rsp "  Wachtwoord: " lk_pw; echo ""
  done
  read -rsp "  Bevestig wachtwoord: " lk_pw2; echo ""
  if [[ "$lk_pw" != "$lk_pw2" ]]; then
    err "Wachtwoorden komen niet overeen."
    pauze; return
  fi

  read -rp "  Rol (teacher/admin) [teacher]: " lk_rol
  lk_rol="${lk_rol:-teacher}"
  [[ "$lk_rol" != "admin" ]] && lk_rol="teacher"

  echo ""
  docker exec pycodeflow-web-1     node /app/scripts/manage-teacher.js add "$lk_user" "$lk_pw" "$lk_rol"

  echo ""
  if [[ $? -eq 0 ]]; then
    ok "Leerkrachtsaccount '$lk_user' aangemaakt als $lk_rol"
  else
    err "Aanmaken mislukt — zie foutmelding hierboven"
  fi
  echo ""
  pauze
}

update_versie() {
  header
  stap "Versie instellen"
  echo ""

  local vj vm vn vb
  vj=$(get_env APP_VERSION_YEAR);  vm=$(get_env APP_VERSION_MAJOR)
  vn=$(get_env APP_VERSION_MINOR); vb=$(get_env APP_VERSION_BUILD)
  [[ -z "$vj" ]] && { local full; full=$(get_env APP_VERSION); IFS='.' read -r vj vm vn vb <<< "$full"; }
  vj="${vj:-2026}"; vm="${vm:-2}"; vn="${vn:-13}"; vb="${vb:-0}"

  echo -e "  Huidige versie: ${GEEL}${vj}.${vm}.${vn}.${vb}${RESET}"
  echo -e "  ${DIM}Druk Enter om waarde te behouden.${RESET}"
  echo ""

  local nj nm nn nb
  read -rp "  Jaar  [${vj}]: " nj; read -rp "  Major [${vm}]: " nm
  read -rp "  Minor [${vn}]: " nn; read -rp "  Build [${vb}]: " nb

  nj="${nj:-$vj}"; nm="${nm:-$vm}"; nn="${nn:-$vn}"; nb="${nb:-$vb}"
  local nieuw="${nj}.${nm}.${nn}.${nb}"

  echo ""
  echo -e "  Nieuwe versie: ${GROEN}${nieuw}${RESET}"
  read -rp "  Bevestigen? (j/n): " bevestig
  if [[ "$bevestig" =~ ^[jJ]$ ]]; then
    set_env "APP_VERSION_YEAR"  "$nj"; set_env "APP_VERSION_MAJOR" "$nm"
    set_env "APP_VERSION_MINOR" "$nn"; set_env "APP_VERSION_BUILD" "$nb"
    set_env "APP_VERSION" "$nieuw"
    echo ""
    ok "Versie bijgewerkt naar ${nieuw}"
  else
    warn "Geannuleerd."
  fi
  echo ""
  pauze
}

actie_backup() {
  header
  stap "PostgreSQL backup (Sprint 19i)"
  echo ""

  local backup_script="$BASE/scripts/backup-db.sh"
  local backup_dir="$BASE/backups"

  # Toon backup status
  if [[ -d "$backup_dir" ]]; then
    local count
    count=$(find "$backup_dir" -name "*.sql.gz" 2>/dev/null | wc -l)
    local size
    size=$(du -sh "$backup_dir" 2>/dev/null | cut -f1)
    local laatste
    laatste=$(find "$backup_dir" -name "*.sql.gz" -newer /tmp 2>/dev/null | sort -r | head -1)
    echo -e "  Backups: ${GEEL}$count${RESET} bewaard · Grootte: ${GEEL}$size${RESET}"
    if [[ -n "$laatste" ]]; then
      ok "Laatste backup: $(basename $laatste)"
    else
      warn "Nog geen backups gevonden"
    fi
    # Toon backup log
    if [[ -f "$backup_dir/backup.log" ]]; then
      echo ""
      echo -e "  ${BOLD}Recentste log-entries:${RESET}"
      tail -5 "$backup_dir/backup.log" | sed 's/^/  /'
    fi
  else
    info "Backup map bestaat nog niet — wordt aangemaakt bij eerste backup"
  fi

  echo ""
  echo -e "  ${BOLD}Acties:${RESET}"
  echo -e "  ${BOLD}1)${RESET} Nu een backup maken"
  echo -e "  ${BOLD}2)${RESET} Cronjob instellen (dagelijks 02:00)"
  echo -e "  ${BOLD}3)${RESET} Backup herstelten (restore)"
  echo -e "  ${BOLD}0)${RESET} Terug"
  echo ""
  read -rp "  Keuze: " bk

  case "$bk" in
    1)
      if [[ ! -f "$backup_script" ]]; then
        err "backup-db.sh niet gevonden. Kopieer scripts/backup-db.sh naar $BASE/scripts/"
        pauze; return
      fi
      info "Backup maken..."
      bash "$backup_script"
      echo ""
      ok "Backup voltooid — zie $backup_dir"
      ;;
    2)
      if [[ ! -f "$backup_script" ]]; then
        err "backup-db.sh niet gevonden."
        pauze; return
      fi
      chmod +x "$backup_script"
      if crontab -l 2>/dev/null | grep -q "backup-db.sh"; then
        ok "Backup cronjob al ingesteld"
      else
        (crontab -l 2>/dev/null; echo "0 2 * * * $backup_script") | crontab -
        ok "Cronjob ingesteld: dagelijks om 02:00"
      fi
      ;;
    3)
      local backups
      backups=$(find "$backup_dir" -name "*.sql.gz" 2>/dev/null | sort -r)
      if [[ -z "$backups" ]]; then
        err "Geen backups gevonden in $backup_dir"
        pauze; return
      fi
      echo -e "  ${BOLD}Beschikbare backups:${RESET}"
      local i=1
      while IFS= read -r b; do
        echo -e "  ${BOLD}$i)${RESET} $(basename $b)"
        i=$((i+1))
      done <<< "$backups"
      echo ""
      warn "LET OP: restore overschrijft de VOLLEDIGE database!"
      read -rp "  Backup nummer om te herstellen (0=annuleren): " keuze_b
      if [[ "$keuze_b" =~ ^[0-9]+$ ]] && [[ $keuze_b -gt 0 ]]; then
        local gekozen
        gekozen=$(echo "$backups" | sed -n "${keuze_b}p")
        if [[ -n "$gekozen" ]]; then
          read -rp "  Bevestig restore van $(basename $gekozen)? (j/n): " confirm_r
          if [[ "$confirm_r" =~ ^[jJ]$ ]]; then
            PG_PW=$(get_env POSTGRES_PASSWORD)
            zcat "$gekozen" | docker exec -i pycodeflow-postgres-1               psql -U pycodeflow pycodeflow
            [[ $? -eq 0 ]] && ok "Restore voltooid!" || err "Restore mislukt"
          fi
        fi
      fi
      ;;
    0|*) return ;;
  esac
  echo ""
  pauze
}

actie_health_monitor() {
  header
  stap "Health monitor instellen (Sprint 19e)"
  echo ""

  local monitor_script="$BASE/health-monitor.sh"

  if [[ ! -f "$monitor_script" ]]; then
    err "health-monitor.sh niet gevonden in $BASE"
    info "Kopieer het bestand eerst naar $BASE/health-monitor.sh"
    pauze; return
  fi

  chmod +x "$monitor_script"

  # Check of cronjob al bestaat
  if crontab -l 2>/dev/null | grep -q "health-monitor.sh"; then
    ok "Health monitor cronjob is al ingesteld"
    echo ""
    crontab -l 2>/dev/null | grep "health-monitor"
    echo ""
  else
    info "Cronjob instellen (elke 5 minuten)..."
    (crontab -l 2>/dev/null; echo "*/5 * * * * $monitor_script >> $BASE/logs/health-monitor.log 2>&1") | crontab -
    ok "Cronjob ingesteld: elke 5 minuten"
  fi

  # Optioneel webhook
  local huidig_webhook
  huidig_webhook=$(get_env WEBHOOK_URL)
  if [[ -z "$huidig_webhook" ]]; then
    echo ""
    echo -e "  ${BOLD}Webhook notificaties (optioneel):${RESET}"
    echo -e "  ${DIM}Bv. https://ntfy.sh/jouw-kanaal voor push-notificaties op telefoon${RESET}"
    echo -e "  ${DIM}Leeglaten = enkel logging, geen externe notificatie${RESET}"
    echo ""
    read -rp "  Webhook URL (Enter om over te slaan): " webhook_url
    if [[ -n "$webhook_url" ]]; then
      set_env "WEBHOOK_URL" "$webhook_url"
      ok "Webhook URL ingesteld"
    fi
  else
    ok "Webhook URL: $huidig_webhook"
  fi

  echo ""
  info "Test de monitor nu:"
  info "  bash $monitor_script"
  echo ""
  pauze
}

actie_volledige_reset() {
  header
  echo -e "${ROOD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${ROOD}║  ⚠️   VOLLEDIGE RESET — ALLES VERWIJDEREN    ║${RESET}"
  echo -e "${ROOD}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${ROOD}${BOLD}DIT VERWIJDERT:${RESET}"
  echo -e "  ${ROOD}✗${RESET} Alle Docker containers"
  echo -e "  ${ROOD}✗${RESET} Alle Docker images (pycodeflow)"
  echo -e "  ${ROOD}✗${RESET} Alle Docker volumes"
  echo -e "  ${ROOD}✗${RESET} PostgreSQL database + alle data (pgdata/)"
  echo -e "  ${ROOD}✗${RESET} Alle logbestanden"
  echo -e "  ${ROOD}✗${RESET} SQLite legacy bestanden"
  echo ""
  echo -e "  ${GROEN}✓${RESET} .env wordt NIET verwijderd (wachtwoorden en tokens blijven bewaard)"
  echo -e "  ${GROEN}✓${RESET} Bestanden in web/, runner/ blijven bewaard"
  echo -e "  ${GROEN}✓${RESET} Backups in backups/ blijven bewaard"
  echo ""
  warn "Dit is onomkeerbaar. Alle leerlingendata en toetsresultaten gaan verloren."
  echo ""

  read -rp "  Type 'RESET' om te bevestigen (of Enter om te annuleren): " bevestig1
  if [[ "$bevestig1" != "RESET" ]]; then
    warn "Geannuleerd — geen wijzigingen."
    pauze; return
  fi

  read -rp "  Nogmaals bevestigen — type 'JA VERWIJDER ALLES': " bevestig2
  if [[ "$bevestig2" != "JA VERWIJDER ALLES" ]]; then
    warn "Geannuleerd — geen wijzigingen."
    pauze; return
  fi

  echo ""
  stap "Stap 1: Containers stoppen en verwijderen"
  # Gebruik --env-file zodat compose de variabelen kent ook als .env ontbreekt
  docker compose --project-directory "$BASE" down --volumes --remove-orphans 2>/dev/null     || docker compose -f "$BASE/docker-compose.yml" down --remove-orphans 2>/dev/null
  ok "Containers gestopt"

  stap "Stap 2: Docker images verwijderen"
  docker rmi pycodeflow-web-1 pycodeflow-runner-1 2>/dev/null
  docker rmi "$(basename "$BASE")-web" "$(basename "$BASE")-runner" 2>/dev/null
  docker image prune -f 2>/dev/null
  ok "Images verwijderd (eventuele fouten hier zijn normaal)"

  stap "Stap 3: PostgreSQL data verwijderen"
  if [[ -d "$BASE/pgdata" ]] && [[ -n "$(ls -A "$BASE/pgdata" 2>/dev/null)" ]]; then
    info "pgdata/ wissen via Docker (root-bestanden)..."
    docker run --rm \
      -v "$BASE/pgdata:/pgdata" \
      alpine sh -c "rm -rf /pgdata/*" 2>/dev/null
    ok "pgdata/ geleegd"
  else
    info "pgdata/ was al leeg"
  fi

  stap "Stap 4: Logbestanden verwijderen"
  if [[ -d "$BASE/logs" ]]; then
    rm -f "$BASE/logs"/*.log 2>/dev/null
    ok "Logbestanden verwijderd"
  else
    info "logs/ bestond niet — niets te doen"
  fi

  stap "Stap 5: Data map opruimen (SQLite legacy)"
  if [[ -d "$BASE/data" ]]; then
    rm -f "$BASE/data"/*.db 2>/dev/null
    ok "SQLite bestanden verwijderd"
  else
    info "data/ bestond niet — niets te doen"
  fi

  # .env wordt NOOIT aangeraakt — wachtwoorden en tokens blijven bewaard

  echo ""
  echo -e "  ${GROEN}╔══════════════════════════════════════════╗${RESET}"
  echo -e "  ${GROEN}║  ✅  Reset voltooid                      ║${RESET}"
  echo -e "  ${GROEN}╚══════════════════════════════════════════╝${RESET}"
  echo ""
  ok "Containers, database en logs verwijderd."
  ok ".env bewaard — wachtwoorden en Cloudflare token intact."
  echo ""
  echo -e "  ${BOLD}Volgende stap:${RESET}"
  info "Kies optie 13 (Eerste-start opnieuw) om alles opnieuw op te bouwen."
  info "Je .env is al ingesteld — de wizard gaat sneller deze keer."
  echo ""
  pauze
}

actie_resources() {
  header
  stap "Container resources"
  echo ""
  docker stats --no-stream \
    pycodeflow-web-1 pycodeflow-runner-1 pycodeflow-postgres-1 2>/dev/null \
    || docker stats --no-stream 2>/dev/null
  echo ""
  pauze
}

actie_logs_cleanup() {
  header
  stap "Logs opruimen (Sprint 17a)"
  echo ""

  if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    err "Web container niet bereikbaar. Start PyCodeFlow eerst."
    pauze; return
  fi

  # Haal log info op via API
  local info
  info=$(curl -sf -b /tmp/pycf_cookie.txt http://localhost:3000/api/admin/logs/info 2>/dev/null)

  if [[ -z "$info" ]]; then
    warn "Kan log-info niet ophalen. Ben je ingelogd?"
    info "Probeer eerst in te loggen via de browser en kopieer je cookie,"
    info "of gebruik optie 6 (logs bekijken) voor een handmatig overzicht."
    echo ""
    # Fallback: direct op schijf kijken
    local LOG_DIR
    LOG_DIR="$BASE/web/logs"
    if [[ -d "$LOG_DIR" ]]; then
      local count size
      count=$(find "$LOG_DIR" -name "*.log" 2>/dev/null | wc -l)
      size=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
      echo -e "  Logmap: ${GEEL}$LOG_DIR${RESET}"
      echo -e "  Bestanden: ${GEEL}$count${RESET}"
      echo -e "  Totaal: ${GEEL}$size${RESET}"
      echo ""
      read -rp "  Retentiedagen [7]: " dagen
      dagen="${dagen:-7}"
      read -rp "  Bestanden ouder dan $dagen dagen verwijderen? (j/n): " bevestig
      if [[ "$bevestig" =~ ^[jJ]$ ]]; then
        find "$LOG_DIR" -name "*.log" -mtime "+${dagen}" -delete 2>/dev/null
        local nieuw_count
        nieuw_count=$(find "$LOG_DIR" -name "*.log" 2>/dev/null | wc -l)
        ok "$((count - nieuw_count)) bestand(en) verwijderd"
      else
        warn "Geannuleerd."
      fi
    else
      err "Logmap niet gevonden: $LOG_DIR"
    fi
    pauze; return
  fi

  # Parse JSON output
  local total_files total_mb old_count retention
  total_files=$(echo "$info" | grep -o '"totalFiles":[0-9]*' | cut -d: -f2)
  total_mb=$(echo "$info" | grep -o '"totalMB":"[^"]*"' | cut -d'"' -f4)
  old_count=$(echo "$info" | grep -o '"oldCount":[0-9]*' | cut -d: -f2)
  retention=$(echo "$info" | grep -o '"retentionDays":[0-9]*' | cut -d: -f2)

  echo -e "  Logbestanden: ${GEEL}${total_files}${RESET}"
  echo -e "  Totale grootte: ${GEEL}${total_mb} MB${RESET}"
  echo -e "  Ouder dan ${retention} dagen: ${ROOD}${old_count}${RESET}"
  echo ""

  echo -e "  ${BOLD}Keuze:${RESET}"
  echo -e "  ${BOLD}1)${RESET} Verwijder bestanden ouder dan ${retention} dagen (${old_count} bestanden)"
  echo -e "  ${BOLD}2)${RESET} Verwijder ALLE logbestanden (${total_files} bestanden — voor troubleshooting)"
  echo -e "  ${BOLD}0)${RESET} Annuleren"
  echo ""
  read -rp "  Keuze: " lk

  case "$lk" in
    1)
      if [[ "$old_count" == "0" ]]; then
        ok "Geen oude logbestanden gevonden."
      else
        read -rp "  ${old_count} bestand(en) verwijderen? (j/n): " bevestig
        if [[ "$bevestig" =~ ^[jJ]$ ]]; then
          curl -sf -b /tmp/pycf_cookie.txt -X POST http://localhost:3000/api/admin/logs/cleanup > /dev/null 2>&1
          ok "${old_count} logbestand(en) verwijderd."
        else
          warn "Geannuleerd."
        fi
      fi
      ;;
    2)
      read -rp "  ${ROOD}ALLE ${total_files} logbestanden verwijderen?${RESET} (j/n): " bevestig
      if [[ "$bevestig" =~ ^[jJ]$ ]]; then
        curl -sf -b /tmp/pycf_cookie.txt -X POST http://localhost:3000/api/admin/logs/cleanup-all > /dev/null 2>&1
        ok "Alle logbestanden verwijderd."
      else
        warn "Geannuleerd."
      fi
      ;;
    0|*) warn "Geannuleerd." ;;
  esac
  echo ""
  pauze
}

# ═══════════════════════════════════════════════════════════════════════════════
#  HOOFDMENU
# ═══════════════════════════════════════════════════════════════════════════════

# Controleer eerste start VOOR het hoofdmenu
if is_eerste_start; then
  header
  echo -e "  ${GEEL}Geen PostgreSQL configuratie gevonden.${RESET}"
  echo -e "  ${GEEL}Eerste-start setup wordt gestart...${RESET}"
  echo ""
  sleep 2
  setup_eerste_start
fi

while true; do
  header
  echo -e "  Versie: ${GEEL}$(versie_display)${RESET}"
  echo ""
  toon_status
  echo ""
  echo -e "${BOLD}──────────────────────────────────────────────${RESET}"
  echo -e "  ${BOLD} 1)${RESET} 🔢  Versie instellen"
  echo -e "  ${BOLD} 2)${RESET} ▶   Start"
  echo -e "  ${BOLD} 3)${RESET} ■   Stop"
  echo -e "  ${BOLD} 4)${RESET} ↺   Herstart"
  echo -e "  ${BOLD} 5)${RESET} 🔨  Rebuild & herstart"
  echo -e "  ${BOLD} 6)${RESET} 📋  Logs bekijken"
  echo -e "  ${BOLD} 7)${RESET} ✅  Verificatie uitvoeren"
  echo -e "  ${BOLD} 8)${RESET} 🗄  SQLite → PostgreSQL migratie"
  echo -e "  ${BOLD} 9)${RESET} 📦  npm packages controleren"
  echo -e "  ${BOLD}10)${RESET} 👤  Leerkrachtsaccount aanmaken"
  echo -e "  ${BOLD}11)${RESET} 📊  Container resources"
  echo -e "  ${BOLD}12)${RESET} 🗑   Logs opruimen"
  echo -e "  ${BOLD}13)${RESET} 🔧  Eerste-start opnieuw uitvoeren"
  echo -e "  ${BOLD}14)${RESET} 💣  Volledige reset (verwijder alles + herinstall)"
  echo -e "  ${BOLD}15)${RESET} 🔔  Health monitor instellen (crash notificatie)"
  echo -e "  ${BOLD}16)${RESET} 💾  Database backup beheren"
  echo -e "  ${BOLD} q)${RESET} ✖   Afsluiten"
  echo ""
  echo -e "${BOLD}──────────────────────────────────────────────${RESET}"
  read -rp "  Keuze: " keuze
  echo ""

  case "$keuze" in
     1) update_versie ;;
     2) actie_start ;;
     3) actie_stop ;;
     4) actie_restart ;;
     5) actie_rebuild ;;
     6) actie_logs ;;
     7) actie_check ;;
     8) actie_migratie ;;
     9) actie_npm_check ;;
    10) actie_leerkracht ;;
    11) actie_resources ;;
    12) actie_logs_cleanup ;;
    13) setup_eerste_start ;;
    14) actie_volledige_reset ;;
    15) actie_health_monitor ;;
    16) actie_backup ;;
    q|Q) echo -e "${GROEN}Tot later!${RESET}"; echo ""; exit 0 ;;
    *) err "Ongeldige keuze."; sleep 1 ;;
  esac
done
