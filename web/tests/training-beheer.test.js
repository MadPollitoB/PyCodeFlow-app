'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const K = require('../lib/training-kwaliteit');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const goedeCode = () => ({ text: 'Lees een naam in en toon "Hallo, naam!". Bij Ada is de uitvoer: Hallo, Ada!', type: 'code', level: 2, explanation: 'x',
  tests: [{ input: ['Ada'], output: 'Hallo, Ada!' }, { input: ['Sam'], output: 'Hallo, Sam!' }], checks: [], keywords: ['input'], hints: ['h'] });

test('kwaliteit: een goede codevraag heeft geen fouten', () => {
  assert.deepStrictEqual(K.controleerVraag(goedeCode()).filter(p => p.ernst === 'fout'), []);
});
test('kwaliteit: lege verwachte uitvoer bij één test is toegestaan, bij alle tests een fout', () => {
  const q = goedeCode(); q.tests.push({ input: ['0'], output: '' });
  assert.ok(!K.controleerVraag(q).some(p => p.code === 'lege_verwachte_uitvoer'));
  q.tests = q.tests.map(t => ({ ...t, output: '' }));
  assert.ok(K.controleerVraag(q).some(p => p.code === 'lege_verwachte_uitvoer' && p.ernst === 'fout'));
});
test('kwaliteit: geen tests, kapotte check en meerkeuze zonder juist antwoord zijn fouten', () => {
  assert.ok(K.controleerVraag({ ...goedeCode(), tests: [] }).some(p => p.code === 'geen_tests'));
  assert.ok(K.controleerVraag({ ...goedeCode(), checks: [{ label: 'a', kind: 'bevat', pattern: '(' }] }).some(p => p.code === 'check_regex'));
  assert.ok(K.controleerVraag({ ...goedeCode(), checks: [{ label: 'a', kind: 'test', index: 9 }] }).some(p => p.code === 'check_test_index'));
  const m = { text: 'Welke is juist hier?', type: 'single', level: 1, choices: ['a', 'b'], correct: [], explanation: 'x' };
  assert.ok(K.controleerVraag(m).some(p => p.code === 'single_juist'));
  assert.ok(K.controleerVraag({ ...m, correct: [0], choices: ['a', 'a'] }).some(p => p.code === 'dubbele_keuze'));
});
test('nakijkstappen beschrijven code- en keuzevragen', () => {
  assert.ok(K.nakijkStappen(goedeCode()).some(s => /testgeval/i.test(s)));
  assert.ok(K.nakijkStappen({ type: 'multiple', level: 1 }).some(s => /fout aangevinkt/.test(s)));
});
test('routes en scherm: onderwerpen en vragen beheren, detail en proberen', () => {
  const r = rd('lib/training-routes.js'); const ui = rd('public/training-overzicht.html');
  for (const x of ["'/api/teacher/training/topics'", "'/api/teacher/training/topics/:id'", '/questions/:id/active', '/questions/:id/detail', '/questions/:id/probeer', 'definitief'])
    assert.ok(r.includes(x), x);
  for (const x of ['laadOnderwerpen', 'openDetail', 'q-status', 'q-probleem', 'Zo wordt het nagekeken', 'Probeer het als leerling'])
    assert.ok(ui.includes(x), x);
});
test('uitgeschakeld onderwerp: leerlingen krijgen er geen vragen van', () => {
  const db = rd('db/database.js');
  assert.match(db, /EXISTS \(SELECT 1 FROM training_topics tt WHERE tt\.id = q\.topic_id AND tt\.active\)/);
  assert.match(db, /ADD COLUMN IF NOT EXISTS verwijderd/);
  assert.match(rd('lib/training-routes.js'), /valideerTrainingKeuze\(req\.body \|\| \{\}, actieveIds\)/);
});
test('inline script van het overzicht is geldig', () => {
  const html = rd('public/training-overzicht.html'); const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g; let x;
  while ((x = re.exec(html))) assert.doesNotThrow(() => new Function(x[1]));
});
