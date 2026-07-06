// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 34a — Unit tests: input-validatie (lib/validation.js)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const v = require('../lib/validation');

// ── Sessiecode ────────────────────────────────────────────────────────────────
test('sessiecode: geldig (8 hoofdletters/cijfers)', () => {
  assert.strictEqual(v.isValidSessionCode('ABC12345'), true);
  assert.strictEqual(v.isValidSessionCode('SAN8JYSV'), true);
});

test('sessiecode: ongeldig', () => {
  assert.strictEqual(v.isValidSessionCode('abc12345'), false); // kleine letters
  assert.strictEqual(v.isValidSessionCode('ABC123'), false);   // te kort
  assert.strictEqual(v.isValidSessionCode('ABC123456'), false); // te lang
  assert.strictEqual(v.isValidSessionCode('ABC-1234'), false); // streepje
  assert.strictEqual(v.isValidSessionCode(''), false);
  assert.strictEqual(v.isValidSessionCode(null), false);
  assert.strictEqual(v.isValidSessionCode('"ABC12345"'), false); // JSON quotes (29a bug!)
});

// ── Config-sleutels (whitelist) ───────────────────────────────────────────────
test('config-sleutel: toegestane sleutels', () => {
  assert.strictEqual(v.isAllowedConfigKey('autoIndent'), true);
  assert.strictEqual(v.isAllowedConfigKey('autoClosingBrackets'), true);
  assert.strictEqual(v.isAllowedConfigKey('parameterHints'), true);
});

test('config-sleutel: verboden sleutels geweigerd', () => {
  assert.strictEqual(v.isAllowedConfigKey('evilKey'), false);
  assert.strictEqual(v.isAllowedConfigKey('__proto__'), false);
  assert.strictEqual(v.isAllowedConfigKey(''), false);
});

test('config-waarde: enkel booleans', () => {
  assert.strictEqual(v.isValidConfigValue(true), true);
  assert.strictEqual(v.isValidConfigValue(false), true);
  assert.strictEqual(v.isValidConfigValue('true'), false);
  assert.strictEqual(v.isValidConfigValue(1), false);
  assert.strictEqual(v.isValidConfigValue(null), false);
});

// ── clampString ───────────────────────────────────────────────────────────────
test('clampString: begrenst lengte', () => {
  assert.strictEqual(v.clampString('hallo wereld', 5), 'hallo');
  assert.strictEqual(v.clampString('kort', 100), 'kort');
});

test('clampString: trimt witruimte', () => {
  assert.strictEqual(v.clampString('  spaties  ', 100), 'spaties');
});

test('clampString: niet-string → lege string', () => {
  assert.strictEqual(v.clampString(null, 10), '');
  assert.strictEqual(v.clampString(123, 10), '');
});

// ── clampInt ──────────────────────────────────────────────────────────────────
test('clampInt: binnen grenzen', () => {
  assert.strictEqual(v.clampInt('45', 1, 240, 60), 45);
});

test('clampInt: onder minimum → min', () => {
  assert.strictEqual(v.clampInt('0', 1, 240, 60), 1);
});

test('clampInt: boven maximum → max', () => {
  assert.strictEqual(v.clampInt('500', 1, 240, 60), 240);
});

test('clampInt: ongeldig → fallback', () => {
  assert.strictEqual(v.clampInt('abc', 1, 240, 60), 60);
  assert.strictEqual(v.clampInt(null, 1, 240, 60), 60);
});

// ── isValidRole ───────────────────────────────────────────────────────────────
test('rol: geldige rollen', () => {
  assert.strictEqual(v.isValidRole('teacher'), true);
  assert.strictEqual(v.isValidRole('admin'), true);
});

test('rol: ongeldige rollen geweigerd', () => {
  assert.strictEqual(v.isValidRole('superadmin'), false);
  assert.strictEqual(v.isValidRole('student'), false);
  assert.strictEqual(v.isValidRole(''), false);
});

// ── 30-cfg: apply-session-config scenario (server-validatie) ──────────────────
// Simuleert de filtering die server.js doet bij teacher_apply_session_config:
// enkel whitelisted sleutels met booleanwaarden worden toegepast.
function filterConfig(incoming) {
  const out = {};
  let applied = 0;
  for (const [key, value] of Object.entries(incoming)) {
    if (v.isAllowedConfigKey(key) && v.isValidConfigValue(value)) {
      out[key] = value;
      applied++;
    }
  }
  return { out, applied };
}

test('apply-config: geldige volledige config volledig toegepast', () => {
  const { out, applied } = filterConfig({
    autoIndent: true, autoClosingBrackets: false, autoClosingQuotes: true,
    quickSuggestions: false, parameterHints: true,
  });
  assert.strictEqual(applied, 5);
  assert.strictEqual(out.autoIndent, true);
  assert.strictEqual(out.autoClosingBrackets, false);
});

test('apply-config: onbekende sleutel geweigerd', () => {
  const { out, applied } = filterConfig({ autoIndent: true, evilKey: true, __proto__: false });
  assert.strictEqual(applied, 1);
  assert.strictEqual(out.autoIndent, true);
  assert.strictEqual('evilKey' in out, false);
});

test('apply-config: niet-boolean waarde geweigerd', () => {
  const { out, applied } = filterConfig({ autoIndent: 'ja', quickSuggestions: 1, parameterHints: true });
  assert.strictEqual(applied, 1);
  assert.strictEqual(out.parameterHints, true);
  assert.strictEqual('autoIndent' in out, false);
});

test('apply-config: lege config → niets toegepast', () => {
  const { applied } = filterConfig({});
  assert.strictEqual(applied, 0);
});
