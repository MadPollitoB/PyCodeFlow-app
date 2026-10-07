'use strict';
// v105: na indienen mogen vragen/antwoorden niet meer terugkomen (terug-knop, herladen, bfcache).
// Regressiewachters op de broncode; het gedrag zelf is live met Playwright gecontroleerd.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'quiz-student.js'), 'utf8');

test('server: ingediende leerling krijgt geen vragen/antwoorden meer in quiz_state', () => {
  assert.match(server, /questions: dichtGezet \? \[\] : vragenLijst/);
  assert.match(server, /savedAnswers: dichtGezet \? \{\} :/);
});
test('server: ingediend wordt ook uit de databank afgeleid (na serverherstart)', () => {
  assert.match(server, /savedAnswers\.every\(a => a\.submitted_at != null\)/);
});
test('server: leerlingpagina niet in cache (bfcache)', () => {
  assert.match(server, /magIngebedWorden\) res\.setHeader\('Cache-Control', 'no-store'\)/);
});
test('client: terug-knop, pageshow en onthouden-ingediend aanwezig', () => {
  assert.match(client, /addEventListener\('popstate'/);
  assert.match(client, /addEventListener\('pageshow'/);
  assert.match(client, /function wisVragenUitScherm/);
  assert.match(client, /markeerIngediend\(false\)/); // heropening maakt het weer open
});
