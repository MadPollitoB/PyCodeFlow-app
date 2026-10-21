'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// v2026.2.51.125 — Trainingscenter: hulp per niveau (pure logica, geen databank/Express).
//   niveau 1-3 : hoofdstuk + kernwoorden + checklist (knop "Check", 1× gratis)
//   niveau 4-5 : hoofdstuk (zonder kernwoorden) + hints (1e gratis, 2e kost score)
//   niveau 6+  : geen hulp
// De server beslist wat een leerling krijgt; de regels van de checks en de hinttekst gaan
// nooit mee met de vraag zelf.
// ═══════════════════════════════════════════════════════════════════════════════

const CHECKLIST_TOT = 3;     // t.e.m. dit niveau: checklist + kernwoorden
const HINTS_TOT = 5;         // t.e.m. dit niveau: hints
const STRAF_PER_EXTRA = 0.1; // elke extra check/hint (na de eerste gratis) kost 10 procentpunten
const MAX_HINTS = 2;
const MAX_KERNWOORDEN = 4;
const MAX_CHECKS = 6;
const CHECK_SOORTEN = ['bevat', 'niet_bevat', 'aantal_input', 'test'];

// Cursus: https://cursus.pycodeflow.org (25 hoofdstukken in 10 delen)
const CURSUS_BASIS = 'https://cursus.pycodeflow.org/';
const CURSUS = [
  { id: 'h1',  nr: 1,  deel: 1,  titel: 'Stroomdiagrammen',            pad: 'h1-stroomdiagrammen.html' },
  { id: 'h2',  nr: 2,  deel: 1,  titel: 'print & input',               pad: 'h2-print-input.html' },
  { id: 'h3',  nr: 3,  deel: 1,  titel: 'Variabelen',                  pad: 'h3-variabelen.html' },
  { id: 'h4',  nr: 4,  deel: 1,  titel: 'Datatypes',                   pad: 'h4-datatypes.html' },
  { id: 'h5',  nr: 5,  deel: 1,  titel: 'Wiskundige expressies',       pad: 'h5-expressies.html' },
  { id: 'h6',  nr: 6,  deel: 2,  titel: 'Beslissingen',                pad: 'h6-beslissingen.html' },
  { id: 'h7',  nr: 7,  deel: 2,  titel: 'Herhaling',                   pad: 'h7-herhaling.html' },
  { id: 'h8',  nr: 8,  deel: 3,  titel: 'Foutmeldingen',               pad: 'h8-foutmeldingen.html' },
  { id: 'h9',  nr: 9,  deel: 3,  titel: 'Debuggen',                    pad: 'h9-debuggen.html' },
  { id: 'h10', nr: 10, deel: 4,  titel: 'Lijsten',                     pad: 'h10-lijsten.html' },
  { id: 'h11', nr: 11, deel: 4,  titel: 'Dictionaries',                pad: 'h11-dictionaries.html' },
  { id: 'h12', nr: 12, deel: 5,  titel: 'De module math',              pad: 'h12-math.html' },
  { id: 'h13', nr: 13, deel: 5,  titel: 'Willekeur met random',        pad: 'h13-random.html' },
  { id: 'h14', nr: 14, deel: 6,  titel: 'Bestanden lezen & schrijven', pad: 'h14-bestanden-lezen-schrijven.html' },
  { id: 'h15', nr: 15, deel: 6,  titel: 'Werken met CSV',              pad: 'h15-csv.html' },
  { id: 'h16', nr: 16, deel: 7,  titel: 'Klassen & objecten',          pad: 'h16-klassen-objecten.html' },
  { id: 'h17', nr: 17, deel: 7,  titel: 'Methodes',                    pad: 'h17-methodes.html' },
  { id: 'h18', nr: 18, deel: 8,  titel: 'Functies definiëren',         pad: 'h18-functies-definieren.html' },
  { id: 'h19', nr: 19, deel: 8,  titel: 'Parameters & scope',          pad: 'h19-parameters-scope.html' },
  { id: 'h20', nr: 20, deel: 8,  titel: 'Eigen bibliotheken maken',    pad: 'h20-eigen-bibliotheken.html' },
  { id: 'h21', nr: 21, deel: 9,  titel: 'Databases & SQL',             pad: 'h21-databases-sql.html' },
  { id: 'h22', nr: 22, deel: 9,  titel: 'SQLite vanuit Python',        pad: 'h22-sqlite-python.html' },
  { id: 'h23', nr: 23, deel: 10, titel: 'Van idee naar plan',          pad: 'h23-van-idee-naar-plan.html' },
  { id: 'h24', nr: 24, deel: 10, titel: 'Bouwen in stappen',           pad: 'h24-bouwen-in-stappen.html' },
  { id: 'h25', nr: 25, deel: 10, titel: 'Afwerken & verdedigen',       pad: 'h25-afwerken-verdedigen.html' },
].map(h => ({ ...h, url: CURSUS_BASIS + h.pad }));

