#!/usr/bin/env node
/**
 * PyCodeFlow — noodingang: alle inlogblokkades (netwerken en accounts) opheffen, zonder herstart.
 * Draait IN de web-container en spreekt het interne eindpunt aan op 127.0.0.1.
 *   docker exec pycodeflow-web-1 node /app/scripts/ontgrendel-netwerk.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const { internToken } = require('../lib/intern-token');

const token = internToken();
if (!token) { console.error('FOUT: geen POSTGRES_PASSWORD/DATABASE_URL in de omgeving — kan niet ontgrendelen.'); process.exit(1); }
const poort = Number(process.env.PORT || 3000);
const req = http.request({ host: '127.0.0.1', port: poort, path: '/api/intern/netwerk-ontgrendelen', method: 'POST',
  headers: { 'x-intern-token': token, 'content-length': 0 } }, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    if (res.statusCode === 200) { try { console.log('Ontgrendeld:', JSON.parse(data).verwijderd, 'blokkade(s)/teller(s) gewist.'); } catch { console.log('Ontgrendeld.'); } }
    else { console.error('FOUT', res.statusCode, data); process.exit(1); }
  });
});
req.on('error', (e) => { console.error('FOUT: server niet bereikbaar op poort ' + poort + ' — ' + e.message); process.exit(1); });
req.end();
