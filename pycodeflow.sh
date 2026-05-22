#!/bin/bash
# ═══════════════════════════════════════════════════════
#  PyCodeFlow — Beheertool
#  Gebruik: bash pycodeflow.sh
# ═══════════════════════════════════════════════════════

BASE="/volume3/docker/pycodeflow"
ENV_FILE="$BASE/.env"
COMPOSE="docker compose -f $BASE/docker-compose.yml -f $BASE/docker-compose.prod.yml"

# Kleuren
BLAUW='\033[1;34m'
GROEN='\033[1;32m'
GEEL='\033[1;33m'
ROOD='\033[1;31m'
RESET='\033[0m'
BOLD='\033[1m'

# ── Helpers ──────────────────────────────────────────────
header() {
  clear
  echo -e "${BLAUW}╔══════════════════════════════════════════╗${RESET}"
  echo -e "${BLAUW}║   🐍  PyCodeFlow — Beheertool            ║${RESET}"
  echo -e "${BLAUW}╚══════════════════════════════════════════╝${RESET}"
  echo ""
}

get_env_var() {
  grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"'
}

set_env_var() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

get_versie_display() {
  local jaar major minor build
  jaar=$(get_env_var "APP_VERSION_YEAR")
  major=$(get_env_var "APP_VERSION_MAJOR")
  minor=$(get_env_var "APP_VERSION_MINOR")
  build=$(get_env_var "APP_VERSION_BUILD")
  # Fallback naar APP_VERSION als losse vars ontbreken
  if [[ -z "$jaar" ]]; then
    get_env_var "APP_VERSION"
  else
    echo "${jaar}.${major}.${minor}.${build}"
  fi
}

kleur_status() {
  case "$1" in
    running)  echo -e "${GROEN}● running${RESET}" ;;
    exited)   echo -e "${ROOD}● gestopt${RESET}" ;;
    *)        echo -e "${GEEL}● $1${RESET}" ;;
  esac
}

toon_status() {
  local web runner
  web=$(docker inspect --format='{{.State.Status}}' pycodeflow-web-1 2>/dev/null || echo "niet gevonden")
  runner=$(docker inspect --format='{{.State.Status}}' pycodeflow-runner-1 2>/dev/null || echo "niet gevonden")
  echo -e "  ${BOLD}web:${RESET}    $(kleur_status "$web")"
  echo -e "  ${BOLD}runner:${RESET} $(kleur_status "$runner")"
}

# ── Versie updaten ──────────────────────────────────────
update_versie() {
  header
  echo -e "${BOLD}── Versie instellen ─────────────────────────${RESET}"
  echo ""

  # Lees huidige waarden
  local v_jaar v_major v_minor v_build
  v_jaar=$(get_env_var "APP_VERSION_YEAR")
  v_major=$(get_env_var "APP_VERSION_MAJOR")
  v_minor=$(get_env_var "APP_VERSION_MINOR")
  v_build=$(get_env_var "APP_VERSION_BUILD")

  # Fallback: parse APP_VERSION als losse vars ontbreken
  if [[ -z "$v_jaar" ]]; then
    local full
    full=$(get_env_var "APP_VERSION")
    IFS='.' read -r v_jaar v_major v_minor v_build <<< "$full"
  fi

  # Defaults
  v_jaar="${v_jaar:-2026}"
  v_major="${v_major:-2}"
  v_minor="${v_minor:-7}"
  v_build="${v_build:-13}"

  echo -e "  Huidige versie: ${GEEL}${v_jaar}.${v_major}.${v_minor}.${v_build}${RESET}"
  echo -e "  Druk Enter om de huidige waarde te behouden."
  echo ""

  local n_jaar n_major n_minor n_build
  read -rp "  Jaar    [${v_jaar}]  : " n_jaar
  read -rp "  Major   [${v_major}]  : " n_major
  read -rp "  Minor   [${v_minor}]  : " n_minor
  read -rp "  Build   [${v_build}]  : " n_build

  n_jaar="${n_jaar:-$v_jaar}"
  n_major="${n_major:-$v_major}"
  n_minor="${n_minor:-$v_minor}"
  n_build="${n_build:-$v_build}"

  local nieuwe="${n_jaar}.${n_major}.${n_minor}.${n_build}"
  echo ""
  echo -e "  Nieuwe versie: ${GROEN}${nieuwe}${RESET}"
  echo ""
  read -rp "  Bevestigen? (j/n) : " bevestig

  if [[ "$bevestig" =~ ^[jJ]$ ]]; then
    set_env_var "APP_VERSION_YEAR"  "$n_jaar"
    set_env_var "APP_VERSION_MAJOR" "$n_major"
    set_env_var "APP_VERSION_MINOR" "$n_minor"
    set_env_var "APP_VERSION_BUILD" "$n_build"
    set_env_var "APP_VERSION"       "$nieuwe"
    echo ""
    echo -e "  ${GROEN}✓ Versie bijgewerkt naar ${nieuwe}${RESET}"
  else
    echo -e "  ${GEEL}Geannuleerd.${RESET}"
  fi

  echo ""
  read -rp "  Druk Enter om terug te gaan..." _
}

