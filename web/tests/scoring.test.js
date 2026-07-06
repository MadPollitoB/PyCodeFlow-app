// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 34a — Unit tests: automatische scoring (lib/scoring.js)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { computeAutoScore } = require('../lib/scoring');

// Helper: bouw een vraag met keuzes
function vraag(type, choices, points = 4) {
  return { question_type: type, choices_json: JSON.stringify(choices), points };
}

const choicesSingle = [
  { id: 'a', text: 'Fout', correct: false },
  { id: 'b', text: 'Juist', correct: true },
  { id: 'c', text: 'Fout', correct: false },
];

const choicesMulti = [
  { id: 'a', text: 'Juist 1', correct: true },
  { id: 'b', text: 'Juist 2', correct: true },
  { id: 'c', text: 'Fout', correct: false },
  { id: 'd', text: 'Juist 3', correct: true },
];

// ── Open/code vragen ──────────────────────────────────────────────────────────
test('open vraag → niet auto-gescoord', () => {
  const r = computeAutoScore({ question_type: 'open', points: 10 }, []);
  assert.strictEqual(r.autoScored, false);
  assert.strictEqual(r.autoScore, null);
});

test('code vraag → niet auto-gescoord', () => {
  const r = computeAutoScore({ question_type: 'code', points: 10 }, ['a']);
  assert.strictEqual(r.autoScored, false);
});

test('null vraag → veilig, niet gescoord', () => {
  const r = computeAutoScore(null, ['a']);
  assert.strictEqual(r.autoScored, false);
});

// ── Single choice ─────────────────────────────────────────────────────────────
test('single: juist antwoord → volle punten', () => {
  const r = computeAutoScore(vraag('single', choicesSingle, 4), ['b']);
  assert.strictEqual(r.autoScored, true);
  assert.strictEqual(r.autoScore, 4);
});

test('single: fout antwoord → 0', () => {
  const r = computeAutoScore(vraag('single', choicesSingle, 4), ['a']);
  assert.strictEqual(r.autoScore, 0);
});

test('single: meerdere geselecteerd → 0 (ongeldig voor single)', () => {
  const r = computeAutoScore(vraag('single', choicesSingle, 4), ['a', 'b']);
  assert.strictEqual(r.autoScore, 0);
});

test('single: niets geselecteerd → 0', () => {
  const r = computeAutoScore(vraag('single', choicesSingle, 4), []);
  assert.strictEqual(r.autoScore, 0);
});

// ── Multiple choice (pro-rata) ────────────────────────────────────────────────
test('multiple: alle juiste geselecteerd → volle punten', () => {
  const r = computeAutoScore(vraag('multiple', choicesMulti, 6), ['a', 'b', 'd']);
  assert.strictEqual(r.autoScore, 6);
});

test('multiple: helft juist → pro-rata', () => {
  // 3 juiste totaal, 2 geselecteerd (geen foute) → round(2/3 * 6) = 4
  const r = computeAutoScore(vraag('multiple', choicesMulti, 6), ['a', 'b']);
  assert.strictEqual(r.autoScore, 4);
});

test('multiple: één fout geselecteerd → 0 (ook al zijn er juiste)', () => {
  const r = computeAutoScore(vraag('multiple', choicesMulti, 6), ['a', 'b', 'c']);
  assert.strictEqual(r.autoScore, 0);
});

test('multiple: niets geselecteerd → 0', () => {
  const r = computeAutoScore(vraag('multiple', choicesMulti, 6), []);
  assert.strictEqual(r.autoScore, 0);
});

test('multiple: één juiste van drie → round(1/3*6)=2', () => {
  const r = computeAutoScore(vraag('multiple', choicesMulti, 6), ['a']);
  assert.strictEqual(r.autoScore, 2);
});

// ── Randgevallen ──────────────────────────────────────────────────────────────
test('ongeldige choices_json → niet gescoord', () => {
  const r = computeAutoScore({ question_type: 'single', choices_json: 'geen json', points: 4 }, ['a']);
  assert.strictEqual(r.autoScored, false);
});

test('geen correcte antwoorden gedefinieerd → 0', () => {
  const geen = [{ id: 'a', correct: false }, { id: 'b', correct: false }];
  const r = computeAutoScore(vraag('multiple', geen, 4), ['a']);
  assert.strictEqual(r.autoScore, 0);
});

test('points ontbreekt → 0 punten', () => {
  const r = computeAutoScore({ question_type: 'single', choices_json: JSON.stringify(choicesSingle) }, ['b']);
  assert.strictEqual(r.autoScore, 0);
});
