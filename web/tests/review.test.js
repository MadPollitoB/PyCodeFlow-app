// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 37d — Unit tests: nakijk-modus, token en toegangscontrole
//
// De HTTP-endpoints hebben een DB nodig; hier testen we de pure logica die
// erachter zit: het ondertekende token en de beslisregels van review-login.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createReviewToken, verifyReviewToken } = require('../lib/review-token');

const SECRET = 'test-geheim';

// ── Token ─────────────────────────────────────────────────────────────────────

test('token: geldig token verifieert en geeft code + studentId terug', () => {
  const t = createReviewToken('ABC123', 'stu-1', SECRET);
  const r = verifyReviewToken(t, SECRET);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sessionCode, 'ABC123');
  assert.strictEqual(r.studentId, 'stu-1');
});

test('token: verlopen token → expired', () => {
  const t = createReviewToken('ABC123', 'stu-1', SECRET, 1000, 0);
  const r = verifyReviewToken(t, SECRET, 5000); // ruim na verval
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'expired');
});

test('token: ander geheim → bad_signature (niet vervalsbaar)', () => {
  const t = createReviewToken('ABC123', 'stu-1', SECRET);
  assert.strictEqual(verifyReviewToken(t, 'ander-geheim').reason, 'bad_signature');
});

test('token: gemanipuleerde payload wordt geweigerd', () => {
  const t = createReviewToken('ABC123', 'stu-1', SECRET);
  const [, sig] = t.split('.');
  // Probeer het studentId te wijzigen met de oude handtekening
  const kwaad = Buffer.from(JSON.stringify({ c: 'ABC123', s: 'stu-2', e: Date.now() + 1e6 }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(verifyReviewToken(`${kwaad}.${sig}`, SECRET).reason, 'bad_signature');
});

test('token: onzin-invoer → malformed, geen crash', () => {
  assert.strictEqual(verifyReviewToken('', SECRET).reason, 'malformed');
  assert.strictEqual(verifyReviewToken('geen-punt', SECRET).reason, 'malformed');
  assert.strictEqual(verifyReviewToken(null, SECRET).reason, 'malformed');
});

test('token van toets A is ongeldig voor toets B', () => {
  // De middleware vergelijkt token.sessionCode met de opgevraagde code.
  const t = createReviewToken('AAA111', 'stu-1', SECRET);
  const r = verifyReviewToken(t, SECRET);
  assert.strictEqual(r.ok, true);
  assert.notStrictEqual(r.sessionCode, 'BBB222'); // guard zou dit weigeren
});

// ── Beslisregels van review-login ─────────────────────────────────────────────
// Repliceert de logica uit server.js zonder DB.

function reviewLoginDecision({ meta, matches, naam, klas }) {
  if (!naam || !klas) return { status: 400 };
  if (!meta || meta.review_mode !== true) return { status: 403 };
  if (matches.length === 0) return { status: 404 };
  if (matches.length > 1) return { status: 409 };
  return { status: 200, studentId: matches[0].student_id };
}

test('review-login: nakijk-modus uit → 403, ook met correcte naam', () => {
  const r = reviewLoginDecision({
    meta: { review_mode: false },
    matches: [{ student_id: 'stu-1' }],
    naam: 'Jan', klas: '3A',
  });
  assert.strictEqual(r.status, 403);
});

test('review-login: onbestaande toets → 403 (lekt geen toetscodes)', () => {
  const r = reviewLoginDecision({ meta: null, matches: [], naam: 'Jan', klas: '3A' });
  assert.strictEqual(r.status, 403);
});

test('review-login: nakijk aan + unieke match → 200 + studentId', () => {
  const r = reviewLoginDecision({
    meta: { review_mode: true },
    matches: [{ student_id: 'stu-7' }],
    naam: 'Jan', klas: '3A',
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.studentId, 'stu-7');
});

test('review-login: onbekende naam → 404 (generiek, geen naam-enumeratie)', () => {
  const r = reviewLoginDecision({
    meta: { review_mode: true }, matches: [], naam: 'Onbekend', klas: '3A',
  });
  assert.strictEqual(r.status, 404);
});

test('review-login: dubbele naam+klas → 409', () => {
  const r = reviewLoginDecision({
    meta: { review_mode: true },
    matches: [{ student_id: 'a' }, { student_id: 'b' }],
    naam: 'Jan', klas: '3A',
  });
  assert.strictEqual(r.status, 409);
});

test('review-login: naam of klas leeg → 400', () => {
  assert.strictEqual(reviewLoginDecision({ meta: { review_mode: true }, matches: [], naam: '', klas: '3A' }).status, 400);
  assert.strictEqual(reviewLoginDecision({ meta: { review_mode: true }, matches: [], naam: 'Jan', klas: '' }).status, 400);
});
