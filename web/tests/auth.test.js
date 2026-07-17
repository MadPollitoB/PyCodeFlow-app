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

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 50a — Sessietokens voor leerkracht-logins
// ═══════════════════════════════════════════════════════════════════════════════

test('createSessionToken: 64 hex-tekens (256 bit)', () => {
  const t = auth.createSessionToken();
  assert.match(t, /^[0-9a-f]{64}$/);
});

test('createSessionToken: elke aanroep geeft een ANDER token', () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i++) tokens.add(auth.createSessionToken());
  assert.strictEqual(tokens.size, 200, 'geen enkel token mag herhalen');
});

test('hashSessionToken: zelfde token → zelfde hash', () => {
  const t = auth.createSessionToken();
  assert.strictEqual(auth.hashSessionToken(t), auth.hashSessionToken(t));
});

test('hashSessionToken: ander token → andere hash', () => {
  assert.notStrictEqual(
    auth.hashSessionToken(auth.createSessionToken()),
    auth.hashSessionToken(auth.createSessionToken())
  );
});

test('hashSessionToken: 64 hex-tekens (sha256)', () => {
  assert.match(auth.hashSessionToken('wat dan ook'), /^[0-9a-f]{64}$/);
});

test('hashSessionToken: de hash bevat het token NIET', () => {
  // Kern van de opzet: uit de databank valt geen bruikbaar token te halen.
  const t = auth.createSessionToken();
  const h = auth.hashSessionToken(t);
  assert.ok(!h.includes(t), 'hash mag het token niet bevatten');
  assert.notStrictEqual(h, t);
});

test('hashSessionToken: lege/ontbrekende invoer crasht niet', () => {
  assert.match(auth.hashSessionToken(''), /^[0-9a-f]{64}$/);
  assert.match(auth.hashSessionToken(null), /^[0-9a-f]{64}$/);
  assert.match(auth.hashSessionToken(undefined), /^[0-9a-f]{64}$/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 50b — Wie is er ingelogd? (bepaalTeacherIdentiteit)
// ═══════════════════════════════════════════════════════════════════════════════

const sessieA = { teacher_id: 'id-a', username: 'anja',  display_name: 'Anja V.', role: 'teacher' };
const sessieB = { teacher_id: 'id-b', username: 'bram',  display_name: 'Bram K.', role: 'admin'   };

test('50b KERNTEST: sessie van A geeft A, sessie van B geeft B', () => {
  const a = auth.bepaalTeacherIdentiteit({ sessie: sessieA });
  const b = auth.bepaalTeacherIdentiteit({ sessie: sessieB });
  assert.strictEqual(a.id, 'id-a');
  assert.strictEqual(a.username, 'anja');
  assert.strictEqual(b.id, 'id-b');
  assert.strictEqual(b.username, 'bram');
  assert.notStrictEqual(a.id, b.id, 'twee leerkrachten mogen nooit dezelfde identiteit krijgen');
});

test('50b: rol komt uit de sessie, niet uit een aanname', () => {
  assert.strictEqual(auth.bepaalTeacherIdentiteit({ sessie: sessieA }).role, 'teacher');
  assert.strictEqual(auth.bepaalTeacherIdentiteit({ sessie: sessieB }).role, 'admin');
});

test('50b/50f: geen sessie → null (naar de login)', () => {
  assert.strictEqual(auth.bepaalTeacherIdentiteit({}), null);
  assert.strictEqual(auth.bepaalTeacherIdentiteit(), null);
});

test('50f KERNTEST: het oude gedeelde cookie geeft GEEN toegang meer', () => {
  // Vroeger liet heeftLegacyCookie:true je binnen zonder dat de app wist wie je was.
  // Die tak bestaat niet meer: onbekende velden worden genegeerd, geen sessie → null.
  assert.strictEqual(auth.bepaalTeacherIdentiteit({ heeftLegacyCookie: true, envUser: 'gedeeld' }), null);
});

test('50f: er zijn nog maar twee bronnen — session of open', () => {
  assert.strictEqual(auth.bepaalTeacherIdentiteit({ sessie: sessieA }).source, 'session');
  assert.strictEqual(auth.bepaalTeacherIdentiteit({ authUit: true }).source, 'open');
});

test('50b: authenticatie uit → open toegang, herkenbaar aan source', () => {
  const r = auth.bepaalTeacherIdentiteit({ authUit: true });
  assert.strictEqual(r.source, 'open');
  assert.strictEqual(r.id, null);
});

test('50b: authUit wint van alles (geen halve toestand)', () => {
  const r = auth.bepaalTeacherIdentiteit({ authUit: true, sessie: sessieA });
  assert.strictEqual(r.source, 'open');
});

test('50b: sessie zonder display_name of role → veilige standaarden', () => {
  const r = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'i', username: 'u' } });
  assert.strictEqual(r.displayName, '');
  assert.strictEqual(r.role, 'teacher');
});


// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 50d — Sessie verlengen bij activiteit (berekenSessieVerlenging)
// ═══════════════════════════════════════════════════════════════════════════════

const UUR = 3600 * 1000;
const MAX = 8 * UUR;        // gewone looptijd
const ABS = 24 * UUR;       // harde grens

test('50d: net ingelogd → NIET verlengen (geen schrijfactie per verzoek)', () => {
  const now = 1_000_000;
  const r = auth.berekenSessieVerlenging({
    now, createdAt: now, expiresAt: now + MAX, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, false);
});

test('50d: net vóór de helft → nog niet verlengen', () => {
  const start = 1_000_000;
  const now = start + (MAX / 2) - UUR;   // 3u bezig van de 8u
  const r = auth.berekenSessieVerlenging({
    now, createdAt: start, expiresAt: start + MAX, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, false);
});

test('50d: voorbij de helft → WEL verlengen', () => {
  const start = 1_000_000;
  const now = start + (MAX / 2) + UUR;   // 5u bezig van de 8u
  const r = auth.berekenSessieVerlenging({
    now, createdAt: start, expiresAt: start + MAX, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, true);
  assert.strictEqual(r.nieuwEind, now + MAX);
});

test('50d: verlengen gaat NOOIT voorbij de harde grens', () => {
  const start = 1_000_000;
  const now = start + 20 * UUR;          // 20u bezig, grens ligt op 24u
  const r = auth.berekenSessieVerlenging({
    now, createdAt: start, expiresAt: now + UUR, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, true);
  assert.strictEqual(r.nieuwEind, start + ABS, 'moet afgekapt worden op de harde grens');
  assert.ok(r.nieuwEind < now + MAX, 'dus korter dan een volle looptijd');
});

test('50d: harde grens bereikt → niet meer verlengen, sessie dooft uit', () => {
  const start = 1_000_000;
  const now = start + ABS;               // exact op de grens
  const r = auth.berekenSessieVerlenging({
    now, createdAt: start, expiresAt: now + UUR, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, false);
});

test('50d: voorbij de harde grens → niet verlengen', () => {
  const start = 1_000_000;
  const now = start + ABS + UUR;
  const r = auth.berekenSessieVerlenging({
    now, createdAt: start, expiresAt: now + UUR, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, false);
});

test('50d: verlengen mag een sessie nooit INKORTEN', () => {
  // Vlak vóór de harde grens zou het nieuwe einde vroeger kunnen vallen dan wat
  // er al staat. Dan moeten we niets doen i.p.v. de leerkracht tijd afpakken.
  const start = 1_000_000;
  const now = start + 23 * UUR;
  const huidigEind = start + ABS;        // staat al op de grens
  const r = auth.berekenSessieVerlenging({
    now, createdAt: start, expiresAt: huidigEind, maxAgeMs: MAX, absoluutMaxMs: ABS,
  });
  assert.strictEqual(r.verlengen, false, 'nieuw einde zou niet later zijn → niets doen');
});

test('50d: een verlengde sessie schuift echt op (werkdag valt niet stil)', () => {
  const start = 1_000_000;
  let eind = start + MAX;
  // Leerkracht klikt om 5u, 10u en 15u — de sessie moet blijven leven
  for (const uren of [5, 10, 15]) {
    const now = start + uren * UUR;
    const r = auth.berekenSessieVerlenging({
      now, createdAt: start, expiresAt: eind, maxAgeMs: MAX, absoluutMaxMs: ABS,
    });
    if (r.verlengen) eind = r.nieuwEind;
    assert.ok(eind > now, `na ${uren}u moet de sessie nog leven`);
  }
  assert.ok(eind <= start + ABS, 'maar nooit voorbij de harde grens');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 48b1 — De actieve school hangt aan de sessie
// ═══════════════════════════════════════════════════════════════════════════════

test('48b1: de actieve school komt uit de SESSIE, niet uit de browser', () => {
  const r = auth.bepaalTeacherIdentiteit({
    sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher',
              active_school_id: 's1', active_school_name: 'Atheneum Hoboken' },
  });
  assert.strictEqual(r.activeSchoolId, 's1');
  assert.strictEqual(r.activeSchoolName, 'Atheneum Hoboken');
});

test('48b1: geen school in de sessie → null (breekt niets)', () => {
  const r = auth.bepaalTeacherIdentiteit({ sessie: sessieA });
  assert.strictEqual(r.activeSchoolId, null);
  assert.strictEqual(r.activeSchoolName, null);
});

test('48b1: bij authenticatie uit is er ook geen school', () => {
  const r = auth.bepaalTeacherIdentiteit({ authUit: true });
  assert.strictEqual(r.activeSchoolId, null);
});
