// Live-test v149: toegang herstellen vanuit het verbeterscherm — "nog X minuten vanaf nu".
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v149-live.js
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
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `v149-q${i}${tag}`, questionType: 'single', maxPoints: 2, choices: ch });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); ids.push(r.data.id);
  }
  const maak = async (extra) => {
    const r = await api('POST', '/api/quiz', Object.assign({ name: 'v149-test', type: 'toets', isTeacherPreview: true,
      questions: ids.map(id => ({ id, text: 'x', points: 2 })) }, extra));
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); return r.data.code;
  };
  const start = (code, naam) => new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('timeout ' + naam)), 15000);
    s.on('quiz_state', (st) => { clearTimeout(t); s._st = st; resolve(s); });
    s.on('connect', () => s.emit('quiz_start', { code, name: naam, className: 'Test' }));
  });
  const herstel = (code, id, naam, body) => api('POST', `/api/quiz-sessions/${code}/roster/${encodeURIComponent(id)}/herstel`, Object.assign({ studentName: naam }, body));
  const info = (code, id, naam, q) => api('GET', `/api/quiz-sessions/${code}/roster/${encodeURIComponent(id)}/herstel-info?name=${encodeURIComponent(naam)}${q || ''}`);

  // 1. toets zonder timer en zonder deadline, gestopt, al verbeterd → "10 min vanaf nu" = EXACT 10 min (niet 15)
  const c1 = await maak({ noTimer: true });
  const s1 = await start(c1, 'Nazicht Nina'); const id1 = s1._st.studentId;
  await wacht(300);
  await api('POST', `/api/quiz/${c1}/stop`, {}); await wacht(1500);
  await db.query(`UPDATE quiz_answers SET score = 2 WHERE session_code=$1 AND student_name=$2`, [c1, 'Nazicht Nina']);
  const voor = Date.now();
  let r = await info(c1, id1, 'Nazicht Nina', '&extra=10&modus=vanafNu');
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(Math.abs(r.data.individueelTot - (voor + 10 * 60000)) < 5000, 'voorbeeld: exact 10 min, kreeg ' + (r.data.individueelTot - voor) / 60000);
  r = await herstel(c1, id1, 'Nazicht Nina', { extraMinuten: 10, extraModus: 'vanafNu', bron: 'nazicht' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(Math.abs(r.data.plan.individueelTot - (voor + 10 * 60000)) < 5000, 'exact 10 min venster');
  let rijen = (await db.query(`SELECT * FROM quiz_answers WHERE session_code=$1 AND student_name=$2`, [c1, 'Nazicht Nina'])).rows;
  assert.ok(rijen.every(x => x.submitted_at == null), 'weer open');
  assert.ok(rijen.every(x => Number(x.score) === 2), 'scores blijven staan');
  r = await api('GET', `/api/quiz-sessions/${c1}/reopen-open`);
  assert.ok((r.data.students || []).some(x => x.name === 'Nazicht Nina'), 'staat in de lijst van open heropeningen');
  const inc = await db.getIncidenten(c1);
  const h = inc.find(x => x.type === 'toegang_hersteld'); assert.ok(h, 'gelogd');
  assert.strictEqual(JSON.parse(h.detail).bron, 'verbeterscherm');
  s1.close();

  // 2. zonder keuze van minuten blijft het veiligheidsvenster van 15 min bestaan
  r = await info(c1, id1, 'Nazicht Nina');
  assert.ok(r.data.individueelTot - Date.now() > 14 * 60000, 'zonder keuze minstens 15 min');

  // 3. met timer: 15 min vanaf nu schuift zijn eindtijd op; 1 min vanaf nu verkort die NIET
  const c2 = await maak({ timerSeconds: 600 });
  const s2 = await start(c2, 'Timer Tom'); const id2 = s2._st.studentId; const t0 = s2._st.startedAt || Date.now();
  await wacht(300);
  await api('POST', `/api/quiz/${c2}/stop`, {}); await wacht(1500);
  r = await info(c2, id2, 'Timer Tom', '&extra=15&modus=vanafNu');
  assert.ok(Math.abs(r.data.eigenEind - (Date.now() + 15 * 60000)) < 6000, 'eind = nu + 15 min');
  r = await info(c2, id2, 'Timer Tom', '&extra=1&modus=vanafNu');
  assert.ok(Math.abs(r.data.eigenEind - (t0 + 600000)) < 3000, 'eigen eindtijd blijft behouden als die later valt');
  s2.close();
  console.log('LIVE OK');
  process.exit(0);
})().catch(e => { console.error('LIVE FAIL', e); process.exit(1); });
