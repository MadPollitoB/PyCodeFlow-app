// v138 — gelijkenismelding uitklapbaar (antwoorden naast elkaar + alle overeenkomsten met die leerling)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'quiz-review.js'), 'utf8');

test('138 melding is een uitklapbare <details> met details per leerling', () => {
  assert.match(js, /<details class="similarity-warning sim-kaart"/);
  assert.match(js, /function simKaartHtml/);
  assert.match(js, /async function laadSimDetail/);
  assert.match(js, /Alle overeenkomsten tussen/);
  assert.match(js, /gaNaarLeerling/);
  assert.match(js, /\/api\/quiz\/\$\{sessionCode\}\/gelijkenisrapport/);
});

test('138 samengestelde vragen ("vraagId:onderdeelId") worden nu ook aan de vraag gekoppeld', () => {
  assert.match(js, /simBasisId\(w\.questionId\) === q\.id/);
  const simBasisId = (qid) => String(qid).split(':')[0];
  assert.strictEqual(simBasisId('v12:p3'), 'v12'); assert.strictEqual(simBasisId('v12'), 'v12');
});

test('138 rapport en melding delen dezelfde itemregel', () => {
  assert.match(js, /function gelijkenisItemHtml/);
  assert.ok((js.match(/gelijkenisItemHtml/g) || []).length >= 3);   // definitie + rapport + melding
});
