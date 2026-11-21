// v153 — Wissen van een oefening/voorbeeld verwijdert ook de plaats in de lijst (1/3 → 1/2)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('153 Wissen bij een oefening: bij meerdere verdwijnt de plaats, de laatste blijft leeg staan', () => {
  const s = r('public/app.js');
  const i = s.indexOf("qs('teacher-announcement-clear-btn')?.addEventListener");
  const blok = s.slice(i, i + 900);
  assert.match(blok, /if \(_announcementDrafts\.length > 1\) \{\s*_announcementDrafts\.splice\(_announcementDraftIdx, 1\)/);
  assert.match(blok, /Math\.min\(_announcementDraftIdx, _announcementDrafts\.length - 1\)/);
  assert.match(blok, /_announcementDrafts\[_announcementDraftIdx\] = ''/);
});

test('153 Wissen bij een codevoorbeeld: zelfde gedrag', () => {
  const s = r('public/app.js');
  const i = s.indexOf("qs('code-clear-btn')?.addEventListener");
  const blok = s.slice(i, i + 700);
  assert.match(blok, /if \(_codeDrafts\.length > 1\) \{\s*_codeDrafts\.splice\(_codeDraftIdx, 1\)/);
  assert.match(blok, /_codeDrafts\[_codeDraftIdx\] = ''/);
  assert.match(blok, /codeNavRender\(\); draftsStatusRender\(\)/);
});

test('153 versie en tooltips', () => {
  assert.match(r('VERSION').trim(), /^2026\.2\.51\.\d+$/);
  assert.match(r('public/teacher-app.html'), /1\/3 wordt 1\/2/);
  assert.match(r('public/teacher-app.html'), /1\/12 wordt 1\/11/);
});
