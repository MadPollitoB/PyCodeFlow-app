// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Auth & crypto helpers (pure, testbaar)
// Sprint 34a: geëxtraheerd uit server.js zodat de kritieke auth-logica
// geïsoleerd unit-getest kan worden zonder de volledige server te booten.
// server.js requiret deze module — één bron van waarheid.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Timing-safe string-vergelijking. Retourneert false bij verschillende lengtes.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Maak een scrypt-hash in het formaat scrypt$N$r$p$saltB64$hashB64
function createPasswordHash(password, salt = crypto.randomBytes(16)) {
  const normalizedSalt = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'base64');
  const derivedKey = crypto.scryptSync(String(password), normalizedSalt, 64, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${normalizedSalt.toString('base64')}$${derivedKey.toString('base64')}`;
}

// Verifieer een wachtwoord tegen een opgeslagen hash. Timing-safe, faalt veilig.
function verifyPasswordWithHash(password, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Parse een HTTP Basic Auth header → { username, password } of null.
function parseBasicAuthHeader(headerValue) {
  try {
    if (!headerValue || typeof headerValue !== 'string') return null;
    const [scheme, encoded] = headerValue.split(' ');
    if (scheme !== 'Basic' || !encoded) return null;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

// Parse een Cookie-header → object met key/value paren.
function parseCookieHeader(headerValue) {
  const out = {};
  if (!headerValue || typeof headerValue !== 'string') return out;
  headerValue.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

// ── Sprint 50a: sessietokens voor leerkracht-logins ──────────────────────────
// Het token dat de browser krijgt is willekeurig; in de databank bewaren we enkel
// de SHA-256 ervan. Zo geeft een gelekte databank geen bruikbare sessies: uit een
// hash valt het token niet te herleiden. Vergelijken doen we op de hash, dus een
// gewone (snelle) hash volstaat hier — dit is geen wachtwoord dat mensen kiezen,
// maar 256 bit puur toeval.

// ── Sprint 50b: wie is er ingelogd? ──────────────────────────────────────────
// Pure beslisregel, los van Express en de databank — zo is ze rechtstreeks testbaar.
// Geeft null wanneer niemand mag (de aanroeper stuurt dan naar de login).
//
// Sprint 50f: de tak voor het oude gedeelde cookie is weg. Er zijn nog twee bronnen:
//   'session' = een echte sessie: we weten wie
//   'open'    = authenticatie staat uit (POC_BASIC_AUTH_ENABLED=false)
function bepaalTeacherIdentiteit({ sessie = null, authUit = false } = {}) {
  if (authUit) {
    return { id: null, username: 'anoniem', displayName: '', role: 'admin', source: 'open',
             activeSchoolId: null, activeSchoolName: null };
  }
  if (sessie) {
    return {
      id: sessie.teacher_id,
      username: sessie.username,
      displayName: sessie.display_name || '',
      role: sessie.role || 'teacher',
      source: 'session',
      // Sprint 48b1: komt uit de sessie in de databank, niet uit de browser.
      activeSchoolId: sessie.active_school_id || null,
      activeSchoolName: sessie.active_school_name || null,
    };
  }
  return null;
}

// ── Sprint 50d: moet deze sessie verlengd worden? ────────────────────────────
// Pure rekenregel — geen databank, geen klok van buitenaf, dus rechtstreeks testbaar.
//
// Drie regels, elk om een concreet probleem te vermijden:
//  1. HARDE GRENS. Een sessie mag nooit eeuwig blijven leven door dagelijks gebruik.
//     Op een klaslokaal-pc is dat het verschil tussen "vergeten af te melden" en
//     "iedereen kan er maanden bij".
//  2. PAS HALFWEG verlengen. Anders schrijf je bij élk verzoek naar de databank —
//     101 endpoints × elke klik. Halfweg is vaak genoeg en kost bijna niets.
//  3. NOOIT INKORTEN. Vlak vóór de harde grens zou het nieuwe einde vroeger kunnen
//     vallen dan wat er al staat; dan doen we niets.
function berekenSessieVerlenging({ now, createdAt, expiresAt, maxAgeMs, absoluutMaxMs }) {
  const geen = { verlengen: false, nieuwEind: null };
  const absoluutEind = Number(createdAt) + Number(absoluutMaxMs);

  if (now >= absoluutEind) return geen;                       // 1
  if (now < Number(expiresAt) - Number(maxAgeMs) / 2) return geen;  // 2

  const nieuwEind = Math.min(now + Number(maxAgeMs), absoluutEind);
  if (nieuwEind <= Number(expiresAt)) return geen;            // 3
  return { verlengen: true, nieuwEind };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// ── Sprint 51a (Fase 2 — eigenaarschap): wie wordt de eigenaar van een NIEUWE
// sessie? Pure regel, los van Express/sockets — zo blijft ze rechtstreeks
// testbaar zonder databank, net als bepaalTeacherIdentiteit hierboven.
//
// De eigenaar is gewoon de leerkracht die de sessie aanmaakt. Bij authUit
// (POC_BASIC_AUTH_ENABLED=false, geen echte accounts) is er niemand om als
// eigenaar te noteren — dat is de bewuste "open" modus, geen bug.
function bepaalSessieEigenaar(teacher) {
  return teacher?.id || null;
}

module.exports = {
  SCRYPT_PARAMS,
  safeEqual,
  createPasswordHash,
  verifyPasswordWithHash,
  parseBasicAuthHeader,
  parseCookieHeader,
  createSessionToken,
  hashSessionToken,
  bepaalTeacherIdentiteit,
  berekenSessieVerlenging,
  bepaalSessieEigenaar,
};
