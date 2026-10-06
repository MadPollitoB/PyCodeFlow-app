'use strict';
// Regressietest v100: "Onderdeelscores & opmerkingen opslaan" crashte NA het opslaan op een
// niet-bestaande variabele ("comment") → geen melding en geen sprong naar de volgende vraag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bron = fs.readFileSync(path.join(__dirname, '..', 'public', 'quiz-review.js'), 'utf8');
const start = bron.indexOf('async function savePartScores(');
const einde = bron.indexOf('async function saveGeneralComment()');
const fnTekst = bron.slice(start, einde);

function maakOmgeving({ ok = true } = {}) {
  const toasts = []; const geselecteerd = []; const calls = [];
  const invoeren = [
    { dataset: { partId: 'p1' }, value: '1' },
    { dataset: { partId: 'p2' }, value: '' },
  ];
  const opmerkingen = { p1: { value: 'goed' }, p2: { value: '' } };
  const ctx = {
    sessionCode: 'ABC', _questions: [1, 2, 3], _answers: [{ id: 'a1', part_scores: '{}', part_comments: '{"p2":"oud"}' }],
    window: { pyToast: (t, k) => toasts.push([t, k]), apiFetch: async (u, o) => { calls.push([u, JSON.parse(o.body)]); return { ok }; } },
    pyToast: (t, k) => toasts.push([t, k]),
    document: {
      querySelectorAll: (sel) => (sel === '.part-score-input' ? invoeren : [{ classList: { add() {} } }, { classList: { add() {} } }, { classList: { add() {} } }]),
      querySelector: (sel) => { const m = /data-part-id="(\w+)"/.exec(sel); return m ? opmerkingen[m[1]] : null; },
    },
    renderStudentList: () => {},
    selectQuestion: (i) => geselecteerd.push(i),
  };
  vm.createContext(ctx);
  vm.runInContext(fnTekst, ctx);
  return { ctx, toasts, geselecteerd, calls };
}

test('opslaan: melding en sprong naar de volgende vraag, opmerkingen lokaal bijgewerkt', async () => {
  const e = maakOmgeving();
  await e.ctx.savePartScores('a1', 0);
  assert.equal(e.calls.length, 2);
  assert.deepEqual(e.toasts.at(-1), ['Onderdeelscores opgeslagen.', 'success']);
  assert.deepEqual(e.geselecteerd, [1]);
  const ans = e.ctx._answers[0];
  assert.equal(ans.score, 1);
  assert.deepEqual(JSON.parse(ans.part_comments), { p1: 'goed' }); // lege opmerking wist de oude
});

test('opslaan bij de laatste vraag: blijft staan (herstekent) maar geeft wel een melding', async () => {
  const e = maakOmgeving();
  await e.ctx.savePartScores('a1', 2);
  assert.deepEqual(e.geselecteerd, [2]);
  assert.equal(e.toasts.at(-1)[1], 'success');
});

test('serverfout: foutmelding, geen sprong', async () => {
  const e = maakOmgeving({ ok: false });
  await e.ctx.savePartScores('a1', 0);
  assert.equal(e.toasts.at(-1)[1], 'error');
  assert.deepEqual(e.geselecteerd, []);
});
