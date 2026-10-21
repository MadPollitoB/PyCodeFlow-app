'use strict';
// v122 — anti-fraude: broncode-garanties (de browserdetectie zelf is live getest in de sandbox).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const lees = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const client = lees('public/quiz-student.js');
const srv = lees('server.js');
const db = lees('db/database.js');
const app = lees('public/app.js');

test('v122: tweede scherm blokkeert het starten en wordt gelogd', () => {
  assert.match(client, /window\.screen && window\.screen\.isExtended === true/);
  assert.match(client, /meldIncident\('tweede_scherm_start'\)/);
  assert.match(client, /tweede-scherm-overlay/);
  assert.match(client, /meldIncident\('tweede_scherm'\)/);
});
test('v122: kopiëren, knippen, plakken en slepen worden geblokkeerd én gelogd', () => {
  for (const t of ['plakken', 'kopieren', 'knippen', 'slepen']) assert.match(client, new RegExp("'" + t + "'"));
  assert.match(client, /addEventListener\('beforeinput'/);
  assert.match(client, /insertFrom\(Paste\|Drop\|Yank\)/);
});
test('v122: klembord wordt leeggemaakt bij start en bij terugkeer', () => {
  assert.match(client, /function wisKlembord\(\)/);
  assert.match(client, /writeText\(''\)/);
  assert.match(client, /addEventListener\('focus'/);
});
test('v122: volledig scherm verlaten wordt gelogd', () => {
  assert.match(client, /meldIncident\('fullscreen_uit'\)/);
});
test('v122: server bewaart incidenten, met whitelist en limiet, en toont ze in de voortgang', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS quiz_incidents/);
  assert.match(srv, /socket\.on\('quiz_incident'/);
  assert.match(srv, /INCIDENT_TYPES = new Set\(/);
  assert.match(srv, /_incidentLog\.length >= 30/);
  assert.match(srv, /incidenten: incVoor\(/);
  assert.match(srv, /\/api\/quiz-sessions\/:code\/incidenten/);
  assert.match(srv, /logIncident\(normalizedCode, student\.id, student\.name, 'tabwissel'\)/);
  assert.match(app, /function incidentChips\(/);
  assert.match(app, /Incidenten/);
});
test('v122: geen native browserdialogen in de nieuwe code', () => {
  assert.doesNotMatch(client.slice(client.indexOf('v122: anti-fraude')), /\b(alert|confirm|prompt)\(/);
});
