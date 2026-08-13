#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — Versie synchronisatie
# Leest het VERSION-bestand en propageert het nummer naar:
#   • .env (APP_VERSION_* velden + APP_VERSION)
#   • alle HTML cache-bust querystrings (?v=vX.Y.Z.B)
#
# Gebruik:
#   bash sync-version.sh            → gebruikt versie uit VERSION-bestand
#   bash sync-version.sh 2026.2.30.0 → zet nieuwe versie én schrijft die naar VERSION
#
# Dit vervangt het handmatig bijwerken van de versie via pycodeflow.sh.
# Bij een deploy: pas VERSION aan (of geef als argument), run dit script, herstart.
# ═══════════════════════════════════════════════════════════════════════════════

set -e
BASE="$(cd "$(dirname "$0")/../.." && pwd)"  # scripts/general → projectroot
VERSION_FILE="$BASE/VERSION"

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"; RESET="\033[0m"

# Versie bepalen: argument heeft voorrang, anders uit VERSION-bestand
if [[ -n "$1" ]]; then
  NEW_VERSION="$1"
  echo "$NEW_VERSION" > "$VERSION_FILE"
  echo -e "${GREEN}VERSION-bestand bijgewerkt naar $NEW_VERSION${RESET}"
elif [[ -f "$VERSION_FILE" ]]; then
  NEW_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
else
  echo -e "${RED}Geen VERSION-bestand gevonden en geen argument opgegeven.${RESET}"
  echo "Gebruik: bash sync-version.sh 2026.2.30.0"
  exit 1
fi

# Valideer formaat YYYY.MAJOR.MINOR.BUILD
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}Ongeldig versieformaat: '$NEW_VERSION' (verwacht: 2026.2.30.0)${RESET}"
  exit 1
fi

# Splits versie in onderdelen
IFS='.' read -r V_YEAR V_MAJOR V_MINOR V_BUILD <<< "$NEW_VERSION"

echo "Synchroniseren naar versie: $NEW_VERSION"
echo ""

# ── 1. .env bijwerken ─────────────────────────────────────────────────────────
if [[ -f "$BASE/.env" ]]; then
  sed -i "s/^APP_VERSION_YEAR=.*/APP_VERSION_YEAR=$V_YEAR/"   "$BASE/.env"
  sed -i "s/^APP_VERSION_MAJOR=.*/APP_VERSION_MAJOR=$V_MAJOR/" "$BASE/.env"
  sed -i "s/^APP_VERSION_MINOR=.*/APP_VERSION_MINOR=$V_MINOR/" "$BASE/.env"
  sed -i "s/^APP_VERSION_BUILD=.*/APP_VERSION_BUILD=$V_BUILD/" "$BASE/.env"
  sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW_VERSION/"         "$BASE/.env"
  echo -e "  ${GREEN}✅ .env bijgewerkt${RESET}"
else
  echo -e "  ${YELLOW}⚠️  .env niet gevonden — overgeslagen${RESET}"
fi

# ── 2. HTML cache-bust querystrings bijwerken ─────────────────────────────────
PUB="$BASE/web/public"
HTML_COUNT=0
if [[ -d "$PUB" ]]; then
  for f in "$PUB"/*.html; do
    [[ -f "$f" ]] || continue
    # Vervang ?v=v2026.2.X.Y en ?v=2026.2.X.Y door de nieuwe versie
    if grep -qE '\?v=v?[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$f"; then
      sed -i -E "s/\?v=v?[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/?v=v$NEW_VERSION/g" "$f"
      HTML_COUNT=$((HTML_COUNT+1))
    fi
  done
  echo -e "  ${GREEN}✅ $HTML_COUNT HTML-bestanden bijgewerkt (cache-bust)${RESET}"
fi

# ── 3. styles.css versie-comment (indien aanwezig) ────────────────────────────
if [[ -f "$PUB/styles.css" ]]; then
  sed -i -E "s/v?[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/v$NEW_VERSION/g" "$PUB/styles.css" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}Versie $NEW_VERSION gesynchroniseerd.${RESET}"
echo "De server leest deze versie automatisch uit het VERSION-bestand bij (her)start."
echo ""
echo "Volgende stap: herstart de web-container zodat de nieuwe versie actief wordt:"
echo "  docker compose restart web"
