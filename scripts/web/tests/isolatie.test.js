// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 48c3 — Isolatietestsuite (Fase 3): school A ziet NUL rijen van school B.
//
// Dit zijn INTEGRATIETESTS tegen een echte PostgreSQL (geen mocks): ze draaien het
// volledige schema (initSchema incl. 48c1-migratie) en toetsen daarna de gescopede
// leesfuncties van 48c2 én het Bibliotheek-uitzonderingspad van 51c.
//
// Draaien:
//   1) zorg voor een LEGE testdatabase, bv.:  createdb pycodeflow_test
//   2) DATABASE_URL=postgres://user:pw@127.0.0.1:5432/pycodeflow_test \
//        node --test tests/isolatie.test.js
// Zonder DATABASE_URL (of onbereikbare DB) slaan de tests zichzelf over — zo blijft
// `npm test` overal groen, ook zonder databank (bv. in een kale checkout).
// NOOIT tegen een productiedatabase draaien: de suite maakt testdata aan.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const DB_URL = process.env.DATABASE_URL || '';
let db = null;
let beschikbaar = false;

// Vaste, herkenbare test-ids (prefix isotest-) zodat herhaald draaien geen rommel stapelt:
// we ruimen vooraf alles met deze prefix op.
const P = 'isotest-';
const ids = {
  schoolA: P + 'school-a', schoolB: P + 'school-b',
  lkA: P + 'teacher-a', lkB: P + 'teacher-b',
};

before(async () => {
  if (!DB_URL) { console.log('[isolatie] DATABASE_URL niet gezet → suite overgeslagen'); return; }
  process.env.DATABASE_URL = DB_URL;
  db = require('../db/database');
  try {
    await db.init(); // volledig schema + 48c1-migratie (idempotent)
    beschikbaar = true;
  } catch (e) {
    console.log('[isolatie] databank onbereikbaar → suite overgeslagen:', e.message);
    return;
  }

  // Schoon vorige testresten op (volgorde: afhankelijke tabellen eerst).
  await db.query(`DELETE FROM template_questions WHERE template_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM assignment_templates WHERE id LIKE $1 OR owner_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM question_bank WHERE id LIKE $1 OR created_by LIKE $1 OR text LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM class_memberships WHERE student_id IN (SELECT id FROM students WHERE id LIKE $1 OR name LIKE $1)`, [P + '%']);
  await db.query(`DELETE FROM students WHERE id LIKE $1 OR name LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM teacher_classes WHERE teacher_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM teacher_classes WHERE class_id IN (SELECT id FROM classes WHERE name LIKE $1)`, [P + '%']);
  await db.query(`DELETE FROM classes WHERE id LIKE $1 OR name LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM sessions WHERE code LIKE $1`, [P.toUpperCase() + '%']);
  await db.query(`DELETE FROM audit_log WHERE id LIKE $1 OR action LIKE 'isotest_%'`, [P + '%']);
  await db.query(`DELETE FROM teacher_schools WHERE teacher_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM school_domains WHERE school_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM teachers WHERE id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM schools WHERE id LIKE $1`, [P + '%']);

  // ── Twee scholen, twee leerkrachten ──
  const now = Date.now();
  await db.query(`INSERT INTO schools (id, name, created_at) VALUES ($1,$2,$3),($4,$5,$6)`,
    [ids.schoolA, P + 'School A', now, ids.schoolB, P + 'School B', now]);
  await db.query(
    `INSERT INTO teachers (id, username, display_name, pass_hash, role, created_at)
     VALUES ($1,$2,$3,'x','teacher',$4), ($5,$6,$7,'x','teacher',$8)`,
    [ids.lkA, P + 'anja', 'Anja (A)', now, ids.lkB, P + 'bart', 'Bart (B)', now]);
  await db.query(`INSERT INTO teacher_schools (teacher_id, school_id) VALUES ($1,$2),($3,$4)`,
    [ids.lkA, ids.schoolA, ids.lkB, ids.schoolB]);
});

after(async () => { if (db) await db.query('SELECT 1').catch(() => {}); });

