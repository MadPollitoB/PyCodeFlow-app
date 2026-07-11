#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PyCodeFlow — Lokale CI: syntax-checks + unit tests + sandbox tests
# Sprint 34b: draai dit vóór elke deploy (of via de CI-pipeline).
#
# Gebruik:  bash run-tests.sh
# Exit-code 0 = alles OK, ≠0 = er faalde iets (deploy niet doorzetten).
# ═══════════════════════════════════════════════════════════════════════════════
set -u
BASE="$(cd "$(dirname "$0")" && pwd)"
WEB="$BASE/web"
RUNNER="$BASE/runner"

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"; BOLD="\033[1m"; RESET="\033[0m"
FAILED=0

section() { echo -e "\n${BOLD}$1${RESET}"; }
pass()    { echo -e "  ${GREEN}✅ $1${RESET}"; }
fail()    { echo -e "  ${RED}❌ $1${RESET}"; FAILED=1; }

echo "═══════════════════════════════════════════════════════════"
echo "  PyCodeFlow — Testrun $(date '+%d/%m/%Y %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════"

# ── 1. JS syntax-checks ───────────────────────────────────────────────────────
section "1. JavaScript syntax-checks"
# 32a: ook de geëxtraheerde pagina-scripts checken
for f in "$WEB/server.js" "$WEB/public/app.js" \
         "$WEB/lib/auth.js" "$WEB/lib/scoring.js" "$WEB/lib/validation.js" "$WEB/lib/logger.js" "$WEB/lib/review-token.js" \
         "$WEB/scripts/manage-teacher.js" \
         "$WEB"/public/monitoring.js "$WEB"/public/quiz-bank.js "$WEB"/public/quiz-student.js \
         "$WEB"/public/quiz-review.js "$WEB"/public/quiz-teacher.js "$WEB"/public/quiz-archive.js \
         "$WEB"/public/admin.js "$WEB"/public/teacher-grid.js "$WEB"/public/teacher-login.js; do
  if [[ ! -f "$f" ]]; then
    fail "$(basename "$f") — bestand ONTBREEKT (niet gedeployed?)"
  elif node --check "$f" 2>/dev/null; then
    pass "$(basename "$f")"
  else
    fail "$(basename "$f") — syntaxfout"
  fi
done

# ── 2. Inline HTML-scripts syntax ─────────────────────────────────────────────
section "2. Inline HTML-scripts"
# Schrijf de checker eenmalig weg — toont exacte fout + regel bij falen
cat > /tmp/_check_inline.js <<'CHECKEOF'
const fs = require('fs');
const vm = require('vm');
const c = fs.readFileSync(process.argv[2], 'utf8');
// Bepaal de regel-offset van elk <script>-blok in het bronbestand
const blocks = [];
const re = /<script>\s*\n([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(c)) !== null) {
  const before = c.slice(0, m.index);
  const startLine = before.split('\n').length; // 1-based regel van <script>
  blocks.push({ code: m[1], startLine });
}
if (blocks.length === 0) { process.stdout.write('NONE'); process.exit(0); }
let firstErr = null;
for (const b of blocks) {
  try {
    new vm.Script(b.code, { filename: process.argv[2] });
  } catch (e) {
    if (!firstErr) {
      // Probeer het regelnummer binnen het blok te achterhalen
      const lineMatch = (e.stack || '').match(/:(\d+)\)?\n/);
      const blockLine = lineMatch ? parseInt(lineMatch[1], 10) : null;
      const fileLine = blockLine ? (b.startLine + blockLine) : null;
      firstErr = e.message + (fileLine ? ` (rond bestandsregel ${fileLine})` : '');
    }
  }
}
process.stdout.write(firstErr ? 'FAIL::' + firstErr : 'OK');
CHECKEOF
for html in "$WEB"/public/*.html; do
  name=$(basename "$html")
  RESULT=$(node /tmp/_check_inline.js "$html" 2>/dev/null)
  if [[ "$RESULT" == "OK" ]]; then
    pass "$name (inline script)"
  elif [[ "$RESULT" == "NONE" ]]; then
    : # geen inline script
  elif [[ "$RESULT" == FAIL::* ]]; then
    fail "$name — ${RESULT#FAIL::}"
  else
    fail "$name — inline script syntaxfout"
  fi
done

# ── 3. Unit tests (node:test) ─────────────────────────────────────────────────
section "3. Unit tests (node:test)"
if [[ ! -d "$WEB/tests" ]]; then
  fail "tests/ map ONTBREEKT — niet gedeployed? (sprint 34)"
elif (cd "$WEB" && node --test 2>&1 | tail -8 | grep -q "# fail 0"); then
  pass "Alle unit tests geslaagd"
  (cd "$WEB" && node --test 2>&1 | grep -E "# (tests|pass|fail)" | sed 's/^/    /')
else
  fail "Unit tests gefaald"
  (cd "$WEB" && node --test 2>&1 | grep -E "not ok|# fail" | head -10 | sed 's/^/    /')
fi

# ── 4. Sandbox-tests (Python) ─────────────────────────────────────────────────
section "4. Runner sandbox-tests"
if [[ ! -f "$RUNNER/test_sandbox.py" ]]; then
  fail "runner/test_sandbox.py ONTBREEKT — niet gedeployed? (sprint 34)"
elif command -v python3 >/dev/null 2>&1; then
  if (cd "$RUNNER" && python3 -m unittest test_sandbox 2>&1 | grep -q "^OK"); then
    pass "Sandbox-tests geslaagd"
  else
    fail "Sandbox-tests gefaald"
  fi
else
  echo -e "  ${YELLOW}⚠️  python3 niet gevonden — sandbox-tests overgeslagen${RESET}"
fi

# ── 5. npm audit (indien node_modules aanwezig) ───────────────────────────────
section "5. Dependency audit"
if [[ -d "$WEB/node_modules" ]]; then
  AUDIT=$(cd "$WEB" && npm audit --production 2>/dev/null | grep -E "found|vulnerabilities" | head -1)
  if echo "$AUDIT" | grep -qE "found 0|0 vulnerabilities"; then
    pass "Geen kwetsbaarheden"
  else
    echo -e "  ${YELLOW}⚠️  ${AUDIT:-audit niet beschikbaar}${RESET}"
  fi
else
  echo -e "  ${YELLOW}⚠️  node_modules niet aanwezig — audit overgeslagen${RESET}"
fi

# ── Samenvatting ──────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
if [[ $FAILED -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}✅ Alle checks geslaagd — klaar om te deployen.${RESET}"
else
  echo -e "  ${RED}${BOLD}❌ Er faalden checks — deploy NIET doorzetten.${RESET}"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
exit $FAILED
