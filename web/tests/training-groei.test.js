'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../lib/training-groei');

const NU = Date.parse('2026-10-07T10:00:00Z');   // woensdag
const dag = n => NU - n * G.DAG_MS;

test('108 herhaling: fout → morgen opnieuw; juist → steeds langer wachten; 5x juist = geleerd', () => {
  const f = G.volgendeHerhaling(null, false, NU);
  assert.strictEqual(f.box, 0); assert.ok(f.dueAt > NU && f.dueAt <= NU + G.DAG_MS);
  assert.strictEqual(G.volgendeHerhaling(null, true, NU), null, 'eerste keer juist: niets bij te houden');
  let st = f; const wachtdagen = [];
  for (let i = 0; i < 4; i++) { st = G.volgendeHerhaling(st, true, NU); wachtdagen.push(Math.round((st.dueAt - NU) / G.DAG_MS)); }
  assert.deepStrictEqual(wachtdagen, [1, 3, 7, 14]);
  st = G.volgendeHerhaling(st, true, NU); assert.strictEqual(Math.round((st.dueAt - NU) / G.DAG_MS), 30);
  assert.strictEqual(G.volgendeHerhaling(st, true, NU), null, 'na de laatste doos: geleerd');
  assert.strictEqual(G.volgendeHerhaling({ box: 3 }, false, NU).box, 0, 'fout = terug naar het begin');
});

test('108 elke 3e vraag is een herhaalmoment', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].filter(G.isHerhaalMoment), [2, 5, 8]);
});

test('108 streak: opeenvolgende dagen, vandaag nog niet gemist', () => {
  assert.deepStrictEqual(G.berekenStreak([dag(2), dag(1), dag(0)], NU), { streak: 3, vandaagGedaan: true });
  assert.deepStrictEqual(G.berekenStreak([dag(2), dag(1)], NU), { streak: 2, vandaagGedaan: false });
  assert.strictEqual(G.berekenStreak([dag(3), dag(1)], NU).streak, 1, 'een gemiste schooldag breekt de reeks');
  assert.strictEqual(G.berekenStreak([], NU).streak, 0);
});

test('108 streak: weekend breekt de reeks niet', () => {
  const maandag = Date.parse('2026-10-05T10:00:00Z');
  const vrijdag = Date.parse('2026-10-02T10:00:00Z');
  const donderdag = Date.parse('2026-10-01T10:00:00Z');
  assert.strictEqual(G.berekenStreak([donderdag, vrijdag, maandag], maandag).streak, 3);
  assert.strictEqual(G.berekenStreak([donderdag, vrijdag], maandag).streak, 2, 'maandag nog niet geoefend maar niet gemist');
});

test('108 dagelijkse onderwerpen: eerst herhalen, dan zwakste; zonder vragen nooit', () => {
  const rijen = [{ id: 'a', aantal: 10 }, { id: 'b', aantal: 10 }, { id: 'c', aantal: 10 }, { id: 'd', aantal: 0 }, { id: 'e', aantal: 10 }];
  const stats = { a: { n: 9, gem: 90 }, b: { n: 9, gem: 40 }, c: { n: 9, gem: 70 }, e: { n: 0, gem: null } };
  assert.deepStrictEqual(G.kiesDagelijkseOnderwerpen(rijen, stats, { a: 2 }), ['a', 'b', 'e']);
  assert.ok(!G.kiesDagelijkseOnderwerpen(rijen, stats, {}).includes('d'));
  assert.strictEqual(G.kiesDagelijkseOnderwerpen(rijen, stats, {}).length, 3);
});

test('108 groeipad: volgende stap', () => {
  assert.strictEqual(G.volgendeStap({ due: 2, n: 5, gem: 90, niveau: 3 }).soort, 'herhaal');
  assert.strictEqual(G.volgendeStap({ n: 0 }).soort, 'start');
  assert.strictEqual(G.volgendeStap({ n: 8, gem: 30, niveau: 2 }).soort, 'oefen');
  assert.strictEqual(G.volgendeStap({ n: 8, gem: 85, niveau: 4 }).soort, 'door');
  assert.strictEqual(G.volgendeStap({ n: 8, gem: 65, niveau: 4 }).soort, 'blijf');
});
