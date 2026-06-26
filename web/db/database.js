/**
 * PyCodeFlow — PostgreSQL database module
 * Sprint 12a: migratie van SQLite naar PostgreSQL (pg)
 * Sprint 17: DATABASE_URL automatisch opgebouwd uit POSTGRES_PASSWORD
 *
 * In .env is enkel dit nodig:
 *   POSTGRES_PASSWORD=jouwwachtwoord
 *
 * DATABASE_URL wordt automatisch opgebouwd als die niet ingesteld is.
 * Handig: wachtwoord hoeft maar op één plek ingesteld te worden.
 */
'use strict';

const { Pool } = require('pg');
const crypto   = require('crypto');

// ── Connection string ──────────────────────────────────────────────────────────
// Bouw DATABASE_URL automatisch op uit POSTGRES_PASSWORD als die niet ingesteld is.
// Dit voorkomt dat het wachtwoord op twee plaatsen in .env moet staan.
const connectionString = process.env.DATABASE_URL ||
  (() => {
    const pw = process.env.POSTGRES_PASSWORD;
    if (!pw) {
      console.error('[db] FATALE FOUT: POSTGRES_PASSWORD of DATABASE_URL moet ingesteld zijn in .env');
      process.exit(1);
    }
    const url = `postgresql://pycodeflow:${encodeURIComponent(pw)}@postgres:5432/pycodeflow`;
    console.log('[db] DATABASE_URL automatisch opgebouwd uit POSTGRES_PASSWORD');
    return url;
  })();

// ── Connection pool ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[db] Onverwachte pool fout:', err.message);
});

