// v148 — meerkeuze bewaren en scoren bij automatisch indienen
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('148 client: een aangeklikte keuze wordt meteen bewaard', () => {
  const c = r('public/quiz-student.js');
  const f = c.slice(c.indexOf('function onChoiceChange'), c.indexOf('function updateOpenCount'));
  assert.match(f, /saveCurrentAnswer\(\)/);
});
test('148 server: elk afgedwongen indienpad scoort meerkeuze via rondForceInzendingAf', () => {
  const s = r('server.js');
  assert.match(s, /async function autoScoreInzending/);
  assert.match(s, /async function rondForceInzendingAf/);
  for (const reden of ['deadline', 'teacher', 'tab_switch', 'timer']) assert.match(s, new RegExp(`rondForceInzendingAf\\([^)]*'${reden}'`), reden);
  // geen kale submitQuizAnswers meer in de afgedwongen paden (enkel nog in de helper en bij "student")
  const kaal = s.match(/dbModule\.submitQuizAnswers\([^)]*true, '(deadline|teacher|timer|tab_switch)'/g) || [];
  assert.strictEqual(kaal.length, 1, 'enkel in rondForceInzendingAf zelf (variabele reden)' + kaal.length);
});
test('148 server: de timer-indiening schrijft de gekozen opties mee weg (niet meer op leeg zetten)', () => {
  const s = r('server.js');
  const i = s.indexOf('const timerReeks');
  assert.ok(i > 0);
  const blok = s.slice(i, i + 1200);
  assert.match(blok, /selectedChoices: JSON\.stringify\(ans\.selectedChoices \|\| \[\]\)/);
  assert.match(blok, /partAnswers: ans\.partAnswers/);
});
test('148 server: laatste opslag mag 20 s na een afgedwongen indiening nog binnenkomen', () => {
  const s = r('server.js');
  assert.match(s, /laatToegelaten/);
  assert.match(s, /_forcedAt <= 20000|Date\.now\(\) - student\._forcedAt <= 20000/);
  assert.strictEqual((s.match(/_forcedAt = Date\.now\(\)/g) || []).length, 7);
});
test('148 versie', () => assert.match(r('VERSION').trim(), /^2026\.2\.51\.\d+$/));

test('148 startscherm: regels + verplicht akkoord staan op het scherm zelf', () => {
  const h = r('public/quiz-student.html'), j = r('public/quiz-student.js'), s = r('server.js');
  assert.match(h, /id="start-akkoord"/); assert.match(h, /id="start-knop"[^>]*disabled/); assert.match(h, /id="start-regels-lijst"/); assert.match(h, /id="start-type-badge"/);
  assert.match(j, /function renderStartRegels/); assert.match(j, /function updateStartKnop/);
  assert.match(j, /START ' \+ startSoort\(\)\.toUpperCase\(\)/);
  assert.doesNotMatch(j, /window\.pyConfirm\(\{\s*title: \(_startInfo\?\.noBack/, 'geen aparte bevestigingspopup meer');
  assert.match(j, /meldIncident\('startbevestiging'/);
  for (const veld of ['randomize', 'minRunsPerQ', 'mcScoring', 'heeftMeerkeuze', 'liveScreenshotSec', 'heeftCursus', 'name']) assert.match(s, new RegExp(veld + ':'), veld);
});
