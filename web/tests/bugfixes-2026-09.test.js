// ═══════════════════════════════════════════════════════════════════════════════
// Sprint (2026-09) — Integratietests voor de 7 bugfixes uit deze levering:
//   1) leerling écht verwijderen (volledige cascade)
//   2/3) sessie ↔ klas-koppeling (session_classes) + gefilterde leerlingenlijst
//   7) verwijderde sessie blijft niet meer "zweven" in de DB
//
// Zelfde patroon als tests/isolatie.test.js: INTEGRATIETESTS tegen een echte
// PostgreSQL, geen mocks. Zonder DATABASE_URL (of onbereikbare DB) slaan de tests
// zichzelf over. NOOIT tegen een productiedatabase draaien: de suite maakt en
// verwijdert testdata (met een herkenbare prefix, opgeruimd voor en na afloop).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const DB_URL = process.env.DATABASE_URL || '';
let db = null;
let beschikbaar = false;

const P = 'bugfixtest-';
const ids = {
  school: P + 'school', teacher: P + 'teacher',
  klasA: P + 'klas-a', klasB: P + 'klas-b',
};

async function opruimen() {
  await db.query(`DELETE FROM session_classes WHERE session_code LIKE $1`, [P.toUpperCase() + '%']);
  await db.query(`DELETE FROM code_snapshots WHERE student_id LIKE $1 OR id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM assignment_student_status WHERE student_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM class_memberships WHERE student_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM students WHERE id LIKE $1 OR name LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM sessions WHERE code LIKE $1`, [P.toUpperCase() + '%']);
  await db.query(`DELETE FROM teacher_classes WHERE teacher_id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM classes WHERE id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM teachers WHERE id LIKE $1`, [P + '%']);
  await db.query(`DELETE FROM schools WHERE id LIKE $1`, [P + '%']);
}

before(async () => {
  if (!DB_URL) { console.log('[bugfixes] DATABASE_URL niet gezet → suite overgeslagen'); return; }
  db = require('../db/database');
  try {
    await db.init();
    beschikbaar = true;
  } catch (e) {
    console.log('[bugfixes] databank onbereikbaar → suite overgeslagen:', e.message);
    return;
  }
  await opruimen();
  const now = Date.now();
  await db.query(`INSERT INTO schools (id, name, created_at) VALUES ($1,$2,$3)`, [ids.school, P + 'School', now]);
  await db.query(
    `INSERT INTO teachers (id, username, display_name, pass_hash, role, created_at)
     VALUES ($1,$2,$3,'x','teacher',$4)`, [ids.teacher, P + 'juf', 'Juf Test', now]);
});

after(async () => { if (db && beschikbaar) await opruimen(); });

