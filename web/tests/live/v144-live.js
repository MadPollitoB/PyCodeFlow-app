// Live-test v144: incidenten met detail → /fraude groepeert per vraag; weg-van-toets telt één keer in het overzicht.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v144-live.js
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
  for (let i = 0; i < 2; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `v144-open${i}${tag}`, questionType: 'open', maxPoints: 2 });
    assert.strictEqual(r.status, 200); ids.push(r.data.id);
  }
  let r = await api('POST', '/api/quiz', { name: 'v144-test', type: 'toets', isTeacherPreview: true, timerSeconds: 600,
    accessUntil: Date.now() + 3600000, questions: ids.map(id => ({ id, text: 'x', points: 2 })) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  const sock = await new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    s.on('quiz_state', (st) => { clearTimeout(t); s._st = st; resolve(s); });
    s.on('connect', () => s.emit('quiz_start', { code, name: 'Fraude Leerling', className: 'Preview' }));
  });
  const sid = sock._st.studentId;
  const stuur = (type, d) => sock.emit('quiz_incident', { code, type, detail: JSON.stringify(d) });
  stuur('plakken', { q: ids[0], len: 11, tekst: 'print("hi")' }); await wacht(60);
  stuur('plakken', { q: ids[0], len: 3, tekst: 'abc' }); await wacht(60);
  stuur('kopieren', { q: ids[1], len: 4, tekst: 'abcd' }); await wacht(60);
  stuur('weg_van_toets', { q: ids[1], fase: 'weg', oorzaak: 'zoek-/startknop (Meta) ingedrukt', ev: 'blur', toetsen: ['Meta (zoek-/startknop)'] }); await wacht(60);
  stuur('weg_van_toets', { q: ids[1], fase: 'terug', secs: 75, oorzaak: 'zoek-/startknop (Meta) ingedrukt' }); await wacht(60);
  stuur('grote_invoer', { q: ids[1], delta: 140, tekst: 'x = 1' }); await wacht(300);
  sock.close();

  r = await api('GET', `/api/quiz-sessions/${code}/fraude`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const f = r.data.perLeerling[sid];
  assert.ok(f, 'leerling heeft fraude-overzicht');
  assert.strictEqual(f.risico, 'hoog');
  const plak = f.groepen.find(g => g.type === 'plakken' && g.vraag === ids[0]);
  assert.strictEqual(plak.aantal, 2, 'twee plakpogingen op vraag 1');
  assert.ok(plak.items.some(i => i.tekst.includes('print("hi")')), 'geplakte tekst bewaard');
  assert.ok(f.groepen.find(g => g.type === 'kopieren' && g.vraag === ids[1]));
  assert.ok(f.groepen.find(g => g.type === 'weg_van_toets').items.some(i => /Meta/.test(i.tekst)));
  assert.ok(f.groepen.find(g => g.type === 'grote_invoer'));
  console.log('v144-live OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
