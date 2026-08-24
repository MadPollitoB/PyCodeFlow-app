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

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 51a (Fase 2 — eigenaarschap) — bepaalSessieEigenaar
// ═══════════════════════════════════════════════════════════════════════════════

test('51a KERNTEST: nieuwe sessie krijgt de juiste eigenaar', () => {
  const identiteitA = auth.bepaalTeacherIdentiteit({ sessie: sessieA });
  const identiteitB = auth.bepaalTeacherIdentiteit({ sessie: sessieB });
  assert.strictEqual(auth.bepaalSessieEigenaar(identiteitA), 'id-a');
  assert.strictEqual(auth.bepaalSessieEigenaar(identiteitB), 'id-b');
  assert.notStrictEqual(
    auth.bepaalSessieEigenaar(identiteitA), auth.bepaalSessieEigenaar(identiteitB),
    'twee verschillende leerkrachten mogen nooit dezelfde eigenaar opleveren'
  );
});

test('51a: geen leerkracht (undefined/null) → geen eigenaar, geen crash', () => {
  assert.strictEqual(auth.bepaalSessieEigenaar(undefined), null);
  assert.strictEqual(auth.bepaalSessieEigenaar(null), null);
});

test('51a: authUit (open modus) heeft geen eigenaar — bewust, geen bug', () => {
  const open = auth.bepaalTeacherIdentiteit({ authUit: true });
  assert.strictEqual(auth.bepaalSessieEigenaar(open), null);
});

test('51a: eigenaar volgt de socket-identiteit net zo goed als de REST-identiteit', () => {
  // De socket-kant (io.use-middleware, sprint 50f) en de REST-kant (requireTeacherAuth,
  // sprint 50b) leveren allebei hetzelfde identiteit-object via bepaalTeacherIdentiteit —
  // bepaalSessieEigenaar hoeft dus niet te weten via welk kanaal iemand binnenkwam.
  const viaSocket = auth.bepaalTeacherIdentiteit({ sessie: sessieA });
  const viaRest    = auth.bepaalTeacherIdentiteit({ sessie: sessieA });
  assert.strictEqual(auth.bepaalSessieEigenaar(viaSocket), auth.bepaalSessieEigenaar(viaRest));
});

// ── Backfill bestaande rijen (database.js migratie) ─────────────────────────────
// De DB-migratie vereist een live PostgreSQL; hier testen we de LOGICA die ze
// borgt (zelfde patroon als membership.test.js): bij precies één leerkrachtaccount
// is er maar één mogelijke eigenaar voor oude sessies, bij meerdere blijft het
// bewust onbekend i.p.v. te gokken.
function backfillSessionOwners(sessions, teacherIds) {
  return sessions.map(s => {
    if (s.teacherId != null) return s; // al een eigenaar → nooit overschrijven
    if (teacherIds.length === 1) return { ...s, teacherId: teacherIds[0] };
    return s; // 0 of >1 leerkrachten → blijft onbekend (null)
  });
}

test('51a backfill: precies 1 leerkracht → alle wees-sessies krijgen die eigenaar', () => {
  const sessies = [{ code: 'AAA', teacherId: null }, { code: 'BBB', teacherId: null }];
  const result = backfillSessionOwners(sessies, ['solo-teacher']);
  assert.strictEqual(result[0].teacherId, 'solo-teacher');
  assert.strictEqual(result[1].teacherId, 'solo-teacher');
});

test('51a backfill: meerdere leerkrachten → blijft NULL (niet gokken)', () => {
  const sessies = [{ code: 'AAA', teacherId: null }];
  const result = backfillSessionOwners(sessies, ['id-a', 'id-b']);
  assert.strictEqual(result[0].teacherId, null);
});

test('51a backfill: geen leerkrachten → blijft NULL', () => {
  const sessies = [{ code: 'AAA', teacherId: null }];
  const result = backfillSessionOwners(sessies, []);
  assert.strictEqual(result[0].teacherId, null);
});

