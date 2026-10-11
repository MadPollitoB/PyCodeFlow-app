'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../lib/training-hulp');
const T = require('../lib/training');

test('107 standaard hulpregels = gedrag van v106', () => {
  const c = H.normaliseerHulpCfg({}).cfg;
  assert.deepStrictEqual(c, { ...H.STANDAARD_HULP });
  assert.strictEqual(H.hulpSoort(3, c), 'checklist');
  assert.strictEqual(H.hulpSoort(4, c), 'hints');
  assert.strictEqual(H.hulpSoort(6, c), 'geen');
  assert.strictEqual(H.hulpStraf(2, { checks: 1 }, c), 0);
  assert.strictEqual(H.hulpStraf(2, { checks: 3 }, c), 0.2);
  assert.strictEqual(H.hulpStraf(4, { hints: 2 }, c), 0.1);
});

test('107 klas kan gratis hulp, aftrek en niveaus aanpassen', () => {
  const streng = H.normaliseerHulpCfg({ gratisChecks: 0, gratisHints: 0, strafPct: 25, checklistTot: 2, hintsTot: 3 }).cfg;
  assert.strictEqual(H.hulpSoort(2, streng), 'checklist');
  assert.strictEqual(H.hulpSoort(3, streng), 'hints');
  assert.strictEqual(H.hulpSoort(4, streng), 'geen');
  assert.strictEqual(H.hulpStraf(1, { checks: 1 }, streng), 0.25);
  assert.strictEqual(H.hulpStraf(3, { hints: 2 }, streng), 0.5);
  const mild = H.normaliseerHulpCfg({ gratisChecks: 3, gratisHints: 2, strafPct: 5, hintsTot: 6 }).cfg;
  assert.strictEqual(H.hulpStraf(2, { checks: 3 }, mild), 0);
  assert.strictEqual(H.hulpStraf(2, { checks: 5 }, mild), 0.1);
  assert.strictEqual(H.hulpStraf(5, { hints: 2 }, mild), 0);
  assert.strictEqual(H.hulpSoort(6, mild), 'hints');
});

test('107 hulp uit = nooit hulp of aftrek', () => {
  const uit = H.normaliseerHulpCfg({ aan: false }).cfg;
  assert.strictEqual(H.hulpSoort(1, uit), 'geen');
  assert.strictEqual(H.hulpStraf(1, { checks: 9 }, uit), 0);
  assert.strictEqual(T.vraagVoorLeerling({ id: 1, topic: 'herhaling', level: 1, type: 'single', text: 'x', choices: ['a', 'b'], correct: [0] }, 1, 10, 1, uit).hulp, null);
});

test('107 ongeldige waarden worden geweigerd; hintsTot nooit lager dan checklistTot', () => {
  assert.ok(H.normaliseerHulpCfg({ strafPct: 80 }).fouten.length);
  assert.ok(H.normaliseerHulpCfg({ gratisHints: 3 }).fouten.length);
  assert.ok(H.normaliseerHulpCfg({ gratisChecks: 'a' }).fouten.length);
  assert.strictEqual(H.normaliseerHulpCfg({ checklistTot: 5, hintsTot: 2 }).cfg.hintsTot, 5);
});

test('107 leerling in meerdere klassen krijgt de ruimste regeling', () => {
  const e = H.effectieveHulpCfg([{ gratisChecks: 0, strafPct: 30, checklistTot: 1 }, { gratisChecks: 2, strafPct: 10, checklistTot: 3 }]);
  assert.strictEqual(e.gratisChecks, 2); assert.strictEqual(e.strafPct, 10); assert.strictEqual(e.checklistTot, 3);
  assert.deepStrictEqual(H.effectieveHulpCfg([]), { ...H.STANDAARD_HULP });
  assert.strictEqual(H.effectieveHulpCfg([{ aan: false }, { aan: true }]).aan, true);
});

test('107 hulpCfgVan(state) valt terug op standaard (oude runs zonder cfg)', () => {
  assert.deepStrictEqual(H.hulpCfgVan({}), { ...H.STANDAARD_HULP });
  assert.strictEqual(H.hulpCfgVan({ hulpCfg: { gratisChecks: 2 } }).gratisChecks, 2);
});

test('107 de vraag toont de klasregels (gratis/aftrek) aan de leerling', () => {
  const q = { id: 1, topic: 'print-input', level: 2, type: 'code', text: 'x', tests: [{ input: [], output: 'a' }], keywords: ['print()'] };
  const h = T.vraagVoorLeerling(q, 1, 10, 2, H.normaliseerHulpCfg({ gratisChecks: 2, strafPct: 15 }).cfg).hulp;
  assert.strictEqual(h.gratisChecks, 2); assert.strictEqual(h.strafPct, 15);
});
