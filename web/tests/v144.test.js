// v144 — fraude en inzicht: plakpogingen met tekst, tabdiagnose, extra signalen, fraudeblok
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const fraude = require('../lib/fraude');
const diag = require('../public/tabdiagnose');

const inc = (studentId, type, d, at = 1000) => ({ studentId, name: 'x', type, detail: typeof d === 'string' ? d : JSON.stringify(d), at });

test('144 fraude: parseDetail tolereert JSON, ruwe tekst en rommel', () => {
  assert.deepStrictEqual(fraude.parseDetail('{"q":"a","len":3}'), { q: 'a', len: 3 });
  assert.deepStrictEqual(fraude.parseDetail('hallo'), { tekst: 'hallo' });
  assert.deepStrictEqual(fraude.parseDetail('{kapot'), { tekst: '{kapot' });
  assert.deepStrictEqual(fraude.parseDetail(''), {});
  assert.deepStrictEqual(fraude.parseDetail(null), {});
});

test('144 fraude: groepeert per vraag en soort, telt en bewaart de geplakte tekst', () => {
  const l = [
    inc('s1', 'plakken', { q: 'v1', len: 12, tekst: 'print("hoi")' }, 1),
    inc('s1', 'plakken', { q: 'v1', len: 5, tekst: 'x = 1' }, 2),
    inc('s1', 'plakken', { q: 'v2', len: 3, tekst: 'abc' }, 3),
    inc('s1', 'kopieren', { q: 'v2', len: 4, tekst: 'abcd' }, 4),
    inc('s2', 'plakken', { q: 'v1', len: 1, tekst: 'z' }, 5),
  ];
  const g = fraude.groepeerFraude(l, 's1');
  assert.strictEqual(g.totaal, 4);
  assert.strictEqual(g.risico, 'hoog');
  const v1 = g.groepen.find(x => x.type === 'plakken' && x.vraag === 'v1');
  assert.strictEqual(v1.aantal, 2);
  assert.ok(v1.items[0].tekst.includes('print("hoi")'));
  assert.ok(v1.items[0].tekst.includes('12 tekens'));
  assert.strictEqual(g.groepen[0].risico, 'hoog');   // hoogste risico eerst
});

test('144 fraude: acties van de leerkracht en startbevestiging tellen niet als poging', () => {
  const g = fraude.groepeerFraude([inc('s1', 'toegang_hersteld', {}), inc('s1', 'startbevestiging', {}), inc('s1', 'deadline_aangepast', {})], 's1');
  assert.strictEqual(g.totaal, 0);
  assert.strictEqual(g.risico, null);
});

test('144 fraude: risico van weg_van_toets hangt van de duur af; sneltoetsen volgens zwaarte', () => {
  assert.strictEqual(fraude.risicoVan('weg_van_toets', { fase: 'weg' }), 'laag');
  assert.strictEqual(fraude.risicoVan('weg_van_toets', { fase: 'terug', secs: 5 }), 'laag');
  assert.strictEqual(fraude.risicoVan('weg_van_toets', { fase: 'terug', secs: 30 }), 'middel');
  assert.strictEqual(fraude.risicoVan('weg_van_toets', { fase: 'terug', secs: 120 }), 'hoog');
  assert.strictEqual(fraude.risicoVan('sneltoets', { toets: 'F12' }), 'middel');
  assert.strictEqual(fraude.risicoVan('sneltoets', { toets: 'Ctrl+P' }), 'laag');
  assert.strictEqual(fraude.risicoVan('grote_invoer', {}), 'hoog');
});

test('144 fraude: samenvatting is leesbaar voor elk nieuw type', () => {
  assert.match(fraude.samenvatting('grote_invoer', { delta: 120 }), /120 tekens in één keer/);
  assert.match(fraude.samenvatting('weinig_toetsen', { len: 300, keys: 12 }), /300 tekens.*12 toetsaanslagen/);
  assert.match(fraude.samenvatting('venster_kleiner', { w: 500, h: 400, basisW: 1200, basisH: 800 }), /500×400/);
  assert.match(fraude.samenvatting('weg_van_toets', { fase: 'terug', secs: 42, oorzaak: 'Alt+Tab (van venster gewisseld)' }), /Alt\+Tab.*42 s weg/);
  assert.match(fraude.samenvatting('plakken', { len: 600, tekst: 'a'.repeat(600) }), /…/);   // lange tekst afgekapt
});

test('144 fraude: plakTellingen per leerling en vraag (voor het gelijkenisrapport)', () => {
  const t = fraude.plakTellingen([inc('s1', 'plakken', { q: 'v1' }), inc('s1', 'plakken', { q: 'v1' }), inc('s1', 'slepen', { q: 'v2' }), inc('s1', 'kopieren', { q: 'v2' }), inc('s2', 'plakken', 'ruwe tekst')]);
  assert.deepStrictEqual(t.s1, { v1: 2, v2: 1 });
  assert.deepStrictEqual(t.s2, { '?': 1 });
});

