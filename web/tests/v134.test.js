'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pool = require('../lib/vragenpool.js');
const klasbord = require('../lib/klasbord.js');

const vragen = (groepen) => groepen.flatMap((g, gi) => Array.from({ length: g }, (_, i) => ({ id: `g${gi}q${i}`, random_group: gi, points: 2 })));

test('134 pool: groepen worden uit aaneengesloten random_group-nummers gebouwd', () => {
  const g = pool.bouwGroepen(vragen([3, 2, 4]));
  assert.deepStrictEqual(g.map(x => x.vragen.length), [3, 2, 4]);
  assert.deepStrictEqual(g.map(x => x.nr), [0, 1, 2]);
});

test('134 pool: normaliseerPool houdt enkel geldige regels (1 ≤ N < M, bestaande groep)', () => {
  const v = vragen([4, 3]);
  assert.deepStrictEqual(pool.normaliseerPool({ 0: 2, 1: 3 }, v), { 0: 2 });          // N = M telt niet
  assert.deepStrictEqual(pool.normaliseerPool({ 0: 0 }, v), {});
  assert.deepStrictEqual(pool.normaliseerPool({ 5: 1 }, v), {});                        // groep bestaat niet
  assert.deepStrictEqual(pool.normaliseerPool({ 0: '2', 1: '1' }, v), { 0: 2, 1: 1 }); // strings
  assert.deepStrictEqual(pool.normaliseerPool('{"0":2}', v), { 0: 2 });
  assert.deepStrictEqual(pool.normaliseerPool('kapot', v), {});
  assert.deepStrictEqual(pool.normaliseerPool(null, v), {});
  assert.deepStrictEqual(pool.normaliseerPool([1, 2], v), {});
  assert.strictEqual(pool.poolActief({}), false);
  assert.strictEqual(pool.poolActief({ 0: 2 }), true);
});

test('134 pool: trekVragen geeft N unieke vragen per groep, in originele volgorde', () => {
  const v = vragen([5, 3]);
  for (let k = 0; k < 200; k++) {
    const t = pool.trekVragen(v, { 0: 2, 1: 1 });
    assert.strictEqual(t.length, 3);
    assert.strictEqual(new Set(t.map(q => q.id)).size, 3);
    const g0 = t.filter(q => q.random_group === 0);
    assert.strictEqual(g0.length, 2);
    assert.ok(Number(g0[0].id.slice(3)) < Number(g0[1].id.slice(3)), 'volgorde binnen groep behouden');
    assert.strictEqual(t.filter(q => q.random_group === 1).length, 1);
  }
});

test('134 pool: zonder pool alles; groepen zonder regel blijven volledig', () => {
  const v = vragen([3, 3]);
  assert.strictEqual(pool.trekVragen(v, {}).length, 6);
  assert.strictEqual(pool.trekVragen(v, { 1: 2 }).length, 5);
});

test('134 pool: trekking is eerlijk verdeeld (elke vraag komt ongeveer even vaak voor)', () => {
  const v = vragen([6]);
  const teller = {};
  const RONDES = 6000;
  for (let k = 0; k < RONDES; k++) for (const q of pool.trekVragen(v, { 0: 2 })) teller[q.id] = (teller[q.id] || 0) + 1;
  const verwacht = RONDES * 2 / 6;
  for (const id of Object.keys(teller)) assert.ok(Math.abs(teller[id] - verwacht) < verwacht * 0.12, `${id}: ${teller[id]} vs ${verwacht}`);
});

test('134 pool: leerlingen krijgen niet allemaal dezelfde vragen', () => {
  const v = vragen([8]);
  const sets = new Set();
  for (let k = 0; k < 30; k++) sets.add(pool.trekVragen(v, { 0: 3 }).map(q => q.id).join(','));
  assert.ok(sets.size > 10, 'verschillende trekkingen: ' + sets.size);
});

test('134 pool: deterministische rng voor tests', () => {
  const v = vragen([4]);
  const t = pool.trekVragen(v, { 0: 2 }, () => 0);   // altijd eerste → kiest posities 0 en 1
  assert.deepStrictEqual(t.map(q => q.id), ['g0q0', 'g0q1']);
});

