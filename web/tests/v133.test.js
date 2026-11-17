'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const v = require('../lib/validation.js');
const sc = require('../lib/scoring.js');

const keuze = (...correct) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].slice(0, correct.length)
  .map((id, i) => ({ id, correct: correct[i] }));
const score = (choices, sel, punten, modus = 'gedeeld') =>
  sc.computeAutoScore({ question_type: 'multiple', choices_json: JSON.stringify(choices), points: punten }, sel, { modus }).autoScore;

test('133 scoring: V4-voorbeeld (A,B,D juist; C fout; 2 punten)', () => {
  const c = keuze(true, true, false, true);
  assert.strictEqual(score(c, ['a', 'b', 'd'], 2), 2);
  assert.strictEqual(score(c, ['a', 'b'], 2), 1);
  assert.strictEqual(score(c, ['a'], 2), 0);
  assert.strictEqual(score(c, ['a', 'b', 'c'], 2), 0);
  assert.strictEqual(score(c, ['a', 'b', 'c', 'd'], 2), 0);   // alles aanduiden = 0
  assert.strictEqual(score(c, [], 2), 0);
});

test('133 scoring: waarden uit de getoonde tabel (4 juiste opties)', () => {
  const c = keuze(true, true, true, true, false);
  assert.strictEqual(score(c, ['a', 'b', 'c'], 2), 1.5);    // 1 gemist
  assert.strictEqual(score(c, ['a', 'b', 'c'], 4), 2.5);
  assert.strictEqual(score(c, ['a', 'b'], 2), 0.5);         // 2 gemist
  assert.strictEqual(score(c, ['a', 'b'], 4), 1);
  assert.strictEqual(score(c, ['a'], 4), 0);                // 3 gemist
  assert.strictEqual(score(c, ['a', 'b', 'c', 'd', 'e'], 4), 0); // alles aangeduid
  assert.strictEqual(score(c, ['a', 'b', 'c', 'd'], 4), 4);
  const fout1 = score(c, ['a', 'b', 'c', 'd', 'e'], 4);
  assert.strictEqual(fout1, 0);
});

test('133 scoring: 1 fout aangeduid kost zwaar (3 eenheden)', () => {
  const c = keuze(true, true, true, true, true, true, true, true, false, false);   // 8 juist, 2 fout
  assert.strictEqual(score(c, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 10), 6.5);  // 1 fout
  assert.strictEqual(score(c, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], 10), 0); // alles = 0
  assert.strictEqual(score(c, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 10), 8);               // 1 gemist
});

test('133 scoring: afronden op het dichtstbijzijnde halve punt (0,25 omhoog)', () => {
  assert.strictEqual(sc.rondOpHalvePunten(1.25), 1.5);
  assert.strictEqual(sc.rondOpHalvePunten(1.24), 1);
  assert.strictEqual(sc.rondOpHalvePunten(0.75), 1);
  assert.strictEqual(sc.rondOpHalvePunten(0.2), 0);
  assert.strictEqual(sc.rondOpHalvePunten(2), 2);
  // 4 juiste, 1 gemist, 2 punten: 2 × 0,625 = 1,25 → 1,5
  assert.strictEqual(score(keuze(true, true, true, true, false), ['a', 'b', 'c'], 2), 1.5);
});

test('133 scoring: klassiek blijft ongewijzigd (default bij ontbrekende modus)', () => {
  const c = keuze(true, true, false, true);
  assert.strictEqual(score(c, ['a', 'b'], 2, 'klassiek'), 1);
  assert.strictEqual(score(c, ['a'], 2, 'klassiek'), 1);   // Math.round(0,67)
  assert.strictEqual(score(c, ['a', 'b', 'c'], 2, 'klassiek'), 0);
  const zonder = sc.computeAutoScore({ question_type: 'multiple', choices_json: JSON.stringify(c), points: 2 }, ['a']).autoScore;
  assert.strictEqual(zonder, 1);
});

test('133 scoring: single blijft alles of niets; open/code niet automatisch', () => {
  const c = [{ id: 'a', correct: true }, { id: 'b', correct: false }];
  const q = { question_type: 'single', choices_json: JSON.stringify(c), points: 2 };
  assert.strictEqual(sc.computeAutoScore(q, ['a'], { modus: 'gedeeld' }).autoScore, 2);
  assert.strictEqual(sc.computeAutoScore(q, ['b'], { modus: 'gedeeld' }).autoScore, 0);
  assert.strictEqual(sc.computeAutoScore({ question_type: 'open', points: 2 }, [], { modus: 'gedeeld' }).autoScored, false);
});

