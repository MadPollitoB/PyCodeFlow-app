'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ph = require('../lib/placeholders.js');

const geheel = (naam, min, max) => ({ naam, type: 'geheel', min, max });

test('135 normaliseerVariabelen: geldige invoer', () => {
  const r1 = ph.normaliseerVariabelen([geheel('n', 2, 9), { naam: 'wie', type: 'keuze', waarden: [' Anna ', 'Bram', 'Anna'] }]);
  assert.deepStrictEqual(r1.fouten, []);
  assert.deepStrictEqual(r1.variabelen[1].waarden, ['Anna', 'Bram']);   // getrimd + ontdubbeld
  assert.deepStrictEqual(ph.normaliseerVariabelen('[]').variabelen, []);
  assert.deepStrictEqual(ph.normaliseerVariabelen(null).variabelen, []);
});

test('135 normaliseerVariabelen: foute invoer geeft een duidelijke fout', () => {
  const fout = (lijst) => ph.normaliseerVariabelen(lijst).fouten[0];
  assert.match(fout([geheel('1n', 1, 5)]), /Ongeldige naam/);
  assert.match(fout([geheel('n', 1, 5), geheel('n', 2, 6)]), /twee keer/);
  assert.match(fout([geheel('n', 5, 5)]), /min moet kleiner/);
  assert.match(fout([geheel('n', 1.5, 5)]), /gehele getallen/);
  assert.match(fout([geheel('n', 0, 9999999)]), /1\.000\.000/);
  assert.match(fout([{ naam: 'k', type: 'keuze', waarden: ['a'] }]), /minstens 2/);
  assert.match(fout([{ naam: 'k', type: 'keuze', waarden: ['a', 'x'.repeat(41)] }]), /40 tekens/);
  assert.match(fout(Array.from({ length: 9 }, (_, i) => geheel('v' + i, 1, 5))), /Maximaal 8/);
  assert.match(fout({ niet: 'een lijst' }), /lijst/);
  assert.deepStrictEqual(ph.normaliseerVariabelen([geheel('1n', 1, 5)]).variabelen, []);   // bij fouten niets teruggeven
});

test('135 rekenmachine: bewerkingen, Python-stijl en veiligheid', () => {
  const w = { a: 7, b: 3, naam: 'Anna' };
  const e = (s) => ph.evalueer(s, w);
  assert.strictEqual(e('a+b'), 10);
  assert.strictEqual(e('a*b-1'), 20);
  assert.strictEqual(e('(a+b)*2'), 20);
  assert.strictEqual(e('a//b'), 2);
  assert.strictEqual(e('a % b'), 1);
  assert.strictEqual(e('-a + 10'), 3);
  assert.strictEqual(e('2**b'), 8);
  assert.strictEqual(e('a/2'), 3.5);
  assert.strictEqual(e('naam'), 'Anna');
  assert.strictEqual(e('naam+1'), undefined);    // tekstvariabele in een berekening
  assert.strictEqual(e('onbekend'), undefined);
  assert.strictEqual(e('a/0'), undefined);       // delen door nul
  assert.strictEqual(e('a//0'), undefined);
  assert.strictEqual(e('a %0'), undefined);
  assert.strictEqual(e('9**99'), undefined);     // te groot
  assert.strictEqual(e('process.exit()'), undefined);
  assert.strictEqual(e('a;b'), undefined);
  assert.strictEqual(e('(a'), undefined);
  assert.strictEqual(e(''), undefined);
  assert.strictEqual(e('-7 % 3'), 2);            // modulo zoals Python
});

test('135 vulIn: tokens ingevuld, onbekende/vreemde tokens ongemoeid', () => {
  const w = { n: 5, wie: 'Bram' };
  assert.strictEqual(ph.vulIn('{{wie}} telt tot {{n}}; dubbel: {{ n*2 }}.', w), 'Bram telt tot 5; dubbel: 10.');
  assert.strictEqual(ph.vulIn('geen {{x}} hier', w), 'geen {{x}} hier');
  assert.strictEqual(ph.vulIn('set {{1,2}} blijft', w), 'set {{1,2}} blijft');          // geen reken-inhoud
  assert.strictEqual(ph.vulIn('f"{n}" blijft', w), 'f"{n}" blijft');                     // enkele accolades blijven
  assert.strictEqual(ph.vulIn('{{n/3}}', w), '1.6667');
  assert.strictEqual(ph.vulIn(null, w), null);
  assert.strictEqual(ph.vulIn('niets', w), 'niets');
});

