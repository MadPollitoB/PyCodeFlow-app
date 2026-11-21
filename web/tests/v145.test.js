// v145 — live mini-kaartjes + schermafbeeldingen
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const lb = require('../lib/live-beeld');

test('145 interval: standaard 30, 0 = uit, minimum 5, maximum 300, rommel → 30', () => {
  assert.strictEqual(lb.normaliseerInterval(undefined), 30);
  assert.strictEqual(lb.normaliseerInterval(null), 30);
  assert.strictEqual(lb.normaliseerInterval(''), 30);
  assert.strictEqual(lb.normaliseerInterval('abc'), 30);
  assert.strictEqual(lb.normaliseerInterval(0), 0);
  assert.strictEqual(lb.normaliseerInterval(-4), 0);
  assert.strictEqual(lb.normaliseerInterval(2), 5);
  assert.strictEqual(lb.normaliseerInterval('20'), 20);
  assert.strictEqual(lb.normaliseerInterval(9999), 300);
});

test('145 beeld: enkel een kleine JPEG-data-URL is geldig', () => {
  assert.ok(lb.isGeldigBeeld('data:image/jpeg;base64,/9j/4AAQ'));
  assert.ok(!lb.isGeldigBeeld('data:image/png;base64,AAAA'));
  assert.ok(!lb.isGeldigBeeld('data:image/jpeg;base64,<script>'));
  assert.ok(!lb.isGeldigBeeld('http://x/y.jpg'));
  assert.ok(!lb.isGeldigBeeld('data:image/jpeg;base64,' + 'A'.repeat(lb.MAX_BEELD_TEKENS)));
  assert.ok(!lb.isGeldigBeeld(null));
});

test('145 snippet: code, onderdelen of keuzes; wordt ingekort', () => {
  assert.strictEqual(lb.antwoordSnippet({ code: 'print(1)\n  x = 2' }), 'print(1) x = 2');
  assert.strictEqual(lb.antwoordSnippet({ code: 'a'.repeat(200) }).length, 91);
  assert.strictEqual(lb.antwoordSnippet({ partAnswers: { a: 'eerste', b: 'tweede' } }), 'eerste ⏐ tweede');
  assert.strictEqual(lb.antwoordSnippet({ selectedChoices: ['x', 'y'] }), '2 keuze(s) gemaakt');
  assert.strictEqual(lb.antwoordSnippet(null), '');
});

test('145 kaarten: vraag, voortgang, snippet, resterende tijd, weg; ingediend wist het beeld', () => {
  const nu = 1_000_000;
  const leerlingen = [
    { id: 'b', name: 'Bart', className: '5A', socketId: 's1', quizStartedAt: 1, quizCurrentQuestion: 2, quizAnswers: { q1: {}, q2: {} }, _quizTotaal: 10,
      _antwoordSnippet: 'x = 1', _laatsteActiviteitAt: nu - 5000, _quizEndAt: nu + 90_000, klasbordWeg: true, tabSwitchCount: 2, _beeld: { img: 'i', at: nu } },
    { id: 'a', name: 'Anna', quizSubmitted: true, quizAnswers: {}, _beeld: { img: 'oud', at: 1 }, _antwoordSnippet: 'geheim' },
    { id: 'c', name: 'Weg', removed: true },
  ];
  const k = lb.bouwLiveKaarten(leerlingen, nu);
  assert.deepStrictEqual(k.map(x => x.name), ['Anna', 'Bart']);   // gesorteerd, verwijderden eruit
  const bart = k[1];
  assert.strictEqual(bart.vraag, 3);
  assert.strictEqual(bart.totaal, 10);
  assert.strictEqual(bart.beantwoord, 2);
  assert.strictEqual(bart.snippet, 'x = 1');
  assert.strictEqual(bart.resterendSec, 90);
  assert.strictEqual(bart.weg, true);
  assert.strictEqual(bart.tabwissels, 2);
  assert.strictEqual(bart.beeldOp, nu);
  const anna = k[0];
  assert.strictEqual(anna.submitted, true);
  assert.strictEqual(anna.snippet, '');
  assert.strictEqual(anna.resterendSec, null);
  assert.strictEqual(anna.beeldOp, null);
  assert.strictEqual(leerlingen[1]._beeld, null, 'beeld gewist bij indienen');
});

test('145 server: signalen, beperkingen en opruiming', () => {
  const sv = r('server.js');
  assert.match(sv, /quiz_screenshot_aan/);
  assert.match(sv, /quiz_screenshot_uit/);
  assert.match(sv, /socket\.on\('quiz_screenshot'/);
  assert.match(sv, /isGeldigBeeld\(img\)/);
  assert.match(sv, /nu - student\._beeld\.at < 2000/);            // nooit sneller dan om de 2 s
  assert.match(sv, /nu - t > 12000/);                                // observer zonder teken van leven
  assert.match(sv, /st\._beeld = null;/);                           // wissen
  assert.match(sv, /teacher_grid_stop/);
  assert.match(sv, /\/vendor\/html2canvas/);
  assert.match(sv, /live_screenshot_sec/);
  assert.match(r('db', 'database.js'), /live_screenshot_sec INTEGER NOT NULL DEFAULT 30/);
});

test('145 student: html2canvas (lokaal) met terugval; enkel de toetspagina; geen beeld als verborgen', () => {
  const js = r('public/quiz-student.js');
  assert.match(js, /\/vendor\/html2canvas\/html2canvas\.min\.js/);
  assert.match(js, /maakTerugvalBeeld/);
  assert.match(js, /BEELD_BREEDTE = 320/);
  assert.match(js, /document\.hidden\) return/);
  assert.match(js, /quiz_screenshot_uit/);
  assert.match(js, /toDataURL\('image\/jpeg'/);
  const pkg = JSON.parse(r('package.json'));
  assert.strictEqual(pkg.dependencies.html2canvas, '1.4.1');
});

test('145 teacher-grid: kaartjes met beeld, tijden, weg-badge en stop bij sluiten', () => {
  const js = r('public/teacher-grid.js');
  assert.match(js, /quiz_live_data/);
  assert.match(js, /quiz_screenshot_update/);
  assert.match(js, /teacher_grid_stop/);
  assert.match(js, /weg uit de toets/);
  assert.match(js, /schermbeeld staat uit/);
  assert.match(r('public/teacher-grid.html'), /\.card-beeld/);
});

test('145 wizard: instelbaar per toets, in bevestigingsscherm, bewerken en dupliceren', () => {
  const html = r('public/quiz-teacher.html');
  assert.match(html, /id="quiz-live-screenshot-sec"/);
  const js = r('public/quiz-teacher.js');
  assert.match(js, /liveScreenshotSec: liveBeeldSec\(\)/);
  assert.match(js, /Schermbeeld live-overzicht/);
  assert.match(js, /setVal\('quiz-live-screenshot-sec'/);
  const sv = r('server.js');
  assert.ok((sv.match(/liveScreenshotSec/g) || []).length >= 6);
});