test('134 pool: puntenBereik en waarschuwing bij verschillende punten', () => {
  const v = vragen([4]);
  v[0].points = 1; v[1].points = 1; v[2].points = 4; v[3].points = 4;
  assert.deepStrictEqual(pool.puntenBereik(v, { 0: 2 }), { min: 2, max: 8, afwijkendeGroepen: [0] });
  const gelijk = vragen([4]);
  assert.deepStrictEqual(pool.puntenBereik(gelijk, { 0: 2 }), { min: 4, max: 4, afwijkendeGroepen: [] });
  assert.deepStrictEqual(pool.puntenBereik(gelijk, {}), { min: 8, max: 8, afwijkendeGroepen: [] });
});

test('134 klasbord: eigen totaal per leerling bij een pool', () => {
  const lijst = klasbord.bouwBordLeerlingen([
    { id: 'a', name: 'A', quizAnswers: { x: 1 }, quizPersonalOrder: ['x', 'y', 'z'] },
    { id: 'b', name: 'B', quizAnswers: {}, quizPersonalOrder: ['x', 'y'], quizSubmitted: true },
    { id: 'c', name: 'C', quizAnswers: {} },
  ], 10);
  const per = Object.fromEntries(lijst.map(l => [l.id, l]));
  // v137: het bord toont geen vraagnummers meer (gaf zenuwen); de status blijft werken
  assert.ok(!('totaal' in per.a) && !('vraag' in per.a));
  assert.strictEqual(per.b.status, 'grijs');
});

test('134 database: kolom, opslag, filters', () => {
  const d = r('db/database.js');
  assert.match(d, /ADD COLUMN pool_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(d, /copy_paste_blocked, cursus_links, mc_scoring, pool_json, created_at\)/);
  assert.match(d, /pool_json = COALESCE\(\$22, pool_json\)/);
  assert.match(d, /async getQuizToewijzing/);
  assert.match(d, /ab\.pool_json <> '\{\}'/);                       // getMyResult filtert enkel bij een pool
  assert.match(d, /trekVragen\(vragen\.rows, pool\)/);              // nooit-gestarte leerlingen krijgen een eigen trekking
});

test('134 server: trekking bij het starten, validatie, dupliceren en exports', () => {
  const s = r('server.js');
  assert.match(s, /vragenpoolLib\.trekVragen\(alleVragen, pool\)/);
  assert.strictEqual((s.match(/poolJson: JSON\.stringify\(poolGezuiverd\)/g) || []).length, 2);   // v137: eerst gezuiverd + gecontroleerd
  assert.match(s, /poolJson: meta\.pool_json \|\| '\{\}'/);
  assert.match(s, /pool: vragenpoolLib\.normaliseerPool\(meta\.pool_json, snaps\.map/);
  assert.match(s, /vragenVanLeerling\(questions, answers, poolIsActief\)/);
  assert.match(s, /Maximum \(eigen vragen\)/);
  assert.match(s, /toewijzing = poolIsActief \? await dbModule\.getQuizToewijzing\(code\)/);
  // trekking gebeurt vóór het husselen
  assert.ok(s.indexOf('trekVragen(alleVragen, pool)') < s.indexOf("bouwGroepen(questions).map(g => g.vragen.map(q => q.id))"));
});

test('134 client: pool-invoer, bevestiging en nazicht per leerling', () => {
  const t = r('public/quiz-teacher.js');
  assert.match(t, /class="pool-n"/);
  assert.match(t, /function zetPool/);
  assert.match(t, /pool: poolVoorPayload\(\)/);
  assert.match(t, /elke leerling krijgt \$\{poolN\} van/);
  assert.match(t, /Per leerling/);
  const rv = r('public/quiz-review.js');
  assert.match(rv, /function vragenVoor\(studentId\)/);
  assert.match(rv, /_questions = vragenVoor\(studentId\)/);
});
