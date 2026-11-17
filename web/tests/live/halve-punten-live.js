// Live-test v133: halve punten + meerkeuze 'gedeeld'/'klassiek' (opslag, instelling, nakijken, dupliceren, migratie).
// Vereist een draaiende server met POC_BASIC_AUTH_ENABLED=false:
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/halve-punten-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const mc = (txt) => ({ text: txt + ' ' + Date.now(), questionType: 'multiple', maxPoints: 2, choices: [
  { text: 'A', correct: true }, { text: 'B', correct: true }, { text: 'C', correct: false }, { text: 'D', correct: true }] });
(async () => {
  await db.init();
  // 1. halve punten in de vragenbank (via API) en ongeldige punten
  let r = await api('POST', '/api/quiz/bank', { ...mc('hp-mc'), maxPoints: '1,5' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const idMc = r.data.id;
  const bankRij = (await db.query(`SELECT max_points FROM question_bank WHERE id = $1`, [idMc])).rows[0];
  assert.strictEqual(typeof bankRij.max_points, 'number', 'NUMERIC moet als getal terugkomen');
  assert.strictEqual(bankRij.max_points, 1.5);
  r = await api('POST', '/api/quiz/bank', { ...mc('hp-mc2'), maxPoints: 2 });
  const idMc2 = r.data.id;
  r = await api('POST', '/api/quiz/bank', { text: 'hp-open ' + Date.now(), questionType: 'open', maxPoints: 3 });
  const idOpen = r.data.id;
  // 2. toets aanmaken: standaard 'gedeeld'; expliciet 'klassiek' blijft klassiek
  const basis = { name: 'hp-test', type: 'toets', isTeacherPreview: true, randomize: false, noTimer: false, timerSeconds: 1800,
    questions: [{ id: idMc, text: 'hp-mc', points: 1.5 }, { id: idMc2, text: 'hp-mc2', points: 2 }, { id: idOpen, text: 'hp-open', points: 0.5 }] };
  r = await api('POST', '/api/quiz', basis);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  assert.strictEqual((await db.getQuizMeta(code)).mc_scoring, 'gedeeld');
  r = await api('POST', '/api/quiz', { ...basis, name: 'hp-klassiek', mcScoring: 'klassiek' });
  const codeKl = r.data.code;
  assert.strictEqual((await db.getQuizMeta(codeKl)).mc_scoring, 'klassiek');
  // snapshots bewaren halve punten
  const snaps = await db.getQuizQuestions(code);
  assert.deepStrictEqual(snaps.map(s => s.points), [1.5, 2, 0.5]);
  // 3. edit-GET geeft de instelling terug, dupliceren neemt hem mee
  r = await api('GET', `/api/quiz/${code}/edit`);
  assert.strictEqual(r.data.meta.mcScoring, 'gedeeld');
  r = await api('POST', `/api/quiz/${codeKl}/duplicate`, { name: 'hp-kopie' });
  assert.ok(r.data.ok, JSON.stringify(r.data));
  assert.strictEqual((await db.getQuizMeta(r.data.code)).mc_scoring, 'klassiek');
  // 4. leerling dient in: auto-score per modus
  async function leerlingDient(sessieCode, keuzesPerVraag) {
    return await new Promise((resolve, reject) => {
      const sock = io(BASE, { transports: ['websocket'] });
      const t = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, 15000);
      sock.on('error_message', (m) => { clearTimeout(t); sock.close(); reject(new Error('error_message: ' + JSON.stringify(m))); });
      sock.on('quiz_state', async (st) => {
        try {
          const dbQs = await db.getQuizQuestions(sessieCode);
          const answers = {};
          dbQs.forEach((q) => {
            if (q.question_type !== 'multiple') return;
            const sel = keuzesPerVraag[q.text_snapshot.startsWith('hp-mc2') ? 1 : 0];
            const ch = JSON.parse(q.choices_json);
            answers[q.id] = { code: '', selectedChoices: sel.map(i => ch[i].id) };
          });
          sock.on('quiz_submitted', () => { clearTimeout(t); sock.close(); resolve(st); });
          sock.emit('quiz_submit_all', { answers });
          setTimeout(() => { clearTimeout(t); sock.close(); resolve(st); }, 3000);
        } catch (e) { reject(e); }
      });
      sock.on('connect', () => sock.emit('quiz_start', { code: sessieCode, name: 'HP Leerling', className: 'Preview' }));
    });
  }
  // A,B gekozen (D gemist): gedeeld, 1,5 p -> 1,5 × (1 − 1,5/3) = 0,75 -> 1 ; klassiek: round(2/3 × 1,5)=1
  // A,B,C (fout): gedeeld 0 ; klassiek 0
  const st = await leerlingDient(code, [[0, 1], [0, 1, 2]]);
  const antw = await db.getQuizAnswers(code);
  const perVraag = Object.fromEntries(antw.map(a => [a.question_id, a.score]));
  const sn = await db.getQuizQuestions(code);
  assert.strictEqual(perVraag[sn[0].id], 1, 'gedeeld, 1 gemist, 1,5 p → 1');
  assert.strictEqual(perVraag[sn[1].id], 0, 'gedeeld, 1 fout → 0');
  // 5. nakijken met halve punten: open vraag 0,5 en 2,5 via de score-eindpunten
  const open = sn[2].id;
  const studentId = antw[0].student_id;
  r = await api('PUT', `/api/quiz/${code}/students/${studentId}/questions/${open}/score`, { score: '0,5', teacherComment: 'ok' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  r = await api('PUT', `/api/quiz/${code}/students/${studentId}/questions/${open}/score`, { score: 1.3 });
  assert.strictEqual(r.status, 400, 'geen veelvoud van 0,5 → 400');
  r = await api('PUT', `/api/quiz/${code}/students/${studentId}/questions/${open}/score`, { score: 'abc' });
  assert.strictEqual(r.status, 400);
  const na = await db.getQuizAnswers(code);
  const openAnt = na.find(a => a.question_id === open);
  assert.strictEqual(openAnt.score, 0.5, 'halve score bewaard (en niet stil naar 0 of 1 afgerond)');
  // totaal = 1 + 0 + 0,5 en som in SQL blijft numeriek
  const som = (await db.query(`SELECT SUM(score) AS s FROM quiz_answers WHERE session_code = $1 AND student_id = $2`, [code, studentId])).rows[0].s;
  assert.strictEqual(som, 1.5);
  // 6. onderdeel-scores van een samengestelde vraag in halve punten
  const comp = await api('POST', '/api/quiz/bank', { text: 'hp-comp ' + Date.now(), questionType: 'composite', maxPoints: 1,
    answerParts: [{ type: 'open', label: 'a', points: 0.5, modelAnswer: '' }, { type: 'open', label: 'b', points: 1.5, modelAnswer: '' }] });
  assert.strictEqual(comp.status, 200, JSON.stringify(comp.data));
  const cb = (await db.query(`SELECT max_points, answer_parts FROM question_bank WHERE id = $1`, [comp.data.id])).rows[0];
  assert.strictEqual(cb.max_points, 2, 'som van 0,5 + 1,5');
  assert.deepStrictEqual(JSON.parse(cb.answer_parts).map(p => p.points), [0.5, 1.5]);
  // 7. migratie van een INTEGER-kolom: terugzetten en init() opnieuw laten lopen
  await db.query(`ALTER TABLE quiz_answers ALTER COLUMN score TYPE INTEGER USING ROUND(score)`);
  await db.init();
  const dt = (await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name='quiz_answers' AND column_name='score'`)).rows[0].data_type;
  assert.strictEqual(dt, 'numeric');
  console.log('HALVE-PUNTEN LIVE OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