// Standaard hoofdstuk per trainingsonderwerp (een vraag kan dit overschrijven met "chapter").
const ONDERWERP_HOOFDSTUK = {
  'stroomdiagrammen': 'h1', 'print-input': 'h2', 'variabelen': 'h3', 'datatypes': 'h4',
  'expressies': 'h5', 'beslissingen': 'h6', 'herhaling': 'h7', 'foutmeldingen': 'h8', 'debuggen': 'h9',
};

function hoofdstukVan(id) { return CURSUS.find(h => h.id === id) || null; }
function hoofdstukVoorVraag(q) {
  return hoofdstukVan(q && q.chapter) || hoofdstukVan(ONDERWERP_HOOFDSTUK[q && q.topic]) || null;
}

// ── v107: hulpinstellingen (per klas aanpasbaar) ─────────────────────────────────────────
const STANDAARD_HULP = Object.freeze({
  aan: true,            // hulp in de training aan/uit
  gratisChecks: 1,      // aantal gratis checks per vraag (niveau met checklist)
  gratisHints: 1,       // aantal gratis hints per vraag (0, 1 of 2)
  strafPct: 10,         // score-aftrek (procentpunten) per extra check/hint
  checklistTot: CHECKLIST_TOT,  // checklist + kernwoorden t.e.m. dit niveau (0 = nooit)
  hintsTot: HINTS_TOT,          // hints t.e.m. dit niveau
});

// Controleert/normaliseert een (gedeeltelijk) hulpobject. Geeft { cfg, fouten }.
function normaliseerHulpCfg(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fouten = [];
  const geheel = (naam, min, max, label) => {
    if (r[naam] == null || r[naam] === '') return STANDAARD_HULP[naam];
    const n = Number(r[naam]);
    if (!Number.isInteger(n) || n < min || n > max) { fouten.push(`${label} moet een geheel getal van ${min} tot ${max} zijn.`); return STANDAARD_HULP[naam]; }
    return n;
  };
  const cfg = {
    aan: r.aan == null ? STANDAARD_HULP.aan : (r.aan === true || r.aan === 'true' || r.aan === 1),
    gratisChecks: geheel('gratisChecks', 0, MAX_CHECKS, 'Gratis checks'),
    gratisHints: geheel('gratisHints', 0, MAX_HINTS, 'Gratis hints'),
    strafPct: geheel('strafPct', 0, 50, 'De aftrek'),
    checklistTot: geheel('checklistTot', 0, 10, 'Checklist tot niveau'),
    hintsTot: geheel('hintsTot', 0, 10, 'Hints tot niveau'),
  };
  if (cfg.hintsTot < cfg.checklistTot) cfg.hintsTot = cfg.checklistTot;
  return { cfg, fouten };
}

// Een leerling in meerdere klassen krijgt de ruimste regeling (meeste gratis hulp, laagste aftrek).
function effectieveHulpCfg(lijst) {
  const l = (lijst || []).map(x => normaliseerHulpCfg(x).cfg);
  if (!l.length) return { ...STANDAARD_HULP };
  if (l.length === 1) return l[0];
  return {
    aan: l.some(x => x.aan),
    gratisChecks: Math.max(...l.map(x => x.gratisChecks)),
    gratisHints: Math.max(...l.map(x => x.gratisHints)),
    strafPct: Math.min(...l.map(x => x.strafPct)),
    checklistTot: Math.max(...l.map(x => x.checklistTot)),
    hintsTot: Math.max(...l.map(x => x.hintsTot)),
  };
}
const hulpCfgVan = state => normaliseerHulpCfg((state && state.hulpCfg) || {}).cfg;