# ── Acties ───────────────────────────────────────────────
actie_start() {
  header
  echo -e "${BOLD}── Start PyCodeFlow ──────────────────────────${RESET}"
  echo ""
  $COMPOSE --project-directory "$BASE" up -d
  echo ""
  echo -e "${GROEN}✓ Gestart.${RESET}"
  echo ""
  read -rp "  Druk Enter om terug te gaan..." _
}

actie_stop() {
  header
  echo -e "${BOLD}── Stop PyCodeFlow ───────────────────────────${RESET}"
  echo ""
  $COMPOSE --project-directory "$BASE" down
  echo ""
  echo -e "${GEEL}✓ Gestopt.${RESET}"
  echo ""
  read -rp "  Druk Enter om terug te gaan..." _
}

actie_restart() {
  header
  echo -e "${BOLD}── Herstart PyCodeFlow ───────────────────────${RESET}"
  echo ""
  echo -e "  ${GEEL}Stoppen...${RESET}"
  $COMPOSE --project-directory "$BASE" down
  echo ""
  echo -e "  ${GEEL}Starten...${RESET}"
  $COMPOSE --project-directory "$BASE" up -d
  echo ""
  echo -e "${GROEN}✓ Herstart voltooid.${RESET}"
  echo ""
  read -rp "  Druk Enter om terug te gaan..." _
}

actie_rebuild() {
  header
  echo -e "${BOLD}── Rebuild & Herstart PyCodeFlow ─────────────${RESET}"
  echo ""
  echo -e "  ${GEEL}Build en herstart (duurt even)...${RESET}"
  echo ""
  $COMPOSE --project-directory "$BASE" up --build -d
  echo ""
  echo -e "${GROEN}✓ Rebuild voltooid.${RESET}"
  echo ""
  read -rp "  Druk Enter om terug te gaan..." _
}

actie_logs() {
  header
  echo -e "${BOLD}── Logs ──────────────────────────────────────${RESET}"
  echo ""
  echo -e "  1) Web container (live)"
  echo -e "  2) Runner container (live)"
  echo -e "  3) Beide containers (live)"
  echo -e "  4) Web — laatste 50 regels"
  echo -e "  5) Runner — laatste 50 regels"
  echo -e "  0) Terug"
  echo ""
  read -rp "  Keuze: " log_keuze
  echo ""
  case "$log_keuze" in
    1) $COMPOSE --project-directory "$BASE" logs -f web ;;
    2) $COMPOSE --project-directory "$BASE" logs -f runner ;;
    3) $COMPOSE --project-directory "$BASE" logs -f ;;
    4) $COMPOSE --project-directory "$BASE" logs --tail=50 web ; read -rp "  Druk Enter..." _ ;;
    5) $COMPOSE --project-directory "$BASE" logs --tail=50 runner ; read -rp "  Druk Enter..." _ ;;
    0) return ;;
    *) echo -e "${ROOD}Ongeldige keuze.${RESET}" ; sleep 1 ;;
  esac
}

actie_check() {
  header
  echo -e "${BOLD}── Verificatie (check-deployment.sh) ────────${RESET}"
  echo ""
  if [[ -f "$BASE/check-deployment.sh" ]]; then
    bash "$BASE/check-deployment.sh"
  else
    echo -e "${ROOD}  check-deployment.sh niet gevonden in $BASE${RESET}"
  fi
  echo ""
  read -rp "  Druk Enter om terug te gaan..." _
}

# ══ HOOFDMENU ════════════════════════════════════════════
while true; do
  header
  echo -e "  Versie: ${GEEL}$(get_versie_display)${RESET}"
  echo ""
  toon_status
  echo ""
  echo -e "${BOLD}──────────────────────────────────────────────${RESET}"
  echo -e "  ${BOLD}1)${RESET} 🔢  Versie instellen"
  echo -e "  ${BOLD}2)${RESET} ▶   Start"
  echo -e "  ${BOLD}3)${RESET} ■   Stop"
  echo -e "  ${BOLD}4)${RESET} ↺   Herstart"
  echo -e "  ${BOLD}5)${RESET} 🔨  Rebuild & herstart"
  echo -e "  ${BOLD}6)${RESET} 📋  Logs bekijken"
  echo -e "  ${BOLD}7)${RESET} ✅  Verificatie uitvoeren"
  echo -e "  ${BOLD}q)${RESET} ✖   Afsluiten"
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
    q|Q) echo -e "${GROEN}Tot later!${RESET}"; echo ""; exit 0 ;;
    *) echo -e "${ROOD}  Ongeldige keuze.${RESET}"; sleep 1 ;;
  esac
done
