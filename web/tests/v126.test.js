'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('126 klassenkiezer: Alle klassen volgt de afzonderlijke vinkjes', () => {
  const a = r('public/app.js');
  assert.match(a, /alleVink\.checked = vinkjes\.every/);
  assert.match(a, /vinkjes\.forEach[\s\S]{0,200}alleVink\.checked/);
});

test('126 fullscreen: inklappen, offline verborgen, slider-limiet', () => {
  const a = r('public/app.js');
  const h = r('public/teacher-app.html');
  const c = r('public/styles.css');
  assert.match(a, /TFS_MIN_CODE = 480/);
  assert.match(a, /TFS_MIN_SIDE = 320/);
  assert.match(a, /tfsClampSidebar/);
  for (const id of ['tfs-top-toggle', 'tfs-timer-toggle', 'tfs-timer-pill', 'tfs-count-opdracht', 'tfs-count-voorbeeld']) {
    assert.ok(h.includes('id="' + id + '"') || a.includes(id), id);
  }
  assert.match(h, /data-tfs-collapse="opdracht"/);
  assert.match(h, /data-tfs-collapse="voorbeeld"/);
  assert.match(h, /class="tfs-offline-block hidden" id="tfs-offline-block"/);
  assert.match(c, /\.tfs-offline-block \{ flex: none; height: auto; max-height/);
  assert.match(c, /\.tfs-collapsed/);
});

test('126 cursus in sessie: leerkracht, leerling, server, CSP', () => {
  const s = r('server.js');
  assert.match(s, /teacher_set_cursus/);
  assert.match(s, /cursus_update/);
  assert.match(s, /isValidCursusUrl/);
  assert.match(s, /\/student-app\.html/);
  const st = r('public/student-app.html');
  assert.match(st, /id="cursus-toggle-btn"/);
  assert.match(st, /id="cursus-panel"/);
  const t = r('public/teacher-app.html');
  assert.match(t, /id="cursus-vink"/);
  assert.match(t, /id="tfs-cursus-vink"/);
  assert.match(r('db/database.js'), /_cursus/);
});

test('126 geen native dialogs in nieuwe code', () => {
  const a = r('public/app.js');
  const i = a.indexOf('setupCursusBediening');
  assert.ok(i > 0);
  assert.doesNotMatch(a.slice(i, i + 4000), /\b(alert|confirm|prompt)\(/);
});
