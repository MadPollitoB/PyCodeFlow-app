// v136 — Gelijkenisrapport
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('../lib/gelijkenis');

const code1 = 'def som(n):\n    totaal = 0\n    for i in range(n):\n        totaal += i\n    return totaal\nprint(som(10))';
const hernoemd = 'def bereken(x):\n    r = 0\n    for k in range(x):\n        r += k\n    return r\nprint(bereken(10))';
const anders = 'a = int(input())\nb = int(input())\nprint(a * b + 7)\nprint("klaar met rekenen")';

test('tokens/normalisatie negeren commentaar en hoofdletters', () => {
  assert.strictEqual(g.normaliseerTekst('  X = 1   # opmerking\nY=2 '), 'x = 1 y=2');
  assert.deepStrictEqual(g.structuur('x = 5 + y'), ['ID', '=', 'NUM', '+', 'ID']);
});

test('te korte antwoorden worden niet vergeleken', () => {
  assert.strictEqual(g.vergelijkAntwoorden('print(1)', 'print(1)'), null);
});

test('identieke code → 100%, hernoemde code → hoge structuur maar lagere tekst', () => {
  const gelijk = g.vergelijkAntwoorden(code1, code1);
  assert.strictEqual(gelijk.tekst, 100);
  const h = g.vergelijkAntwoorden(code1, hernoemd);
  assert.strictEqual(h.structuur, 100);
  assert.ok(h.tekst < 100);
  const x = g.vergelijkAntwoorden(code1, anders);
  assert.ok(x.tekst < 60 && x.structuur < 70);
});

const rij = (leerling, vraag, extra) => ({ student_id: leerling, student_name: 'L' + leerling, question_id: vraag, text_snapshot: 'Vraag ' + vraag,
  question_type: 'code', code: '', points: 2, saved_at: 1000000, submitted_at: 2000000, selected_choices: '[]', ...extra });

test('rapport: paren met gelijke code, hernoemde code en afwijkende leerling', () => {
  const rijen = [rij('1', 'q1', { code: code1 }), rij('2', 'q1', { code: code1 }), rij('3', 'q1', { code: hernoemd }), rij('4', 'q1', { code: anders })];
  const rap = g.bouwRapport(g.eenhedenUit(rijen));
  const sleutel = (p) => p.leerling1.id + p.leerling2.id;
  const m = Object.fromEntries(rap.paren.map(p => [sleutel(p), p]));
  assert.ok(m['12'] && m['12'].items[0].tekstPct === 100);
  assert.ok(m['13'] && m['13'].items[0].hernoemd === true);
  assert.ok(!Object.keys(m).some(k => k.includes('4')), 'leerling 4 is niet verdacht');
  assert.strictEqual(rap.paren[0].leerling1.id + rap.paren[0].leerling2.id, '12', 'sterkste paar bovenaan');
  assert.ok(rap.perVraag.some(x => x.student1.id === '1' && x.student2.id === '2' && x.similarity === 100), 'oud formaat blijft beschikbaar');
});

test('testaccounts en afwezige leerlingen tellen niet mee', () => {
  const rijen = [rij('1', 'q1', { code: code1 }), rij('2', 'q1', { code: code1, is_test_account: true }), rij('3', 'q1', { code: code1, student_status: 'afwezig' })];
  assert.strictEqual(g.bouwRapport(g.eenhedenUit(rijen)).paren.length, 0);
});

test('meerkeuze: gedeelde zeldzame foute keuze telt, veelgemaakte fout niet', () => {
  const mc = (l, v, keuze, score) => rij(l, v, { question_type: 'single', selected_choices: JSON.stringify(keuze), score, points: 2 });
  // q1: leerlingen 1 en 2 kozen als enigen B (fout); q2 idem; leerlingen 3..8 hebben het juist
  const rijen = [];
  for (const v of ['q1', 'q2']) {
    rijen.push(mc('1', v, ['B'], 0), mc('2', v, ['B'], 0));
    for (const l of ['3', '4', '5', '6', '7', '8']) rijen.push(mc(l, v, ['A'], 2));
  }
  const rap = g.bouwRapport(g.eenhedenUit(rijen));
  assert.strictEqual(rap.paren.length, 1);
  assert.strictEqual(rap.paren[0].gedeeldeFouten, 2);
  assert.ok(rap.paren[0].punten >= 4);
  // als 7 van 8 dezelfde fout maken is het geen signaal
  const veel = [];
  for (const l of ['1', '2', '3', '4', '5', '6', '7']) veel.push(mc(l, 'q9', ['B'], 0));
  veel.push(mc('8', 'q9', ['A'], 2));
  assert.strictEqual(g.bouwRapport(g.eenhedenUit(veel)).paren.length, 0);
});