// 'checklist' | 'hints' | 'geen'
function hulpSoort(niveau, cfg) {
  const c = cfg || STANDAARD_HULP;
  if (c.aan === false) return 'geen';
  const n = Number(niveau);
  if (n >= 1 && n <= c.checklistTot) return 'checklist';
  if (n >= 1 && n <= c.hintsTot) return 'hints';
  return 'geen';
}

const tekst = (x, max) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, max);

// Controleert en normaliseert de hulpvelden van één vraag (import). Geeft { fouten, hulp }.
function valideerHulp(v) {
  const fouten = [];
  const hulp = { chapter: '', keywords: [], hints: [], checks: [] };
  if (v.chapter != null && v.chapter !== '') {
    if (!hoofdstukVan(String(v.chapter))) fouten.push(`"chapter" moet h1 tot h25 zijn (kreeg "${tekst(v.chapter, 20)}").`);
    else hulp.chapter = String(v.chapter);
  }
  if (v.keywords != null) {
    if (!Array.isArray(v.keywords)) fouten.push('"keywords" moet een lijst zijn.');
    else {
      hulp.keywords = v.keywords.map(k => tekst(k, 40)).filter(Boolean);
      if (hulp.keywords.length > MAX_KERNWOORDEN) fouten.push(`Maximaal ${MAX_KERNWOORDEN} kernwoorden.`);
    }
  }
  if (v.hints != null) {
    if (!Array.isArray(v.hints)) fouten.push('"hints" moet een lijst zijn.');
    else {
      hulp.hints = v.hints.map(h => tekst(h, 300)).filter(Boolean);
      if (hulp.hints.length > MAX_HINTS) fouten.push(`Maximaal ${MAX_HINTS} hints.`);
    }
  }
  if (v.checks != null) {
    if (!Array.isArray(v.checks)) fouten.push('"checks" moet een lijst zijn.');
    else if (v.type !== 'code' && v.checks.length) fouten.push('"checks" kan enkel bij een codevraag.');
    else if (v.checks.length > MAX_CHECKS) fouten.push(`Maximaal ${MAX_CHECKS} checks.`);
    else {
      const aantalTests = Array.isArray(v.tests) ? v.tests.length : 0;
      v.checks.forEach((c, i) => {
        const label = tekst(c && c.label, 90);
        const kind = tekst(c && c.kind, 20);
        if (!label) { fouten.push(`Check ${i + 1}: "label" ontbreekt.`); return; }
        if (!CHECK_SOORTEN.includes(kind)) { fouten.push(`Check ${i + 1}: "kind" moet ${CHECK_SOORTEN.join(', ')} zijn.`); return; }
        const uit = { label, kind };
        if (kind === 'bevat' || kind === 'niet_bevat') {
          const p = String(c.pattern == null ? '' : c.pattern).slice(0, 200);
          if (!p) { fouten.push(`Check ${i + 1}: "pattern" ontbreekt.`); return; }
          try { new RegExp(p); } catch (e) { fouten.push(`Check ${i + 1}: ongeldig "pattern" (${e.message}).`); return; }
          uit.pattern = p;
        } else if (kind === 'aantal_input') {
          const n = Number(c.n);
          if (!Number.isInteger(n) || n < 0 || n > 20) { fouten.push(`Check ${i + 1}: "n" moet een geheel getal 0-20 zijn.`); return; }
          uit.n = n;
        } else if (kind === 'test') {
          const idx = Number(c.index);
          if (!Number.isInteger(idx) || idx < 0 || idx >= aantalTests) { fouten.push(`Check ${i + 1}: "index" verwijst naar een onbestaande test.`); return; }
          uit.index = idx;
        }
        hulp.checks.push(uit);
      });
    }
  }
  return { fouten, hulp };
}

// Standaardchecklist voor een codevraag zonder eigen checks: afgeleid uit de testgevallen.
function standaardChecks(tests) {
  const t = Array.isArray(tests) ? tests : [];
  const checks = [];
  const n = t.length && Array.isArray(t[0].input) ? t[0].input.length : 0;
  if (n > 0) checks.push({ label: n === 1 ? 'Je programma vraagt 1 invoer met input()' : `Je programma vraagt ${n} invoeren met input()`, kind: 'aantal_input', n });
  checks.push({ label: 'Je gebruikt print()', kind: 'bevat', pattern: '\\bprint\\s*\\(' });
  t.slice(0, 3).forEach((_, i) => checks.push({ label: t.length === 1 ? 'De uitvoer klopt' : `De uitvoer klopt bij voorbeeld ${i + 1}`, kind: 'test', index: i }));
  return checks;
}

