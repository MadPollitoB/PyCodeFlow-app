// v137 — klasbord met tijd, pool met gelijke punten/niveaumix/telling, placeholders met voorwaarde + controle, moeilijkheidsrapport
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/placeholders');
const V = require('../lib/vragenpool');
const M = require('../lib/moeilijkheid');
const r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ── placeholders ──────────────────────────────────────────────────────────────
test('137 voorwaarden: vergelijkingen, and/or, modulo, fouten', () => {
  assert.strictEqual(P.evalueerVoorwaarde('a > b', { a: 3, b: 2 }), true);
  assert.strictEqual(P.evalueerVoorwaarde('a > b', { a: 2, b: 2 }), false);
  assert.strictEqual(P.evalueerVoorwaarde('n % 2 == 0 and n > 3', { n: 4 }), true);
  assert.strictEqual(P.evalueerVoorwaarde('n % 2 == 0 and n > 3', { n: 2 }), false);
  assert.strictEqual(P.evalueerVoorwaarde('a == b || (a + b) < 3', { a: 1, b: 1 }), true);
  assert.strictEqual(P.evalueerVoorwaarde('wie != x', { wie: 'Anna', x: 'Bram' }), true);
  assert.strictEqual(P.evalueerVoorwaarde('a >', { a: 1 }), undefined);
  assert.strictEqual(P.evalueerVoorwaarde('a > 1; drop', { a: 1 }), undefined, 'geen vreemde tekens');
  assert.strictEqual(P.evalueerVoorwaarde('', {}), true);
});

const vars = [{ naam: 'a', type: 'geheel', min: 1, max: 9 }, { naam: 'b', type: 'geheel', min: 1, max: 9 }];
test('137 normaliseerVariabelen: voorwaarde staat los in de lijst en wordt gevalideerd', () => {
  const nv = P.normaliseerVariabelen([...vars, { voorwaarde: 'a > b' }]);
  assert.strictEqual(nv.variabelen.length, 2); assert.strictEqual(nv.voorwaarde, 'a > b'); assert.deepStrictEqual(nv.fouten, []);
  assert.ok(P.normaliseerVariabelen([...vars, { voorwaarde: 'a >' }]).fouten.length, 'ongeldige voorwaarde → fout');
  assert.deepStrictEqual(P.opslagVan(nv.variabelen, nv.voorwaarde).slice(-1), [{ voorwaarde: 'a > b' }]);
  assert.strictEqual(P.opslagVan(nv.variabelen, '').length, 2);
  assert.strictEqual(P.heeftVariabelen({ variables_json: JSON.stringify([{ voorwaarde: 'a>b' }]) }), false, 'enkel een voorwaarde is geen placeholder');
  assert.strictEqual(P.heeftVariabelen({ variables_json: JSON.stringify(P.opslagVan(vars, 'a>b')) }), true);
});

test('137 waarden: voorwaarde wordt altijd gerespecteerd, deterministisch, en zonder voorwaarde onveranderd t.o.v. v135', () => {
  const nv = P.normaliseerVariabelen(P.opslagVan(vars, 'a > b'));
  for (let i = 0; i < 200; i++) {
    const w = P.berekenWaarden(nv.variabelen, 'S|' + i, nv.voorwaarde);
    assert.ok(w.a > w.b, `a>b voor seed ${i}: ${JSON.stringify(w)}`);
    assert.deepStrictEqual(w, P.berekenWaarden(nv.variabelen, 'S|' + i, nv.voorwaarde));
  }
  // zonder voorwaarde: identiek aan de eerste trekking (bestaande toetsen krijgen dezelfde waarden)
  const zonder = P.berekenWaarden(vars, 'S|x');
  assert.deepStrictEqual(zonder, P.berekenWaarden(vars, 'S|x', ''));
  const q = { id: 'q1', text: '{{a}} en {{b}}', variables_json: JSON.stringify(P.opslagVan(vars, 'a > b')) };
  const gevuld = P.vulVraagIn(q, 'CODE', 'l1');
  const m = /^(\d+) en (\d+)$/.exec(gevuld.text); assert.ok(m && Number(m[1]) > Number(m[2]));
  assert.deepStrictEqual(P.waardenVoorVraag(q, 'CODE', 'l1', 'q1'), gevuld._waarden);
});