test('meerkeuze: volgorde van keuzes speelt geen rol', () => {
  assert.strictEqual(g.keuzeSleutel(['b', 'a']), g.keuzeSleutel(['a', 'b']));
});

test('placeholders: zelfde antwoord ondanks andere waarden, en vreemde waarde', () => {
  const waarden = { '1': { n: '12' }, '2': { n: '47' } };
  const tekst = (n) => `def som():\n    totaal = 0\n    for i in range(${n}):\n        totaal += i\n    return totaal\nprint(som())`;
  const rijen = [rij('1', 'q1', { code: tekst(47) }), rij('2', 'q1', { code: tekst(47) })];
  const rap = g.bouwRapport(g.eenhedenUit(rijen, { waardenVan: (r) => waarden[r.student_id] }));
  const it = rap.paren[0].items[0];
  assert.strictEqual(it.andereWaarden, true);
  assert.deepStrictEqual(it.vreemdeWaarden, ['n'], 'leerling 1 gebruikt 47, de waarde van leerling 2');
  assert.strictEqual(rap.paren[0].risico, 'hoog');
  // eigen waarden → geen vreemde waarde
  const goed = [rij('1', 'q1', { code: tekst(12) }), rij('2', 'q1', { code: tekst(47) })];
  const r2 = g.bouwRapport(g.eenhedenUit(goed, { waardenVan: (r) => waarden[r.student_id] }));
  assert.ok(!r2.paren[0].items[0].vreemdeWaarden);
});

test('pool: enkel gemeenschappelijke vragen worden vergeleken (geen antwoord = geen eenheid)', () => {
  const rijen = [rij('1', 'qA', { code: code1 }), rij('2', 'qB', { code: code1 })];
  assert.strictEqual(g.bouwRapport(g.eenhedenUit(rijen)).paren.length, 0);
});

test('timing: kort na elkaar ingediend geeft extra punt; incidenten als context', () => {
  const rijen = [rij('1', 'q1', { code: code1, submitted_at: 5000000 }), rij('2', 'q1', { code: code1, submitted_at: 5030000 })];
  const rap = g.bouwRapport(g.eenhedenUit(rijen), [{ studentId: '1', type: 'paste', at: 1 }, { studentId: '1', type: 'tab_switch', at: 2 }]);
  assert.strictEqual(rap.paren[0].tijdsverschilIndienenSec, 30);
  assert.deepStrictEqual(rap.paren[0].context['1'], { plakken: 1, tabwissel: 1, andere: 0 });
});

test('samengestelde vraag: tekstonderdelen apart vergeleken', () => {
  const delen = JSON.stringify([{ id: 'p1', type: 'code', label: 'Deel 1', points: 2 }]);
  const pa = (c) => JSON.stringify({ p1: c });
  const rijen = [rij('1', 'q1', { question_type: 'composite', answer_parts: delen, part_answers: pa(code1) }), rij('2', 'q1', { question_type: 'composite', answer_parts: delen, part_answers: pa(code1) })];
  const rap = g.bouwRapport(g.eenhedenUit(rijen));
  assert.strictEqual(rap.paren[0].items[0].vraagId, 'q1:p1');
});

test('statische controles server + client + db', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /\/api\/quiz\/:code\/gelijkenisrapport/);
  assert.match(server, /gelijkenisLib\.bouwRapport/);
  assert.match(server, /requireTeacherAuth, requireSessionAccess, async \(req, res\) => \{\s*try \{\s*const code = req\.params\.code\.toUpperCase\(\);\s*const drempel/);
  assert.match(fs.readFileSync(path.join(root, 'db/database.js'), 'utf8'), /q\.question_type, q\.variables_json, q\.answer_parts/);
  assert.match(fs.readFileSync(path.join(root, 'public/quiz-review.html'), 'utf8'), /id="gelijkenis-modal"/);
  assert.match(fs.readFileSync(path.join(root, 'public/quiz-review.js'), 'utf8'), /renderGelijkenisRapport/);
});
