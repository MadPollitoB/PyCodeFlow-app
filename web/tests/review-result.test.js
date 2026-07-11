// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 37a — Unit tests: opbouw van het nakijk-resultaat + sanitisatie
//
// De belangrijkste test: de `correct`-vlag mag NIET naar de leerling lekken
// zolang de juiste antwoorden niet bewust onthuld worden (sprint 37b).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildMyResult, sanitizeChoices } = require('../lib/review-result');

const CHOICES = JSON.stringify([
  { id: 'a', text: 'Fout antwoord', correct: false },
  { id: 'b', text: 'Juist antwoord', correct: true },
]);

function rows() {
  return [
    { question_id: 'q1', order_index: 0, text_snapshot: 'Print hallo', subject: 'Basis',
      points: 4, question_type: 'code', choices_json: '[]',
      code: 'print("hallo")', score: 3, selected_choices: '[]' },
    { question_id: 'q2', order_index: 1, text_snapshot: 'Welke is juist?', subject: 'MC',
      points: 6, question_type: 'single', choices_json: CHOICES,
      code: null, score: null, selected_choices: JSON.stringify(['a']) },
  ];
}

// ── 🔒 Lekpreventie ───────────────────────────────────────────────────────────

test('37a: `correct`-vlag lekt NIET naar de leerling', () => {
  const r = buildMyResult(rows());
  const opties = r.vragen[1].opties;
  assert.strictEqual(opties.length, 2);
  for (const o of opties) {
    assert.strictEqual('correct' in o, false, 'correct mag niet aanwezig zijn');
  }
});

test('37a: JSON-payload bevat nergens het woord "correct"', () => {
  const json = JSON.stringify(buildMyResult(rows()));
  assert.strictEqual(json.includes('"correct"'), false);
});

test('37b-hook: met onthulJuisteAntwoorden staat `correct` er wel', () => {
  const r = buildMyResult(rows(), { onthulJuisteAntwoorden: true });
  const opties = r.vragen[1].opties;
  assert.strictEqual(opties.find(o => o.id === 'b').correct, true);
  assert.strictEqual(opties.find(o => o.id === 'a').correct, false);
});

test('sanitizeChoices: strip standaard, behoud bij onthulling', () => {
  const raw = [{ id: 'x', text: 'T', correct: true }];
  assert.strictEqual('correct' in sanitizeChoices(raw)[0], false);
  assert.strictEqual(sanitizeChoices(raw, { onthulJuisteAntwoorden: true })[0].correct, true);
});

// ── Score en totalen ──────────────────────────────────────────────────────────

test('totalen: som van scores en maxpunten', () => {
  const r = buildMyResult(rows());
  assert.strictEqual(r.totaal, 3);        // enkel q1 is beoordeeld
  assert.strictEqual(r.maxTotaal, 10);    // 4 + 6
});

test('niet-beoordeelde vraag telt niet mee in het totaal', () => {
  const r = buildMyResult(rows());
  assert.strictEqual(r.vragen[1].beoordeeld, false);
  assert.strictEqual(r.vragen[1].score, null);
});

test('score 0 telt wel als beoordeeld', () => {
  const rs = rows();
  rs[1].score = 0;
  const r = buildMyResult(rs);
  assert.strictEqual(r.vragen[1].beoordeeld, true);
  assert.strictEqual(r.totaal, 3);
});

// ── Eigen antwoord ────────────────────────────────────────────────────────────

test('eigen keuze wordt gemarkeerd, andere niet', () => {
  const r = buildMyResult(rows());
  const opties = r.vragen[1].opties;
  assert.strictEqual(opties.find(o => o.id === 'a').gekozen, true);
  assert.strictEqual(opties.find(o => o.id === 'b').gekozen, false);
});

test('code-vraag geeft eigenCode terug, geen opties', () => {
  const r = buildMyResult(rows());
  assert.strictEqual(r.vragen[0].eigenCode, 'print("hallo")');
  assert.strictEqual(r.vragen[0].opties, undefined);
});

test('ingevuld: lege code telt als niet ingevuld', () => {
  const rs = rows();
  rs[0].code = '   ';
  const r = buildMyResult(rs);
  assert.strictEqual(r.vragen[0].ingevuld, false);
  assert.strictEqual(r.beantwoord, 1); // enkel de MC-keuze
});

test('ingevuld: geen keuze gemaakt telt als niet ingevuld', () => {
  const rs = rows();
  rs[1].selected_choices = '[]';
  const r = buildMyResult(rs);
  assert.strictEqual(r.vragen[1].ingevuld, false);
});

// ── Robuustheid ───────────────────────────────────────────────────────────────