test('51a backfill: raakt nooit een sessie die al een eigenaar heeft', () => {
  const sessies = [{ code: 'AAA', teacherId: 'al-gezet' }];
  const result = backfillSessionOwners(sessies, ['solo-teacher']);
  assert.strictEqual(result[0].teacherId, 'al-gezet', 'idempotent: bestaande eigenaar blijft staan');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 51b (Fase 2 — autorisatie) — magSessieBeheren
//
// De regel die zowel de REST-middleware (requireSessionAccess) als de socketguards
// (socketMagSessie) gebruiken: mag deze leerkracht deze sessie openen/beheren?
// ═══════════════════════════════════════════════════════════════════════════════

const leerkrachtA = { id: 'id-a', username: 'anja', role: 'teacher' };
const leerkrachtB = { id: 'id-b', username: 'bram', role: 'teacher' };
const beheerder   = { id: 'id-x', username: 'admin', role: 'admin' };

test('51b KERNTEST: A mag B\'s sessie NIET beheren (openen/sluiten/verwijderen)', () => {
  // sessie is van B (owner id-b); A probeert erbij
  assert.strictEqual(auth.magSessieBeheren(leerkrachtA, 'id-b'), false);
});

test('51b: de eigenaar mag zijn eigen sessie beheren', () => {
  assert.strictEqual(auth.magSessieBeheren(leerkrachtA, 'id-a'), true);
  assert.strictEqual(auth.magSessieBeheren(leerkrachtB, 'id-b'), true);
});

test('51b: een admin mag elke sessie beheren', () => {
  assert.strictEqual(auth.magSessieBeheren(beheerder, 'id-a'), true);
  assert.strictEqual(auth.magSessieBeheren(beheerder, 'id-b'), true);
  assert.strictEqual(auth.magSessieBeheren(beheerder, null), true);
});

test('51k REGRESSIE: een super-admin mag elke sessie beheren (was kapot — enkel role==="admin" telde mee)', () => {
  const superadmin = { id: 'id-super', username: 'super', role: 'superadmin' };
  assert.strictEqual(auth.magSessieBeheren(superadmin, 'id-a'), true);
  assert.strictEqual(auth.magSessieBeheren(superadmin, 'id-b'), true);
  assert.strictEqual(auth.magSessieBeheren(superadmin, null), true);
});

test('51b: open-modus (source open → rol admin) mag alles', () => {
  const open = auth.bepaalTeacherIdentiteit({ authUit: true });
  assert.strictEqual(auth.magSessieBeheren(open, 'id-a'), true);
});

test('51b: legacy-sessie zonder eigenaar (null) blijft voor elke leerkracht beheerbaar', () => {
  // Bewuste transitieregel: sessies van vóór 51a die de backfill niet kon toewijzen
  // mogen niemand buitensluiten.
  assert.strictEqual(auth.magSessieBeheren(leerkrachtA, null), true);
  assert.strictEqual(auth.magSessieBeheren(leerkrachtB, null), true);
  assert.strictEqual(auth.magSessieBeheren(leerkrachtA, undefined), true);
});

test('51b: geen (geldige) leerkracht → nooit toegang', () => {
  assert.strictEqual(auth.magSessieBeheren(null, 'id-a'), false);
  assert.strictEqual(auth.magSessieBeheren(undefined, 'id-a'), false);
});

test('51b: identiteit uit bepaalTeacherIdentiteit werkt rechtstreeks in de regel', () => {
  // Zoals de echte flow: identiteit komt uit de sessie, eigenaar is een teacher_id.
  const a = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magSessieBeheren(a, 'id-a'), true);   // eigen
  assert.strictEqual(auth.magSessieBeheren(a, 'id-b'), false);  // van iemand anders
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 51c — Bibliotheek: zichtbaarheid (privé/school/publiek) + sjabloon↔vraag
// ═══════════════════════════════════════════════════════════════════════════════

const anja  = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja',  role: 'teacher' } });
const bob   = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-b', username: 'bob',   role: 'teacher' } });
const admin = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-x', username: 'admin', role: 'admin'   } });

// ── scopeRang ─────────────────────────────────────────────────────────────────
test('51c scopeRang: private<school<public, onbekend telt als privé', () => {
  assert.strictEqual(auth.scopeRang('private'), 0);
  assert.strictEqual(auth.scopeRang('school'),  1);
  assert.strictEqual(auth.scopeRang('public'),  2);
  assert.strictEqual(auth.scopeRang('rommel'),  0);
});

// ── sjabloonItemZichtbaar ─────────────────────────────────────────────────────
test('51c zichtbaar: eigen item zie je altijd, ongeacht scope', () => {
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'private' }, anja, {}), true);
});