function checksVan(q) {
  return (q.checks && q.checks.length) ? q.checks : standaardChecks(q.tests);
}

// Wat de leerling bij de vraag te zien krijgt (nooit de regels of hintteksten zelf).
function hulpVoorLeerling(q, cfg) {
  const c = cfg || STANDAARD_HULP;
  const soort = hulpSoort(q.level, c);
  if (soort === 'geen') return null;
  const h = hoofdstukVoorVraag(q);
  const uit = {
    soort,
    hoofdstuk: h ? { nr: h.nr, titel: h.titel, url: h.url } : null,
    kernwoorden: [], checks: [], aantalHints: 0,
    gratisChecks: c.gratisChecks, gratisHints: c.gratisHints, strafPct: c.strafPct,
  };
  if (soort === 'checklist') {
    uit.kernwoorden = (q.keywords || []).slice(0, MAX_KERNWOORDEN);
    if (q.type === 'code') uit.checks = checksVan(q).map((c, i) => ({ id: i, label: c.label }));
  } else if (soort === 'hints') {
    uit.aantalHints = Math.min(MAX_HINTS, (q.hints || []).length);
  }
  return uit;
}

// Evaluatie van de checks. Statisch = op de code; 'test' en 'aantal_input' komen uit echte uitvoeringen.
// uitvoeringen: { aantalInvoer: number|null, tests: [{ ok } | undefined, ...] }
function evalueerChecks(checks, code, uitvoeringen) {
  const c = String(code == null ? '' : code);
  const u = uitvoeringen || {};
  const heeftCode = !!c.trim();
  return checks.map((chk, id) => {
    let ok = false;
    if (heeftCode) {
      if (chk.kind === 'bevat' || chk.kind === 'niet_bevat') {
        let treft = false;
        try { treft = new RegExp(chk.pattern, 'm').test(c); } catch (e) { treft = false; }
        ok = chk.kind === 'bevat' ? treft : !treft;
      } else if (chk.kind === 'aantal_input') {
        ok = typeof u.aantalInvoer === 'number' && u.aantalInvoer === chk.n;
      } else if (chk.kind === 'test') {
        ok = !!(u.tests && u.tests[chk.index] && u.tests[chk.index].ok);
      }
    }
    return { id, ok };
  });
}

// Welke testgevallen moeten gedraaid worden om deze checks te kunnen beoordelen (spaart runner-capaciteit).
function nodigeTests(checks) {
  const idx = new Set();
  for (const c of checks) {
    if (c.kind === 'test') idx.add(c.index);
    if (c.kind === 'aantal_input') idx.add(0);
  }
  return [...idx].sort((a, b) => a - b);
}

// Score na aftrek voor extra hulp. gebruik = { checks, hints } (aantal keer gebruikt).
function hulpStraf(niveau, gebruik, cfg) {
  const g = gebruik || {};
  const c = cfg || STANDAARD_HULP;
  const soort = hulpSoort(niveau, c);
  let extra = 0;
  if (soort === 'checklist') extra = Math.max(0, (g.checks || 0) - c.gratisChecks);
  else if (soort === 'hints') extra = Math.max(0, (g.hints || 0) - c.gratisHints);
  return Math.min(1, Math.round(extra * (c.strafPct / 100) * 100) / 100);
}
function scoreNaStraf(score, straf) {
  if (!(score > 0) || !(straf > 0)) return score;
  return Math.max(0, Math.round((score - straf) * 100) / 100);
}

module.exports = {
  CHECKLIST_TOT, HINTS_TOT, STRAF_PER_EXTRA, STANDAARD_HULP, normaliseerHulpCfg, effectieveHulpCfg, hulpCfgVan, MAX_HINTS, MAX_KERNWOORDEN, MAX_CHECKS, CHECK_SOORTEN,
  CURSUS, ONDERWERP_HOOFDSTUK, hoofdstukVan, hoofdstukVoorVraag,
  hulpSoort, valideerHulp, standaardChecks, checksVan, hulpVoorLeerling,
  evalueerChecks, nodigeTests, hulpStraf, scoreNaStraf,
};
