'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const db = rd('db/database.js');
const routes = rd('lib/training-routes.js');
const ui = rd('public/training-overzicht.html');
const stu = rd('public/training.html');

test('verwijderTrainingTopic ruimt vragen en antwoorden op maar laat niveaus en dagvragen staan', () => {
  const m = db.match(/async verwijderTrainingTopic[\s\S]*?\n  },/);
  assert.ok(m, 'functie bestaat');
  const f = m[0];
  assert.match(f, /DELETE FROM training_run_answers WHERE topic_id/);
  assert.match(f, /DELETE FROM training_questions WHERE topic_id/);
  assert.match(f, /active\s*=\s*false/);
  assert.doesNotMatch(f, /training_student_levels/);
  assert.doesNotMatch(f, /DELETE FROM training_dagvraag\b/);
});

test('route vereist bevestiging met naam en algemeen beheer', () => {
  assert.match(routes, /\/api\/teacher\/training\/topics\/:id\/impact/);
  assert.match(routes, /delete\(\s*'\/api\/teacher\/training\/topics\/:id'/);
  assert.match(routes, /bevestig/);
  assert.match(routes, /kanAlgemeen/);
});

test('verwijderde vraag in streak geeft "bestaat niet meer"', () => {
  assert.match(routes, /Deze vraag bestaat niet meer\./);
  assert.match(routes, /410/);
  assert.match(stu, /bestaat niet meer/);
  assert.match(stu, /vraag verwijderd/);
});

test('docent-UI heeft verwijderknop en extra rasterkolom', () => {
  assert.match(ui, /verwijderOnderwerp/);
  assert.match(ui, /laadOnderwerpen/);
});

test('inline scripts blijven geldig', () => {
  for (const html of [ui, stu]) {
    const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g; let x;
    while ((x = re.exec(html))) assert.doesNotThrow(() => new Function(x[1]));
  }
});

test('gewettigd afwezig in Verbeteren en Scores: enkel bij wie niets indiende', () => {
  const rev = rd('public/quiz-review.js');
  const mat = rd('public/klasmatrix.js');
  assert.match(rev, /function heeftNietsIngediend/);
  assert.match(rev, /function afwezigBlok/);
  assert.match(rev, /roster\/\$\{encodeURIComponent\(_currentStudent\.id\)\}\/status/);
  assert.match(mat, /c\.status === 'niets' \|\| c\.status === 'gewettigd'/);
  assert.match(mat, /zetAfwezigVanuitMatrix/);
});

test('heeftNietsIngediend-logica', () => {
  const src = rd('public/quiz-review.js').match(/function heeftNietsIngediend[\s\S]*?\n}\n/)[0];
  const f = new Function(src + '; return heeftNietsIngediend;')();
  assert.equal(f([]), true);
  assert.equal(f([{ submitted_by: 'geen_deelname', code: '' }]), true);
  assert.equal(f([{ code: '', selected_choices: '[]', run_count: 0 }]), true);
  assert.equal(f([{ code: 'print(1)', selected_choices: '[]', run_count: 0 }]), false);
  assert.equal(f([{ code: '', selected_choices: '["a"]', run_count: 0 }]), false);
  assert.equal(f([{ code: '', selected_choices: '[]', run_count: 2 }]), false);
});
