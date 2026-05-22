#!/usr/bin/env node
/**
 * PyCodeFlow — Leerkrachtenaccount beheer (CLI)
 *
 * Gebruik:
 *   node web/scripts/manage-teacher.js add <gebruikersnaam> <wachtwoord> [weergavenaam]
 *   node web/scripts/manage-teacher.js delete <gebruikersnaam>
 *   node web/scripts/manage-teacher.js list
 *   node web/scripts/manage-teacher.js reset-password <gebruikersnaam> <nieuwWachtwoord>
 *
 * Voer uit vanuit de map waar docker-compose.yml staat, of stel DB_DIR in:
 *   DB_DIR=/volume3/docker/pycodeflow/web/data node web/scripts/manage-teacher.js list
 */
'use strict';

const crypto = require('crypto');
const path   = require('path');

// Zet DB_DIR zodat database.js de juiste locatie vindt
if (!process.env.DB_DIR) {
  process.env.DB_DIR = path.join(__dirname, '..', 'data');
}

const db = require('../db/database');

function hashPassword(password) {
  const salt   = crypto.randomBytes(16);
  const params = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const key    = crypto.scryptSync(password, salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'add': {
    const [username, password, displayName = ''] = args;
    if (!username || !password) {
      console.error('Gebruik: manage-teacher.js add <gebruikersnaam> <wachtwoord> [weergavenaam]');
      process.exit(1);
    }
    const existing = db.getTeacherByUsername(username);
    if (existing) {
      console.error(`Fout: gebruiker "${username}" bestaat al.`);
      process.exit(1);
    }
    const hash = hashPassword(password);
    const id   = db.createTeacher(username, hash, displayName || username);
    console.log(`✅ Leerkracht aangemaakt: ${username} (id: ${id})`);
    break;
  }

  case 'delete': {
    const [username] = args;
    if (!username) {
      console.error('Gebruik: manage-teacher.js delete <gebruikersnaam>');
      process.exit(1);
    }
    const ok = db.deleteTeacher(username);
    if (ok) console.log(`✅ Leerkracht verwijderd: ${username}`);
    else    console.error(`Fout: gebruiker "${username}" niet gevonden.`);
    break;
  }

  case 'list': {
    const teachers = db.listTeachers();
    if (!teachers.length) {
      console.log('Geen leerkrachten gevonden in de database.');
      break;
    }
    console.log(`\n${'Gebruikersnaam'.padEnd(20)} ${'Weergavenaam'.padEnd(20)} ${'Aangemaakt'.padEnd(22)} Laatste login`);
    console.log('─'.repeat(80));
    for (const t of teachers) {
      const created   = new Date(t.created_at).toLocaleString('nl-BE');
      const lastLogin = t.last_login ? new Date(t.last_login).toLocaleString('nl-BE') : 'nooit';
      console.log(`${t.username.padEnd(20)} ${t.display_name.padEnd(20)} ${created.padEnd(22)} ${lastLogin}`);
    }
    console.log();
    break;
  }

  case 'reset-password': {
    const [username, newPassword] = args;
    if (!username || !newPassword) {
      console.error('Gebruik: manage-teacher.js reset-password <gebruikersnaam> <nieuwWachtwoord>');
      process.exit(1);
    }
    const teacher = db.getTeacherByUsername(username);
    if (!teacher) {
      console.error(`Fout: gebruiker "${username}" niet gevonden.`);
      process.exit(1);
    }
    const hash = hashPassword(newPassword);
    db.updatePassHash(username, hash);
    console.log(`✅ Wachtwoord bijgewerkt voor: ${username}`);
    break;
  }

  default:
    console.log(`
PyCodeFlow — Leerkrachtenaccount beheer

Commando's:
  add <gebruikersnaam> <wachtwoord> [weergavenaam]   Maak een nieuw account aan
  delete <gebruikersnaam>                             Verwijder een account
  list                                                Toon alle accounts
  reset-password <gebruikersnaam> <wachtwoord>        Stel wachtwoord opnieuw in
    `);
}

db.close();
