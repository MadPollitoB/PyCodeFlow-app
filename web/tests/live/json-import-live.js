// Live-test v129: JSON-import in een echte database.
// DATABASE_URL=... TOETS_JSON=pad/naar/toets.json node tests/live/json-import-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const assert = require('assert');
const fs = require('fs');
const db = require('../../db/database.js');
(async () => {
  await db.init();
  const t = JSON.parse(fs.readFileSync(process.env.TOETS_JSON, 'utf8'));
  const marker = ' [livetest ' + Date.now() + ']';
  const items = t.vragen.map(q => ({ ...q, text: q.text + marker }));
  const r1 = await db.importQuizQuestionsJSON(items, null, null);
  assert.deepStrictEqual([r1.added, r1.skipped, r1.errors.length], [14, 0, 0], JSON.stringify(r1));
  const r2 = await db.importQuizQuestionsJSON(items, null, null);
  assert.deepStrictEqual([r2.added, r2.skipped], [0, 14]);           // duplicaten overgeslagen
  const { query } = require('../../db/database.js');
  const rij = await db.getQuizQuestionById
    ? null : null;
  const all = await (async () => {
    const pg = require('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const x = await pool.query(`SELECT title, question_type, max_points, choices_json, answer_parts FROM question_bank WHERE text LIKE $1`, ['%' + marker]);
    await pool.query(`DELETE FROM question_bank WHERE text LIKE $1`, ['%' + marker]);
    await pool.end(); return x.rows;
  })();
  assert.strictEqual(all.length, 14);
  assert.ok(all.every(x => x.title));
  assert.strictEqual(all.reduce((s, x) => s + x.max_points, 0), 30);
  const comp = all.filter(x => x.question_type === 'composite');
  assert.strictEqual(comp.length, 3);
  assert.ok(comp.every(x => JSON.parse(x.answer_parts).length === 2));
  const mult = all.filter(x => x.question_type === 'multiple');
  assert.strictEqual(mult.length, 3);
  // foute invoer
  const bad = await db.importQuizQuestionsJSON([
    { title: 'x', type: 'single', text: 'a' + marker, choices: [{ text: 'a', correct: true }] },
    { title: 'y', type: 'single', text: 'b' + marker, choices: [{ text: 'a', correct: true }, { text: 'b', correct: true }] },
    { title: 'z', type: 'composite', text: 'c' + marker },
    { title: 'w', type: 'ufo', text: 'd' + marker },
    { text: '' },
  ], null, null);
  assert.strictEqual(bad.added, 0); assert.strictEqual(bad.errors.length, 5);
  console.log('JSON-import live OK', r1, bad.errors.length + ' foutmeldingen');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
