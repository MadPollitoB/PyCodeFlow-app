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
// Volgorde is de kern: een echte sessie wint altijd van het oude gedeelde cookie.
// Geeft null wanneer niemand mag (de aanroeper stuurt dan naar de login).
//
//   'session' = betrouwbaar, we weten wie
//   'legacy'  = oud gedeeld cookie: we weten enkel DÁT iemand mag, niet wie (id = null)
//   'open'    = authenticatie staat uit
function bepaalTeacherIdentiteit({ sessie = null, heeftLegacyCookie = false, envUser = '', authUit = false } = {}) {
  if (authUit) {
    return { id: null, username: 'anoniem', displayName: '', role: 'admin', source: 'open' };
  }
  if (sessie) {
    return {
      id: sessie.teacher_id,
      username: sessie.username,
      displayName: sessie.display_name || '',
      role: sessie.role || 'teacher',
      source: 'session',
    };
  }
  if (heeftLegacyCookie) {
    // Bewust géén rol 'admin' verzinnen die meer mag dan verdiend: het oude cookie
    // zegt niets over wie je bent, dus krijg je de laagste rol.
    return { id: null, username: envUser || 'onbekend', displayName: '', role: 'teacher', source: 'legacy' };
  }
  return null;
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
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
};