function t(naam, fn) {
  test(naam, beschikbaar === false && !DB_URL ? { skip: 'geen databank beschikbaar (zet DATABASE_URL)' } : {}, async (ctx) => {
    if (!beschikbaar) return ctx.skip('databank onbereikbaar');
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 — leerling verwijderen: volledige cascade, geen wees-data
// ─────────────────────────────────────────────────────────────────────────────
t('bug1: deleteStudent ruimt gekoppelde data in ALLE tabellen op', async () => {
  const klas = await db.createClass(P + 'Klas cascade', '2025-2026', ids.school);
  await db.linkTeacherClass(ids.teacher, klas);
  const studentId = await db.createStudent(P + 'Wies Cascade', klas, 'manual', 'active');

  // Data in tabellen zonder FK-constraint (het lek van vóór de fix):
  await db.query(
    `INSERT INTO code_snapshots (id, session_code, student_id, student_name, timestamp, code)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [P + 'snap-1', P.toUpperCase() + 'SES', studentId, 'Wies', Date.now(), 'print(1)']);
  await db.query(
    `INSERT INTO assignment_student_status (session_code, student_id, status, note, set_by, set_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [P.toUpperCase() + 'SES', studentId, 'gewettigd', 'test', P + 'juf', Date.now()]);

  // Data in tabellen MET ON DELETE CASCADE:
  assert.ok(await db.query(`SELECT 1 FROM class_memberships WHERE student_id = $1`, [studentId])
    .then(r => r.rows.length > 0), 'lidmaatschap staat er vooraf');

  const ok = await db.deleteStudent(studentId);
  assert.strictEqual(ok, true, 'deleteStudent meldt succes');

  const student = await db.query(`SELECT 1 FROM students WHERE id = $1`, [studentId]);
  assert.strictEqual(student.rows.length, 0, 'leerling zelf is weg');

  const snap = await db.query(`SELECT 1 FROM code_snapshots WHERE student_id = $1`, [studentId]);
  assert.strictEqual(snap.rows.length, 0, 'code-snapshots zijn mee opgeruimd (geen wees-rij)');

  const ans = await db.query(`SELECT 1 FROM assignment_student_status WHERE student_id = $1`, [studentId]);
  assert.strictEqual(ans.rows.length, 0, 'taakstatus is mee opgeruimd (geen wees-rij)');

  const lid = await db.query(`SELECT 1 FROM class_memberships WHERE student_id = $1`, [studentId]);
  assert.strictEqual(lid.rows.length, 0, 'lidmaatschap is (via CASCADE) mee verdwenen');
});

t('bug1: deleteStudent van een niet-bestaande leerling geeft false, geen crash', async () => {
  const ok = await db.deleteStudent(P + 'bestaat-niet');
  assert.strictEqual(ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2/3 — sessie ↔ klas-koppeling
// ─────────────────────────────────────────────────────────────────────────────
t('bug2/3: zonder session_classes-rijen ziet de leerling de sessie (oud gedrag = "alle klassen")', async () => {
  const klas = await db.createClass(P + 'Klas geen restrictie', '2025-2026', ids.school);
  await db.linkTeacherClass(ids.teacher, klas);
  const studentId = await db.createStudent(P + 'Leerling Open', klas, 'manual', 'active');
  await db.query(
    `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
     VALUES ($1,$2,'2025-2026','active',$3) ON CONFLICT DO NOTHING`, [studentId, klas, Date.now()]);

  const code = (P + 'OPEN1').toUpperCase();
  await db.persistSession({
    code, id: P + 'sess-open', name: 'Open sessie', mode: 'class', editorAssist: true,
    createdAt: Date.now(), closed: false, blocked: false, deleted: false,
    sharedCode: '', announcement: '', classWorkspaceMode: 'shared',
    students: {}, config: {}, teacherId: ids.teacher, schoolId: ids.school,
  });

  const rijen = await db.listOpenSessionsForStudent(studentId);
  assert.ok(rijen.some(r => r.code === code), 'leerling ziet de sessie zonder klas-restrictie');
});

t('bug2/3: met session_classes-rijen ziet enkel de gekoppelde klas de sessie', async () => {
  const klasA = await db.createClass(P + 'Klas gekoppeld A', '2025-2026', ids.school);
  const klasB = await db.createClass(P + 'Klas gekoppeld B', '2025-2026', ids.school);
  await db.linkTeacherClass(ids.teacher, klasA);
  await db.linkTeacherClass(ids.teacher, klasB);
  const leerlingA = await db.createStudent(P + 'Leerling A', klasA, 'manual', 'active');
  const leerlingB = await db.createStudent(P + 'Leerling B', klasB, 'manual', 'active');
  await db.query(
    `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
     VALUES ($1,$2,'2025-2026','active',$3) ON CONFLICT DO NOTHING`, [leerlingA, klasA, Date.now()]);
  await db.query(
    `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
     VALUES ($1,$2,'2025-2026','active',$3) ON CONFLICT DO NOTHING`, [leerlingB, klasB, Date.now()]);

  const code = (P + 'RESTR1').toUpperCase();
  await db.persistSession({
    code, id: P + 'sess-restr', name: 'Restrictieve sessie', mode: 'class', editorAssist: true,
    createdAt: Date.now(), closed: false, blocked: false, deleted: false,
    sharedCode: '', announcement: '', classWorkspaceMode: 'shared',
    students: {}, config: {}, teacherId: ids.teacher, schoolId: ids.school,
  });
  await db.setSessionClasses(code, [klasA]);

  const gekoppeld = await db.getSessionClasses(code);
  assert.deepStrictEqual(gekoppeld, [klasA], 'getSessionClasses geeft de gekozen klas terug');

  const rijenA = await db.listOpenSessionsForStudent(leerlingA);
  assert.ok(rijenA.some(r => r.code === code), 'leerling van klas A ziet de sessie');

  const rijenB = await db.listOpenSessionsForStudent(leerlingB);
  assert.ok(!rijenB.some(r => r.code === code), 'leerling van klas B ziet de sessie NIET');

  // setSessionClasses met lege array = terug "alle klassen"
  await db.setSessionClasses(code, []);
  const rijenBNa = await db.listOpenSessionsForStudent(leerlingB);
  assert.ok(rijenBNa.some(r => r.code === code), 'na leegmaken ziet klas B de sessie weer (= alle klassen)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 7 — verwijderde sessie blijft niet zweven
// ─────────────────────────────────────────────────────────────────────────────
t('bug7: markSessionDeleted maakt de sessie onzichtbaar voor leerlingen', async () => {
  const klas = await db.createClass(P + 'Klas verwijder-sessie', '2025-2026', ids.school);
  await db.linkTeacherClass(ids.teacher, klas);
  const studentId = await db.createStudent(P + 'Leerling Verwijder', klas, 'manual', 'active');
  await db.query(
    `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
     VALUES ($1,$2,'2025-2026','active',$3) ON CONFLICT DO NOTHING`, [studentId, klas, Date.now()]);

  const code = (P + 'WEG1').toUpperCase();
  await db.persistSession({
    code, id: P + 'sess-weg', name: 'Weg te gooien sessie', mode: 'class', editorAssist: true,
    createdAt: Date.now(), closed: false, blocked: false, deleted: false,
    sharedCode: '', announcement: '', classWorkspaceMode: 'shared',
    students: {}, config: {}, teacherId: ids.teacher, schoolId: ids.school,
  });
  let rijen = await db.listOpenSessionsForStudent(studentId);
  assert.ok(rijen.some(r => r.code === code), 'sessie is eerst zichtbaar');

  await db.markSessionDeleted(code);

  rijen = await db.listOpenSessionsForStudent(studentId);
  assert.ok(!rijen.some(r => r.code === code), 'sessie is na markSessionDeleted NIET meer zichtbaar (blijft niet zweven)');
});

// Let op — GEEN automatische opruimmigratie voor bestaande "zwevende" sessies: sessies
// worden bij het opstarten van de server ECHT herladen vanuit de DB (loadPersistedSessions
// in server.js, gebaseerd op exact hetzelfde deleted=0 AND closed=0-criterium). Een
// blanket "markeer alles als verwijderd bij opstart" zou dus bij elke herstart ook ECHTE,
// nog lopende lessen vernietigen — dat mag nooit tegen een live productiedatabase. De 3
// bestaande spooksessies verschijnen na deze update dus gewoon opnieuw in het
// sessieoverzicht van de leerkracht (als "Hersteld na herstart") en kunnen daar met de
// (nu wél correct werkende) verwijderknop weggehaald worden — geen automatische ingreep
// in productiedata nodig of gewenst.