test('51c zichtbaar: privé van iemand anders → nooit', () => {
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'private' }, bob, { deeltSchool: true }), false);
});

test('51c zichtbaar: publiek → iedereen', () => {
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'public' }, bob, { deeltSchool: false }), true);
});

test('51c zichtbaar: school → enkel wie een school deelt', () => {
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'school' }, bob, { deeltSchool: true }),  true);
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'school' }, bob, { deeltSchool: false }), false);
});

test('51c zichtbaar: admin ziet school-items ook zonder gedeelde school', () => {
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'school' }, admin, { deeltSchool: false }), true);
  // maar admin ziet andermans privé NIET in de bibliotheek
  assert.strictEqual(auth.sjabloonItemZichtbaar({ ownerId: 'id-a', scope: 'private' }, admin, {}), false);
});

// ── magVraagKoppelen ──────────────────────────────────────────────────────────
test('51c koppelen: publiek sjabloon aanvaardt enkel publieke vragen', () => {
  assert.strictEqual(auth.magVraagKoppelen('public', 'public'),  true);
  assert.strictEqual(auth.magVraagKoppelen('public', 'school'),  false);
  assert.strictEqual(auth.magVraagKoppelen('public', 'private'), false);
});

test('51c koppelen: school-sjabloon aanvaardt school + publiek, niet privé', () => {
  assert.strictEqual(auth.magVraagKoppelen('school', 'public'),  true);
  assert.strictEqual(auth.magVraagKoppelen('school', 'school'),  true);
  assert.strictEqual(auth.magVraagKoppelen('school', 'private'), false);
});

test('51c koppelen: privé sjabloon aanvaardt alles', () => {
  for (const qs of ['private', 'school', 'public']) {
    assert.strictEqual(auth.magVraagKoppelen('private', qs), true);
  }
});

// ── magSjabloonScopeWorden ────────────────────────────────────────────────────
test('51c sjabloon-scope: breder maken mag enkel als alle vragen dat toelaten', () => {
  // sjabloon met een school-vraag mag WEL school worden, NIET publiek
  assert.strictEqual(auth.magSjabloonScopeWorden('school', ['school', 'public']), true);
  assert.strictEqual(auth.magSjabloonScopeWorden('public', ['school', 'public']), false);
});

test('51c sjabloon-scope: smaller (meer privé) maken mag altijd', () => {
  assert.strictEqual(auth.magSjabloonScopeWorden('private', ['school', 'public', 'private']), true);
});

test('51c sjabloon-scope: leeg sjabloon mag elke scope worden', () => {
  assert.strictEqual(auth.magSjabloonScopeWorden('public', []), true);
});

// ── magSjabloonBeheren (alias van magSessieBeheren) ───────────────────────────
test('51c beheren: enkel eigenaar (of admin/legacy) mag een sjabloon/vraag wijzigen', () => {
  assert.strictEqual(auth.magSjabloonBeheren(anja, 'id-a'), true);   // eigenaar
  assert.strictEqual(auth.magSjabloonBeheren(bob,  'id-a'), false);  // ander
  assert.strictEqual(auth.magSjabloonBeheren(admin,'id-a'), true);   // admin
  assert.strictEqual(auth.magSjabloonBeheren(bob,  null),   true);   // legacy zonder eigenaar
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 51d — Gewone sessies enkel zichtbaar voor de eigenaar (magSessieZien)
// ═══════════════════════════════════════════════════════════════════════════════
test('51d zien: eigenaar ziet zijn eigen gewone sessie', () => {
  const t = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magSessieZien(t, { teacherId: 'id-a' }), true);
});

test('51d zien: een leerkracht ziet andermans gewone sessie NIET', () => {
  const t = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magSessieZien(t, { teacherId: 'id-b' }), false);
});

test('51d zien: GEEN admin-alziend-oog — admin ziet andermans gewone sessie niet in de lijst', () => {
  const admin = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-x', username: 'admin', role: 'admin' } });
  assert.strictEqual(auth.magSessieZien(admin, { teacherId: 'id-b' }), false);
  assert.strictEqual(auth.magSessieZien(admin, { teacherId: 'id-x' }), true); // eigen wel
});

test('51d zien: GEEN null-legacy-uitzondering — sessie zonder eigenaar is niet voor iedereen', () => {
  const t = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magSessieZien(t, { teacherId: null }), false);
  assert.strictEqual(auth.magSessieZien(t, {}), false);
});

