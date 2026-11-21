// Live-test v150: bulk-heropenen geeft echte werktijd; startinfo kent heropende leerlingen.
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
  const ch = [{ id: 'a', text: 'fout', correct: false }, { id: 'b', text: 'juist', correct: true }];
  const q = await api('POST', '/api/quiz/bank', { text: 'v150-q' + tag, questionType: 'single', maxPoints: 2, choices: ch });
  assert.strictEqual(q.status, 200);
  const c = await api('POST', '/api/quiz', { name: 'v150-test', type: 'toets', isTeacherPreview: true, timerSeconds: 600, questions: [{ id: q.data.id, text: 'x', points: 2 }] });
  assert.strictEqual(c.status, 200, JSON.stringify(c.data)); const code = c.data.code;
  const s = await new Promise((res, rej) => { const k = io(BASE, { transports: ['websocket'] }); const t = setTimeout(() => rej(new Error('timeout')), 15000);
    k.on('quiz_state', (st) => { clearTimeout(t); k._st = st; res(k); }); k.on('connect', () => k.emit('quiz_start', { code, name: 'Bulk Bart', className: 'T' })); });
  const id = s._st.studentId; await wacht(300);
  await api('POST', `/api/quiz/${code}/stop`, {}); await wacht(1500);
  // gestopt: zonder heropening is hij 'stopped'
  let r = await api('GET', `/api/quiz/${code}/startinfo?name=${encodeURIComponent('Bulk Bart')}`);
  assert.strictEqual(r.data.stopped, true); assert.strictEqual(r.data.heropendTot, null);
  const until = Date.now() + 60 * 60000;
  r = await api('POST', `/api/quiz-sessions/${code}/reopen-bulk`, { until, students: [{ id, name: 'Bulk Bart' }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const extra = await db.getIndividualExtraSeconds(code, id, 'Bulk Bart');
  // eigen eind = start + 600 s; tot 'until' = ± 60 min → ± 50 min extra (en zeker NIET 0)
  assert.ok(extra > 45 * 60 && extra < 60 * 60, 'extra seconden: ' + extra);
  const tot = await db.getIndividualAccessUntil(code, id, 'Bulk Bart');
  assert.ok(tot >= until - 2000, 'toegang tot minstens until');
  // startinfo voor de heropende leerling: niet meer 'stopped' (knop kan vrijkomen), met heropendTot
  r = await api('GET', `/api/quiz/${code}/startinfo?name=${encodeURIComponent('Bulk Bart')}`);
  assert.strictEqual(r.data.stopped, false); assert.ok(r.data.heropendTot >= until - 2000);
  // een andere naam blijft 'stopped'
  r = await api('GET', `/api/quiz/${code}/startinfo?name=Iemand%20Anders`);
  assert.strictEqual(r.data.stopped, true);
  s.close(); console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error('LIVE FAIL', e); process.exit(1); });
