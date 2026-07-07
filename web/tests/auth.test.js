// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 34a — Unit tests: auth & crypto (lib/auth.js)
// Draai met: node --test  (vanuit web/)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');

// ── safeEqual ─────────────────────────────────────────────────────────────────
test('safeEqual: gelijke strings → true', () => {
  assert.strictEqual(auth.safeEqual('geheim123', 'geheim123'), true);
});

test('safeEqual: verschillende strings → false', () => {
  assert.strictEqual(auth.safeEqual('geheim123', 'geheim124'), false);
});

test('safeEqual: verschillende lengtes → false (geen crash)', () => {
  assert.strictEqual(auth.safeEqual('kort', 'veel langer'), false);
});

test('safeEqual: lege strings → true', () => {
  assert.strictEqual(auth.safeEqual('', ''), true);
});

// ── createPasswordHash / verifyPasswordWithHash ───────────────────────────────
test('hash: correct wachtwoord verifieert', () => {
  const hash = auth.createPasswordHash('MijnW8woord!');
  assert.strictEqual(auth.verifyPasswordWithHash('MijnW8woord!', hash), true);
});

test('hash: fout wachtwoord faalt', () => {
  const hash = auth.createPasswordHash('MijnW8woord!');
  assert.strictEqual(auth.verifyPasswordWithHash('foutwachtwoord', hash), false);
});

test('hash: formaat is scrypt$N$r$p$salt$hash', () => {
  const hash = auth.createPasswordHash('test');
  const parts = hash.split('$');
  assert.strictEqual(parts.length, 6);
  assert.strictEqual(parts[0], 'scrypt');
  assert.strictEqual(parts[1], '16384');
});

test('hash: zelfde wachtwoord geeft verschillende hash (random salt)', () => {
  const h1 = auth.createPasswordHash('zelfde');
  const h2 = auth.createPasswordHash('zelfde');
  assert.notStrictEqual(h1, h2); // andere salt
  // maar beide verifiëren wel
  assert.strictEqual(auth.verifyPasswordWithHash('zelfde', h1), true);
  assert.strictEqual(auth.verifyPasswordWithHash('zelfde', h2), true);
});

test('hash: ongeldige hash-string faalt veilig', () => {
  assert.strictEqual(auth.verifyPasswordWithHash('x', 'geen-geldige-hash'), false);
  assert.strictEqual(auth.verifyPasswordWithHash('x', ''), false);
  assert.strictEqual(auth.verifyPasswordWithHash('x', null), false);
  assert.strictEqual(auth.verifyPasswordWithHash('x', 'md5$abc$def'), false);
});

test('hash: manage-teacher.js compatibiliteit (zelfde params)', () => {
  // Simuleer een hash gemaakt met dezelfde parameters als manage-teacher.js
  const crypto = require('node:crypto');
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync('cliwachtwoord', salt, 64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cliHash = `scrypt$16384$8$1$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
  // server-side verify moet dit accepteren
  assert.strictEqual(auth.verifyPasswordWithHash('cliwachtwoord', cliHash), true);
});

// Sprint 36: createPasswordHash geeft ÉÉN string (geen {hash, salt} object).
// Deze test borgt dat de admin-endpoints het juiste formaat gebruiken.
test('hash: createPasswordHash retourneert string, geen object', () => {
  const result = auth.createPasswordHash('test123');
  assert.strictEqual(typeof result, 'string');
  assert.strictEqual(result.startsWith('scrypt$'), true);
  // {hash, salt} destructuring zou undefined geven → de oude bug
  const { hash, salt } = auth.createPasswordHash('test123');
  assert.strictEqual(hash, undefined);
  assert.strictEqual(salt, undefined);
});

test('hash: string uit createPasswordHash verifieert direct', () => {
  // De hele round-trip zoals de admin-endpoints hem nu gebruiken
  const passHash = auth.createPasswordHash('AdminW8w!');
  assert.strictEqual(typeof passHash, 'string');
  assert.strictEqual(auth.verifyPasswordWithHash('AdminW8w!', passHash), true);
  assert.strictEqual(auth.verifyPasswordWithHash('fout', passHash), false);
});

// ── parseBasicAuthHeader ──────────────────────────────────────────────────────
test('parseBasicAuthHeader: geldige header', () => {
  const encoded = Buffer.from('gebruiker:wachtwoord').toString('base64');
  const result = auth.parseBasicAuthHeader('Basic ' + encoded);
  assert.deepStrictEqual(result, { username: 'gebruiker', password: 'wachtwoord' });
});

test('parseBasicAuthHeader: wachtwoord met dubbele punt', () => {
  const encoded = Buffer.from('user:pass:met:dubbelepunt').toString('base64');
  const result = auth.parseBasicAuthHeader('Basic ' + encoded);
  assert.strictEqual(result.username, 'user');
  assert.strictEqual(result.password, 'pass:met:dubbelepunt');
});

test('parseBasicAuthHeader: ongeldige input → null', () => {
  assert.strictEqual(auth.parseBasicAuthHeader(null), null);
  assert.strictEqual(auth.parseBasicAuthHeader(''), null);
  assert.strictEqual(auth.parseBasicAuthHeader('Bearer xyz'), null);
  assert.strictEqual(auth.parseBasicAuthHeader('Basic'), null);
});

// ── parseCookieHeader ─────────────────────────────────────────────────────────
test('parseCookieHeader: meerdere cookies', () => {
  const result = auth.parseCookieHeader('teacher_auth=abc123; csrf=xyz789');
  assert.strictEqual(result.teacher_auth, 'abc123');
  assert.strictEqual(result.csrf, 'xyz789');
});

test('parseCookieHeader: URL-encoded waarde', () => {
  const result = auth.parseCookieHeader('key=hello%20world');
  assert.strictEqual(result.key, 'hello world');
});

test('parseCookieHeader: lege header → leeg object', () => {
  assert.deepStrictEqual(auth.parseCookieHeader(''), {});
  assert.deepStrictEqual(auth.parseCookieHeader(null), {});
});
