'use strict';
// v124: gedeeld geheim tussen de server en de CLI-scripts in dezelfde container
// (scripts/ontgrendel-netwerk.js). Afgeleid van de databasegegevens die enkel binnen de
// container bekend zijn; zonder die gegevens bestaat er geen token en blijft het interne
// eindpunt dicht.
const crypto = require('crypto');
function internToken(env = process.env) {
  const bron = env.POSTGRES_PASSWORD || env.DATABASE_URL || '';
  if (!bron) return '';
  return crypto.createHash('sha256').update('pycodeflow-intern|' + bron).digest('hex');
}
function isLoopback(adres) {
  const a = String(adres || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
module.exports = { internToken, isLoopback };
