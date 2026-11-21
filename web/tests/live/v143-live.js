// Live-test v143: toegang herstellen (eigen eindtijd), bevestigde vragen + hervatten, deadline aanpassen.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v143-live.js
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
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `v143-open${i}${tag}`, questionType: 'open', maxPoints: 2 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); ids.push(r.data.id);
  }
  const deadline = Date.now() + 2 * 3600 * 1000;
  let r = await api('POST', '/api/quiz', { name: 'v143-test', type: 'toets', isTeacherPreview: true, noBack: true, timerSeconds: 600,
    accessUntil: deadline, tabSwitchEnabled: true, tabSwitchThreshold: 1, tabSwitchGraceSeconds: 0,
    questions: ids.map(id => ({ id, text: 'x', points: 2 })) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  const naam = 'Herstel Leerling';

  const start = () => new Promise((resolve, reject) => {
    const sock = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, 15000);
    sock.on('error_message', (m) => { clearTimeout(t); sock.close(); reject(new Error(JSON.stringify(m))); });
    sock.on('quiz_state', (st) => { clearTimeout(t); resolve({ sock, st }); });
    sock.on('connect', () => sock.emit('quiz_start', { code, name: naam, className: 'Preview' }));
  });
  const bewaar = (sock, questionId, code, idx, bevestigd) => new Promise((resolve) => {
    sock.emit('quiz_save_answer', { questionId, code, runCount: 0, currentQuestion: idx, bevestigd: bevestigd || undefined }, (a) => resolve(a));
  });

  let { sock, st } = await start();
  const vragen = st.questions.map(q => q.id);
  assert.strictEqual(vragen.length, 4);
  // vraag 1 (met antwoord) en 2 (LEEG) bewust bevestigd, daarna op vraag 3 een half antwoord
  assert.ok((await bewaar(sock, vragen[0], 'antwoord een', 1, true)).ok);
  assert.ok((await bewaar(sock, vragen[1], '', 2, true)).ok);
  assert.ok((await bewaar(sock, vragen[2], 'half', 2, false)).ok);
  const startTijd = st.startedAt;
  // tabwissel → automatisch ingediend (drempel 1)
  const ingediend = new Promise(res => sock.on('quiz_force_submit', res));
  sock.emit('quiz_tab_switch', { code });
  const reden = await ingediend;
  assert.strictEqual(reden.reason, 'tab_switch');
  await wacht(400);
  let rijen = await db.getQuizAnswersByStudent(code, st.studentId);
  assert.ok(rijen.every(x => x.submitted_at != null), 'alles ingediend');
  assert.strictEqual(rijen.filter(x => x.confirmed_at != null).length, 2, '2 bewust bevestigd');
  sock.close();

  // herstel-info
  r = await api('GET', `/api/quiz-sessions/${code}/roster/${encodeURIComponent(st.studentId)}/herstel-info?name=${encodeURIComponent(naam)}`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.heeftTimer && !r.data.tijdOp);
  assert.ok(Math.abs(r.data.eigenEind - (startTijd + 600000)) < 2000, 'eigen eindtijd = start + duur');
  assert.strictEqual(r.data.bevestigd, 2);

  // herstellen zonder extra minuten: eindtijd blijft hetzelfde
  await wacht(1200);
  r = await api('POST', `/api/quiz-sessions/${code}/roster/${encodeURIComponent(st.studentId)}/herstel`, { studentName: naam });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(Math.abs(r.data.plan.eigenEind - (startTijd + 600000)) < 2000, 'eindtijd niet opgeschoven');
  rijen = await db.getQuizAnswersByStudent(code, st.studentId);
  assert.ok(rijen.every(x => x.submitted_at == null), 'ingediend-vlag weg');
  assert.strictEqual(rijen.filter(x => x.confirmed_at != null).length, 2, 'bevestigde vragen blijven bevestigd');

  // opnieuw binnen: op vraag 3 (index 2), bevestigde vragen dicht, tijd loopt door
  const again = await start();
  assert.strictEqual(again.st.currentQuestion, 2, 'verder op de eerste niet-bevestigde vraag');
  assert.deepStrictEqual(new Set(again.st.bevestigdeVragen), new Set([vragen[0], vragen[1]]));
  assert.ok(Math.abs(again.st.startedAt - startTijd) < 50, 'start is niet verschoven');
  assert.strictEqual(again.st.timerSeconds, 600);
  // tabwissel blijft gelogd
  const inc = await db.getIncidenten(code);
  assert.ok(inc.some(x => x.type === 'toegang_hersteld'), 'herstel gelogd');
  assert.ok(inc.some(x => x.type === 'tabwissel'), 'tabwissel blijft bestaan');
  again.sock.close();

  // nogmaals herstellen met 10 extra minuten (ook al is hij niet ingediend: moet gewoon werken)
  await again.sock;
  r = await api('POST', `/api/quiz-sessions/${code}/roster/${encodeURIComponent(st.studentId)}/herstel`, { studentName: naam, extraMinuten: 10 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(Math.abs(r.data.plan.eigenEind - (startTijd + 600000 + 600000)) < 2000);
  const derde = await start();
  assert.strictEqual(derde.st.timerSeconds, 1200, 'extra minuten tellen in de timer');
  derde.sock.close();

  // deadline aanpassen tijdens de toets
  r = await api('GET', `/api/quiz/${code}/deadline-info`);
  assert.strictEqual(r.status, 200);
  assert.ok(Math.abs(r.data.accessUntil - deadline) < 1000);
  const nieuw = deadline + 30 * 60000;
  r = await api('PUT', `/api/quiz/${code}/deadline`, { accessUntil: nieuw });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(Number((await db.getQuizMeta(code)).access_until), nieuw);
  r = await api('PUT', `/api/quiz/${code}/deadline`, { accessUntil: Date.now() - 1000 });
  assert.strictEqual(r.status, 400, 'verleden geweigerd');
  assert.ok((await db.getIncidenten(code)).some(x => x.type === 'deadline_aangepast'));

  console.log('v143-live OK');
  process.exit(0);
})().catch(e => { console.error('FOUT', e); process.exit(1); });
