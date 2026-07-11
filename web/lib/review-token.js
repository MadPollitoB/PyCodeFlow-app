// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Nakijk-token (sprint 37d)
//
// Een leerling die zijn eigen toets wil inzien, logt opnieuw in met naam + klas.
// De server geeft dan een kortlevend, HMAC-ondertekend token terug dat vastlegt:
//   - voor welke toets (sessiecode)
//   - welke leerling (student_id uit quiz_answers)
//   - tot wanneer het geldig is
//
// Stateless: geen extra tabel nodig. Het token leeft in het geheugen van de
// pagina (niet in localStorage), zodat inzage op elk toestel werkt zonder sporen.
//
// Formaat: base64url(payloadJSON) + "." + base64url(HMAC-SHA256)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 uur

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payloadB64, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/**
 * Maak een nakijk-token.
 * @param {string} sessionCode toetscode (hoofdletters)
 * @param {string} studentId   student_id uit quiz_answers (sessie-UUID)
 * @param {string} secret      servergeheim
 * @param {number} ttlMs       geldigheidsduur
 * @param {number} now         huidige tijd (injecteerbaar voor tests)
 */
function createReviewToken(sessionCode, studentId, secret, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  const payload = { c: String(sessionCode), s: String(studentId), e: now + ttlMs };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verifieer een nakijk-token.
 * Geeft { ok: true, sessionCode, studentId } of { ok: false, reason }.
 * reason: 'malformed' | 'bad_signature' | 'expired'
 */
function verifyReviewToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [payloadB64, sig] = token.split('.', 2);
  if (!payloadB64 || !sig) return { ok: false, reason: 'malformed' };

  const expected = sign(payloadB64, secret);
  // Constante-tijd vergelijking; lengteverschil vangen we eerst af.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload.c !== 'string' || typeof payload.s !== 'string'
      || typeof payload.e !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (now > payload.e) return { ok: false, reason: 'expired' };

  return { ok: true, sessionCode: payload.c, studentId: payload.s };
}

module.exports = { createReviewToken, verifyReviewToken, DEFAULT_TTL_MS };