test('137 telCombinaties en controleerCombinaties: onmogelijke situaties worden gevonden', () => {
  assert.deepStrictEqual(P.telCombinaties(vars, ''), { aantal: 81, exact: true, onmogelijk: false });
  assert.strictEqual(P.telCombinaties(vars, 'a > b').aantal, 36);
  assert.strictEqual(P.telCombinaties(vars, 'a > 20').onmogelijk, true);
  const groot = [{ naam: 'n', type: 'geheel', min: 1, max: 1000 }, { naam: 'm', type: 'geheel', min: 1, max: 1000 }];
  const t = P.telCombinaties(groot, 'n > m');
  assert.strictEqual(t.exact, false); assert.ok(t.aantal > 400000 && t.aantal < 600000, 'schatting ± 500 000: ' + t.aantal);

  const delen = P.controleerCombinaties([{ naam: 'a', type: 'geheel', min: 0, max: 3 }], '', { text: '{{10//a}}' });
  assert.ok(delen.fouten.length && /nul|a=0/.test(delen.fouten[0]), delen.fouten.join());
  assert.deepStrictEqual(P.controleerCombinaties([{ naam: 'a', type: 'geheel', min: 1, max: 3 }], '', { text: '{{10//a}}' }).fouten, []);
  assert.ok(P.controleerCombinaties([{ naam: 'a', type: 'geheel', min: 0, max: 3 }], 'a > 0', { text: '{{10//a}}' }).fouten.length === 0, 'voorwaarde sluit a=0 uit');
  const dubbel = P.controleerCombinaties([{ naam: 'n', type: 'geheel', min: 1, max: 3 }], '', { text: 'x', choices_json: [{ text: '{{n}}' }, { text: '{{n*n-n+1}}' }] });
  assert.ok(dubbel.fouten.some(f => /dezelfde tekst/.test(f)), 'bij n=1 geven beide opties 1: ' + dubbel.fouten.join());
  assert.ok(P.controleerCombinaties([{ naam: 'a', type: 'geheel', min: 1, max: 4 }], '', { text: '{{10/a}}' }).waarschuwingen.some(w => /geheel getal/.test(w)));
  assert.ok(P.controleerCombinaties([{ naam: 'a', type: 'geheel', min: 1, max: 4 }, { naam: 'z', type: 'geheel', min: 1, max: 4 }], '', { text: '{{a}}' }).waarschuwingen.some(w => /z/.test(w)), 'ongebruikte placeholder');
});

// ── pool ───────────────────────────────────────────────────────────────────────
const q = (id, g, d, p = 2) => ({ id, random_group: g, difficulty: d, points: p });
const lijst = [q('a', 0, 'makkelijk'), q('b', 0, 'makkelijk'), q('c', 0, 'gemiddeld'), q('d', 0, 'moeilijk'), q('e', 0, 'moeilijk'), q('f', 1, 'gemiddeld'), q('g', 1, 'gemiddeld'), q('h', 1, 'gemiddeld')];

test('137 pool: niveaumix wordt gezuiverd en elke trekking heeft exact de mix', () => {
  const pool = V.normaliseerPool({ 0: { n: 3, mix: { makkelijk: 1, gemiddeld: 1, moeilijk: 1 } }, 1: 2 }, lijst);
  assert.deepStrictEqual(pool[0], { n: 3, mix: { makkelijk: 1, gemiddeld: 1, moeilijk: 1 } });
  assert.strictEqual(pool[1], 2);
  assert.strictEqual(V.poolActief(pool), true);
  for (let i = 0; i < 200; i++) {
    const t = V.trekVragen(lijst, pool);
    assert.strictEqual(t.length, 5);
    const g0 = t.filter(x => x.random_group === 0);
    assert.deepStrictEqual(['makkelijk', 'gemiddeld', 'moeilijk'].map(k => g0.filter(x => x.difficulty === k).length), [1, 1, 1]);
    assert.strictEqual(new Set(t.map(x => x.id)).size, 5);
    assert.deepStrictEqual(t.map(x => x.id), [...t.map(x => x.id)].sort(), 'oorspronkelijke volgorde blijft');
  }
  // onmogelijke mixen vallen terug op "trek N"
  assert.strictEqual(V.normaliseerPool({ 0: { n: 3, mix: { makkelijk: 3 } } }, lijst)[0], 3, 'maar 2 makkelijke beschikbaar');
  assert.strictEqual(V.normaliseerPool({ 0: { n: 3, mix: { makkelijk: 1, moeilijk: 1 } } }, lijst)[0], 3, 'som ≠ N');
  assert.strictEqual(V.poolN(pool[0]), 3);
});