function alleenMet(voorwaarde) { return beschikbaar && voorwaarde; }
const skipMsg = { skip: 'geen databank beschikbaar (zet DATABASE_URL)' };
function t(naam, fn) {
  test(naam, beschikbaar === false && !DB_URL ? skipMsg : {}, async (ctx) => {
    if (!beschikbaar) return ctx.skip('databank onbereikbaar');
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Klassen
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 klassen: A ziet enkel klassen van school A (nul van B)', async () => {
  const kA = await db.createClass(P + 'Klas 5A', '2025-2026', ids.schoolA);
  const kB = await db.createClass(P + 'Klas 5B', '2025-2026', ids.schoolB);
  await db.linkTeacherClass(ids.lkA, kA);
  await db.linkTeacherClass(ids.lkB, kB);

  const zichtA = await db.listClassesVisibleTo({ teacherId: ids.lkA, isAdmin: false, actieveSchoolId: ids.schoolA });
  const idsA = zichtA.map(c => c.id);
  assert.ok(idsA.includes(kA), 'A ziet zijn eigen klas');
  assert.ok(!idsA.includes(kB), 'A ziet de B-klas niet (die is gekoppeld én van school B)');
  assert.strictEqual(zichtA.filter(c => c.school_id === ids.schoolB).length, 0, 'A ziet NUL klassen van school B');

  // Ook als admin: de actieve school blijft de scope (super-admin = 48c4).
  const adminA = await db.listClassesVisibleTo({ teacherId: ids.lkA, isAdmin: true, actieveSchoolId: ids.schoolA });
  assert.strictEqual(adminA.filter(c => c.school_id === ids.schoolB).length, 0, 'ook admin(A) ziet nul B-klassen');
});

// ─────────────────────────────────────────────────────────────────────────────
// Leerlingen (erven de school van hun klas)
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 leerlingen: erven school van klas + lijst is gescheiden', async () => {
  const kA = await db.createClass(P + 'Klas erf A', '2025-2026', ids.schoolA);
  const kB = await db.createClass(P + 'Klas erf B', '2025-2026', ids.schoolB);
  const sA = await db.createStudent(P + 'Aline', kA);
  const sB = await db.createStudent(P + 'Boris', kB);

  const rijA = await db.getStudentById(sA);
  const rijB = await db.getStudentById(sB);
  assert.strictEqual(rijA.school_id, ids.schoolA, 'leerling erft school A van zijn klas');
  assert.strictEqual(rijB.school_id, ids.schoolB, 'leerling erft school B van zijn klas');

  const lijstA = await db.listStudents(null, true, ids.schoolA);
  assert.ok(lijstA.some(s => s.id === sA), 'A-lijst bevat Aline');
  assert.strictEqual(lijstA.filter(s => s.school_id === ids.schoolB).length, 0, 'A-lijst bevat NUL B-leerlingen');
});

// ─────────────────────────────────────────────────────────────────────────────
// Vragenbank
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 vragenbank: gescoped per school, legacy (NULL) blijft zichtbaar', async () => {
  const qA = await db.createQuizQuestion({ text: P + 'Vraag van A?', createdBy: ids.lkA, schoolId: ids.schoolA });
  const qB = await db.createQuizQuestion({ text: P + 'Vraag van B?', createdBy: ids.lkB, schoolId: ids.schoolB });
  const qLegacy = await db.createQuizQuestion({ text: P + 'Vraag zonder school?', createdBy: ids.lkA, schoolId: null });

  const bankA = await db.listQuizBank({ actieveSchoolId: ids.schoolA });
  const eigen = bankA.map(q => q.id);
  assert.ok(eigen.includes(qA), 'A ziet zijn eigen vraag');
  assert.ok(!eigen.includes(qB), 'A ziet de B-vraag NIET');
  assert.ok(eigen.includes(qLegacy), 'school-loze (legacy) vraag blijft zichtbaar');
});