test('51d zien: open modus (geen teacher.id) ziet alles — één gebruiker', () => {
  const open = { id: null, role: 'admin' };
  assert.strictEqual(auth.magSessieZien(open, { teacherId: 'id-a' }), true);
  assert.strictEqual(auth.magSessieZien(open, { teacherId: null }), true);
});

test('51d zien: geen leerkracht → nooit', () => {
  assert.strictEqual(auth.magSessieZien(null, { teacherId: 'id-a' }), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 51e — Leerkracht ziet enkel eigen (of niet-toegewezen) klassen (magKlasZien)
// ═══════════════════════════════════════════════════════════════════════════════
test('51e klas: gekoppelde leerkracht ziet zijn klas', () => {
  const t = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magKlasZien(t, { isLinked: true, heeftEigenaar: true }), true);
});

test('51e klas: niet-gekoppelde leerkracht ziet andermans klas niet', () => {
  const t = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magKlasZien(t, { isLinked: false, heeftEigenaar: true }), false);
});

test('51e klas: niet-toegewezen klas (legacy) blijft zichtbaar voor iedereen', () => {
  const t = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-a', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magKlasZien(t, { isLinked: false, heeftEigenaar: false }), true);
});

test('51e klas: admin ziet alle klassen (klasbeheer is admintaak)', () => {
  const admin = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'id-x', username: 'admin', role: 'admin' } });
  assert.strictEqual(auth.magKlasZien(admin, { isLinked: false, heeftEigenaar: true }), true);
});

