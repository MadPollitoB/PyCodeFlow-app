// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 31b — Unit tests: localStorage prefix + migratie
// Test de _lsKey prefix-logica en de eenmalige migratie van oude sleutels.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const LS_PREFIX = 'pycodeflow_';

// Repliceert de helpers uit app.js.
function makeLS(store) {
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const _lsKey = (key) => key.startsWith(LS_PREFIX) ? key : LS_PREFIX + key;
  return {
    setLS: (key, val) => localStorage.setItem(_lsKey(key), JSON.stringify(val)),
    getLS: (key, fb = null) => {
      try { const v = JSON.parse(localStorage.getItem(_lsKey(key))); return v ?? fb; }
      catch { return fb; }
    },
    delLS: (key) => localStorage.removeItem(_lsKey(key)),
    _lsKey,
    store,
  };
}

function migrate(store) {
  const legacy = ['teacherSessionCode', 'studentSessionCode', 'studentName',
    'studentId', 'studentState', 'freeSessionCode', 'freeStudentName',
    'freeStudentClass', 'observerSessionCode'];
  for (const k of legacy) {
    const oldVal = (k in store) ? store[k] : null;
    if (oldVal !== null && !((LS_PREFIX + k) in store)) {
      store[LS_PREFIX + k] = oldVal;
      delete store[k];
    }
  }
}

// ── Prefix ────────────────────────────────────────────────────────────────────
test('_lsKey: voegt prefix toe aan korte naam', () => {
  const { _lsKey } = makeLS({});
  assert.strictEqual(_lsKey('studentName'), 'pycodeflow_studentName');
});

test('_lsKey: dubbele prefix wordt vermeden', () => {
  const { _lsKey } = makeLS({});
  assert.strictEqual(_lsKey('pycodeflow_free_code'), 'pycodeflow_free_code');
});

test('setLS/getLS: round-trip met prefix', () => {
  const ls = makeLS({});
  ls.setLS('studentName', 'Jan');
  assert.strictEqual(ls.store['pycodeflow_studentName'], '"Jan"');
  assert.strictEqual(ls.getLS('studentName'), 'Jan');
});

test('getLS: onbekende sleutel → fallback', () => {
  const ls = makeLS({});
  assert.strictEqual(ls.getLS('bestaatNiet', 'standaard'), 'standaard');
});

test('delLS: verwijdert de geprefixte sleutel', () => {
  const ls = makeLS({});
  ls.setLS('studentId', 'abc');
  ls.delLS('studentId');
  assert.strictEqual(ls.getLS('studentId'), null);
});

// ── Migratie ──────────────────────────────────────────────────────────────────
test('migratie: oude sleutel krijgt prefix, oude verdwijnt', () => {
  const store = { 'teacherSessionCode': '"ABC12345"' };
  migrate(store);
  assert.strictEqual(store['pycodeflow_teacherSessionCode'], '"ABC12345"');
  assert.strictEqual('teacherSessionCode' in store, false);
});

test('migratie: bestaande geprefixte sleutel wordt niet overschreven', () => {
  const store = {
    'studentName': '"Oud"',
    'pycodeflow_studentName': '"Nieuw"',
  };
  migrate(store);
  // De nieuwe blijft behouden, de oude wordt niet gemigreerd (geen overschrijving)
  assert.strictEqual(store['pycodeflow_studentName'], '"Nieuw"');
});

test('migratie: leest correct na migratie via getLS', () => {
  const store = { 'studentSessionCode': '"XYZ99999"' };
  migrate(store);
  const ls = makeLS(store);
  assert.strictEqual(ls.getLS('studentSessionCode'), 'XYZ99999');
});

test('migratie: niets te migreren → geen wijziging', () => {
  const store = { 'pycodeflow_studentId': '"123"' };
  migrate(store);
  assert.deepStrictEqual(store, { 'pycodeflow_studentId': '"123"' });
});
