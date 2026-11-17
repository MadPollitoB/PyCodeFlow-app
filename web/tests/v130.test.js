'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('130 overzicht: wisselknoppen enkel bij afgerond/te verbeteren', () => {
  const j = r('public/assignment-overview.js');
  assert.match(j, /function snelVrijgave\(a\)/);
  assert.match(j, /a\.status !== 'te_verbeteren' && a\.status !== 'afgerond'\) return ''/);
  assert.match(j, /voortgangBalk\(a\) \+ snelVrijgave\(a\)/);
  assert.match(j, /a\.resultsReleased/);
  assert.match(j, /a\.reviewMode/);
});

test('130 overzicht: roept bestaande routes aan, wisselt de stand, geen native dialogs', () => {
  const j = r('public/assignment-overview.js');
  const i = j.indexOf('window.zetLeerlingRecht');
  assert.ok(i > 0);
  const blok = j.slice(i, i + 1400);
  assert.match(blok, /'\/review-mode' : '\/release'/);
  assert.match(blok, /enabled: !!aan/);
  assert.match(blok, /pyToast/);
  assert.match(blok, /reloadAssignments/);
  assert.doesNotMatch(blok, /\b(alert|confirm|prompt)\(/.source ? /(?<![a-zA-Z.])(alert|confirm|prompt)\(/ : /x/);
  assert.match(r('public/overzicht.css'), /\.ov-toggle\.aan/);
});

test('130 server: routes bestaan en zijn beveiligd', () => {
  const s = r('server.js');
  assert.match(s, /app\.post\('\/api\/quiz\/:code\/release', requireTeacherAuth, requireSessionAccess, requireCsrf/);
  assert.match(s, /app\.post\('\/api\/quiz\/:code\/review-mode', requireTeacherAuth, requireSessionAccess, requireCsrf/);
});

test('130 render: snelVrijgave geeft de juiste knoppen en standen', () => {
  const src = r('public/assignment-overview.js');
  const m = src.match(/function snelVrijgave\(a\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m);
  const f = new Function('esc', 'LABEL', m[0] + '; return snelVrijgave;')(s => String(s), 'toets');
  assert.strictEqual(f({ status: 'actief', code: 'AB' }), '');
  const uit = f({ status: 'afgerond', code: 'AB1', resultsReleased: false, reviewMode: false });
  assert.match(uit, /Scores vrijgeven/);
  assert.match(uit, /Nazicht openen/);
  assert.match(uit, /zetLeerlingRecht\('AB1','scores',true\)/);
  const aan = f({ status: 'te_verbeteren', code: 'AB1', resultsReleased: true, reviewMode: true });
  assert.match(aan, /intrekken/);
  assert.match(aan, /sluiten/);
  assert.match(aan, /zetLeerlingRecht\('AB1','scores',false\)/);
  assert.match(aan, /zetLeerlingRecht\('AB1','nazicht',false\)/);
});
