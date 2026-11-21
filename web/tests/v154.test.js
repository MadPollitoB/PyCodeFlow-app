// v154 — Wissen bij links verwijdert ook de plaats (zoals bij oefeningen en voorbeelden)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
test('154 Wissen bij een link: bij meerdere verdwijnt de plaats, de laatste blijft leeg staan', () => {
  const s = r('public/app.js');
  const i = s.indexOf("qs('link-clear-btn').addEventListener");
  const blok = s.slice(i, i + 700);
  assert.match(blok, /_linkDrafts\.length > 1\) \{ _linkDrafts\.splice\(_linkDraftIdx, 1\)/);
  assert.match(blok, /Math\.min\(_linkDraftIdx, _linkDrafts\.length - 1\)/);
  assert.match(blok, /_linkDrafts\[_linkDraftIdx\] = \{ titel: '', url: '' \}/);
  assert.match(r('public/teacher-app.html'), /1\/3 wordt 1\/2/);
});
