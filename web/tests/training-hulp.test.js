'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/training-hulp');
const T = require('../lib/training');

test('hulpsoort per niveau', () => {
  [1, 2, 3].forEach(n => assert.equal(H.hulpSoort(n), 'checklist'));
  [4, 5].forEach(n => assert.equal(H.hulpSoort(n), 'hints'));
  [6, 7, 10].forEach(n => assert.equal(H.hulpSoort(n), 'geen'));
});

test('cursus: 25 hoofdstukken met url, elk onderwerp heeft een hoofdstuk', () => {
  assert.equal(H.CURSUS.length, 25);
  assert.equal(H.hoofdstukVan('h2').url, 'https://cursus.pycodeflow.org/h2-print-input.html');
  Object.values(H.ONDERWERP_HOOFDSTUK).forEach(id => assert.ok(H.hoofdstukVan(id), id));
});

test('niveau 1-3: hoofdstuk + kernwoorden + checklist (zonder regels); niveau 4-5: geen kernwoorden/checks', () => {
  const q = { topic: 'print-input', level: 2, type: 'code', keywords: ['input()', 'print()'], hints: ['x', 'y'], tests: [{ input: ['a', 'b'], output: 'b a' }] };
  const h = H.hulpVoorLeerling(q);
  assert.equal(h.soort, 'checklist');
  assert.equal(h.hoofdstuk.nr, 2);
  assert.deepEqual(h.kernwoorden, ['input()', 'print()']);
  assert.ok(h.checks.length >= 3);
  assert.ok(h.checks.every(c => Object.keys(c).sort().join() === 'id,label'), 'geen regels naar de leerling');
  assert.equal(h.aantalHints, 0);
  const h4 = H.hulpVoorLeerling({ ...q, level: 4 });
  assert.equal(h4.soort, 'hints'); assert.deepEqual(h4.kernwoorden, []); assert.deepEqual(h4.checks, []); assert.equal(h4.aantalHints, 2);
  assert.equal(H.hulpVoorLeerling({ ...q, level: 6 }), null);
});

test('standaardchecks afgeleid uit testgevallen', () => {
  const c = H.standaardChecks([{ input: ['a', 'b'], output: 'x' }, { input: ['c', 'd'], output: 'y' }]);
  assert.equal(c[0].kind, 'aantal_input'); assert.equal(c[0].n, 2);
  assert.equal(c.filter(x => x.kind === 'test').length, 2);
  assert.equal(H.standaardChecks([{ input: [], output: 'hallo' }]).some(x => x.kind === 'aantal_input'), false);
});

test('evalueer: statisch op de code, aantal input en tests uit echte uitvoeringen', () => {
  const checks = [
    { label: 'print', kind: 'bevat', pattern: '\\bprint\\s*\\(' },
    { label: 'geen tekst in input', kind: 'niet_bevat', pattern: 'input\\(\\s*["\']' },
    { label: '2 inputs', kind: 'aantal_input', n: 2 },
    { label: 'uitvoer', kind: 'test', index: 0 },
  ];
  const code = 'a = input()\nb = input()\nprint(b, a)';
  const r = H.evalueerChecks(checks, code, { aantalInvoer: 2, tests: [{ ok: true }] });
  assert.deepEqual(r.map(x => x.ok), [true, true, true, true]);
  const r2 = H.evalueerChecks(checks, 'a = input("naam")', { aantalInvoer: 1, tests: [{ ok: false }] });
  assert.deepEqual(r2.map(x => x.ok), [false, false, false, false]);
  assert.deepEqual(H.evalueerChecks(checks, '   ', {}).map(x => x.ok), [false, false, false, false]);
  assert.deepEqual(H.nodigeTests(checks), [0]);
});

test('straf: 1e check/hint gratis, elke volgende kost 10 procentpunten', () => {
  assert.equal(H.hulpStraf(2, { checks: 0 }), 0);
  assert.equal(H.hulpStraf(2, { checks: 1 }), 0);
  assert.equal(H.hulpStraf(2, { checks: 2 }), 0.1);
  assert.equal(H.hulpStraf(3, { checks: 4 }), 0.3);
  assert.equal(H.hulpStraf(4, { hints: 1 }), 0);
  assert.equal(H.hulpStraf(5, { hints: 2 }), 0.1);
  assert.equal(H.hulpStraf(7, { hints: 2, checks: 5 }), 0, 'geen hulp boven niveau 5');
  assert.equal(H.scoreNaStraf(1, 0.1), 0.9);
  assert.equal(H.scoreNaStraf(0, 0.1), 0);
  assert.equal(H.scoreNaStraf(0.05, 0.1), 0);
  assert.equal(H.scoreNaStraf(1, 0), 1);
});

test('import: hulpvelden gevalideerd en genormaliseerd', () => {
  const basis = { topic: 'print-input', level: 2, type: 'code', text: 'Doe iets', tests: [{ input: ['a'], output: 'a' }] };
  const ok = T.valideerImport([{ ...basis, chapter: 'h2', keywords: ['input()'], hints: ['tip'], checks: [{ label: 'print', kind: 'bevat', pattern: 'print' }, { label: 'klopt', kind: 'test', index: 0 }] }], ['print-input']);
  assert.equal(ok.fouten.length, 0);
  assert.equal(ok.geldig[0].chapter, 'h2');
  const slecht = T.valideerImport([
    { ...basis, chapter: 'h99' },
    { ...basis, hints: ['a', 'b', 'c'] },
    { ...basis, checks: [{ label: 'x', kind: 'test', index: 5 }] },
    { ...basis, checks: [{ label: 'x', kind: 'bevat', pattern: '(' }] },
    { ...basis, type: 'single', choices: ['a', 'b'], correct: [0], checks: [{ label: 'x', kind: 'bevat', pattern: 'a' }] },
  ], ['print-input']);
  assert.equal(slecht.fouten.length, 5);
});

test('hash verandert niet door hulpvelden (bijwerken i.p.v. dubbel)', () => {
  const v = { topic: 'print-input', level: 2, type: 'code', text: 'Doe iets', code: '' };
  assert.equal(T.vraagHash(v), T.vraagHash({ ...v, hints: ['x'], keywords: ['y'], chapter: 'h2' }));
});