test('135 waarden: deterministisch per seed, verschillend tussen leerlingen, binnen het bereik', () => {
  const v = ph.normaliseerVariabelen([geheel('n', 3, 12), { naam: 'wie', type: 'keuze', waarden: ['A', 'B', 'C', 'D'] }]).variabelen;
  const s1 = ph.seedVoor('SES', 'leerling1', 'vraag1');
  assert.deepStrictEqual(ph.berekenWaarden(v, s1), ph.berekenWaarden(v, s1));
  const ontdekt = new Set();
  for (let i = 0; i < 300; i++) {
    const w = ph.berekenWaarden(v, ph.seedVoor('SES', 'l' + i, 'vraag1'));
    assert.ok(w.n >= 3 && w.n <= 12 && Number.isInteger(w.n));
    assert.ok(['A', 'B', 'C', 'D'].includes(w.wie));
    ontdekt.add(w.n);
  }
  assert.strictEqual(ontdekt.size, 10, 'alle 10 waarden komen voor');
  assert.notDeepStrictEqual(ph.berekenWaarden(v, ph.seedVoor('SES', 'a', 'q')), ph.berekenWaarden(v, ph.seedVoor('SES', 'b', 'q')));
});

test('135 waarden: eerlijk verdeeld', () => {
  const v = ph.normaliseerVariabelen([geheel('n', 1, 4)]).variabelen;
  const teller = {};
  for (let i = 0; i < 4000; i++) { const n = ph.berekenWaarden(v, 'S|' + i + '|q').n; teller[n] = (teller[n] || 0) + 1; }
  for (const k of [1, 2, 3, 4]) assert.ok(Math.abs(teller[k] - 1000) < 150, `${k}: ${teller[k]}`);
});

test('135 controleerTokens: onbekende variabele of fout in de formule', () => {
  const v = ph.normaliseerVariabelen([geheel('n', 2, 9)]).variabelen;
  assert.deepStrictEqual(ph.controleerTokens(v, ['{{n}} en {{n*2+1}}']), []);
  assert.match(ph.controleerTokens(v, ['{{m}}'])[0], /m/);
  assert.match(ph.controleerTokens(v, ['{{n/0}}'])[0], /berekend/);
  assert.deepStrictEqual(ph.controleerTokens([], ['{{iets}}']), []);          // geen variabelen → niets te controleren
  assert.deepStrictEqual(ph.controleerTokens(v, ['set {{1,2}}']), []);        // geen reken-inhoud → genegeerd
});

test('135 vulVraagIn: tekst, opties, modelantwoord en onderdelen; kopie met eigen waarden', () => {
  const q = {
    id: 'Q1', text_snapshot: 'Som van 1 tot {{n}}?', model_answer: 'print({{n*(n+1)//2}})',
    choices_json: JSON.stringify([{ id: 'a', text: '{{n*(n+1)//2}}', correct: true }, { id: 'b', text: '{{n+1}}', correct: false }]),
    answer_parts: JSON.stringify([{ id: 'p1', type: 'open', label: 'Reken {{n}}*2', points: 1, modelAnswer: '{{n*2}}' }]),
    variables_json: JSON.stringify([geheel('n', 2, 9)]),
  };
  const a = ph.vulVraagIn(q, 'SES', 'leerling-a');
  const n = a._waarden.n;
  assert.strictEqual(a.text_snapshot, `Som van 1 tot ${n}?`);
  assert.strictEqual(a.model_answer, `print(${n * (n + 1) / 2})`);
  const keuzes = JSON.parse(a.choices_json);
  assert.strictEqual(keuzes[0].text, String(n * (n + 1) / 2));
  assert.strictEqual(keuzes[0].correct, true);            // juist-vlag en id blijven
  assert.strictEqual(keuzes[0].id, 'a');
  const delen = JSON.parse(a.answer_parts);
  assert.strictEqual(delen[0].label, `Reken ${n}*2`);
  assert.strictEqual(delen[0].modelAnswer, String(n * 2));
  assert.strictEqual(q.text_snapshot, 'Som van 1 tot {{n}}?', 'origineel blijft onaangeroerd');
  const nog = ph.vulVraagIn(q, 'SES', 'leerling-a');
  assert.strictEqual(nog.text_snapshot, a.text_snapshot, 'zelfde leerling → zelfde tekst');
});

