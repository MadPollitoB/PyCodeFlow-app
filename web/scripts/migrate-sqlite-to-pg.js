#!/usr/bin/env node
/**
 * PyCodeFlow — Migratescript SQLite → PostgreSQL
 * Sprint 12a
 *
 * Gebruik:
 *   DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-pg.js
 *
 * SQLite blijft ongewijzigd als fallback.
 * Voer dit script EEN keer uit na het opzetten van PostgreSQL.
 */
'use strict';

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

const SQLITE_PATH = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'pycodeflow.db');

if (!fs.existsSync(SQLITE_PATH)) {
  console.error('SQLite database niet gevonden:', SQLITE_PATH);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL niet ingesteld in .env');
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function q(text, params = []) {
  const c = await pool.connect();
  try { return await c.query(text, params); }
  finally { c.release(); }
}

async function migrate() {
  console.log('=== PyCodeFlow: SQLite → PostgreSQL migratie ===\n');

  // 1. Leerkrachten
  const teachers = sqlite.prepare('SELECT * FROM teachers').all();
  console.log(`Leerkrachten: ${teachers.length}`);
  let added = 0;
  for (const t of teachers) {
    await q(`
      INSERT INTO teachers (id, username, pass_hash, display_name, role, created_at, last_login)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO NOTHING
    `, [t.id, t.username, t.pass_hash, t.display_name || '', t.role || 'teacher',
        Number(t.created_at), t.last_login ? Number(t.last_login) : null]);
    added++;
  }
  console.log(`  ✅ ${added} leerkrachten gemigreerd`);

  // 2. Sessies
  const sessions = sqlite.prepare('SELECT * FROM sessions').all();
  console.log(`\nSessies: ${sessions.length}`);
  added = 0;
  for (const s of sessions) {
    await q(`
      INSERT INTO sessions (code,id,name,mode,editor_assist,created_at,closed,blocked,deleted,shared_code,announcement,workspace_mode,students_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (code) DO NOTHING
    `, [s.code, s.id, s.name, s.mode, s.editor_assist, Number(s.created_at),
        s.closed, s.blocked, s.deleted, s.shared_code || '', s.announcement || '',
        s.workspace_mode || 'shared', s.students_json || '{}']);
    added++;
  }
  console.log(`  ✅ ${added} sessies gemigreerd`);

  // 3. Annotaties
  let annotations = [];
  try { annotations = sqlite.prepare('SELECT * FROM session_annotations').all(); } catch {}
  console.log(`\nAnnotaties: ${annotations.length}`);
  for (const a of annotations) {
    await q(`
      INSERT INTO session_annotations (session_code, annotations_json, updated_at)
      VALUES ($1,$2,$3) ON CONFLICT (session_code) DO NOTHING
    `, [a.session_code, a.annotations_json, Number(a.updated_at)]);
  }
  console.log(`  ✅ ${annotations.length} annotaties gemigreerd`);

  // 4. Snapshots
  let snapshots = [];
  try { snapshots = sqlite.prepare('SELECT * FROM code_snapshots').all(); } catch {}
  console.log(`\nSnapshots: ${snapshots.length}`);
  let batch = 0;
  for (const s of snapshots) {
    await q(`
      INSERT INTO code_snapshots (id, session_code, student_id, student_name, timestamp, code)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING
    `, [s.id || crypto.randomUUID(), s.session_code, s.student_id,
        s.student_name || '', Number(s.timestamp), s.code || '']);
    batch++;
    if (batch % 100 === 0) process.stdout.write('.');
  }
  console.log(`\n  ✅ ${snapshots.length} snapshots gemigreerd`);

  // 5. Verificatie
  console.log('\n=== Verificatie ===');
  const pgTeachers  = (await q('SELECT COUNT(*) FROM teachers')).rows[0].count;
  const pgSessions  = (await q('SELECT COUNT(*) FROM sessions')).rows[0].count;
  const pgSnapshots = (await q('SELECT COUNT(*) FROM code_snapshots')).rows[0].count;
  console.log(`  PostgreSQL: ${pgTeachers} leerkrachten, ${pgSessions} sessies, ${pgSnapshots} snapshots`);
  console.log(`  SQLite:     ${teachers.length} leerkrachten, ${sessions.length} sessies, ${snapshots.length} snapshots`);

  const ok = Number(pgTeachers) >= teachers.length && Number(pgSessions) >= sessions.length;
  if (ok) {
    console.log('\n✅ Migratie geslaagd! SQLite blijft ongewijzigd als backup.\n');
  } else {
    console.error('\n❌ Aantallen komen niet overeen — controleer de PostgreSQL logs.\n');
    process.exit(1);
  }

  await pool.end();
  sqlite.close();
}

migrate().catch(e => {
  console.error('FATALE FOUT:', e.message);
  process.exit(1);
});
