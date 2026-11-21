// v149 — toegang herstellen vanuit het verbeterscherm, met "nog X minuten vanaf nu"
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const herstel = require('../lib/herstel');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const T = (u, m = 0) => new Date(2026, 10, 19, u, m).getTime();

test('149 lib: zonder timer en deadline is "vanaf nu" met gekozen minuten EXACT dat aantal', () => {
  const now = T(20, 0);
  const p = herstel.berekenHerstel({ start: null, noTimer: true, stoppedAt: T(19), extraMinuten: 10, extraModus: 'vanafNu', now });
  assert.strictEqual(p.individueelTot, now + 10 * 60000);
});
test('149 lib: zonder keuze blijft het veiligheidsvenster van 15 minuten', () => {
  const now = T(20, 0);
  const p = herstel.berekenHerstel({ start: null, noTimer: true, stoppedAt: T(19), extraMinuten: 0, now });
  assert.strictEqual(p.individueelTot, now + 15 * 60000);
  // en "eind"-modus (oud gedrag) blijft ongewijzigd
  const q = herstel.berekenHerstel({ start: null, noTimer: true, stoppedAt: T(19), extraMinuten: 10, extraModus: 'eind', now });
  assert.strictEqual(q.individueelTot, now + 15 * 60000);
});
test('149 lib: met timer eindigt hij exact over X minuten; een latere eigen eindtijd blijft behouden', () => {
  const now = T(20, 0);
  const a = herstel.berekenHerstel({ start: T(19, 0), timerSeconds: 3600, extraMinuten: 10, extraModus: 'vanafNu', now });
  assert.strictEqual(a.eigenEind, now + 10 * 60000, 'tijd was op → nu + 10');
  const b = herstel.berekenHerstel({ start: T(19, 50), timerSeconds: 3600, extraMinuten: 10, extraModus: 'vanafNu', now });
  assert.strictEqual(b.eigenEind, T(20, 50), 'eigen eindtijd later dan nu + 10 → behouden');
});
test('149 verbeterscherm: knop, chip, polling en hergebruik van het herstelvenster', () => {
  const c = r('public/quiz-review.js');
  assert.match(c, /herstelVanuitNazicht/);
  assert.match(c, /Toegang herstellen<\/button>/);
  assert.match(c, /reopen-open/);
  assert.match(c, /heropendChip/);
  assert.match(c, /bron: 'nazicht'/);
  assert.match(c, /Al verbeterd|verbeterd/);
  assert.match(r('public/quiz-review.html'), /\.chip-heropend/);
});
test('149 venster: presets, eigen aantal, live voorbeeld en bron worden meegestuurd', () => {
  const a = r('public/app.js');
  const f = a.slice(a.indexOf('window.herstelLeerling'), a.indexOf('window.heropenLeerling'));
  assert.match(f, /Hoeveel tijd krijgt hij vanaf nu/);
  assert.match(f, /\[5, 10, 15, 30\]/);
  assert.match(f, /herstel-voorbeeld/);
  assert.match(f, /bron: opties\.bron/);
  assert.match(f, /nooit een 0/);
  assert.match(f, /eigen eindtijd valt later/);
});
test('149 server: herstel-info geeft individueelTot terug en het logboek kent de bron', () => {
  const s = r('server.js');
  assert.match(s, /individueelTot: r\.plan\.individueelTot/);
  assert.match(s, /bron: req\.body\?\.bron === 'nazicht' \? 'verbeterscherm' : 'monitoring'/);
});
test('149 versie', () => assert.match(r('VERSION').trim(), /^2026\.2\.51\.\d+$/));