test('137 pool: gelijke punten per groep', () => {
  assert.deepStrictEqual(V.controleerGelijkePunten(lijst, { 0: 3 }), []);
  const ongelijk = [q('a', 0, 'x', 1), q('b', 0, 'x', 2), q('c', 0, 'x', 2), q('d', 1, 'x', 5), q('e', 1, 'x', 6)];
  assert.deepStrictEqual(V.controleerGelijkePunten(ongelijk, { 0: 2, 1: 1 }), [{ nr: 0, punten: [1, 2] }, { nr: 1, punten: [5, 6] }]);
  assert.deepStrictEqual(V.controleerGelijkePunten(ongelijk, {}), [], 'zonder pool geen eis');
  assert.deepStrictEqual(V.controleerGelijkePunten(ongelijk, { 1: 1 }).map(g => g.nr), [1], 'enkel groepen mét pool');
});

test('137 pool: aantal unieke toetsen (exact, met niveaumix en placeholders)', () => {
  assert.strictEqual(V.telUniekeToetsen(lijst, { 0: 3, 1: 2 }).totaal, String(10 * 3));
  const mix = V.normaliseerPool({ 0: { n: 3, mix: { makkelijk: 1, gemiddeld: 1, moeilijk: 1 } }, 1: 2 }, lijst);
  const t = V.telUniekeToetsen(lijst, mix);
  assert.strictEqual(t.perGroep[0].aantal, String(2 * 1 * 2));   // 2 makkelijk × 1 gemiddeld × 2 moeilijk
  assert.strictEqual(t.perGroep[0].metMix, true);
  assert.strictEqual(t.totaal, String(4 * 3));
  // placeholders: vraag c heeft 4 invullingen → e_3 met gewichten
  assert.strictEqual(V.telUniekeToetsen(lijst, mix, { c: 4 }).perGroep[0].aantal, String(2 * 4 * 2));
  // zonder pool: enkel de product van de invullingen
  assert.strictEqual(V.telUniekeToetsen(lijst, {}, { a: 3, b: 2 }).totaal, '6');
  // controle: brute force voor een kleine groep met gewichten
  const kl = [q('a', 0, 'x'), q('b', 0, 'x'), q('c', 0, 'x'), q('d', 0, 'x')]; const w = { a: 2, b: 3, c: 1, d: 5 };
  let brute = 0; const ids = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) brute += w[ids[i]] * w[ids[j]];
  assert.strictEqual(V.telUniekeToetsen(kl, { 0: 2 }, w).totaal, String(brute));
  // heel grote aantallen blijven exact (BigInt)
  const grote = Array.from({ length: 40 }, (_, i) => q('v' + i, 0, 'x'));
  assert.strictEqual(V.telUniekeToetsen(grote, { 0: 20 }).totaal, '137846528820');
});

