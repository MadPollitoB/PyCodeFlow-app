// Live-test v146: timerregel (duur + deadline) en deadline verschuiven tijdens de toets.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v146-live.js
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
  for (let i = 0; i < 2; i++) ids.push((await api('POST', '/api/quiz/bank', { text: `v146-open${i}${tag}`, questionType: 'open', maxPoints: 2 })).data.id);
  const maak = async (extra) => {
    const r = await api('POST', '/api/quiz', Object.assign({ name: 'v146-test', type: 'toets', isTeacherPreview: true,
      questions: ids.map(id => ({ id, text: 'x', points: 2 })) }, extra));
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); return r.data.code;
  };
  const start = (code, naam) => new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('timeout ' + naam)), 15000);
    s.ev = [];
    s.on('quiz_tijd_wijziging', (d) => s.ev.push(d));
    s.on('quiz_timer_update', (d) => { s.laatsteTimer = d; });
    s.on('quiz_state', (st) => { clearTimeout(t); s._st = st; resolve(s); });
    s.on('connect', () => s.emit('quiz_start', { code, name: naam, className: 'Test' }));
  });
  const nu = Date.now();

  // 1. duur 60 min, deadline over 40 min → teller 40 min (kortste)
  const c1 = await maak({ timerSeconds: 3600, accessUntil: nu + 40 * 60000 });
  const s1 = await start(c1, 'Laat Lies');
  assert.ok(Math.abs(s1._st.timerSeconds - 2400) <= 5, 'kortste = deadline: ' + s1._st.timerSeconds);
  assert.strictEqual(s1._st.noTimer, false);
  assert.strictEqual(s1._st.timerModus, 'beide');
  await wacht(1500);
  assert.ok(s1.laatsteTimer && s1.laatsteTimer.remaining <= 2400 && s1.laatsteTimer.remaining >= 2390, 'server-teller 40 min: ' + (s1.laatsteTimer && s1.laatsteTimer.remaining));

  // 2. deadline 20 min later → teller springt live naar 60 min (duur is nu kortst... 60 min vs 60 min deadline = ~60)
  const nieuw = nu + 90 * 60000;
  const put = await api('PUT', `/api/quiz/${c1}/deadline`, { accessUntil: nieuw });
  assert.strictEqual(put.status, 200, JSON.stringify(put.data));
  await wacht(1500);
  assert.ok(s1.ev.length >= 1, 'leerling kreeg quiz_tijd_wijziging');
  assert.ok(Math.abs(s1.ev[0].timerSeconds - 3600) <= 5, 'nu de duur: ' + s1.ev[0].timerSeconds);
  assert.ok(s1.laatsteTimer.remaining > 3500, 'teller bijgewerkt: ' + s1.laatsteTimer.remaining);
  // vervroegen: 10 min vanaf nu → iedereen 10 min
  const put2 = await api('PUT', `/api/quiz/${c1}/deadline`, { accessUntil: Date.now() + 10 * 60000 + 2000 });
  assert.strictEqual(put2.status, 200, JSON.stringify(put2.data));
  await wacht(1500);
  assert.ok(s1.laatsteTimer.remaining <= 605 && s1.laatsteTimer.remaining >= 590, 'vervroegd: ' + s1.laatsteTimer.remaining);

  // 3. alleen een deadline → geen teller, wel indienOp
  const dl = nu + 3 * 3600000;
  const c2 = await maak({ noTimer: true, accessUntil: dl });
  const s2 = await start(c2, 'Enkel Deadline');
  assert.strictEqual(s2._st.noTimer, true);
  assert.strictEqual(s2._st.timerModus, 'deadline');
  assert.ok(Math.abs(s2._st.indienOp - dl) < 1000, 'indienOp = deadline');
  const live2 = await new Promise((res) => { const l = io(BASE, { transports: ['websocket'] }); l.on('quiz_live_data', (d) => res(d)); l.on('connect', () => l.emit('teacher_grid_observe', { code: c2 })); setTimeout(() => res(null), 3000); });
  if (live2) assert.ok(live2.kaarten[0].indienOp, 'live-kaartje toont indientijd'), assert.strictEqual(live2.kaarten[0].resterendSec, null);

  // 4. geen duur en geen deadline → geen teller, geen indienOp
  const c3 = await maak({ noTimer: true });
  const s3 = await start(c3, 'Niets');
  assert.strictEqual(s3._st.noTimer, true); assert.strictEqual(s3._st.timerModus, 'geen'); assert.strictEqual(s3._st.indienOp, null);

  // 5. alleen duur → start + duur
  const c4 = await maak({ timerSeconds: 1800 });
  const s4 = await start(c4, 'Enkel Duur');
  assert.ok(Math.abs(s4._st.timerSeconds - 1800) <= 2); assert.strictEqual(s4._st.timerModus, 'duur');

  // 6. monitoring blijft de volledige lijst geven en kent de echte status
  const mon = await api('GET', '/api/monitoring');
  if (mon.status === 200 && mon.data.sessions) {
    const rij = mon.data.sessions.find(x => x.code === c3);
    assert.ok(rij && rij.status && typeof rij.lopend === 'boolean', 'status op monitoring-rij');
  }
  console.log('v146-live OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