test('niet-beantwoorde vraag (LEFT JOIN → nulls) crasht niet', () => {
  const r = buildMyResult([
    { question_id: 'q9', order_index: 0, text_snapshot: 'Niet gemaakt', subject: '',
      points: 5, question_type: 'code', choices_json: null,
      code: null, score: null, selected_choices: null },
  ]);
  assert.strictEqual(r.vragen[0].ingevuld, false);
  assert.strictEqual(r.vragen[0].eigenCode, '');
  assert.strictEqual(r.maxTotaal, 5);
  assert.strictEqual(r.totaal, 0);
});

test('kapotte choices_json → lege optielijst, geen crash', () => {
  const rs = rows();
  rs[1].choices_json = '{niet-geldig';
  const r = buildMyResult(rs);
  assert.deepStrictEqual(r.vragen[1].opties, []);
});

test('lege invoer geeft lege maar geldige structuur', () => {
  const r = buildMyResult([]);
  assert.deepStrictEqual(r, { vragen: [], totaal: 0, maxTotaal: 0, beantwoord: 0, algemeenCommentaar: null });
});

test('vraagnummers lopen op vanaf 1', () => {
  const r = buildMyResult(rows());
  assert.strictEqual(r.vragen[0].nummer, 1);
  assert.strictEqual(r.vragen[1].nummer, 2);
});

// ── 37b: modelantwoord + onthulde juiste antwoorden ───────────────────────────

function modelRows() {
  return [{
    question_id: 'q1', order_index: 0, text_snapshot: 'Print', subject: '', points: 4,
    question_type: 'code', choices_json: '[]', model_answer: 'print("hallo")',
    code: 'print(1)', score: 2, selected_choices: '[]',
  }];
}

test('37b: modelAnswer lekt NIET zolang antwoorden niet onthuld zijn', () => {
  const r = buildMyResult(modelRows(), { onthulJuisteAntwoorden: false });
  assert.strictEqual(r.vragen[0].modelAnswer, undefined);
});

test('37b: modelAnswer verschijnt WEL bij onthulling', () => {
  const r = buildMyResult(modelRows(), { onthulJuisteAntwoorden: true });
  assert.strictEqual(r.vragen[0].modelAnswer, 'print("hallo")');
});

test('37b: leeg modelantwoord geeft geen modelAnswer-veld', () => {
  const rs = modelRows();
  rs[0].model_answer = '   ';
  const r = buildMyResult(rs, { onthulJuisteAntwoorden: true });
  assert.strictEqual(r.vragen[0].modelAnswer, undefined);
});

test('37b: bij onthulling staat correct-vlag op de juiste optie', () => {
  const r = buildMyResult(rows(), { onthulJuisteAntwoorden: true });
  const opties = r.vragen[1].opties;
  assert.strictEqual(opties.find(o => o.id === 'b').correct, true);
  assert.strictEqual(opties.find(o => o.id === 'a').correct, false);
});

// ── 37c: commentaar per vraag + algemeen commentaar ───────────────────────────

function commentRows() {
  return [{
    question_id: 'q1', order_index: 0, text_snapshot: 'V', subject: '', points: 4,
    question_type: 'code', choices_json: '[]', model_answer: '',
    code: 'x', score: 2, selected_choices: '[]', teacher_comment: 'Goed geprobeerd!',
  }];
}

test('37c: commentaar per vraag lekt NIET vóór onthulling', () => {
  const r = buildMyResult(commentRows(), { onthulJuisteAntwoorden: false });
  assert.strictEqual(r.vragen[0].commentaar, undefined);
});

test('37c: commentaar per vraag verschijnt WEL bij onthulling', () => {
  const r = buildMyResult(commentRows(), { onthulJuisteAntwoorden: true });
  assert.strictEqual(r.vragen[0].commentaar, 'Goed geprobeerd!');
});

test('37c: leeg commentaar geeft geen commentaar-veld', () => {
  const rs = commentRows();
  rs[0].teacher_comment = '   ';
  const r = buildMyResult(rs, { onthulJuisteAntwoorden: true });
  assert.strictEqual(r.vragen[0].commentaar, undefined);
});

test('37c: algemeen commentaar enkel bij onthulling', () => {
  const dicht = buildMyResult(commentRows(), { onthulJuisteAntwoorden: false, algemeenCommentaar: 'Top klas' });
  const open = buildMyResult(commentRows(), { onthulJuisteAntwoorden: true, algemeenCommentaar: 'Top klas' });
  assert.strictEqual(dicht.algemeenCommentaar, null);
  assert.strictEqual(open.algemeenCommentaar, 'Top klas');
});

test('37c: leeg algemeen commentaar → null', () => {
  const r = buildMyResult(commentRows(), { onthulJuisteAntwoorden: true, algemeenCommentaar: '  ' });
  assert.strictEqual(r.algemeenCommentaar, null);
});

test('37c: ontbrekend algemeen commentaar → null, geen crash', () => {
  const r = buildMyResult(commentRows(), { onthulJuisteAntwoorden: true });
  assert.strictEqual(r.algemeenCommentaar, null);
});
