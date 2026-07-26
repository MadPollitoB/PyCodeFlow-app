#!/usr/bin/env node
/**
 * PyCodeFlow — Leerkrachtenaccount beheer (CLI)
 * Sprint 12+: volledig herschreven voor PostgreSQL
 *
 * Gebruik (vanuit de web/ map in de container):
 *   node scripts/manage-teacher.js list
 *   node scripts/manage-teacher.js add <gebruikersnaam> <wachtwoord> [rol: teacher|admin]
 *   node scripts/manage-teacher.js delete <gebruikersnaam>
 *   node scripts/manage-teacher.js reset-password <gebruikersnaam> <nieuwWachtwoord>
 *   node scripts/manage-teacher.js set-role <gebruikersnaam> <rol: teacher|admin>
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const { Pool } = require('pg');

// Verbinding — zelfde logica als database.js
const connectionString = process.env.DATABASE_URL ||
  (() => {
    const pw = process.env.POSTGRES_PASSWORD;
    if (!pw) {
      console.error('FOUT: POSTGRES_PASSWORD of DATABASE_URL moet ingesteld zijn in .env');
      process.exit(1);
    }
    return `postgresql://pycodeflow:${encodeURIComponent(pw)}@postgres:5432/pycodeflow`;
  })();

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

function hashPassword(password) {
  // Zelfde formaat als server.js: scrypt$N$r$p$saltBase64$hashBase64
  const salt = crypto.randomBytes(16);
  const params = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derivedKey = crypto.scryptSync(String(password), salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

async function run() {
  const [,, cmd, arg1, arg2, arg3] = process.argv;

  if (!cmd) {
    console.log('Gebruik: node scripts/manage-teacher.js <list|add|delete|reset-password|set-role> [args]');
    process.exit(0);
  }

  try {
    switch (cmd) {

      case 'list': {
        const r = await pool.query(
          'SELECT username, display_name, role, created_at FROM teachers ORDER BY created_at'
        );
        if (r.rows.length === 0) {
          console.log('Geen leerkrachten gevonden.');
        } else {
          console.log('\nLeerkrachten:');
          r.rows.forEach(t => {
            const datum = new Date(Number(t.created_at)).toLocaleDateString('nl-BE');
            console.log(`  ${t.username.padEnd(20)} ${t.role.padEnd(8)} ${datum}`);
          });
        }
        break;
      }

      case 'add': {
        const username = arg1;
        const password = arg2;
        const role     = ['admin', 'teacher', 'superadmin'].includes(arg3) ? arg3 : 'teacher';
        if (!username || !password) {
          console.error('Gebruik: node scripts/manage-teacher.js add <gebruikersnaam> <wachtwoord> [teacher|admin]');
          process.exit(1);
        }
        if (password.length < 8) {
          console.error('FOUT: wachtwoord moet minimaal 8 tekens zijn.');
          process.exit(1);
        }
        // Check of gebruiker al bestaat
        const exists = await pool.query(
          'SELECT 1 FROM teachers WHERE LOWER(username) = LOWER($1)', [username]
        );
        if (exists.rows.length > 0) {
          console.error(`Fout: gebruiker "${username}" bestaat al.`);
          process.exit(1);
        }
        await pool.query(
          'INSERT INTO teachers (id, username, pass_hash, display_name, role, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [crypto.randomUUID(), username, hashPassword(password), username, role, Date.now()]
        );
        console.log(`✅ Leerkracht aangemaakt: ${username} (${role})`);
        break;
      }

      case 'delete': {
        const username = arg1;
        if (!username) {
          console.error('Gebruik: node scripts/manage-teacher.js delete <gebruikersnaam>');
          process.exit(1);
        }
        const r = await pool.query(
          'DELETE FROM teachers WHERE LOWER(username) = LOWER($1)', [username]
        );
        if (r.rowCount > 0) {
          console.log(`✅ Leerkracht verwijderd: ${username}`);
        } else {
          console.error(`Fout: gebruiker "${username}" niet gevonden.`);
        }
        break;
      }

      case 'reset-password': {
        const username = arg1;
        const password = arg2;
        if (!username || !password) {
          console.error('Gebruik: node scripts/manage-teacher.js reset-password <gebruikersnaam> <nieuwWachtwoord>');
          process.exit(1);
        }
        if (password.length < 8) {
          console.error('FOUT: wachtwoord moet minimaal 8 tekens zijn.');
          process.exit(1);
        }
        const r = await pool.query(
          'UPDATE teachers SET pass_hash = $1 WHERE LOWER(username) = LOWER($2)',
          [hashPassword(password), username]
        );
        if (r.rowCount > 0) {
          console.log(`✅ Wachtwoord bijgewerkt voor: ${username}`);
        } else {
          console.error(`Fout: gebruiker "${username}" niet gevonden.`);
        }
        break;
      }

      case 'set-role': {
        const username = arg1;
        const role     = arg2;
        if (!username || !['teacher', 'admin', 'superadmin'].includes(role)) {
          console.error('Gebruik: node scripts/manage-teacher.js set-role <gebruikersnaam> <teacher|admin>');
          process.exit(1);
        }
        const r = await pool.query(
          'UPDATE teachers SET role = $1 WHERE LOWER(username) = LOWER($2)',
          [role, username]
        );
        if (r.rowCount > 0) {
          console.log(`✅ Rol bijgewerkt: ${username} → ${role}`);
        } else {
          console.error(`Fout: gebruiker "${username}" niet gevonden.`);
        }
        break;
      }

      default:
        console.error(`Onbekend commando: ${cmd}`);
        console.log('Beschikbare commando\'s: list, add, delete, reset-password, set-role');
        process.exit(1);
    }
  } catch (e) {
    console.error('Database fout:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