// ─────────────────────────────────────────────────────────────────────────────
// Sessies (persist + closed-lijst dragen schoolId)
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 sessies: schoolId overleeft persist en laad-rondes', async () => {
  const code = (P + 'SES1').toUpperCase();
  await db.persistSession({
    code, id: P + 'sess-1', name: P + 'Sessie A', mode: 'classroom',
    editorAssist: false, createdAt: Date.now(), closed: false, blocked: false, deleted: false,
    sharedCode: '', announcement: '', classWorkspaceMode: 'shared',
    students: {}, config: {}, teacherId: ids.lkA, schoolId: ids.schoolA,
  });
  const rows = await db.loadActiveSessions();
  const mijn = rows.find(s => s.code === code);
  assert.ok(mijn, 'sessie geladen');
  assert.strictEqual(mijn.schoolId, ids.schoolA, 'schoolId komt terug uit de databank');
});

// ─────────────────────────────────────────────────────────────────────────────
// Auditlog
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 auditlog: gescoped per school', async () => {
  await db.auditLog(P + 'anja', 'isotest_actie_a', 't', {}, '', ids.schoolA);
  await db.auditLog(P + 'bart', 'isotest_actie_b', 't', {}, '', ids.schoolB);
  const logA = await db.getAuditLog({ limit: 200, actieveSchoolId: ids.schoolA });
  const acties = logA.map(l => l.action);
  assert.ok(acties.includes('isotest_actie_a'), 'A ziet zijn eigen logregel');
  assert.ok(!acties.includes('isotest_actie_b'), 'A ziet de B-logregel NIET');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bibliotheek (51c): de ENIGE toegelaten cross-school-uitzondering
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 bibliotheek: publiek kruist scholen, privé/school niet, hidden (53d) wint', async () => {
  const now = Date.now();
  const qPub = await db.createQuizQuestion({ text: P + 'Publieke vraag van B', createdBy: ids.lkB, schoolId: ids.schoolB });
  await db.setQuestionScope(qPub, 'public');
  const qPriv = await db.createQuizQuestion({ text: P + 'Privévraag van B', createdBy: ids.lkB, schoolId: ids.schoolB });

  // Leerkracht A (andere school, deelt géén school met B): ziet enkel de publieke vraag.
  const gedeeld = await db.listSharedQuestions({ viewerId: ids.lkA, isAdmin: false });
  const zichtbaar = gedeeld.map(q => q.id);
  assert.ok(zichtbaar.includes(qPub), 'publieke B-vraag is cross-school zichtbaar (bedoelde uitzondering)');
  assert.ok(!zichtbaar.includes(qPriv), 'privé B-vraag kruist NIET');

  // 53d: admin-takedown wint van publiek.
  await db.setQuestionHidden(qPub, true);
  const naTakedown = await db.listSharedQuestions({ viewerId: ids.lkA, isAdmin: false });
  assert.ok(!naTakedown.map(q => q.id).includes(qPub), 'verborgen publieke vraag verdwijnt bij andere school');
});

// ─────────────────────────────────────────────────────────────────────────────
// 48c1-dekking: diagnose telt school-loze rijen correct
// ─────────────────────────────────────────────────────────────────────────────
t('48c3 dekking: schoolDekking telt de bewust school-loze legacy-vraag mee', async () => {
  const d = await db.schoolDekking();
  assert.ok(d.question_bank_zonder >= 1, 'de legacy-vraag zonder school wordt geteld');
  // Met 2 scholen is er geen eenduidige standaardschool:
  assert.strictEqual(await db.getStandaardSchoolId(), null, 'standaardschool is null bij 2 scholen');
});

// ─────────────────────────────────────────────────────────────────────────────
// 48c4: super-admin kijkt over de schoolgrens heen (leesscope null)
// ─────────────────────────────────────────────────────────────────────────────
t('48c4 superadmin: ziet klassen van BEIDE scholen (scope null)', async () => {
  const kA = await db.createClass(P + 'Klas sup A', '2025-2026', ids.schoolA);
  const kB = await db.createClass(P + 'Klas sup B', '2025-2026', ids.schoolB);
  // leesScopeVoor(superadmin) → null: geen schoolfilter.
  const alles = await db.listClassesVisibleTo({ teacherId: ids.lkA, isAdmin: true, actieveSchoolId: null });
  const zichtbaar = alles.map(c => c.id);
  assert.ok(zichtbaar.includes(kA), 'superadmin ziet de A-klas');
  assert.ok(zichtbaar.includes(kB), 'superadmin ziet óók de B-klas');
});
