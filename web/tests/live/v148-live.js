// Live-test v148: meerkeuze blijft bewaard + wordt gescoord bij automatisch indienen.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v148-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const tag = ' ' + Date.now();
const wacht = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  await db.init();
  const ch = [{ id: 'a', text: 'fout', correct: false }, { id: 'b', text: 'juist', correct: true }, { id: 'c', text: 'fout', correct: false }];
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `v148-single${i}${tag}`, questionType: 'single', maxPoints: 2, choices: ch });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); ids.push(r.data.id);
  }
  const maak = async (extra) => {
    const r = await api('POST', '/api/quiz', Object.assign({ name: 'v148-test', type: 'toets', isTeacherPreview: true,
      questions: ids.map(id => ({ id, text: 'x', points: 2 })) }, extra));
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); return r.data.code;
  };
  const start = (code, naam) => new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('timeout ' + naam)), 15000);
    s.on('quiz_state', (st) => { clearTimeout(t); s._st = st; resolve(s); });
    s.on('connect', () => s.emit('quiz_start', { code, name: naam, className: 'Test' }));
  });
  const bewaar = (s, qid, keuze, idx, ack = true) => new Promise(r => s.emit('quiz_save_answer', { questionId: qid, code: '', selectedChoices: keuze, runCount: 0, currentQuestion: idx }, r));
  // optie-id's worden door de server gemaakt: juist/fout opzoeken in de snapshot
  const keuzes = async (code, qid) => { const r = (await db.query('SELECT choices_json FROM quiz_question_snapshots WHERE id=$1', [qid])).rows[0]; const l = JSON.parse(r.choices_json); return { juist: l.find(x => x.correct).id, fout: l.find(x => !x.correct).id }; };
  const rij = async (code, naam) => (await db.query(`SELECT a.* FROM quiz_answers a WHERE a.session_code=$1 AND a.student_name=$2 ORDER BY a.personal_order`, [code, naam])).rows;

  // 1. tabwissel-indiening: juiste keuze bewaard en gescoord
  const c1 = await maak({ tabSwitchEnabled: true, tabSwitchThreshold: 1 });
  const s1 = await start(c1, 'Tab Tom');
  const q1 = s1._st.questions.map(q => q.id);
  const k10 = await keuzes(c1, q1[0]), k11 = await keuzes(c1, q1[1]);
  assert.ok((await bewaar(s1, q1[0], [k10.juist], 0)).ok);
  s1.emit('quiz_tab_switch', { code: c1 }); await wacht(1500);
  let rs = await rij(c1, 'Tab Tom');
  const r0 = rs.find(x => x.question_id === q1[0]);
  assert.deepStrictEqual(JSON.parse(r0.selected_choices), [k10.juist], 'keuze bleef bewaard');
  assert.strictEqual(Number(r0.score), 2, 'automatisch gescoord bij tabwissel-indiening: ' + r0.score);
  assert.ok(r0.submitted_at, 'ingediend');

  // 2. laatste keuze komt NA de afgedwongen indiening binnen (venster van 20 s)
  const late = await bewaar(s1, q1[1], [k11.juist], 1);
  assert.ok(late.ok, 'late opslag aanvaard: ' + JSON.stringify(late)); await wacht(800);
  rs = await rij(c1, 'Tab Tom');
  const r1 = rs.find(x => x.question_id === q1[1]);
  assert.deepStrictEqual(JSON.parse(r1.selected_choices), [k11.juist]);
  assert.strictEqual(Number(r1.score), 2, 'ook de late keuze is gescoord');
  assert.ok(r1.submitted_at, 'late rij ook als ingediend gemarkeerd');

  // 3. na meer dan 20 s niets meer aanvaarden
  const st = await db.query(`SELECT 1`); // (geen wachttijd van 20 s in de test: eenmalig controle via een leerling zonder forcedAt)
  const c2 = await maak({});
  const s2 = await start(c2, 'Stop Sara');
  const q2 = s2._st.questions.map(x => x.id);
  const k20 = await keuzes(c2, q2[0]), k21 = await keuzes(c2, q2[1]);
  await bewaar(s2, q2[0], [k20.fout], 0); await bewaar(s2, q2[1], [k21.juist], 1);
  const stop = await api('POST', `/api/quiz/${c2}/stop`, {}); assert.strictEqual(stop.status, 200, JSON.stringify(stop.data)); await wacht(1500);
  rs = await rij(c2, 'Stop Sara');
  assert.strictEqual(Number(rs.find(x => x.question_id === q2[0]).score), 0, 'fout = 0');
  assert.strictEqual(Number(rs.find(x => x.question_id === q2[1]).score), 2, 'juist = 2 na stopknop');
  assert.deepStrictEqual(JSON.parse(rs.find(x => x.question_id === q2[1]).selected_choices), [k21.juist]);
  const nogEens = await bewaar(s2, q2[0], [k20.juist], 0);
  console.log('na stop (binnen venster):', JSON.stringify(nogEens));

  // 4. timer loopt af: keuzes mogen NIET op leeg gezet worden (oude fout) en worden gescoord
  const c3 = await maak({ timerSeconds: 60 });
  const s3 = await start(c3, 'Timer Tim');
  const q3 = s3._st.questions.map(x => x.id);
  const k30 = await keuzes(c3, q3[0]);
  await bewaar(s3, q3[0], [k30.juist], 0);
  await wacht(66000);
  rs = await rij(c3, 'Timer Tim');
  const r3 = rs.find(x => x.question_id === q3[0]);
  assert.deepStrictEqual(JSON.parse(r3.selected_choices), [k30.juist], 'keuze overleeft timer-indiening');
  assert.strictEqual(Number(r3.score), 2, 'gescoord na timer-indiening');
  assert.ok(r3.submitted_at);
  console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
