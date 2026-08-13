#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — oldies-check.sh
#
# Verplaatst oude/dubbele/irrelevante bestanden naar OLDIES/v<versie>/ met behoud
# van de ORIGINELE mapstructuur. Dit is de standalone-variant van de opruiming die
# ook in de rebuild-flow (scripts/app/pycodeflow.sh → menu 5) zit.
#
# In OLDIES staat zo altijd de rommel van precies één versie terug, mocht er iets
# fout gelopen zijn. Bij een volgende opruiming maak je OLDIES leeg en komt de nieuwe
# versie-map ervoor in de plaats.
#
# Kenmerken:
#   • Idempotent  — meermaals draaien kan geen kwaad.
#   • Veilig      — verwijdert nooit iets; enkel 'mv' naar OLDIES/.
#   • Dry-run     — met `--dry-run` zie je wat er zou gebeuren.
#
# Gebruik (van waar dan ook):
#   bash scripts/general/oldies-check.sh            → voert de opruiming uit
#   bash scripts/general/oldies-check.sh --dry-run  → toont enkel wat er zou gebeuren
#   bash scripts/general/oldies-check.sh --leeg     → maakt OLDIES eerst leeg
# ═══════════════════════════════════════════════════════════════════════════════
set -u

# Projectroot = twee niveaus boven dit script (scripts/general → root).
BASE="$(cd "$(dirname "$0")/../.." && pwd)"
OLDIES="$BASE/OLDIES"

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"; BOLD="\033[1m"; RESET="\033[0m"

DRY_RUN=0; LEEGMAKEN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --leeg|--empty) LEEGMAKEN=1 ;;
  esac
done

if [[ ! -f "$BASE/VERSION" || ! -d "$BASE/web" ]]; then
  echo -e "${RED}✋ Dit lijkt geen PyCodeFlow-projectroot (VERSION of web/ ontbreekt).${RESET}"
  exit 1
fi
VERSIE="$(tr -d '[:space:]' < "$BASE/VERSION" 2>/dev/null)"; [[ -z "$VERSIE" ]] && VERSIE="onbekend"

echo -e "${BOLD}PyCodeFlow — OLDIES-opruiming (v${VERSIE})${RESET}"
[[ $DRY_RUN -eq 1 ]] && echo -e "${YELLOW}(DRY-RUN: er wordt niets verplaatst)${RESET}"
echo ""

# ── Detectie van oude/irrelevante bestanden (NIET het echte project) ──────────
detecteer() {
  local -a k=(); local f
  [[ -d "$BASE/scripts/web" ]] && k+=("scripts/web")
  [[ -f "$BASE/web/public/sprintlog.md" ]] && k+=("web/public/sprintlog.md")
  while IFS= read -r f; do k+=("${f#"$BASE"/}"); done \
    < <(find "$BASE" -maxdepth 1 -type f -regextype posix-extended -regex '.*/\([0-9]+\).*' 2>/dev/null)
  while IFS= read -r f; do k+=("${f#"$BASE"/}"); done \
    < <(find "$BASE" -path "$OLDIES" -prune -o -name "*.ug-tmp" -type f -print 2>/dev/null)
  while IFS= read -r f; do k+=("${f#"$BASE"/}"); done \
    < <(find "$BASE" -path "$OLDIES" -prune -o \( -name ".DS_Store" -o -name "Thumbs.db" \) -type f -print 2>/dev/null)
  while IFS= read -r f; do k+=("${f#"$BASE"/}"); done \
    < <(find "$BASE" -maxdepth 1 -type f \( -name "*.md" -o -name "*.pdf" \) 2>/dev/null)
  while IFS= read -r f; do k+=("${f#"$BASE"/}"); done \
    < <(find "$BASE" -maxdepth 1 -type f \( -name "*.sh" -o -name "*.ps1" -o -name "*.py" \) 2>/dev/null)
  printf '%s\n' "${k[@]}" | awk 'NF' | sort -u
}

# ── Optioneel: OLDIES eerst leegmaken ─────────────────────────────────────────
if [[ $LEEGMAKEN -eq 1 && -d "$OLDIES" && -n "$(ls -A "$OLDIES" 2>/dev/null)" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo -e "  ${YELLOW}zou OLDIES leegmaken${RESET}"
  else
    rm -rf "$OLDIES"/* "$OLDIES"/.[!.]* 2>/dev/null
    echo -e "  ${GREEN}OLDIES leeggemaakt${RESET}"
  fi
  echo ""
fi

# ── Verplaatsen ───────────────────────────────────────────────────────────────
MOVED=0
mapfile -t KANDIDATEN < <(detecteer)
if [[ ${#KANDIDATEN[@]} -eq 0 ]]; then
  echo -e "  ${GREEN}Geen oude/irrelevante bestanden gevonden.${RESET}"
else
  for rel in "${KANDIDATEN[@]}"; do
    src="$BASE/$rel"; [[ -e "$src" ]] || continue
    dest="$OLDIES/v${VERSIE}/$rel"
    if [[ $DRY_RUN -eq 1 ]]; then
      echo -e "  ${YELLOW}zou verplaatsen:${RESET} $rel → OLDIES/v${VERSIE}/$rel"
    else
      mkdir -p "$(dirname "$dest")"
      if mv "$src" "$dest" 2>/dev/null; then
        echo -e "  ${GREEN}verplaatst:${RESET} $rel → OLDIES/v${VERSIE}/$rel"
      else
        echo -e "  ${RED}MISLUKT:${RESET} $rel"
      fi
    fi
    MOVED=$((MOVED+1))
  done
fi

echo ""
if [[ $DRY_RUN -eq 1 ]]; then
  echo -e "${BOLD}Dry-run:${RESET} ${MOVED} item(s) zouden verplaatst worden naar OLDIES/v${VERSIE}/."
else
  echo -e "${BOLD}Klaar.${RESET} ${GREEN}${MOVED} item(s) verplaatst${RESET} naar OLDIES/v${VERSIE}/ (structuur behouden)."
fi
