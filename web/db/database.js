/**
 * PyCodeFlow — SQLite database module
 * Beheert sessie-persistentie en leerkrachtenaccounts.
 * Schema is bewust UUID-gebaseerd zodat migratie naar PostgreSQL triviaal is.
 */
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const DB_DIR  = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'pycodeflow.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode: betere concurrentie, geen locks bij reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS teachers (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash   TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    last_login  INTEGER
  );

  CREATE TABLE IF NOT EXISTS session_annotations (
    session_code TEXT PRIMARY KEY,
    annotations_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS code_snapshots (
    id          TEXT PRIMARY KEY,
    session_code TEXT NOT NULL,
    student_id   TEXT NOT NULL,
    student_name TEXT NOT NULL DEFAULT '',
    timestamp    INTEGER NOT NULL,
    code         TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_session_student
    ON code_snapshots (session_code, student_id, timestamp);

  CREATE TABLE IF NOT EXISTS sessions (
    code            TEXT PRIMARY KEY,
    id              TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    mode            TEXT NOT NULL DEFAULT 'class',
    editor_assist   INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    closed          INTEGER NOT NULL DEFAULT 0,
    blocked         INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0,
    shared_code     TEXT NOT NULL DEFAULT '',
    announcement    TEXT NOT NULL DEFAULT '',
    workspace_mode  TEXT NOT NULL DEFAULT 'shared',
    students_json   TEXT NOT NULL DEFAULT '{}'
  );
`);

// ── Teacher queries ───────────────────────────────────────────────────────────
const stmtGetTeacherByUsername = db.prepare(
  `SELECT * FROM teachers WHERE username = ? COLLATE NOCASE LIMIT 1`
);
const stmtInsertTeacher = db.prepare(
  `INSERT INTO teachers (id, username, pass_hash, display_name, created_at)
   VALUES (?, ?, ?, ?, ?)`
);
const stmtUpdateLastLogin = db.prepare(
  `UPDATE teachers SET last_login = ? WHERE id = ?`
);
const stmtListTeachers = db.prepare(
  `SELECT id, username, display_name, created_at, last_login FROM teachers ORDER BY created_at`
);
const stmtDeleteTeacher = db.prepare(`DELETE FROM teachers WHERE username = ? COLLATE NOCASE`);
const stmtUpdatePassHash = db.prepare(`UPDATE teachers SET pass_hash = ? WHERE username = ? COLLATE NOCASE`);

// ── Session queries ───────────────────────────────────────────────────────────
const stmtUpsertSession = db.prepare(`
  INSERT INTO sessions (code, id, name, mode, editor_assist, created_at, closed, blocked, deleted,
                        shared_code, announcement, workspace_mode, students_json)
  VALUES (@code, @id, @name, @mode, @editor_assist, @created_at, @closed, @blocked, @deleted,
          @shared_code, @announcement, @workspace_mode, @students_json)
  ON CONFLICT(code) DO UPDATE SET
    name           = excluded.name,
    closed         = excluded.closed,
    blocked        = excluded.blocked,
    deleted        = excluded.deleted,
    shared_code    = excluded.shared_code,
    announcement   = excluded.announcement,
    workspace_mode = excluded.workspace_mode,
    students_json  = excluded.students_json
`);
const stmtLoadActiveSessions = db.prepare(
  `SELECT * FROM sessions WHERE deleted = 0 AND closed = 0`
);
const stmtMarkSessionDeleted = db.prepare(
  `UPDATE sessions SET deleted = 1 WHERE code = ?`
);
const stmtMarkSessionClosed = db.prepare(
  `UPDATE sessions SET closed = 1 WHERE code = ?`
);

// ── Public API ────────────────────────────────────────────────────────────────
module.exports = {
  // Teachers
  getTeacherByUsername(username) {
    return stmtGetTeacherByUsername.get(username) || null;
  },
  createTeacher(username, passHash, displayName = '') {
    const id = crypto.randomUUID();
    stmtInsertTeacher.run(id, username, passHash, displayName, Date.now());
    return id;
  },
  updateLastLogin(id) {
    stmtUpdateLastLogin.run(Date.now(), id);
  },
  listTeachers() {
    return stmtListTeachers.all();
  },
  deleteTeacher(username) {
    return stmtDeleteTeacher.run(username).changes > 0;
  },
  updatePassHash(username, passHash) {
    return stmtUpdatePassHash.run(passHash, username).changes > 0;
  },

  // Sessions
  persistSession(session) {
    // Saniteer runtimevelden (socketIds, runIds) — die zijn niet persistent
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
    stmtUpsertSession.run({
      code:           session.code,
      id:             session.id,
      name:           session.name,
      mode:           session.mode,
      editor_assist:  session.editorAssist ? 1 : 0,
      created_at:     session.createdAt || Date.now(),
      closed:         session.closed    ? 1 : 0,
      blocked:        session.blocked   ? 1 : 0,
      deleted:        session.deleted   ? 1 : 0,
      shared_code:    session.sharedCode    || '',
      announcement:   session.announcement  || '',
      workspace_mode: session.classWorkspaceMode || 'shared',
      students_json:  JSON.stringify(students),
    });
  },
  loadActiveSessions() {
    return stmtLoadActiveSessions.all().map(row => ({
      code:               row.code,
      id:                 row.id,
      name:               row.name,
      mode:               row.mode,
      editorAssist:       row.editor_assist === 1,
      createdAt:          row.created_at,
      closed:             row.closed   === 1,
      blocked:            row.blocked  === 1,
      deleted:            row.deleted  === 1,
      sharedCode:         row.shared_code,
      announcement:       row.announcement,
      classWorkspaceMode: row.workspace_mode,
      students:           JSON.parse(row.students_json || '{}'),
      // Runtime velden
      teacherSocketId: null, selectedStudentId: null,
      sharedOutput: '', teacherRunId: null, teacherPreviewOutput: '',
      statusText: 'Hersteld na herstart', statusType: 'info',
      sharedCodeRevision: 0, sharedCodeSourceSocketId: null,
      announcementVersion: 0,
    }));
  },
  markSessionDeleted(code) { stmtMarkSessionDeleted.run(code); },
  markSessionClosed(code)  { stmtMarkSessionClosed.run(code);  },

  // Annotaties persisteren
  saveAnnotations(sessionCode, annotations) {
    try {
      const json = JSON.stringify(annotations || []);
      db.prepare(`
        INSERT INTO session_annotations (session_code, annotations_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_code) DO UPDATE SET
          annotations_json = excluded.annotations_json,
          updated_at = excluded.updated_at
      `).run(sessionCode, json, Date.now());
    } catch {}
  },
  getAnnotations(sessionCode) {
    try {
      const row = db.prepare(
        'SELECT annotations_json FROM session_annotations WHERE session_code = ?'
      ).get(sessionCode);
      return row ? JSON.parse(row.annotations_json) : [];
    } catch { return []; }
  },

  // Code snapshots
  saveSnapshot(sessionCode, studentId, studentName, code) {
    try {
      db.prepare(`
        INSERT INTO code_snapshots (id, session_code, student_id, student_name, timestamp, code)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), sessionCode, studentId, studentName, Date.now(), code);
    } catch(e) { /* stil falen — snapshot niet kritisch */ }
  },
  getSnapshots(sessionCode, studentId) {
    return db.prepare(`
      SELECT id, timestamp, code, student_name
      FROM code_snapshots
      WHERE session_code = ? AND student_id = ?
      ORDER BY timestamp ASC
    `).all(sessionCode, studentId);
  },
  deleteSnapshotsForSession(sessionCode) {
    db.prepare(`DELETE FROM code_snapshots WHERE session_code = ?`).run(sessionCode);
  },

  // Utility
  close() { db.close(); },
};
