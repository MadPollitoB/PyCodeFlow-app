// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 40 — Unit tests: leerling-lidmaatschap per schooljaar (class_memberships)
//
// De DB-functies vereisen een live PostgreSQL; hier testen we de LOGICA die het
// model borgt — dat een leerling (persoon) over meerdere jaren/klassen kan zitten
// met behoud van historiek — via een in-memory replica van de koppeltabel.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// In-memory replica van class_memberships met dezelfde regels als de DB:
// PK (student_id, class_id, school_year), en een klas hoort bij één schooljaar.
function makeStore() {
  const classes = new Map();      // classId -> { name, school_year }
  const memberships = [];         // { student_id, class_id, school_year, status }

  return {
    addClass(id, name, schoolYear) { classes.set(id, { name, school_year: schoolYear }); },
    addMembership(studentId, classId, status = 'active') {
      const cls = classes.get(classId);
      if (!cls) return false;
      const sy = cls.school_year;
      // PK: geen duplicaat (student, class, jaar)
      if (memberships.some(m => m.student_id === studentId && m.class_id === classId && m.school_year === sy)) {
        return false;
      }
      memberships.push({ student_id: studentId, class_id: classId, school_year: sy, status });
      return true;
    },
    studentsInClass(classId) {
      return memberships.filter(m => m.class_id === classId).map(m => m.student_id);
    },
    classCount(classId) {
      const cls = classes.get(classId);
      if (!cls) return 0;
      return memberships.filter(m => m.class_id === classId && m.school_year === cls.school_year).length;
    },
    historyOf(studentId) {
      return memberships
        .filter(m => m.student_id === studentId)
        .map(m => ({ classId: m.class_id, year: m.school_year }));
    },
  };
}

test('leerling kan in twee schooljaren in verschillende klassen zitten', () => {
  const s = makeStore();
  s.addClass('c-3a-2425', '3A', '2024-2025');
  s.addClass('c-4b-2526', '4B', '2025-2026');
  s.addMembership('jan', 'c-3a-2425');
  s.addMembership('jan', 'c-4b-2526');

  const hist = s.historyOf('jan');
  assert.strictEqual(hist.length, 2);
  assert.deepStrictEqual(hist, [
    { classId: 'c-3a-2425', year: '2024-2025' },
    { classId: 'c-4b-2526', year: '2025-2026' },
  ]);
});

test('historiek blijft intact bij "verplaatsen" (oud lidmaatschap blijft staan)', () => {
  const s = makeStore();
  s.addClass('c-3a', '3A', '2024-2025');
  s.addClass('c-4a', '4A', '2025-2026');
  s.addMembership('an', 'c-3a');
  // "Verplaatsen" = koppel aan nieuwe klas; oude blijft bestaan
  s.addMembership('an', 'c-4a');
  assert.strictEqual(s.historyOf('an').length, 2);
  // De leerling zit nog steeds in de historische klas van vorig jaar
  assert.ok(s.studentsInClass('c-3a').includes('an'));
});

test('dezelfde leerling twee keer in dezelfde klas+jaar wordt niet dubbel toegevoegd', () => {
  const s = makeStore();
  s.addClass('c-3a', '3A', '2024-2025');
  assert.strictEqual(s.addMembership('jan', 'c-3a'), true);
  assert.strictEqual(s.addMembership('jan', 'c-3a'), false); // PK-conflict
  assert.strictEqual(s.classCount('c-3a'), 1);
});

test('leerlingtelling per klas telt enkel het juiste schooljaar', () => {
  const s = makeStore();
  s.addClass('c-3a-2425', '3A', '2024-2025');
  s.addMembership('jan', 'c-3a-2425');
  s.addMembership('an', 'c-3a-2425');
  assert.strictEqual(s.classCount('c-3a-2425'), 2);
});

test('twee leerlingen kunnen in dezelfde klas zitten', () => {
  const s = makeStore();
  s.addClass('c-3a', '3A', '2024-2025');
  s.addMembership('jan', 'c-3a');
  s.addMembership('an', 'c-3a');
  const ids = s.studentsInClass('c-3a').sort();
  assert.deepStrictEqual(ids, ['an', 'jan']);
});

test('leerling zonder lidmaatschap heeft lege historiek (geen crash)', () => {
  const s = makeStore();
  assert.deepStrictEqual(s.historyOf('niemand'), []);
});

test('lidmaatschap aan onbestaande klas faalt netjes', () => {
  const s = makeStore();
  assert.strictEqual(s.addMembership('jan', 'bestaat-niet'), false);
});

test('twee klassen met dezelfde naam maar ander jaar zijn losse klassen', () => {
  const s = makeStore();
  s.addClass('c-3a-2425', '3A', '2024-2025');
  s.addClass('c-3a-2526', '3A', '2025-2026');
  s.addMembership('jan', 'c-3a-2425');
  s.addMembership('jan', 'c-3a-2526');
  // Zelfde klasnaam, maar aparte lidmaatschappen per jaar
  assert.strictEqual(s.classCount('c-3a-2425'), 1);
  assert.strictEqual(s.classCount('c-3a-2526'), 1);
  assert.strictEqual(s.historyOf('jan').length, 2);
});
