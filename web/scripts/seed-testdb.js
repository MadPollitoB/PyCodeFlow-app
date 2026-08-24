#!/usr/bin/env node
/**
 * PyCodeFlow — Sprint 54: TESTDATABASE-SEEDER (CLI)
 *
 * Bouwt een volledige, realistische testdatabase: 2 scholen, leerkrachten, klassen
 * (met actieve startcodes), leerlingen (met en zonder account, incl. pending/blocked),
 * vragenbank (privé/school/publiek + 1 verborgen), sjablonen, een klassessie, een
 * toets en een taak mét ingevulde antwoorden/scores zodat verbeter-/exportschermen
 * data hebben.
 *
 * Gebruik (in de web-container):
 *   node scripts/seed-testdb.js seed   → testdata aanmaken (idempotent: 2× draaien is ok)
 *   node scripts/seed-testdb.js wipe   → ALLE testdata weer verwijderen
 *   node scripts/seed-testdb.js status → wat staat er aan testdata in de databank?
 *
 * ⚠️ NOOIT OP PRODUCTIE. Alle rijen zijn herkenbaar aan het voorvoegsel "testdata-"
 * (ids), "TD…" (sessiecodes) of "TESTDATA " (namen). `wipe` verwijdert uitsluitend
 * die rijen. Wachtwoord = gebruikersnaam (bv. leerkrachtA / leerkrachtA) — bewust
 * onveilig, dus enkel voor test.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const db = require('../db/database');

const P  = 'testdata-';      // id-prefix
const NP = 'TESTDATA ';      // naam-prefix (zichtbaar in de UI)
const JAAR = '2025-2026';

function hash(pw) {
  // Zelfde formaat als server.js / manage-teacher.js: scrypt$N$r$p$salt$hash
  const salt = crypto.randomBytes(16);
  const params = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const key = crypto.scryptSync(String(pw), salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
const now = () => Date.now();

// ── Vaste ids: idempotentie via ON CONFLICT DO NOTHING ───────────────────────
const S = { A: P + 'school-a', B: P + 'school-b' };
const T = {
  supa: P + 'lk-superadmin',
  a1: P + 'lk-a1', a2: P + 'lk-a2',
  b1: P + 'lk-b1',
};
const K = { a5: P + 'klas-5a', a6: P + 'klas-6a', b5: P + 'klas-5b' };
const CODES = { toetsA: 'TDTOETSA', taakA: 'TDTAAKA', lesA: 'TDLESA5' };

async function seed() {
  console.log('— Schema initialiseren (idempotent) …');
  await db.init();

  console.log('— Scholen …');
  await db.query(
    `INSERT INTO schools (id, name, active, created_at) VALUES
       ($1,$2,true,$5),($3,$4,true,$5)
     ON CONFLICT (id) DO NOTHING`,
    [S.A, NP + 'School A', S.B, NP + 'School B', now()]);

  console.log('— Leerkrachten (wachtwoord = gebruikersnaam) …');
  const lk = [
    [T.supa, 'superadmin',  NP + 'Super Admin', 'superadmin', null],
    [T.a1,   'leerkrachtA', NP + 'Anja (A, admin)', 'admin',  S.A],
    [T.a2,   'leerkrachtA2',NP + 'Aron (A)',    'teacher',    S.A],
    [T.b1,   'leerkrachtB', NP + 'Bart (B, admin)', 'admin',  S.B],
  ];
  for (const [id, user, naam, rol, school] of lk) {
    await db.query(
      `INSERT INTO teachers (id, username, display_name, pass_hash, role, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [id, user, naam, hash(user), rol, now()]);
    if (school) {
      await db.query(`INSERT INTO teacher_schools (teacher_id, school_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, school]);
    }
    // Sprint 51h: de superadmin (school === null) wordt bewust NIET aan een school gekoppeld —
    // hij beheert het volledige platform en hangt nooit aan een school. Zijn leesscope is toch
    // alziend, dus koppeling is niet nodig én zou de regel schenden.
  }

  console.log('— Klassen (startcodes actief) …');
  const klassen = [
    [K.a5, NP + 'Klas 5A', S.A, 'TDKLAS5A', T.a1],
    [K.a6, NP + 'Klas 6A', S.A, 'TDKLAS6A', T.a2],
    [K.b5, NP + 'Klas 5B', S.B, 'TDKLAS5B', T.b1],
  ];
  for (const [id, naam, school, code, eigenaar] of klassen) {
    await db.query(
      `INSERT INTO classes (id, name, school_year, school_id, start_code, start_code_active, created_at)
       VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (id) DO NOTHING`,
      [id, naam, JAAR, school, code, now()]);
    await db.query(`INSERT INTO teacher_classes (teacher_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [eigenaar, id]);
  }

  console.log('— Leerlingen (studentA/A5 = actief, A2 = pending, A3 = geblokkeerd, A4 = zonder account) …');
  const studenten = [
    // [id, gebruikers-/loginnaam, voor, achter, klas, school, status, metAccount]
    [P + 'st-a1', 'studentA',  'Sten',  'Testers',  K.a5, S.A, 'active',  true],
    [P + 'st-a5', 'studentA5', 'Nina',  'Actief',   K.a5, S.A, 'active',  true],
    [P + 'st-a2', 'studentA2', 'Pia',   'Pending',  K.a5, S.A, 'pending', true],
    [P + 'st-a3', 'studentA3', 'Bo',    'Blocked',  K.a5, S.A, 'blocked', true],
    [P + 'st-a4', null,        'Gast',  'Zondermail', K.a5, S.A, 'active', false],
    [P + 'st-a6', 'studentA6', 'Zesde', 'Jaars',    K.a6, S.A, 'active',  true],
    [P + 'st-a7', 'studentA7', 'Wout',  'Wachtend',  K.a6, S.A, 'pending', true],
    [P + 'st-b1', 'studentB',  'Bente', 'Vanb',     K.b5, S.B, 'active',  true],
  ];
  for (const [id, user, voor, achter, klas, school, status, metAccount] of studenten) {
    const naam = `${NP}${voor} ${achter}`;
    const email = metAccount ? `${user}@testschool.local` : null;
    await db.query(
      `INSERT INTO students (id, name, first_name, last_name, email, pass_hash, status, source,
                             school_id, must_change_password, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,false,$9) ON CONFLICT (id) DO NOTHING`,
      [id, naam, NP + voor, achter, email, metAccount ? hash(user) : null, status, school, now()]);
    await db.query(
      `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
       VALUES ($1,$2,$3,'active',$4) ON CONFLICT DO NOTHING`,
      [id, klas, JAAR, now()]);
  }

  console.log('— Vragenbank (privé/school/publiek + 1 verborgen door admin) …');
  const vragen = [
    // [id, eigenaar, school, scope, hidden, type, tekst, punten]
    [P + 'q-a1', T.a1, S.A, 'private', false, 'code',   'Schrijf een functie som(a, b) die a+b teruggeeft.', 4],
    [P + 'q-a2', T.a1, S.A, 'school',  false, 'code',   'Schrijf een for-lus die 1 t/m 10 print.', 4],
    [P + 'q-a3', T.a1, S.A, 'public',  false, 'code',   'Keer een string om zonder [::-1].', 6],
    [P + 'q-a4', T.a2, S.A, 'public',  true,  'code',   'VERBORGEN voorbeeldvraag (53d-takedown-demo).', 2],
    [P + 'q-a5', T.a1, S.A, 'school',  false, 'single', 'Wat print print(2 ** 3)?', 2],
    [P + 'q-b1', T.b1, S.B, 'private', false, 'code',   'Bereken de faculteit van n (recursief).', 6],
    [P + 'q-b2', T.b1, S.B, 'public',  false, 'code',   'Tel de klinkers in een string.', 4],
    // Sprint 51j: samengestelde vraag — 2 open-onderdelen (x, y) + 1 code-onderdeel.
    [P + 'q-a6', T.a1, S.A, 'school',  false, 'composite', 'Gegeven onderstaande code:\n\n```python\nx = 3\ny = 0\nfor i in range(1, 4):\n    y += x\n    x -= 1\n```\n\nWat is op het einde de waarde van `x` en `y`? Schrijf ook zelf code die dit bevestigt.', 8],
  ];
  for (const [id, eigenaar, school, scope, hidden, type, tekst, ptn] of vragen) {
    const choices = type === 'single'
      ? JSON.stringify([{ id: id + '-c1', text: '6', correct: false }, { id: id + '-c2', text: '8', correct: true }, { id: id + '-c3', text: '9', correct: false }])
      : '[]';
    const answerParts = type === 'composite' ? JSON.stringify([
      { id: id + '-p1', type: 'open', label: 'Waarde van x', points: 2, modelAnswer: '0' },
      { id: id + '-p2', type: 'open', label: 'Waarde van y', points: 2, modelAnswer: '6' },
      { id: id + '-p3', type: 'code', label: '', points: 4, modelAnswer: 'x = 3\ny = 0\nfor i in range(1, 4):\n    y += x\n    x -= 1\nprint(x, y)' },
    ]) : '[]';
    const dbType = ['single', 'composite'].includes(type) ? type : 'code';
    await db.query(
      `INSERT INTO question_bank (id, text, subject, difficulty, max_points, question_type,
         choices_json, tags, model_answer, created_by, school_id, share_scope, hidden, created_at, updated_at, answer_parts)
       VALUES ($1,$2,'Python','gemiddeld',$3,$4,$5,'testdata','',$6,$7,$8,$9,$10,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [id, NP + tekst, ptn, dbType, choices, eigenaar, school, scope, hidden, now(), answerParts]);
  }

  console.log('— Sjablonen (school + publiek, met gekoppelde vragen) …');
  const sjablonen = [
    [P + 'tpl-a1', T.a1, 'toets', 'school', NP + 'Sjabloon: Python basis (school A)', [P + 'q-a2', P + 'q-a5']],
    [P + 'tpl-a2', T.a1, 'taak',  'public', NP + 'Sjabloon: Strings oefenen (publiek)', [P + 'q-a3']],
    [P + 'tpl-b1', T.b1, 'toets', 'public', NP + 'Sjabloon: Recursie (publiek, school B)', [P + 'q-b2']],
  ];
  for (const [id, eigenaar, type, scope, naam, qids] of sjablonen) {
    await db.query(
      `INSERT INTO assignment_templates (id, type, name, description, subject, owner_id, share_scope, created_at, updated_at)
       VALUES ($1,$2,$3,'Aangemaakt door de testdatabase-seeder.','Python',$4,$5,$6,$6)
       ON CONFLICT (id) DO NOTHING`,
      [id, type, naam, eigenaar, scope, now()]);
    for (let i = 0; i < qids.length; i++) {
      await db.query(
        `INSERT INTO template_questions (template_id, question_id, order_index)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, qids[i], i]);
    }
  }

  console.log('— Sessies: klassessie + toets + taak (met snapshots) …');
  // Klassessie (gewone les) van leerkrachtA
  await db.persistSession({
    code: CODES.lesA, id: P + 'sess-les', name: NP + 'Les 5A (klassessie)', mode: 'classroom',
    editorAssist: true, createdAt: now(), closed: false, blocked: false, deleted: false,
    sharedCode: '', announcement: 'Welkom in de testles!', classWorkspaceMode: 'shared',
    students: {}, config: {}, teacherId: T.a1, schoolId: S.A,
  });

  // Toets + taak: sessions-rij + assignment_bank + snapshots (enkel als ze nog niet bestaan)
  async function maakToets(code, naam, type, vraagIds) {
    await db.persistSession({
      code, id: P + 'sess-' + code.toLowerCase(), name: naam, mode: 'quiz',
      editorAssist: false, createdAt: now(), closed: false, blocked: false, deleted: false,
      sharedCode: '', announcement: '', classWorkspaceMode: 'shared',
      students: {}, config: {}, teacherId: T.a1, schoolId: S.A,
    });
    const bestaat = await db.query(`SELECT 1 FROM assignment_bank WHERE session_code = $1`, [code]);
    if (bestaat.rows.length) return; // idempotent: snapshots niet dubbel aanmaken
    const rows = await db.query(`SELECT * FROM question_bank WHERE id = ANY($1::text[])`, [vraagIds]);
    const opVolgorde = vraagIds.map(id => rows.rows.find(r => r.id === id)).filter(Boolean);
    await db.createQuizSession({
      sessionCode: code,
      questions: opVolgorde.map((q, i) => ({
        bankId: q.id, orderIndex: i, text: q.text, subject: q.subject, points: q.max_points,
        questionType: q.question_type, choicesJson: q.choices_json, modelAnswer: q.model_answer,
        answerParts: q.answer_parts || '[]',
      })),
      randomize: false, timerSeconds: type === 'toets' ? 1800 : null,
      noTimer: type === 'taak', minRunsPerQ: 0, hideQuestionOnScreen: false,
      isTeacherPreview: false, schoolYear: JAAR, targetClass: K.a5,
      accessFrom: null, accessUntil: null, autoSubmitLate: true, type,
    });
  }
  await maakToets(CODES.toetsA, NP + 'Toets: Python basis', 'toets', [P + 'q-a1', P + 'q-a2', P + 'q-a5', P + 'q-a6']);
  await maakToets(CODES.taakA,  NP + 'Taak: Strings',       'taak',  [P + 'q-a3']);

  console.log('— Resultaten: realistische antwoorden + scores (enkel AANVAARDE leerlingen) …');
  const snaps = await db.query(
    `SELECT id, bank_question_id, points FROM quiz_question_snapshots WHERE session_code = $1 ORDER BY order_index`,
    [CODES.toetsA]);
  // Belangrijk: enkel ACTIEVE leerlingen met een account nemen deel aan een toets/taak —
  // net zoals de app afdwingt (pending/geblokkeerd/gast kunnen NIET deelnemen). Pia (pending)
  // en Bo (blocked) blijven wél lid van de klas, maar krijgen bewust GEEN antwoorden, zodat
  // het overzicht klopt met de regels.
  //
  // Per vraag geven we per leerling een ANDERE, realistische oplossing (geen dummy meer),
  // met geldige timestamps, run-history en — voor keuzevragen — echte selected_choices +
  // auto-score. Twee leerlingen krijgen op de for-lus-vraag een gelijkaardige oplossing,
  // zodat de gelijkenis-detectie iets te tonen heeft.

  // Vaste basistijd (recent, in het verleden) zodat alle timestamps geldig en oplopend zijn.
  const T0 = now() - 45 * 60 * 1000; // 45 min geleden
  const tOff = (min) => T0 + min * 60 * 1000;

  // Realistische antwoorden per BANK-vraag-id. Voor keuzevragen: { choiceText } → we zoeken
  // de bijhorende choice-id op in de snapshot. Voor codevragen: { code, runs }.
  const OPL = {
    // som(a, b)
    [P + 'q-a1']: {
      [P + 'st-a1']: { code: 'def som(a, b):\n    return a + b\n\nprint(som(3, 4))', runs: 2 },
      [P + 'st-a5']: { code: 'def som(a, b):\n    resultaat = a + b\n    return resultaat', runs: 3 },
    },
    // for-lus 1 t/m 10 (bewust gelijkaardig → gelijkenis-demo)
    [P + 'q-a2']: {
      [P + 'st-a1']: { code: 'for i in range(1, 11):\n    print(i)', runs: 2 },
      [P + 'st-a5']: { code: 'for getal in range(1, 11):\n    print(getal)', runs: 1 },
    },
    // single choice: "Wat print print(2 ** 3)?" — correct = "8"
    [P + 'q-a5']: {
      [P + 'st-a1']: { choiceText: '8' }, // correct
      [P + 'st-a5']: { choiceText: '6' }, // fout (demo van een foute keuze)
    },
    // Sprint 51j: samengestelde vraag (x/y-onderdelen + code-onderdeel).
    // Correcte uitwerking: x loopt 3→2→1→0, y wordt 3+2+1=6.
    [P + 'q-a6']: {
      [P + 'st-a1']: { parts: { x: '0', y: '6', code: 'x = 3\ny = 0\nfor i in range(1, 4):\n    y += x\n    x -= 1\nprint(x, y)' } },
      [P + 'st-a5']: { parts: { x: '0', y: '5', code: 'x = 3\ny = 0\nfor i in range(3):\n    y += x' } }, // y fout
    },
  };

  // [id, naam, ingediend?, scoortMee? (leerkracht heeft codevragen al verbeterd)]
  const deelnemers = [
    [P + 'st-a1', NP + 'Sten Testers', true,  true],   // ingediend + volledig verbeterd
    [P + 'st-a5', NP + 'Nina Actief',  true,  false],  // ingediend, codevragen nog NIET verbeterd
  ];

  for (const [sid, snaam, ingediend, verbeterd] of deelnemers) {
    let pos = 0;
    for (const snap of snaps.rows) {
      const bankId = snap.bank_question_id;
      const opl = (OPL[bankId] || {})[sid] || {};
      // Keuzevraag? Zoek de gekozen choice-id in de snapshot en bepaal de auto-score.
      let code = '', selectedChoices = '[]', score = null, autoScored = false, runCount = 0;
      let partAnswers = '{}', partScores = '{}';
      const snapMeta = await db.query(
        `SELECT question_type, choices_json, answer_parts FROM quiz_question_snapshots WHERE id = $1`, [snap.id]);
      const qType = snapMeta.rows[0]?.question_type || 'code';
      if (qType === 'single' || qType === 'multiple') {
        const choices = JSON.parse(snapMeta.rows[0]?.choices_json || '[]');
        const gekozen = choices.find(c => c.text === opl.choiceText);
        if (gekozen) {
          selectedChoices = JSON.stringify([gekozen.id]);
          // Auto-score bij inleveren: correct → volle punten, anders 0.
          score = gekozen.correct ? snap.points : 0;
          autoScored = true;
        }
      } else if (qType === 'composite') {
        // Sprint 51j: onderdelen op volgorde — open-onderdelen krijgen x, y (in die volgorde),
        // het code-onderdeel krijgt 'code'. Enkel bij een reeds verbeterde inzending (Sten)
        // vullen we ook part_scores; bij Nina blijft die leeg (nog te verbeteren, net als code).
        const parts = JSON.parse(snapMeta.rows[0]?.answer_parts || '[]');
        const openParts = parts.filter(p => p.type === 'open');
        const codePart = parts.find(p => p.type === 'code');
        const antwoorden = {}, scores = {};
        if (opl.parts) {
          if (openParts[0]) { antwoorden[openParts[0].id] = opl.parts.x; if (verbeterd) scores[openParts[0].id] = opl.parts.x === '0' ? openParts[0].points : 0; }
          if (openParts[1]) { antwoorden[openParts[1].id] = opl.parts.y; if (verbeterd) scores[openParts[1].id] = opl.parts.y === '6' ? openParts[1].points : 0; }
          if (codePart) { antwoorden[codePart.id] = opl.parts.code; code = opl.parts.code; runCount = 2; if (verbeterd) scores[codePart.id] = codePart.points; }
        }
        partAnswers = JSON.stringify(antwoorden);
        partScores = JSON.stringify(scores);
        score = verbeterd && Object.keys(scores).length ? Object.values(scores).reduce((s, v) => s + (v || 0), 0) : null;
      } else {
        code = opl.code || '';
        runCount = opl.runs || 0;
        // Codevragen: enkel een score als de leerkracht al verbeterd heeft.
        score = verbeterd ? snap.points : null;
      }

      const firstVisit = tOff(pos * 3);        // per vraag ~3 min later begonnen
      const firstRun   = code ? tOff(pos * 3 + 1) : null;
      const saved      = tOff(pos * 3 + 2);
      const submitted  = ingediend ? tOff(snaps.rows.length * 3 + 2) : null;

      await db.query(
        `INSERT INTO quiz_student_order (session_code, student_id, question_id, personal_pos)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [CODES.toetsA, sid, snap.id, pos]);
      await db.query(
        `INSERT INTO quiz_answers (id, session_code, student_id, student_name, student_class,
           question_id, personal_order, code, run_count, first_visit_at, first_run_at,
           saved_at, submitted_at, score, teacher_comment, selected_choices, auto_scored,
           submitted_by, part_answers, part_scores)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (session_code, student_id, question_id) DO NOTHING`,
        [P + 'ans-' + sid.slice(-4) + '-' + pos, CODES.toetsA, sid, snaam, NP + 'Klas 5A',
         snap.id, pos, code, runCount, firstVisit, firstRun, saved, submitted, score,
         (verbeterd && qType === 'code') ? 'Netjes opgelost.' : '',
         selectedChoices, autoScored, ingediend ? 'student' : null, partAnswers, partScores]);

      // Run-history voor codevragen (voedt de "Run history" in de verbetermodule).
      if (code && runCount > 0) {
        for (let r = 0; r < runCount; r++) {
          await db.query(
            `INSERT INTO quiz_run_history (id, session_code, student_id, question_id, code, ran_at)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
            [P + 'run-' + sid.slice(-4) + '-' + pos + '-' + r, CODES.toetsA, sid, snap.id,
             code, tOff(pos * 3 + 1) + r * 20 * 1000]);
        }
      }
      pos++;
    }
    if (ingediend && verbeterd) {
      await db.query(
        `INSERT INTO quiz_general_comments (session_code, student_id, comment, updated_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (session_code, student_id) DO NOTHING`,
        [CODES.toetsA, sid, 'Mooi werk — nette, leesbare code!', now()]);
    }
  }

  // ── Taak (Strings): één ingeleverde, realistische oplossing van Sten ──────────
  console.log('— Resultaten: realistisch antwoord op de taak …');
  const taakSnaps = await db.query(
    `SELECT id, bank_question_id, points FROM quiz_question_snapshots WHERE session_code = $1 ORDER BY order_index`,
    [CODES.taakA]);
  const taakCode = 'def keer_om(s):\n    resultaat = ""\n    for teken in s:\n        resultaat = teken + resultaat\n    return resultaat\n\nprint(keer_om("python"))';
  let tpos = 0;
  for (const snap of taakSnaps.rows) {
    await db.query(
      `INSERT INTO quiz_student_order (session_code, student_id, question_id, personal_pos)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [CODES.taakA, P + 'st-a1', snap.id, tpos]);
    await db.query(
      `INSERT INTO quiz_answers (id, session_code, student_id, student_name, student_class,
         question_id, personal_order, code, run_count, first_visit_at, first_run_at,
         saved_at, submitted_at, score, teacher_comment, selected_choices, auto_scored, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (session_code, student_id, question_id) DO NOTHING`,
      [P + 'ans-taak-a1-' + tpos, CODES.taakA, P + 'st-a1', NP + 'Sten Testers', NP + 'Klas 5A',
       snap.id, tpos, taakCode, 3, tOff(0), tOff(1), tOff(3), tOff(4),
       snap.points, 'Goede aanpak zonder [::-1].', '[]', false, 'student']);
    tpos++;
  }

  console.log('');
  console.log('✅ Testdatabase klaar. Inloggegevens (wachtwoord = gebruikersnaam):');
  console.log('   Leerkrachten:  superadmin · leerkrachtA (admin, school A) · leerkrachtA2 · leerkrachtB (admin, school B)');
  console.log('   Leerlingen:    studentA@testschool.local (actief) · studentA2@… (pending, klas 5A) · studentA3@… (geblokkeerd) · studentA7@… (pending, klas 6A → test "Mijn klassen" als leerkrachtA2)');
  console.log('   Klascodes:     TDKLAS5A · TDKLAS6A · TDKLAS5B (open voor registratie)');
  console.log('   Sessies:       ' + CODES.lesA + ' (les) · ' + CODES.toetsA + ' (toets, met resultaten) · ' + CODES.taakA + ' (taak)');
}

async function wipe() {
  console.log('— Testdata verwijderen (enkel rijen met testdata-/TD-/TESTDATA-markering) …');
  const q = (sql, p) => db.query(sql, p);
  // Volgorde: afhankelijke tabellen eerst. Sessies met TD-code cascaden naar
  // assignment_bank/snapshots; quiz_answers hangt aan snapshots (CASCADE).
  await q(`DELETE FROM quiz_general_comments WHERE session_code LIKE 'TD%'`);
  await q(`DELETE FROM quiz_student_order    WHERE session_code LIKE 'TD%'`);
  await q(`DELETE FROM quiz_run_history      WHERE session_code LIKE 'TD%'`);
  await q(`DELETE FROM quiz_answers          WHERE session_code LIKE 'TD%'`);
  await q(`DELETE FROM sessions              WHERE code LIKE 'TD%' OR id LIKE $1`, [P + '%']);
  await q(`DELETE FROM template_questions    WHERE template_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM assignment_templates  WHERE id LIKE $1`, [P + '%']);
  await q(`DELETE FROM question_bank         WHERE id LIKE $1`, [P + '%']);
  await q(`DELETE FROM class_memberships     WHERE student_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM student_sessions      WHERE student_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM students              WHERE id LIKE $1`, [P + '%']);
  await q(`DELETE FROM teacher_classes       WHERE teacher_id LIKE $1 OR class_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM classes               WHERE id LIKE $1`, [P + '%']);
  await q(`DELETE FROM teacher_schools       WHERE teacher_id LIKE $1 OR school_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM teacher_sessions      WHERE teacher_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM teachers              WHERE id LIKE $1`, [P + '%']);
  await q(`DELETE FROM school_domains        WHERE school_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM audit_log             WHERE school_id LIKE $1`, [P + '%']);
  await q(`DELETE FROM schools               WHERE id LIKE $1`, [P + '%']);
  console.log('✅ Testdata verwijderd.');
}

async function status() {
  const tel = async (sql, p) => (await db.query(sql, p)).rows[0].n;
  const n = {
    scholen:  await tel(`SELECT COUNT(*)::int AS n FROM schools  WHERE id LIKE $1`, [P + '%']),
    lk:       await tel(`SELECT COUNT(*)::int AS n FROM teachers WHERE id LIKE $1`, [P + '%']),
    klassen:  await tel(`SELECT COUNT(*)::int AS n FROM classes  WHERE id LIKE $1`, [P + '%']),
    ll:       await tel(`SELECT COUNT(*)::int AS n FROM students WHERE id LIKE $1`, [P + '%']),
    vragen:   await tel(`SELECT COUNT(*)::int AS n FROM question_bank WHERE id LIKE $1`, [P + '%']),
    sessies:  await tel(`SELECT COUNT(*)::int AS n FROM sessions WHERE code LIKE 'TD%'`),
    antwoorden: await tel(`SELECT COUNT(*)::int AS n FROM quiz_answers WHERE session_code LIKE 'TD%'`),
  };
  console.log('Testdata in de databank:', JSON.stringify(n));
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'seed') await seed();
    else if (cmd === 'wipe') await wipe();
    else if (cmd === 'status') await status();
    else {
      console.log('Gebruik: node scripts/seed-testdb.js seed|wipe|status');
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('FOUT:', e.message);
    process.exit(1);
  }
})();