test('135 vulVraagIn: zonder variabelen exact hetzelfde object (geen risico voor bestaande vragen)', () => {
  const q = { id: 'Q', text_snapshot: 'print({{x}})', variables_json: '[]' };
  assert.strictEqual(ph.vulVraagIn(q, 'S', 'l'), q);
  const q2 = { id: 'Q', text_snapshot: 'x' };
  assert.strictEqual(ph.vulVraagIn(q2, 'S', 'l'), q2);
  assert.strictEqual(ph.vulVraagIn(null, 'S', 'l'), null);
});

test('135 voorbeelden voor de editor: 3 verschillende invullingen', () => {
  const uit = ph.voorbeeldVoorbeelden({ text: 'n={{n}}', variables_json: JSON.stringify([geheel('n', 1, 1000)]), choices_json: '[]', answer_parts: '[]' }, 3);
  assert.strictEqual(uit.length, 3);
  assert.ok(new Set(uit.map(x => x.vraag.text)).size > 1);
});

test('135 database: kolommen, opslag, import', () => {
  const d = r('db/database.js');
  assert.match(d, /ALTER TABLE question_bank ADD COLUMN variables_json TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(d, /ALTER TABLE quiz_question_snapshots ADD COLUMN variables_json TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(d, /title, variables_json\)/);
  assert.match(d, /variables_json=\$15/);
  assert.match(d, /random_group, variables_json, difficulty\)/);   // v137
  assert.match(d, /it\.variabelen \?\? it\.variables/);
  assert.match(d, /q\.variables_json,\n\s+a\.code,/);   // getMyResult levert de variabelen mee
  assert.match(d, /variablesJson: q\.variables_json \|\| '\[\]',   \/\/ v135/);   // bank-dupliceren
});

test('135 server: alle leerlinggerichte uitvoer vult placeholders in', () => {
  const s = r('server.js');
  assert.match(s, /vragenLijst\.map\(q => placeholdersLib\.vulVraagIn\(q, normalizedCode, student\.id\)\)/);   // quiz_state
  assert.match(s, /buildMyResult\(rows\.map\(r => placeholdersLib\.vulVraagIn/);                                 // nazicht leerling
  assert.match(s, /\/api\/quiz\/:code\/vragen-van\/:studentId/);                                                 // nakijkscherm leerkracht
  assert.strictEqual((s.match(/placeholdersLib\.vulVraagIn\(q, (sessionCode|code), stud\.id\)/g) || []).length, 2); // PDF's
  assert.match(s, /placeholdersLib\.vulVraagIn\(\{ \.\.\.item\.antwoord, id: item\.antwoord\.question_id \}/);  // AI-nakijken
  assert.match(s, /valideerVariabelen\(variables,/);
  assert.match(s, /variablesJson: bank\?\.variables_json \|\| '\[\]'/);
});

test('135 client: editor, voorbeeld en nakijkscherm', () => {
  assert.match(r('public/quiz-bank.html'), /id="vars-list"/);
  assert.match(r('public/quiz-bank.js'), /function previewVariabelen/);
  assert.match(r('public/quiz-bank.js'), /variables:\s+varsVoorServer\(\)/);
  assert.match(r('public/quiz-review.js'), /vragen-van\/\$\{encodeURIComponent\(studentId\)\}/);
});