// Helper: query uitvoeren
async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ── Schema initialisatie ───────────────────────────────────────────────────────
async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      pass_hash    TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role         TEXT NOT NULL DEFAULT 'teacher',
      created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
      last_login   BIGINT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_username
      ON teachers (LOWER(username));

    CREATE TABLE IF NOT EXISTS sessions (
      code            TEXT PRIMARY KEY,
      id              TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'class',
      editor_assist   INTEGER NOT NULL DEFAULT 1,
      created_at      BIGINT NOT NULL,
      closed          INTEGER NOT NULL DEFAULT 0,
      blocked         INTEGER NOT NULL DEFAULT 0,
      deleted         INTEGER NOT NULL DEFAULT 0,
      shared_code     TEXT NOT NULL DEFAULT '',
      announcement    TEXT NOT NULL DEFAULT '',
      workspace_mode  TEXT NOT NULL DEFAULT 'shared',
      students_json   TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS session_annotations (
      session_code     TEXT PRIMARY KEY,
      annotations_json TEXT NOT NULL DEFAULT '[]',
      updated_at       BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS code_snapshots (
      id           TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      student_name TEXT NOT NULL DEFAULT '',
      timestamp    BIGINT NOT NULL,
      code         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_session_student
      ON code_snapshots (session_code, student_id, timestamp);

    -- Sprint 12b: klassen
    CREATE TABLE IF NOT EXISTS classes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      school_year TEXT NOT NULL DEFAULT '2025-2026',
      archived    BOOLEAN NOT NULL DEFAULT false,
      created_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
    );

    -- Sprint 12b: koppeling leerkracht ↔ klas
    CREATE TABLE IF NOT EXISTS teacher_classes (
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      class_id   TEXT NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
      PRIMARY KEY (teacher_id, class_id)
    );

    -- Sprint 12c: leerlingen
    CREATE TABLE IF NOT EXISTS students (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      class_id     TEXT REFERENCES classes(id) ON DELETE SET NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      source       TEXT NOT NULL DEFAULT 'manual',
      google_email TEXT UNIQUE,
      google_sub   TEXT UNIQUE,
      created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
      last_seen    BIGINT,
      notes        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
    CREATE INDEX IF NOT EXISTS idx_students_name  ON students(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_name_class
      ON students(name, class_id) WHERE class_id IS NOT NULL;

    -- Sprint 19g: sessie-config persistent
    DO $$ BEGIN
      ALTER TABLE sessions ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;

    -- Sprint 20a: audit-log leerkrachtenacties
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      actor       TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      target      TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      ip          TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

    -- Sprint 21: stresstest historiek
    CREATE TABLE IF NOT EXISTS stress_results (
      id              TEXT PRIMARY KEY,
      test_type       TEXT NOT NULL,
      ran_at          BIGINT NOT NULL,
      duration_sec    INTEGER NOT NULL DEFAULT 0,
      params_json     TEXT NOT NULL DEFAULT '{}',
      runs_total      INTEGER NOT NULL DEFAULT 0,
      runs_ok         INTEGER NOT NULL DEFAULT 0,
      runs_failed     INTEGER NOT NULL DEFAULT 0,
      avg_run_ms      INTEGER,
      max_run_ms      INTEGER,
      ram_web_mb      INTEGER,
      ram_runner_mb   INTEGER,
      cpu_runner_pct  INTEGER,
      pg_queries      INTEGER,
      pg_avg_ms       INTEGER,
      pg_pool_used    INTEGER,
      stress_pct      INTEGER NOT NULL DEFAULT 0,
      stress_label    TEXT NOT NULL DEFAULT 'OK',
      log_filename    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stress_ran ON stress_results(ran_at DESC);

    -- ══ Sprint 16: Toetsmodule ════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS quiz_bank (
      id              TEXT PRIMARY KEY,
      text            TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      difficulty      TEXT NOT NULL DEFAULT 'gemiddeld',
      max_points      INTEGER NOT NULL DEFAULT 4,
      question_type   TEXT NOT NULL DEFAULT 'code',
      -- 'code' = Python editor, 'open' = vrije tekst,
      -- 'multiple' = meerdere juiste, 'single' = één juiste
      choices_json    TEXT NOT NULL DEFAULT '[]',
      -- JSON: [{"id":"uuid","text":"...","correct":true/false}]
      created_by   TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL,
      archived     BOOLEAN NOT NULL DEFAULT false
    );
    -- Migratie: kolommen toevoegen als ze nog niet bestaan
    DO $$ BEGIN
      BEGIN ALTER TABLE quiz_bank ADD COLUMN question_type TEXT NOT NULL DEFAULT 'code'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_bank ADD COLUMN choices_json TEXT NOT NULL DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_quiz_bank_subject ON quiz_bank(subject);
    CREATE INDEX IF NOT EXISTS idx_quiz_bank_archived ON quiz_bank(archived);

    CREATE TABLE IF NOT EXISTS quiz_question_snapshots (
      id               TEXT PRIMARY KEY,
      session_code     TEXT NOT NULL REFERENCES sessions(code) ON DELETE CASCADE,
      bank_question_id TEXT REFERENCES quiz_bank(id) ON DELETE SET NULL,
      order_index      INTEGER NOT NULL,
      text_snapshot    TEXT NOT NULL,
      subject          TEXT NOT NULL DEFAULT '',
      points           INTEGER NOT NULL DEFAULT 4,
      question_type    TEXT NOT NULL DEFAULT 'code',
      choices_json     TEXT NOT NULL DEFAULT '[]'
    );
    DO $$ BEGIN
      BEGIN ALTER TABLE quiz_question_snapshots ADD COLUMN question_type TEXT NOT NULL DEFAULT 'code'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_question_snapshots ADD COLUMN choices_json TEXT NOT NULL DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_quiz_snapshots_session
      ON quiz_question_snapshots(session_code);

    CREATE TABLE IF NOT EXISTS quiz_meta (
      session_code           TEXT PRIMARY KEY
                             REFERENCES sessions(code) ON DELETE CASCADE,
      randomize              BOOLEAN NOT NULL DEFAULT true,
      timer_seconds          INTEGER,
      no_timer               BOOLEAN NOT NULL DEFAULT false,
      individual_timer       BOOLEAN NOT NULL DEFAULT true,
      min_runs_per_q         INTEGER NOT NULL DEFAULT 0,
      hide_question_on_screen BOOLEAN NOT NULL DEFAULT false,
      results_released       BOOLEAN NOT NULL DEFAULT false,
      warning_shown          BOOLEAN NOT NULL DEFAULT false,
      is_teacher_preview     BOOLEAN NOT NULL DEFAULT false,
      school_year            TEXT NOT NULL DEFAULT '2025-2026',
      target_class           TEXT NOT NULL DEFAULT '',
      archived               BOOLEAN NOT NULL DEFAULT false,
      archived_at            BIGINT,
      access_from            BIGINT,   -- Sprint 19j: tijdsvenster start (NULL = direct)
      access_until           BIGINT,   -- Sprint 19j: tijdsvenster einde (NULL = geen limiet)
      auto_submit_late       BOOLEAN NOT NULL DEFAULT true,  -- Sprint 19j: auto-submit bij deadline
      created_at             BIGINT NOT NULL
    );
    -- Migratie: voeg kolommen toe als ze nog niet bestaan (bij update)
    DO $$ BEGIN
      BEGIN ALTER TABLE quiz_meta ADD COLUMN no_timer BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN timer_seconds INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN school_year TEXT NOT NULL DEFAULT '2025-2026'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN target_class TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN archived_at BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN access_from BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN access_until BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_meta ADD COLUMN auto_submit_late BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id               TEXT PRIMARY KEY,
      session_code     TEXT NOT NULL,
      student_id       TEXT NOT NULL,
      student_name     TEXT NOT NULL DEFAULT '',
      student_class    TEXT NOT NULL DEFAULT '',
      question_id      TEXT NOT NULL REFERENCES quiz_question_snapshots(id)
                       ON DELETE CASCADE,
      personal_order   INTEGER NOT NULL DEFAULT 0,
      code             TEXT NOT NULL DEFAULT '',
      run_count        INTEGER NOT NULL DEFAULT 0,
      first_visit_at   BIGINT,
      first_run_at     BIGINT,
      saved_at         BIGINT NOT NULL,
      submitted_at     BIGINT,
      auto_submitted   BOOLEAN NOT NULL DEFAULT false,
      score            INTEGER,
      teacher_comment  TEXT NOT NULL DEFAULT '',
      selected_choices TEXT NOT NULL DEFAULT '[]',
      -- JSON array van gekozen choice IDs (bij multiple/single)
      auto_scored      BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(session_code, student_id, question_id)
    );
    DO $$ BEGIN
      BEGIN ALTER TABLE quiz_answers ADD COLUMN selected_choices TEXT NOT NULL DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_answers ADD COLUMN auto_scored BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_session
      ON quiz_answers(session_code);
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_student
      ON quiz_answers(session_code, student_id);

    CREATE TABLE IF NOT EXISTS quiz_general_comments (
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      comment      TEXT NOT NULL DEFAULT '',
      updated_at   BIGINT NOT NULL,
      PRIMARY KEY(session_code, student_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_student_order (
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      question_id  TEXT NOT NULL,
      personal_pos INTEGER NOT NULL,
      PRIMARY KEY(session_code, student_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_run_history (
      id           TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      question_id  TEXT NOT NULL,
      code         TEXT NOT NULL DEFAULT '',
      ran_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_run_history
      ON quiz_run_history(session_code, student_id, question_id);

    CREATE TABLE IF NOT EXISTS quiz_comment_templates (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      created_by TEXT REFERENCES teachers(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );
  `);
  console.log('[db] Schema geïnitialiseerd (PostgreSQL)');
}

// ── Public API (async) ─────────────────────────────────────────────────────────
module.exports = {

  // Initialiseer schema — aanroepen bij serverstart
  async init() {
    await initSchema();
  },

  // ── Teachers ─────────────────────────────────────────────────────────────────
  async getTeacherByUsername(username) {
    const r = await query(
      `SELECT * FROM teachers WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [username]
    );
    return r.rows[0] || null;
  },

  async createTeacher(username, passHash, displayName = '', role = 'teacher') {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO teachers (id, username, pass_hash, display_name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, username, passHash, displayName, role, Date.now()]
    );
    return id;
  },

  async updateLastLogin(id) {
    await query(`UPDATE teachers SET last_login = $1 WHERE id = $2`, [Date.now(), id]);
  },

  async listTeachers() {
    const r = await query(
      `SELECT id, username, display_name, role, created_at, last_login FROM teachers ORDER BY created_at`
    );
    return r.rows;
  },

  async deleteTeacher(username) {
    const r = await query(
      `DELETE FROM teachers WHERE LOWER(username) = LOWER($1)`, [username]
    );
    return r.rowCount > 0;
  },

  async updatePassHash(username, passHash) {
    const r = await query(
      `UPDATE teachers SET pass_hash = $1 WHERE LOWER(username) = LOWER($2)`,
      [passHash, username]
    );
    return r.rowCount > 0;
  },

  async updateTeacherRole(username, role) {
    const r = await query(
      `UPDATE teachers SET role = $1 WHERE LOWER(username) = LOWER($2)`,
      [role, username]
    );
    return r.rowCount > 0;
  },

  // ── Sessions ──────────────────────────────────────────────────────────────────
  async persistSession(session) {
    const students = {};
    for (const [sid, s] of Object.entries(session.students || {})) {
      if (s.removed) continue;
      students[sid] = {
        id: s.id, name: s.name,
        code: s.code, personalCode: s.personalCode || '',
        personalOutput: '', output: '',
        socketId: null, runId: null,
        canRun: s.canRun, canEdit: s.canEdit,
        personalCanRun: s.personalCanRun, personalCanEdit: s.personalCanEdit,
        removed: false,
      };
    }
    await query(`
      INSERT INTO sessions
        (code, id, name, mode, editor_assist, created_at, closed, blocked, deleted,
         shared_code, announcement, workspace_mode, students_json, config_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (code) DO UPDATE SET
        name           = EXCLUDED.name,
        closed         = EXCLUDED.closed,
        blocked        = EXCLUDED.blocked,
        deleted        = EXCLUDED.deleted,
        shared_code    = EXCLUDED.shared_code,
        announcement   = EXCLUDED.announcement,
        workspace_mode = EXCLUDED.workspace_mode,
        students_json  = EXCLUDED.students_json,
        config_json    = EXCLUDED.config_json
    `, [
      session.code,
      session.id,
      session.name,
      session.mode,
      session.editorAssist ? 1 : 0,
      session.createdAt || Date.now(),
      session.closed  ? 1 : 0,
      session.blocked ? 1 : 0,
      session.deleted ? 1 : 0,
      session.sharedCode    || '',
      session.announcement  || '',
      session.classWorkspaceMode || 'shared',
      JSON.stringify(students),
      JSON.stringify(session.config || {}),
    ]);
  },

  async loadActiveSessions() {
    const r = await query(
      `SELECT * FROM sessions WHERE deleted = 0 AND closed = 0`
    );
    return r.rows.map(row => ({
      code:               row.code,
      id:                 row.id,
      name:               row.name,
      mode:               row.mode,
      editorAssist:       row.editor_assist === 1,
      createdAt:          Number(row.created_at),
      closed:             row.closed   === 1,
      blocked:            row.blocked  === 1,
      deleted:            row.deleted  === 1,
      sharedCode:         row.shared_code,
      announcement:       row.announcement,
      config:             (() => { try { return JSON.parse(row.config_json || '{}'); } catch { return {}; } })(),
      classWorkspaceMode: row.workspace_mode,
      students:           JSON.parse(row.students_json || '{}'),
      teacherSocketId: null, selectedStudentId: null,
      sharedOutput: '', teacherRunId: null, teacherPreviewOutput: '',
      statusText: 'Hersteld na herstart', statusType: 'info',
      sharedCodeRevision: 0, sharedCodeSourceSocketId: null,
      announcementVersion: 0,
    }));
  },

  async loadClosedSessions() {
    try {
      const r = await query(
        `SELECT * FROM sessions WHERE closed = 1 AND deleted = 0 ORDER BY created_at DESC LIMIT 100`
      );
      return r.rows.map(row => ({
        code:        row.code,
        id:          row.id,
        name:        row.name,
        mode:        row.mode,
        editorAssist: row.editor_assist === 1,
        createdAt:   Number(row.created_at),
        closed:      true,
        deleted:     row.deleted === 1,
        studentCount: 0,
      }));
    } catch { return []; }
  },

  async markSessionDeleted(code) {
    await query(`UPDATE sessions SET deleted = 1 WHERE code = $1`, [code]);
  },

  async markSessionClosed(code) {
    await query(`UPDATE sessions SET closed = 1 WHERE code = $1`, [code]);
  },

  // ── Annotaties ────────────────────────────────────────────────────────────────
  async saveAnnotations(sessionCode, annotations) {
    try {
      const json = JSON.stringify(annotations || []);
      await query(`
        INSERT INTO session_annotations (session_code, annotations_json, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_code) DO UPDATE SET
          annotations_json = EXCLUDED.annotations_json,
          updated_at       = EXCLUDED.updated_at
      `, [sessionCode, json, Date.now()]);
    } catch (e) { console.error('[db] saveAnnotations:', e.message); }
  },

  async getAnnotations(sessionCode) {
    try {
      const r = await query(
        `SELECT annotations_json FROM session_annotations WHERE session_code = $1`,
        [sessionCode]
      );
      return r.rows[0] ? JSON.parse(r.rows[0].annotations_json) : [];
    } catch { return []; }
  },

  // ── Snapshots ─────────────────────────────────────────────────────────────────
  async saveSnapshot(sessionCode, studentId, studentName, code) {
    try {
      await query(`
        INSERT INTO code_snapshots (id, session_code, student_id, student_name, timestamp, code)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [crypto.randomUUID(), sessionCode, studentId, studentName, Date.now(), code]);
    } catch (e) { /* stil falen — snapshot niet kritisch */ }
  },

  async getSnapshots(sessionCode, studentId) {
    const r = await query(`
      SELECT id, timestamp, code, student_name
      FROM code_snapshots
      WHERE session_code = $1 AND student_id = $2
      ORDER BY timestamp ASC
    `, [sessionCode, studentId]);
    return r.rows;
  },

  async deleteSnapshotsForSession(sessionCode) {
    await query(`DELETE FROM code_snapshots WHERE session_code = $1`, [sessionCode]);
  },

  // ── Klassen (Sprint 12b) ──────────────────────────────────────────────────────
  async listClasses(includeArchived = false) {
    const r = await query(
      `SELECT c.*, COUNT(s.id)::int AS student_count
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id
       WHERE ($1 OR c.archived = false)
       GROUP BY c.id
       ORDER BY c.school_year DESC, c.name`,
      [includeArchived]
    );
    return r.rows;
  },

  async createClass(name, schoolYear = '2025-2026') {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO classes (id, name, school_year, created_at) VALUES ($1, $2, $3, $4)`,
      [id, name, schoolYear, Date.now()]
    );
    return id;
  },

  async archiveClass(id) {
    await query(`UPDATE classes SET archived = true WHERE id = $1`, [id]);
  },

  async deleteClass(id) {
    const r = await query(`DELETE FROM classes WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },

  async linkTeacherClass(teacherId, classId) {
    await query(
      `INSERT INTO teacher_classes (teacher_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [teacherId, classId]
    );
  },

  async unlinkTeacherClass(teacherId, classId) {
    await query(
      `DELETE FROM teacher_classes WHERE teacher_id = $1 AND class_id = $2`,
      [teacherId, classId]
    );
  },

  async getClassesForTeacher(teacherId) {
    const r = await query(
      `SELECT c.* FROM classes c
       JOIN teacher_classes tc ON tc.class_id = c.id
       WHERE tc.teacher_id = $1 AND c.archived = false
       ORDER BY c.name`,
      [teacherId]
    );
    return r.rows;
  },

  // ── Leerlingen (Sprint 12c) ───────────────────────────────────────────────────
  async listStudents(classId = null, includeBlocked = true) {
    const r = await query(
      `SELECT s.*, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE ($1::text IS NULL OR s.class_id = $1)
         AND ($2 OR s.status != 'blocked')
       ORDER BY c.name NULLS LAST, s.name`,
      [classId, includeBlocked]
    );
    return r.rows;
  },

  async getStudentByName(name, classId) {
    const r = await query(
      `SELECT * FROM students WHERE LOWER(name) = LOWER($1) AND class_id = $2 LIMIT 1`,
      [name, classId]
    );
    return r.rows[0] || null;
  },

  async createStudent(name, classId, source = 'manual', status = 'active') {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO students (id, name, class_id, status, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT idx_students_name_class DO NOTHING`,
      [id, name, classId, status, source, Date.now()]
    );
    return id;
  },

  async updateStudentStatus(id, status) {
    await query(`UPDATE students SET status = $1 WHERE id = $2`, [status, id]);
  },

  async updateStudentClass(id, classId) {
    await query(`UPDATE students SET class_id = $1 WHERE id = $2`, [classId, id]);
  },

  async updateStudentLastSeen(id) {
    await query(`UPDATE students SET last_seen = $1 WHERE id = $2`, [Date.now(), id]);
  },

  async updateStudentNotes(id, notes) {
    await query(`UPDATE students SET notes = $1 WHERE id = $2`, [notes.slice(0, 500), id]);
  },

  async deleteStudent(id) {
    const r = await query(`DELETE FROM students WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },

  async getStudentByGoogleEmail(email) {
    const r = await query(
      `SELECT * FROM students WHERE google_email = $1 LIMIT 1`, [email]
    );
    return r.rows[0] || null;
  },

  async linkStudentGoogle(id, email, sub) {
    await query(
      `UPDATE students SET google_email = $1, google_sub = $2 WHERE id = $3`,
      [email, sub, id]
    );
  },

  async importStudentsFromCSV(rows) {
    // rows: [{ name, className }]
    let added = 0, skipped = 0, classesCreated = 0, errors = [];
    for (const row of rows) {
      try {
        const name = String(row.name || '').trim().slice(0, 64);
        const className = String(row.className || '').trim().slice(0, 64);
        if (!name) { errors.push(`Lege naam overgeslagen`); continue; }

        // Zoek of maak klas aan
        let classRow = null;
        if (className) {
          const cr = await query(
            `SELECT * FROM classes WHERE LOWER(name) = LOWER($1) LIMIT 1`, [className]
          );
          if (cr.rows[0]) {
            classRow = cr.rows[0];
          } else {
            const newId = crypto.randomUUID();
            await query(
              `INSERT INTO classes (id, name, created_at) VALUES ($1, $2, $3)`,
              [newId, className, Date.now()]
            );
            classRow = { id: newId, name: className };
            classesCreated++;
          }
        }

        // Check duplicaat
        if (classRow) {
          const existing = await query(
            `SELECT id FROM students WHERE LOWER(name) = LOWER($1) AND class_id = $2 LIMIT 1`,
            [name, classRow.id]
          );
          if (existing.rows.length > 0) { skipped++; continue; }
        }

        const id = crypto.randomUUID();
        await query(
          `INSERT INTO students (id, name, class_id, status, source, created_at)
           VALUES ($1, $2, $3, 'active', 'csv', $4)`,
          [id, name, classRow?.id || null, Date.now()]
        );
        added++;
      } catch (e) {
        errors.push(`${row.name}: ${e.message}`);
      }
    }
    return { added, skipped, classesCreated, errors };
  },

  // ── Quiz Bank (Sprint 16a) ───────────────────────────────────────────────────

  async listQuizBank({ subject = null, difficulty = null, archived = false } = {}) {
    let where = 'WHERE q.archived = $1';
    const params = [archived];
    if (subject) { params.push(subject); where += ` AND q.subject = $${params.length}`; }
    if (difficulty) { params.push(difficulty); where += ` AND q.difficulty = $${params.length}`; }
    const r = await query(
      `SELECT q.*, t.display_name AS created_by_name
       FROM quiz_bank q
       LEFT JOIN teachers t ON t.id = q.created_by
       ${where}
       ORDER BY q.subject, q.created_at DESC`,
      params
    );
    return r.rows;
  },

  async getQuizBankSubjects() {
    const r = await query(
      `SELECT DISTINCT subject FROM quiz_bank WHERE archived = false AND subject != '' ORDER BY subject`
    );
    return r.rows.map(r => r.subject);
  },

  async createQuizQuestion({ text, subject = '', difficulty = 'gemiddeld', maxPoints = 4,
                               questionType = 'code', choicesJson = '[]', createdBy = null }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await query(
      `INSERT INTO quiz_bank (id, text, subject, difficulty, max_points,
         question_type, choices_json, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, text.trim(), subject.trim(), difficulty, maxPoints,
       questionType, choicesJson, createdBy, now, now]
    );
    return id;
  },

  async updateQuizQuestion(id, { text, subject, difficulty, maxPoints, questionType, choicesJson }) {
    const r = await query(
      `UPDATE quiz_bank SET text=$1, subject=$2, difficulty=$3, max_points=$4,
         question_type=$5, choices_json=$6, updated_at=$7
       WHERE id=$8`,
      [text.trim(), subject.trim(), difficulty, maxPoints,
       questionType || 'code', choicesJson || '[]', Date.now(), id]
    );
    return r.rowCount > 0;
  },

  async archiveQuizQuestion(id) {
    await query(`UPDATE quiz_bank SET archived = true, updated_at = $1 WHERE id = $2`, [Date.now(), id]);
  },

  async deleteQuizQuestion(id) {
    // Enkel verwijderen als nog niet gebruikt in een toets
    const used = await query(
      `SELECT 1 FROM quiz_question_snapshots WHERE bank_question_id = $1 LIMIT 1`, [id]
    );
    if (used.rows.length > 0) return { ok: false, reason: 'Vraag is al gebruikt in een toets.' };
    await query(`DELETE FROM quiz_bank WHERE id = $1`, [id]);
    return { ok: true };
  },

  async importQuizQuestionsCSV(rows, teacherId) {
    let added = 0, skipped = 0, errors = [];
    for (const row of rows) {
      try {
        const text = String(row.vraag || '').trim();
        if (!text) { errors.push('Lege vraag overgeslagen'); continue; }
        // Duplicaat check op exacte vraagtekst
        const exists = await query(`SELECT 1 FROM quiz_bank WHERE text = $1 LIMIT 1`, [text]);
        if (exists.rows.length > 0) { skipped++; continue; }
        await this.createQuizQuestion({
          text,
          subject: row.onderwerp || '',
          difficulty: row.moeilijkheid || 'gemiddeld',
          maxPoints: parseInt(row.max_punten) || 4,
          createdBy: teacherId,
        });
        added++;
      } catch (e) { errors.push(`Fout bij rij: ${e.message}`); }
    }
    return { added, skipped, errors };
  },

  // ── Quiz Sessie (Sprint 16b) ──────────────────────────────────────────────────

  async createQuizSession({ sessionCode, questions, randomize, timerSeconds,
                             noTimer, minRunsPerQ, hideQuestionOnScreen, isTeacherPreview,
                             schoolYear, targetClass, accessFrom, accessUntil, autoSubmitLate }) {
    const now = Date.now();
    // noTimer = true → geen tijdslimiet (taak)
    // timerSeconds = null + noTimer = false → gebruik standaard 2700s
    const effectiveTimer = noTimer ? null : (timerSeconds || 2700);
    const currentYear = (() => {
      const d = new Date();
      // Augustus = nieuw schooljaar
      const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
      return `${y}-${y + 1}`;
    })();
    await query(
      `INSERT INTO quiz_meta (session_code, randomize, timer_seconds, no_timer, individual_timer,
        min_runs_per_q, hide_question_on_screen, results_released, is_teacher_preview,
        school_year, target_class, access_from, access_until, auto_submit_late, created_at)
       VALUES ($1,$2,$3,$4,true,$5,$6,false,$7,$8,$9,$10,$11,$12,$13)`,
      [sessionCode, randomize, effectiveTimer, noTimer || false,
       minRunsPerQ, hideQuestionOnScreen, isTeacherPreview,
       schoolYear || currentYear, targetClass || '',
       accessFrom || null, accessUntil || null, autoSubmitLate !== false,
       now]
    );
    // Schrijf vraag-snapshots
    for (const q of questions) {
      await query(
        `INSERT INTO quiz_question_snapshots
           (id, session_code, bank_question_id, order_index, text_snapshot, subject, points,
            question_type, choices_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [crypto.randomUUID(), sessionCode, q.bankId, q.orderIndex, q.text, q.subject, q.points,
         q.questionType || 'code', q.choicesJson || '[]']
      );
    }
  },

  async getQuizMeta(sessionCode) {
    const r = await query(`SELECT * FROM quiz_meta WHERE session_code = $1`, [sessionCode]);
    return r.rows[0] || null;
  },

  async getQuizQuestions(sessionCode) {
    const r = await query(
      `SELECT * FROM quiz_question_snapshots WHERE session_code = $1 ORDER BY order_index`,
      [sessionCode]
    );
    return r.rows;
  },

  async releaseQuizResults(sessionCode) {
    await query(`UPDATE quiz_meta SET results_released = true WHERE session_code = $1`, [sessionCode]);
  },

  // ── Quiz Antwoorden (Sprint 16c) ──────────────────────────────────────────────

  async saveQuizAnswer({ sessionCode, studentId, studentName, studentClass,
                          questionId, personalOrder, code, runCount,
                          firstVisitAt, firstRunAt, selectedChoices = '[]' }) {
    const now = Date.now();
    await query(
      `INSERT INTO quiz_answers
         (id, session_code, student_id, student_name, student_class,
          question_id, personal_order, code, run_count,
          first_visit_at, first_run_at, saved_at, selected_choices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (session_code, student_id, question_id) DO UPDATE SET
         code             = EXCLUDED.code,
         run_count        = EXCLUDED.run_count,
         selected_choices = EXCLUDED.selected_choices,
         first_run_at     = COALESCE(quiz_answers.first_run_at, EXCLUDED.first_run_at),
         first_visit_at   = COALESCE(quiz_answers.first_visit_at, EXCLUDED.first_visit_at),
         saved_at         = EXCLUDED.saved_at`,
      [crypto.randomUUID(), sessionCode, studentId, studentName, studentClass,
       questionId, personalOrder, code, runCount, firstVisitAt, firstRunAt, now,
       selectedChoices]
    );
  },

  async submitQuizAnswers(sessionCode, studentId, autoSubmitted = false) {
    const now = Date.now();
    await query(
      `UPDATE quiz_answers
       SET submitted_at = $1, auto_submitted = $2
       WHERE session_code = $3 AND student_id = $4 AND submitted_at IS NULL`,
      [now, autoSubmitted, sessionCode, studentId]
    );
  },

  async saveQuizStudentOrder(sessionCode, studentId, orderedQuestionIds) {
    for (let i = 0; i < orderedQuestionIds.length; i++) {
      await query(
        `INSERT INTO quiz_student_order (session_code, student_id, question_id, personal_pos)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [sessionCode, studentId, orderedQuestionIds[i], i]
      );
    }
  },

  async getQuizStudentOrder(sessionCode, studentId) {
    const r = await query(
      `SELECT question_id, personal_pos FROM quiz_student_order
       WHERE session_code = $1 AND student_id = $2 ORDER BY personal_pos`,
      [sessionCode, studentId]
    );
    return r.rows;
  },

  async saveQuizRunHistory({ sessionCode, studentId, questionId, code }) {
    await query(
      `INSERT INTO quiz_run_history (id, session_code, student_id, question_id, code, ran_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), sessionCode, studentId, questionId, code, Date.now()]
    );
  },

  async getQuizRunHistory(sessionCode, studentId, questionId) {
    const r = await query(
      `SELECT id, code, ran_at FROM quiz_run_history
       WHERE session_code=$1 AND student_id=$2 AND question_id=$3
       ORDER BY ran_at`,
      [sessionCode, studentId, questionId]
    );
    return r.rows;
  },

  // ── Quiz Verbetering (Sprint 16d) ─────────────────────────────────────────────

  async getQuizAnswers(sessionCode) {
    const r = await query(
      `SELECT a.*, q.text_snapshot, q.subject, q.points, q.order_index
       FROM quiz_answers a
       JOIN quiz_question_snapshots q ON q.id = a.question_id
       WHERE a.session_code = $1
       ORDER BY a.student_name, q.order_index`,
      [sessionCode]
    );
    return r.rows;
  },

  async getQuizAnswersByStudent(sessionCode, studentId) {
    const r = await query(
      `SELECT a.*, q.text_snapshot, q.subject, q.points, q.order_index
       FROM quiz_answers a
       JOIN quiz_question_snapshots q ON q.id = a.question_id
       WHERE a.session_code = $1 AND a.student_id = $2
       ORDER BY q.order_index`,
      [sessionCode, studentId]
    );
    return r.rows;
  },

  async scoreQuizAnswer(answerId, score, teacherComment) {
    await query(
      `UPDATE quiz_answers SET score=$1, teacher_comment=$2 WHERE id=$3`,
      [score, teacherComment, answerId]
    );
  },

  async saveQuizGeneralComment(sessionCode, studentId, comment) {
    await query(
      `INSERT INTO quiz_general_comments (session_code, student_id, comment, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (session_code, student_id) DO UPDATE SET comment=EXCLUDED.comment, updated_at=EXCLUDED.updated_at`,
      [sessionCode, studentId, comment, Date.now()]
    );
  },

  async getQuizGeneralComment(sessionCode, studentId) {
    const r = await query(
      `SELECT comment FROM quiz_general_comments WHERE session_code=$1 AND student_id=$2`,
      [sessionCode, studentId]
    );
    return r.rows[0]?.comment || '';
  },

  async listQuizCommentTemplates(teacherId) {
    const r = await query(
      `SELECT * FROM quiz_comment_templates WHERE created_by=$1 ORDER BY created_at`,
      [teacherId]
    );
    return r.rows;
  },

  async createQuizCommentTemplate(text, teacherId) {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO quiz_comment_templates (id, text, created_by, created_at) VALUES ($1,$2,$3,$4)`,
      [id, text.trim(), teacherId, Date.now()]
    );
    return id;
  },

  async deleteQuizCommentTemplate(id) {
    await query(`DELETE FROM quiz_comment_templates WHERE id=$1`, [id]);
  },

  // ── Quiz Archief (Sprint 17b) ─────────────────────────────────────────────────

  async archiveQuiz(sessionCode) {
    await query(
      `UPDATE quiz_meta SET archived = true, archived_at = $1 WHERE session_code = $2`,
      [Date.now(), sessionCode]
    );
  },

  async unarchiveQuiz(sessionCode) {
    await query(
      `UPDATE quiz_meta SET archived = false, archived_at = NULL WHERE session_code = $1`,
      [sessionCode]
    );
  },

  async deleteQuizFully(sessionCode) {
    // Verwijder alle quiz-data maar behoudt de vragen in quiz_bank
    await query(`DELETE FROM quiz_run_history   WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_general_comments WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_student_order  WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_answers        WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_question_snapshots WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_meta           WHERE session_code = $1`, [sessionCode]);
    // Markeer de sessie als verwijderd
    await query(`UPDATE sessions SET deleted = 1 WHERE code = $1`, [sessionCode]);
  },

  async getQuizArchive({ year = null, classId = null, subject = null, archived = null } = {}) {
    // Haal alle toetsen op met filters
    let where = [];
    let params = [];
    let i = 1;

    if (year)     { where.push(`m.school_year = $${i++}`); params.push(year); }
    if (archived !== null) { where.push(`m.archived = $${i++}`); params.push(archived); }
    if (subject) {
      // Toetsen met minstens één vraag van dit onderwerp
      where.push(`s.code IN (
        SELECT DISTINCT q.session_code FROM quiz_question_snapshots q WHERE q.subject = $${i++}
      )`); params.push(subject);
    }
    if (classId) {
      where.push(`m.target_class = $${i++}`); params.push(classId);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await query(`
      SELECT s.code, s.name, s.created_at, s.deleted,
             m.school_year, m.target_class, m.timer_seconds, m.no_timer,
             m.randomize, m.results_released, m.archived, m.archived_at,
             COUNT(DISTINCT a.student_id)::int AS student_count,
             COUNT(DISTINCT qs.id)::int        AS question_count,
             ROUND(AVG(a.score), 1)            AS avg_score,
             SUM(qs.points)                    AS max_score_per_student
      FROM sessions s
      JOIN quiz_meta m ON m.session_code = s.code
      LEFT JOIN quiz_answers a ON a.session_code = s.code AND a.submitted_at IS NOT NULL
      LEFT JOIN quiz_question_snapshots qs ON qs.session_code = s.code
      ${whereClause}
      GROUP BY s.code, s.name, s.created_at, s.deleted,
               m.school_year, m.target_class, m.timer_seconds, m.no_timer,
               m.randomize, m.results_released, m.archived, m.archived_at
      ORDER BY s.created_at DESC
    `, params);
    return r.rows;
  },

  async getStudentHistory({ name, classId = null, year = null } = {}) {
    // Alle toetsen + scores voor één leerling
    let params = [name.toLowerCase()];
    let i = 2;
    let extra = '';
    if (year)    { extra += ` AND m.school_year = $${i++}`; params.push(year); }
    if (classId) { extra += ` AND m.target_class = $${i++}`; params.push(classId); }

    const r = await query(`
      SELECT s.name AS quiz_name, s.code AS session_code, s.created_at,
             m.school_year, m.target_class,
             a.student_name, a.student_class,
             SUM(a.score) AS total_score,
             SUM(qs.points) AS max_score,
             COUNT(a.id)::int AS answers_count,
             MAX(a.submitted_at) AS submitted_at
      FROM quiz_answers a
      JOIN sessions s ON s.code = a.session_code
      JOIN quiz_meta m ON m.session_code = s.code
      JOIN quiz_question_snapshots qs ON qs.session_code = s.code
      WHERE LOWER(a.student_name) = $1 ${extra}
        AND a.submitted_at IS NOT NULL
      GROUP BY s.name, s.code, s.created_at, m.school_year, m.target_class,
               a.student_name, a.student_class
      ORDER BY s.created_at DESC
    `, params);
    return r.rows;
  },

  async getQuizStatsDetailed(sessionCode) {
    const questions = await this.getQuizQuestions(sessionCode);
    const rows = await query(`
      SELECT a.question_id,
             COUNT(a.id)::int       AS answer_count,
             ROUND(AVG(a.score), 2) AS avg_score,
             ROUND(AVG(a.run_count), 1) AS avg_runs,
             MIN(a.score)           AS min_score,
             MAX(a.score)           AS max_score
      FROM quiz_answers a
      WHERE a.session_code = $1 AND a.submitted_at IS NOT NULL
      GROUP BY a.question_id
    `, [sessionCode]);

    const byQ = {};
    for (const r of rows.rows) byQ[r.question_id] = r;

    return questions.map(q => ({
      ...q,
      stats: byQ[q.id] || { answer_count: 0, avg_score: null, avg_runs: 0 },
    }));
  },

  async getAvailableYears() {
    const r = await query(
      `SELECT DISTINCT school_year FROM quiz_meta WHERE school_year != '' ORDER BY school_year DESC`
    );
    return r.rows.map(r => r.school_year);
  },

  // ── Audit log (Sprint 20a) ───────────────────────────────────────────────────

  async auditLog(actor, action, target, detail = {}, ip = '') {
    await query(
      `INSERT INTO audit_log (id, actor, action, target, detail_json, ip, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(), String(actor||'').slice(0,64), action,
       String(target||'').slice(0,128), JSON.stringify(detail),
       String(ip||'').slice(0,64), Date.now()]
    ).catch(() => {}); // nooit falen
  },

  async getAuditLog({ limit = 50, actor = null, action = null } = {}) {
    let where = [];
    const params = [];
    if (actor)  { params.push(actor);  where.push(`actor = $${params.length}`); }
    if (action) { params.push(action); where.push(`action = $${params.length}`); }
    params.push(limit);
    const r = await query(
      `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // ── Stresstest historiek (Sprint 21) ─────────────────────────────────────────

  async saveStressResult(result) {
    await query(
      `INSERT INTO stress_results
         (id, test_type, ran_at, duration_sec, params_json,
          runs_total, runs_ok, runs_failed, avg_run_ms, max_run_ms,
          ram_web_mb, ram_runner_mb, cpu_runner_pct, pg_queries, pg_avg_ms,
          pg_pool_used, stress_pct, stress_label, log_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [crypto.randomUUID(), result.testType, result.ranAt || Date.now(),
       result.durationSec || 0, JSON.stringify(result.params || {}),
       result.runsTotal || 0, result.runsOk || 0, result.runsFailed || 0,
       result.avgRunMs || null, result.maxRunMs || null,
       result.ramWebMb || null, result.ramRunnerMb || null, result.cpuRunnerPct || null,
       result.pgQueries || null, result.pgAvgMs || null, result.pgPoolUsed || null,
       result.stressPct || 0, result.stressLabel || 'OK', result.logFilename || null]
    );
  },

  async getStressResults(limit = 10) {
    const r = await query(
      `SELECT * FROM stress_results ORDER BY ran_at DESC LIMIT $1`, [limit]
    );
    return r.rows;
  },

  // ── Quiz Monitoring (Sprint 16f) ──────────────────────────────────────────────

  async getQuizStats() {
    const r = await query(`
      SELECT
        COUNT(DISTINCT a.session_code)::int                       AS active_sessions,
        COUNT(*)::int                                             AS total_answers,
        COUNT(CASE WHEN a.submitted_at IS NOT NULL THEN 1 END)::int AS submitted_answers,
        ROUND(AVG(a.run_count), 1)                                AS avg_runs
      FROM quiz_answers a
      JOIN quiz_meta m ON m.session_code = a.session_code
    `);
    return r.rows[0] || {};
  },

  // Utility
  async close() { await pool.end(); },

  // Health check
  async ping() {
    const r = await query(`SELECT 1 AS ok`);
    return r.rows[0]?.ok === 1;
  },
};
