// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 41 — Unit tests: schooljaar-selector + read-only gearchiveerde jaren
//
// De DB-functies vereisen PostgreSQL; hier testen we de LOGICA: welke jaren als
// gearchiveerd/read-only gelden, en de beslisregel die schrijfacties weigert.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ── getSchoolYears: aggregatie per jaar (all_archived via bool_and) ───────────
// Replica van de aggregatielogica.
function aggregateYears(classes) {
  const byYear = new Map();
  for (const c of classes) {
    if (!byYear.has(c.school_year)) byYear.set(c.school_year, []);
    byYear.get(c.school_year).push(c);
  }
  return [...byYear.entries()]
    .map(([schoolYear, cs]) => ({
      schoolYear,
      allArchived: cs.every(c => c.archived === true),
      classCount: cs.length,
    }))
    .sort((a, b) => b.schoolYear.localeCompare(a.schoolYear));
}

test('jaar met alle klassen gearchiveerd → allArchived true', () => {
  const years = aggregateYears([
    { school_year: '2023-2024', archived: true },
    { school_year: '2023-2024', archived: true },
  ]);
  assert.strictEqual(years[0].allArchived, true);
});

test('jaar met minstens één actieve klas → allArchived false', () => {
  const years = aggregateYears([
    { school_year: '2024-2025', archived: true },
    { school_year: '2024-2025', archived: false },
  ]);
  assert.strictEqual(years[0].allArchived, false);
});

test('jaren gesorteerd, nieuwste eerst', () => {
  const years = aggregateYears([
    { school_year: '2023-2024', archived: false },
    { school_year: '2025-2026', archived: false },
    { school_year: '2024-2025', archived: false },
  ]);
  assert.deepStrictEqual(years.map(y => y.schoolYear),
    ['2025-2026', '2024-2025', '2023-2024']);
});

test('classCount telt de klassen per jaar', () => {
  const years = aggregateYears([
    { school_year: '2024-2025', archived: false },
    { school_year: '2024-2025', archived: false },
    { school_year: '2024-2025', archived: true },
  ]);
  assert.strictEqual(years[0].classCount, 3);
});

// ── Read-only beslisregel (server) ────────────────────────────────────────────
// isClassArchived → null (bestaat niet) | true | false.
// De endpoint-regel: null → 404, true → 403, false → doorgaan.
function writeDecision(archived) {
  if (archived === null) return 404;
  if (archived === true) return 403;
  return 200;
}

test('schrijven naar gearchiveerde klas → 403', () => {
  assert.strictEqual(writeDecision(true), 403);
});

test('schrijven naar actieve klas → 200 (toegestaan)', () => {
  assert.strictEqual(writeDecision(false), 200);
});

test('schrijven naar onbestaande klas → 404', () => {
  assert.strictEqual(writeDecision(null), 404);
});

// ── Read-only in de UI ────────────────────────────────────────────────────────
// Een rij is read-only als het geselecteerde jaar volledig gearchiveerd is,
// OF als de klas zelf gearchiveerd is.
function rowIsReadonly(yearAllArchived, classArchived) {
  return yearAllArchived === true || classArchived === true;
}

test('UI: gearchiveerd jaar maakt alle rijen read-only', () => {
  assert.strictEqual(rowIsReadonly(true, false), true);
});

test('UI: gearchiveerde klas in actief jaar is read-only', () => {
  assert.strictEqual(rowIsReadonly(false, true), true);
});

test('UI: actieve klas in actief jaar is bewerkbaar', () => {
  assert.strictEqual(rowIsReadonly(false, false), false);
});