test('144 gelijkenis: context bevat plakkenPerVraag; rapport toont "plakken vraag X: N×"', () => {
  assert.match(r('lib/gelijkenis.js'), /plakkenPerVraag/);
  const rv = r('public/quiz-review.js');
  assert.match(rv, /plakken \$\{i >= 0 \? 'vraag ' \+ \(i \+ 1\)/);
  assert.match(rv, /fraude-blok/);
  assert.match(rv, /Spiek-\/fraudepogingen/);
});

test('144 tabdiagnose: enkel systeemtoetsen worden herkend, nooit letters of cijfers', () => {
  assert.strictEqual(diag.systeemToetsLabel({ key: 'Meta', code: 'MetaLeft' }), 'Meta (zoek-/startknop)');
  assert.strictEqual(diag.systeemToetsLabel({ key: 'Tab', altKey: true }), 'Alt+Tab');
  assert.strictEqual(diag.systeemToetsLabel({ key: 'Tab', ctrlKey: true }), 'Ctrl+Tab');
  assert.strictEqual(diag.systeemToetsLabel({ key: 'F5' }), 'F5');
  assert.strictEqual(diag.systeemToetsLabel({ key: 'a' }), null);
  assert.strictEqual(diag.systeemToetsLabel({ key: '7' }), null);
  assert.strictEqual(diag.systeemToetsLabel({ key: 'p', ctrlKey: true }), null);
});

test('144 tabdiagnose: via welke rand verliet de muis het venster', () => {
  assert.strictEqual(diag.randVan(500, 799, 1000, 800), 'onder');
  assert.strictEqual(diag.randVan(900, 799, 1000, 800), 'rechtsonder');
  assert.strictEqual(diag.randVan(500, -1, 1000, 800), 'boven');
  assert.strictEqual(diag.randVan(-1, 300, 1000, 800), 'links');
  assert.strictEqual(diag.randVan(1001, 300, 1000, 800), 'rechts');
  assert.strictEqual(diag.randVan(NaN, 1, 1, 1), null);
});

test('144 tabdiagnose: oordeel volgt de prioriteit toets > muisrand > onbekend en vergeet oude gegevens', () => {
  const t = 100000;
  let o = diag.bouwOordeel({ event: 'blur', toetsen: [{ label: 'Meta (zoek-/startknop)', t: t - 500 }], rand: 'onder', randT: t - 200, t });
  assert.match(o.oorzaak, /Meta/);
  assert.strictEqual(o.ev, 'blur');
  assert.deepStrictEqual(o.toetsen, ['Meta (zoek-/startknop)']);
  o = diag.bouwOordeel({ event: 'blur', toetsen: [{ label: 'Alt+Tab', t: t - 100 }], t });
  assert.match(o.oorzaak, /Alt\+Tab/);
  o = diag.bouwOordeel({ event: 'visibilitychange', toetsen: [], rand: 'rechtsonder', randT: t - 1000, t });
  assert.match(o.oorzaak, /rechtsonder/);
  assert.strictEqual(o.rand, 'rechtsonder');
  o = diag.bouwOordeel({ event: 'blur', toetsen: [{ label: 'Meta (zoek-/startknop)', t: t - 20000 }], rand: 'onder', randT: t - 20000, t });
  assert.match(o.oorzaak, /onbekende oorzaak/);
  assert.strictEqual(o.rand, null);
  assert.deepStrictEqual(o.toetsen, []);
});

test('144 student: plakpogingen loggen vraag, lengte en tekst (max 500) met eigen dedupe', () => {
  const js = r('public/quiz-student.js');
  assert.match(js, /function meldBlokkade\(/);
  assert.match(js, /tekst\.slice\(0, 500\)|t\.slice\(0, 500\)/);
  assert.match(js, /getData\('text\/plain'\)/);
  assert.match(js, /startPlakProbe/);            // Ctrl+V: tekst lezen via een onzichtbaar veld
  assert.match(js, /geenRem: true/);
});

test('144 student: grote invoer, weinig toetsen, sneltoetsen, venster kleiner, wijziging na terugkeer', () => {
  const js = r('public/quiz-student.js');
  for (const t of ['grote_invoer', 'weinig_toetsen', 'sneltoets', 'venster_kleiner', 'wijziging_na_terugkeer']) assert.ok(js.includes("'" + t + "'"), t);
  assert.match(js, /GROTE_INVOER_MIN = 60/);
  for (const k of ['PrintScreen', 'F12', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C', 'Ctrl+P', 'Ctrl+S', 'Ctrl+U']) assert.ok(js.includes("'" + k + "'"), k);
  assert.match(js, /function ingevoegdStuk\(/);
  assert.match(js, /controleerWeinigToetsen\(\);\s*\/\/ v144/);
});

test('144 student: weggaan wordt meteen gemeld (fase weg) en bij terugkeer met duur (fase terug), met diagnose', () => {
  const js = r('public/quiz-student.js');
  assert.match(js, /fase: 'weg'/);
  assert.match(js, /fase: 'terug'/);
  assert.match(js, /TabDiagnose\.maakDiagnose/);
  assert.match(r('public/quiz-student.html'), /tabdiagnose\.js/);
});

test('144 server: route /fraude en roster telt elke wissel één keer', () => {
  const sv = r('server.js');
  assert.match(sv, /\/api\/quiz-sessions\/:code\/fraude/);
  assert.match(sv, /"fase":"terug"/);
});

test('144 nakijken: chip "zelf ingediend" vs "automatisch afgesloten"', () => {
  const rv = r('public/quiz-review.js');
  for (const k of ['Zelf ingediend', 'tabwissel', 'deadline', 'tijd om']) assert.ok(rv.includes(k), k);
});