// ── moeilijkheidsrapport ──────────────────────────────────────────────────────
const rij = (l, v, score, d, p = 2) => ({ student_id: l, student_name: 'L' + l, question_id: v, points: p, score, difficulty: d, order_index: v.charCodeAt(0), text_snapshot: 'Vraag ' + v });
test('137 moeilijkheid: vraagoordeel, setzwaarte en uitsluitingen', () => {
  const rijen = [];
  for (let l = 1; l <= 6; l++) {
    rijen.push(rij(l, 'a', 2, 'moeilijk'));                 // iedereen volledig juist bij "moeilijk" → makkelijker dan ingesteld
    rijen.push(rij(l, 'b', l === 1 ? 2 : 0, 'makkelijk'));  // bijna niemand juist bij "makkelijk" → moeilijker dan ingesteld
  }
  rijen.push({ ...rij(7, 'a', 0, 'moeilijk'), is_test_account: true }, { ...rij(8, 'a', 0, 'moeilijk'), student_status: 'afwezig' }, rij(9, 'c', null, 'gemiddeld'));
  const rap = M.bouwRapport(rijen);
  const va = rap.vragen.find(v => v.vraagId === 'a'), vb = rap.vragen.find(v => v.vraagId === 'b'), vc = rap.vragen.find(v => v.vraagId === 'c');
  assert.strictEqual(va.aantal, 6); assert.strictEqual(va.gemiddeldePct, 100); assert.strictEqual(va.signaal, 'makkelijker');
  assert.strictEqual(vb.signaal, 'moeilijker'); assert.strictEqual(vb.slaagPct, 16.7);
  assert.strictEqual(vc.signaal, null, 'te weinig data / niet nagekeken'); assert.strictEqual(vc.nietNagekeken, 1);
  assert.strictEqual(rap.samenvatting.afwijkendeVragen, 2);
});

test('137 moeilijkheid: leerling met zwaardere set wordt herkend', () => {
  // vraag E is makkelijk (iedereen juist), vraag Z is moeilijk (niemand juist). L1 kreeg E+Z, L2 kreeg enkel makkelijke, L3 enkel moeilijke.
  const rijen = [];
  for (let l = 1; l <= 6; l++) {
    const vragen = l % 3 === 1 ? ['E', 'Z'] : l % 3 === 2 ? ['E', 'F'] : ['Z', 'Y'];
    for (const v of vragen) rijen.push(rij(l, v, 'EF'.includes(v) ? 2 : 0, 'EF'.includes(v) ? 'makkelijk' : 'moeilijk'));
  }
  const rap = M.bouwRapport(rijen, { minLeerlingen: 2 });
  const per = Object.fromEntries(rap.leerlingen.map(l => [l.id, l]));
  assert.strictEqual(per['3'].setZwaarte, 'zwaarder'); assert.strictEqual(per['2'].setZwaarte, 'lichter'); assert.strictEqual(per['1'].setZwaarte, 'gelijk');
  assert.ok(rap.samenvatting.spreiding >= 50);
  assert.ok(per['3'].verwachtPct < per['2'].verwachtPct);
});

// ── statische controles ────────────────────────────────────────────────────────
test('137 server: eindpunten, validatie en opslag', () => {
  const s = r('server.js');
  assert.match(s, /\/api\/quiz\/pool-telling/);
  assert.match(s, /\/api\/quiz\/:code\/moeilijkheidsrapport/);
  assert.strictEqual((s.match(/controleerGelijkePunten\(poolVragen, poolGezuiverd\)/g) || []).length, 2, 'bij aanmaken én bewerken');
  assert.match(s, /placeholdersLib\.controleerCombinaties\(nv\.variabelen, nv\.voorwaarde, vraag\)/);
  assert.match(s, /nu: Date\.now\(\)/);
  const d = r('db/database.js');
  assert.match(d, /ALTER TABLE quiz_question_snapshots ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'gemiddeld'/);
  assert.match(d, /placeholdersLib\.controleerCombinaties/);
});

test('137 client: klasbord, pool, bank-editor, rapporten', () => {
  const b = r('public/toets-bord.js');
  assert.match(b, /function tijdTekst/); assert.ok(!/vraag ' \+ l\.vraag/.test(b), 'geen vraagnummer meer');
  assert.match(r('public/toets-bord.html'), /id="bord-code-groot"/);
  const t = r('public/quiz-teacher.js');
  assert.match(t, /function wisselMix/); assert.match(t, /function laadPoolTelling/); assert.match(t, /poolGroepenMetOngelijkePunten/);
  const bank = r('public/quiz-bank.js');
  assert.match(bank, /function zetVarsAan/); assert.match(bank, /function syncVars/); assert.match(bank, /variables:\s+varsVoorServer\(\)/);
  assert.match(r('public/quiz-bank.html'), /id="q-vars-aan"/); assert.match(r('public/quiz-bank.html'), /id="vars-voorwaarde"/);
  assert.match(r('public/quiz-review.html'), /id="moeilijkheid-modal"/);
  assert.match(r('public/quiz-review.js'), /function renderMoeilijkheid/);
});