test('51e klas: geen leerkracht → nooit', () => {
  assert.strictEqual(auth.magKlasZien(null, { isLinked: true, heeftEigenaar: true }), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 52b — klas-startcode generator (board-leesbaar, geen ambigue tekens)
// ═══════════════════════════════════════════════════════════════════════════════
test('52b klascode: juiste lengte en enkel toegelaten tekens', () => {
  for (let i = 0; i < 200; i++) {
    const code = auth.genereerKlascode(6);
    assert.strictEqual(code.length, 6);
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test('52b klascode: geen ambigue tekens (0 1 O I)', () => {
  const code = Array.from({ length: 500 }, () => auth.genereerKlascode(8)).join('');
  assert.doesNotMatch(code, /[01OI]/); // alfabet houdt L wél, sluit 0 1 O I uit
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 52e — toegangsregel leerlingen (magLeerlingActiviteit)
// ═══════════════════════════════════════════════════════════════════════════════
test('52e toegang: active mag alles', () => {
  const s = { status: 'active' };
  for (const a of ['klassessie', 'oefenen', 'toets', 'taak']) {
    assert.strictEqual(auth.magLeerlingActiviteit(s, a), true);
  }
});

test('52e toegang: pending mag klassessie + oefenen, GEEN toets/taak', () => {
  const s = { status: 'pending' };
  assert.strictEqual(auth.magLeerlingActiviteit(s, 'klassessie'), true);
  assert.strictEqual(auth.magLeerlingActiviteit(s, 'oefenen'), true);
  assert.strictEqual(auth.magLeerlingActiviteit(s, 'toets'), false);
  assert.strictEqual(auth.magLeerlingActiviteit(s, 'taak'), false);
});

test('52e toegang: blocked mag niets', () => {
  const s = { status: 'blocked' };
  for (const a of ['klassessie', 'oefenen', 'toets', 'taak']) {
    assert.strictEqual(auth.magLeerlingActiviteit(s, a), false);
  }
});

test('52e toegang: geen account of onbekende status → niets (veilige default)', () => {
  assert.strictEqual(auth.magLeerlingActiviteit(null, 'oefenen'), false);
  assert.strictEqual(auth.magLeerlingActiviteit({ status: 'rommel' }, 'oefenen'), false);
});

test('52e toegang: student zonder status telt als active (bestaande data)', () => {
  assert.strictEqual(auth.magLeerlingActiviteit({}, 'toets'), true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 52f — wachtwoordherstel via klas-startcode (magWachtwoordHerstel)
// ═══════════════════════════════════════════════════════════════════════════════
test('52f herstel: enkel als leerkracht reset aanzette (must_change_password)', () => {
  assert.strictEqual(auth.magWachtwoordHerstel({ status: 'pending', must_change_password: true }, true), true);
  assert.strictEqual(auth.magWachtwoordHerstel({ status: 'pending', must_change_password: false }, true), false);
});

test('52f herstel: e-mail moet bij de klas van de code horen', () => {
  assert.strictEqual(auth.magWachtwoordHerstel({ status: 'active', must_change_password: true }, false), false);
  assert.strictEqual(auth.magWachtwoordHerstel({ status: 'active', must_change_password: true }, true), true);
});

test('52f herstel: geblokkeerd account herstelt nooit', () => {
  assert.strictEqual(auth.magWachtwoordHerstel({ status: 'blocked', must_change_password: true }, true), false);
});

test('52f herstel: geen student → nooit', () => {
  assert.strictEqual(auth.magWachtwoordHerstel(null, true), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 53d — admin-takedown van bibliotheekitems (magBibliotheekModereren)
// ═══════════════════════════════════════════════════════════════════════════════
test('53d moderatie: admin mag verbergen', () => {
  const admin = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'a', username: 'admin', role: 'admin' } });
  assert.strictEqual(auth.magBibliotheekModereren(admin), true);
});
test('53d moderatie: gewone leerkracht mag niet', () => {
  const lk = auth.bepaalTeacherIdentiteit({ sessie: { teacher_id: 'b', username: 'anja', role: 'teacher' } });
  assert.strictEqual(auth.magBibliotheekModereren(lk), false);
});
test('53d moderatie: geen leerkracht → nee', () => {
  assert.strictEqual(auth.magBibliotheekModereren(null), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 48c2b — leesscoping op de actieve school (magRijVanSchoolZien)
// ═══════════════════════════════════════════════════════════════════════════════
test('48c2b scoping: rij van eigen school → zichtbaar', () => {
  assert.strictEqual(auth.magRijVanSchoolZien('school-A', 'school-A'), true);
});
test('48c2b scoping: rij van andere school → onzichtbaar', () => {
  assert.strictEqual(auth.magRijVanSchoolZien('school-A', 'school-B'), false);
});
test('48c2b scoping: school-loze rij (legacy) → altijd zichtbaar', () => {
  assert.strictEqual(auth.magRijVanSchoolZien('school-A', null), true);
  assert.strictEqual(auth.magRijVanSchoolZien(null, null), true);
});
test('48c2b scoping: geen actieve school → geen filtering', () => {
  assert.strictEqual(auth.magRijVanSchoolZien(null, 'school-B'), true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 48c4 — super-admin (isSuperAdmin / isBeheerder / leesScopeVoor)
// ═══════════════════════════════════════════════════════════════════════════════
test('48c4 superadmin: rolherkenning + beheerder-hiërarchie', () => {
  const sup = { role: 'superadmin', activeSchoolId: 'school-A' };
  const adm = { role: 'admin', activeSchoolId: 'school-A' };
  const lk  = { role: 'teacher', activeSchoolId: 'school-A' };
  assert.strictEqual(auth.isSuperAdmin(sup), true);
  assert.strictEqual(auth.isSuperAdmin(adm), false);
  assert.strictEqual(auth.isBeheerder(sup), true);
  assert.strictEqual(auth.isBeheerder(adm), true);
  assert.strictEqual(auth.isBeheerder(lk), false);
  assert.strictEqual(auth.isBeheerder(null), false);
});

test('48c4 superadmin: leesScopeVoor — superadmin krijgt geen schoolfilter', () => {
  assert.strictEqual(auth.leesScopeVoor({ role: 'superadmin', activeSchoolId: 'school-A' }), null);
  assert.strictEqual(auth.leesScopeVoor({ role: 'admin', activeSchoolId: 'school-A' }), 'school-A');
  assert.strictEqual(auth.leesScopeVoor({ role: 'teacher', activeSchoolId: null }), null);
  assert.strictEqual(auth.leesScopeVoor(null), null);
});

test('48c4 superadmin: mag Bibliotheek modereren; magKlasZien telt hem als admin', () => {
  const sup = { role: 'superadmin' };
  assert.strictEqual(auth.magBibliotheekModereren(sup), true);
  assert.strictEqual(auth.magKlasZien(sup, { isLinked: false, heeftEigenaar: true }), true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 55 — beheer-RBAC (magBeheerZien / magSysteemZien / magRolToekennen)
// ═══════════════════════════════════════════════════════════════════════════════
test('55 rbac: Beheer voor admin + superadmin, niet voor leerkracht', () => {
  assert.strictEqual(auth.magBeheerZien({ id: 'x', role: 'superadmin' }), true);
  assert.strictEqual(auth.magBeheerZien({ id: 'x', role: 'admin' }), true);
  assert.strictEqual(auth.magBeheerZien({ id: 'x', role: 'teacher' }), false);
  assert.strictEqual(auth.magBeheerZien(null), false);
});

test('55 rbac: Systeem ENKEL voor superadmin (en open modus)', () => {
  assert.strictEqual(auth.magSysteemZien({ id: 'x', role: 'superadmin' }), true);
  assert.strictEqual(auth.magSysteemZien({ id: 'x', role: 'admin' }), false);
  assert.strictEqual(auth.magSysteemZien({ id: 'x', role: 'teacher' }), false);
  assert.strictEqual(auth.magSysteemZien({ id: null, role: 'admin', username: 'anoniem' }), true); // open modus
});

test('55 rbac: superadmin kent elke rol toe', () => {
  const sup = { id: 's', role: 'superadmin' };
  assert.strictEqual(auth.magRolToekennen(sup, 'teacher', 'superadmin', false), true);
  assert.strictEqual(auth.magRolToekennen(sup, 'superadmin', 'teacher', false), true);
});

test('55 rbac: admin enkel teacher↔admin binnen gedeelde school', () => {
  const adm = { id: 'a', role: 'admin' };
  assert.strictEqual(auth.magRolToekennen(adm, 'teacher', 'admin', true), true);
  assert.strictEqual(auth.magRolToekennen(adm, 'admin', 'teacher', true), true);
  assert.strictEqual(auth.magRolToekennen(adm, 'teacher', 'admin', false), false);   // geen gedeelde school
  assert.strictEqual(auth.magRolToekennen(adm, 'teacher', 'superadmin', true), false); // nooit superadmin geven
  assert.strictEqual(auth.magRolToekennen(adm, 'superadmin', 'teacher', true), false); // superadmin niet raken
});

test('55 rbac: gewone leerkracht kent geen rollen toe', () => {
  assert.strictEqual(auth.magRolToekennen({ id: 't', role: 'teacher' }, 'teacher', 'admin', true), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 56 — klasleerkracht beheert zijn eigen klasleerlingen (magLeerlingBeheren)
// ═══════════════════════════════════════════════════════════════════════════════
test('56 klasbeheer: leerkracht mag leerling uit EIGEN klas', () => {
  assert.strictEqual(auth.magLeerlingBeheren({ id: 't', role: 'teacher' }, true), true);
});
test('56 klasbeheer: leerkracht mag GEEN leerling buiten zijn klassen', () => {
  assert.strictEqual(auth.magLeerlingBeheren({ id: 't', role: 'teacher' }, false), false);
});
test('56 klasbeheer: admin/superadmin school-breed, ook buiten eigen klassen', () => {
  assert.strictEqual(auth.magLeerlingBeheren({ id: 'a', role: 'admin' }, false), true);
  assert.strictEqual(auth.magLeerlingBeheren({ id: 's', role: 'superadmin' }, false), true);
});
test('56 klasbeheer: open modus mag alles; geen leerkracht → nooit', () => {
  assert.strictEqual(auth.magLeerlingBeheren({ id: null, role: 'teacher' }, false), true);
  assert.strictEqual(auth.magLeerlingBeheren(null, true), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 72 — resultaten van een klas: enkel eigen klassen (of beheerder in de school)
// De pure kant hiervan: een gewone leerkracht die niet gekoppeld is, mag niets zien.
// (De volledige poort staat in server.js: koppeling → beheerder → school.)
// ═══════════════════════════════════════════════════════════════════════════════
test('72 klasresultaten: gewone leerkracht is géén beheerder, dus koppeling is bepalend', () => {
  assert.strictEqual(auth.isBeheerder({ id: 't', role: 'teacher' }), false);
  assert.strictEqual(auth.isBeheerder({ id: 'a', role: 'admin' }), true);
  assert.strictEqual(auth.isSuperAdmin({ id: 's', role: 'superadmin' }), true);
  assert.strictEqual(auth.isSuperAdmin({ id: 'a', role: 'admin' }), false);
});
