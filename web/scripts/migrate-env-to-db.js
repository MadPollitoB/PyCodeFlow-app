#!/usr/bin/env node
/**
 * PyCodeFlow — Eenmalig migratiescript
 * Verplaatst de leerkrachtenlogin uit .env naar de SQLite database.
 *
 * Gebruik:
 *   node web/scripts/migrate-env-to-db.js
 *
 * Het script leest POC_BASIC_USER en POC_BASIC_PASS_HASH uit de omgeving
 * (of uit .env als dotenv beschikbaar is) en slaat ze op in de database.
 * Na succesvolle migratie toont het welke .env variabelen je kan verwijderen.
 */
'use strict';

const path = require('path');

// Probeer .env te laden als dotenv beschikbaar is
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch {}

if (!process.env.DB_DIR) {
  process.env.DB_DIR = path.join(__dirname, '..', 'data');
}

const db = require('../db/database');

const username = process.env.POC_BASIC_USER || '';
const passHash = process.env.POC_BASIC_PASS_HASH || '';

if (!username || !passHash) {
  console.error('❌ POC_BASIC_USER of POC_BASIC_PASS_HASH niet gevonden in omgeving/.env');
  console.error('   Stel deze variabelen in en probeer opnieuw.');
  process.exit(1);
}

const existing = db.getTeacherByUsername(username);
if (existing) {
  console.log(`ℹ️  Gebruiker "${username}" bestaat al in de database — geen actie nodig.`);
  db.close();
  process.exit(0);
}

db.createTeacher(username, passHash, username);
console.log(`✅ Leerkracht gemigreerd naar database: ${username}`);
console.log(`
Na succesvolle migratie kan je de volgende regels verwijderen uit .env:
  POC_BASIC_USER=...
  POC_BASIC_PASS_HASH=...
  POC_BASIC_PASS=...        (indien aanwezig)

Bewaar WEL:
  POC_BASIC_AUTH_ENABLED=true
  POC_BASIC_COOKIE_SECRET=...
`);

db.close();