test('133 scoring: halve punten per vraag (1,5 p) en dubbele selecties', () => {
  const c = keuze(true, true, true, false);
  assert.strictEqual(score(c, ['a', 'b', 'c'], 1.5), 1.5);
  assert.strictEqual(score(c, ['a', 'b', 'b', 'c', 'c'], 1.5), 1.5);   // dubbels tellen niet dubbel
  assert.strictEqual(score(c, ['a', 'b'], 1.5), 1);                    // 1,5 × (1 − 1,5/3) = 0,75 → 1
});

test('133 validatie: normaliseerScore accepteert enkel veelvouden van 0,5', () => {
  assert.strictEqual(v.normaliseerScore('1,5'), 1.5);
  assert.strictEqual(v.normaliseerScore('1.5'), 1.5);
  assert.strictEqual(v.normaliseerScore(2), 2);
  assert.strictEqual(v.normaliseerScore('0'), 0);
  assert.strictEqual(v.normaliseerScore('1,3'), null);
  assert.strictEqual(v.normaliseerScore('abc'), null);
  assert.strictEqual(v.normaliseerScore(''), null);
  assert.strictEqual(v.normaliseerScore(null), null);
  assert.strictEqual(v.normaliseerScore(-1), null);
  assert.strictEqual(v.normaliseerScore(2000), null);
  assert.strictEqual(v.normaliseerVraagPunten('0,5'), 0.5);
  assert.strictEqual(v.normaliseerVraagPunten(0), 4);
  assert.strictEqual(v.normaliseerVraagPunten('x', 3), 3);
  assert.strictEqual(v.normaliseerVraagPunten(100.5), 4);
  assert.strictEqual(v.normaliseerMcScoring('gedeeld'), 'gedeeld');
  assert.strictEqual(v.normaliseerMcScoring('klassiek'), 'klassiek');
  assert.strictEqual(v.normaliseerMcScoring('rare'), null);
});

test('133 server: geen parseInt meer op scores, en de modus wordt doorgegeven', () => {
  const s = r('server.js');
  assert.doesNotMatch(s, /parseInt\(score/);
  assert.match(s, /computeAutoScore\(q, ans\.selectedChoices, \{ modus: mcModus \}\)/);
  assert.match(s, /gekozen, \{ modus: mcModus \}/);
  assert.strictEqual((s.match(/Een score moet een getal zijn in stappen van 0,5/g) || []).length, 3);
  assert.strictEqual((s.match(/mcScoring: validationLib\.normaliseerMcScoring\(mcScoring\)/g) || []).length, 2);
  assert.match(s, /mcScoring: meta\.mc_scoring === 'gedeeld' \? 'gedeeld' : 'klassiek'/);
});

test('133 database: NUMERIC, type-parser, kolom en migratie', () => {
  const d = r('db/database.js');
  assert.match(d, /setTypeParser\(1700/);
  assert.match(d, /max_points\s+NUMERIC\(6,1\)/);
  assert.match(d, /points\s+NUMERIC\(6,1\) NOT NULL DEFAULT 4/);
  assert.match(d, /score\s+NUMERIC\(6,1\),/);
  assert.match(d, /ADD COLUMN mc_scoring TEXT NOT NULL DEFAULT 'klassiek'/);
  assert.match(d, /ALTER COLUMN score TYPE NUMERIC\(6,1\)/);
  assert.match(d, /mcScoring === 'klassiek' \? 'klassiek' : 'gedeeld'/);
  assert.doesNotMatch(d, /parseInt\(ruw\.points/);
});

test('133 client: stap 0,5 en komma-weergave', () => {
  assert.match(r('public/quiz-review.js'), /id="score-input" value="\$\{score\}" min="0" max="\$\{q\.points\}" step="0\.5"/);
  assert.match(r('public/quiz-review.js'), /part-score-input"[^>]*step="0\.5"/);
  assert.match(r('public/quiz-bank.html'), /id="q-points" value="4" min="0\.5" max="100" step="0\.5"/);
  assert.match(r('public/quiz-teacher.js'), /class="pts"[^>]*step="0\.5"/);
  assert.match(r('public/popups.js'), /window\.fmtP = function/);
  assert.match(r('public/quiz-teacher.html'), /id="quiz-mc-scoring"/);
  assert.match(r('public/quiz-teacher.js'), /mcScoring: document\.getElementById\('quiz-mc-scoring'\)/);
  assert.match(r('public/quiz-student.js'), /function meerkeuzeUitleg/);
});

test('133 fmtP: komma en geen nutteloze decimalen', () => {
  const src = r('public/popups.js');
  const m = src.match(/window\.fmtP = function[\s\S]*?\n\};/);
  const win = {}; new Function('window', m[0])(win);
  assert.strictEqual(win.fmtP(1.5), '1,5');
  assert.strictEqual(win.fmtP(2), '2');
  assert.strictEqual(win.fmtP('3.0'), '3');
  assert.strictEqual(win.fmtP(null), '');
  assert.strictEqual(win.fmtP(0), '0');
});
