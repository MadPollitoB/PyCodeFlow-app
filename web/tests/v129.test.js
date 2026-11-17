'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('129 server: import-json route met CSRF, limiet en formaten', () => {
  const s = r('server.js');
  assert.match(s, /app\.post\('\/api\/quiz\/bank\/import-json', requireTeacherAuth, requireCsrf/);
  assert.match(s, /req\.path === '\/api\/quiz\/bank\/import-json'/);
  assert.match(s, /parsed\.vragen \|\| parsed\.questions/);
  assert.match(s, /importQuizQuestionsJSON\(lijst/);
});

test('129 database: importQuizQuestionsJSON valideert keuzes, titel en onderdelen', () => {
  const d = r('db/database.js');
  const i = d.indexOf('async importQuizQuestionsJSON');
  assert.ok(i > 0);
  const blok = d.slice(i, i + 4500);
  assert.match(blok, /title: String\(it\.title/);
  assert.match(blok, /choices\.length < 2 \|\| !choices\.some/);
  assert.match(blok, /precies 1 juiste optie/);
  assert.match(blok, /normalizeAnswerParts\(/);
  assert.match(blok, /SELECT 1 FROM question_bank WHERE text/);
});

test('129 UI: JSON wordt herkend en fouten worden ge-escaped', () => {
  const j = r('public/quiz-bank.js');
  assert.match(j, /\/\^\[\\\[\{\]\/\.test\(csv\)/);
  assert.match(j, /import-json/);
  assert.match(j, /data\.errors\.map\(esc\)/);
  const h = r('public/quiz-bank.html');
  assert.match(h, /id="json-file"/);
});

test('129 toets-JSON: 14 vragen, 30 punten, titel overal, meerkeuze met puntenregel', () => {
  const p = process.env.TOETS_JSON;
  if (!p) return;
  const t = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(t.vragen.length, 14);
  let som = 0;
  for (const q of t.vragen) {
    assert.ok(q.title && q.title.length <= 200, 'titel ontbreekt');
    const pts = q.type === 'composite' ? q.answerParts.reduce((s, x) => s + x.points, 0) : q.points;
    if (q.type === 'composite') assert.strictEqual(pts, q.points);
    som += pts;
    if (q.type === 'multiple') assert.match(q.text, /Puntenregel/);
    if (q.type === 'single') assert.strictEqual(q.choices.filter(c => c.correct).length, 1);
  }
  assert.strictEqual(som, 30);
  assert.strictEqual(new Set(t.vragen.map(q => q.title)).size, 14);
});
