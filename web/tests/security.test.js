// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 30a/c — Unit tests: security headers & cookie
// Test de pure logica achter Max-Age berekening en CSP-samenstelling.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ── 30a: sessieduur → Max-Age seconden ────────────────────────────────────────
// Repliceert de berekening uit server.js (SESSION_MAX_AGE_SECONDS).
function sessionMaxAgeSeconds(hoursEnv) {
  const hours = Math.max(0, Number(hoursEnv ?? 8));
  return Math.round(hours * 3600);
}

// Bouwt het Max-Age deel van het cookie (leeg bij 0).
function cookieMaxAgePart(seconds) {
  return seconds > 0 ? `; Max-Age=${seconds}` : '';
}

test('sessieduur: standaard 8 uur = 28800 seconden', () => {
  assert.strictEqual(sessionMaxAgeSeconds(undefined), 28800);
  assert.strictEqual(sessionMaxAgeSeconds(8), 28800);
});

test('sessieduur: aangepaste waarde', () => {
  assert.strictEqual(sessionMaxAgeSeconds(4), 14400);
  assert.strictEqual(sessionMaxAgeSeconds(1), 3600);
});

test('sessieduur: 0 = sessiecookie (geen Max-Age)', () => {
  assert.strictEqual(sessionMaxAgeSeconds(0), 0);
  assert.strictEqual(cookieMaxAgePart(0), '');
});

test('sessieduur: negatieve waarde → geklemd naar 0', () => {
  assert.strictEqual(sessionMaxAgeSeconds(-5), 0);
});

test('cookie Max-Age deel: correct geformatteerd', () => {
  assert.strictEqual(cookieMaxAgePart(28800), '; Max-Age=28800');
  assert.strictEqual(cookieMaxAgePart(3600), '; Max-Age=3600');
});

test('volledig cookie bevat alle security-attributen', () => {
  const seconds = sessionMaxAgeSeconds(8);
  const cookie = `teacher_auth=abc; Path=/; HttpOnly; SameSite=Strict; Secure${cookieMaxAgePart(seconds)}`;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=28800/);
});

// ── 30c: CSP bevat upgrade-insecure-requests ──────────────────────────────────
// Repliceert de CSP-string uit server.js voor structuurcontrole.
function buildCSP() {
  return "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
    "img-src 'self' data:; " +
    "worker-src 'self' blob:; " +
    "connect-src 'self' ws: wss:; " +
    "frame-ancestors 'none'; " +
    "upgrade-insecure-requests;";
}

test('CSP bevat upgrade-insecure-requests (30c)', () => {
  assert.match(buildCSP(), /upgrade-insecure-requests/);
});

test('CSP bevat frame-ancestors none (clickjacking)', () => {
  assert.match(buildCSP(), /frame-ancestors 'none'/);
});

test('CSP heeft geen unsafe-eval', () => {
  assert.doesNotMatch(buildCSP(), /unsafe-eval/);
});

test('CSP: default-src is self', () => {
  assert.match(buildCSP(), /default-src 'self'/);
});

// ── 30b Optie A: Report-Only strikte CSP ──────────────────────────────────────
function buildReportOnlyCSP() {
  return "default-src 'self'; " +
    "script-src 'self' https://cdnjs.cloudflare.com; " +
    "style-src 'self'; " +
    "font-src 'self' data:; " +
    "img-src 'self' data:; " +
    "worker-src 'self' blob:; " +
    "connect-src 'self' ws: wss:; " +
    "frame-ancestors 'none';";
}

test('Report-Only CSP: geen unsafe-inline (strikt, sprint 30b Optie A)', () => {
  const ro = buildReportOnlyCSP();
  assert.doesNotMatch(ro, /unsafe-inline/);
  assert.doesNotMatch(ro, /unsafe-eval/);
});

test('Report-Only CSP: script-src enkel self + cdnjs', () => {
  const ro = buildReportOnlyCSP();
  assert.match(ro, /script-src 'self' https:\/\/cdnjs\.cloudflare\.com/);
});
