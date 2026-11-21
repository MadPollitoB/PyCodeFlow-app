// Live-test v145: interval per toets (opslaan/bewerken/dupliceren), live-kaartjes en schermbeelden via sockets.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v145-live.js
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
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
(async () => {
  await db.init();
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `v145-open${i}${tag}`, questionType: 'open', maxPoints: 2 });
    assert.strictEqual(r.status, 200); ids.push(r.data.id);
  }
  const maak = async (extra) => {
    const r = await api('POST', '/api/quiz', Object.assign({ name: 'v145-test', type: 'toets', isTeacherPreview: true, timerSeconds: 600,
      accessUntil: Date.now() + 3600000, questions: ids.map(id => ({ id, text: 'x', points: 2 })) }, extra));
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); return r.data.code;
  };
  // 1. interval opslaan / standaard / normaliseren / bewerken / dupliceren
  const c1 = await maak({ liveScreenshotSec: 12 });
  const c2 = await maak({});
  const c3 = await maak({ liveScreenshotSec: 0 });
  const c4 = await maak({ liveScreenshotSec: 2 });
  const sec = async (c) => (await api('GET', `/api/quiz/${c}/edit`)).data.meta.liveScreenshotSec;
  assert.strictEqual(await sec(c1), 12);
  assert.strictEqual(await sec(c2), 30, 'standaard 30');
  assert.strictEqual(await sec(c3), 0, '0 = uit');
  assert.strictEqual(await sec(c4), 5, 'minimum 5');
  // bewerken kan niet bij een preview: maak een gewone toets (nog zonder activiteit)
  const rn = await api('POST', '/api/quiz', { name: 'v145-bewerk', type: 'toets', isTeacherPreview: false, timerSeconds: 600, liveScreenshotSec: 20,
    accessUntil: Date.now() + 3600000, questions: ids.map(id => ({ id, text: 'x', points: 2 })) });
  assert.strictEqual(rn.status, 200, JSON.stringify(rn.data));
  const cn = rn.data.code;
  assert.strictEqual(await sec(cn), 20);
  const upd = await api('PUT', `/api/quiz/${cn}`, { name: 'v145-test', type: 'toets', timerSeconds: 600, accessUntil: Date.now() + 3600000, liveScreenshotSec: 45, questions: ids.map(id => ({ id, text: 'x', points: 2 })) });
  assert.strictEqual(upd.status, 200, JSON.stringify(upd.data));
  assert.strictEqual(await sec(cn), 45, 'bewerkt');
  const dup = await api('POST', `/api/quiz/${c1}/duplicate`, {});
  assert.strictEqual(dup.status, 200, JSON.stringify(dup.data));
  assert.strictEqual(await sec(dup.data.code), 12, 'dupliceren neemt het interval mee');

  // 2. live: leerling + leerkracht-observer
  const code = c1;
  const stud = await new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('timeout leerling')), 15000);
    s.on('quiz_state', (st) => { clearTimeout(t); s._st = st; resolve(s); });
    s.on('connect', () => s.emit('quiz_start', { code, name: 'Live Leerling', className: 'Preview' }));
  });
  const events = [];
  stud.on('quiz_screenshot_aan', (d) => events.push(['aan', d.intervalSec]));
  stud.on('quiz_screenshot_uit', () => events.push(['uit']));
  stud.emit('quiz_save_answer', { questionId: stud._st.questions[0].id, code: 'print("hallo wereld")', runCount: 0, currentQuestion: 0 }, () => {});
  await wacht(400);

  const leraar = io(BASE, { transports: ['websocket'] });
  const kaarten = []; const beelden = [];
  leraar.on('quiz_live_data', (d) => kaarten.push(d));
  leraar.on('quiz_screenshot_update', (d) => beelden.push(d));
  await new Promise(r => leraar.on('connect', r));
  // zonder observer wordt een beeld genegeerd
  stud.emit('quiz_screenshot', { img: JPEG }); await wacht(200);
  assert.strictEqual(beelden.length, 0, 'zonder observer geen beeld');
  leraar.emit('teacher_grid_observe', { code });
  await wacht(800);
  assert.ok(kaarten.length >= 1, 'quiz_live_data ontvangen (teacher-socket geautoriseerd?)');
  const k = kaarten[kaarten.length - 1];
  assert.strictEqual(k.intervalSec, 12);
  assert.strictEqual(k.kaarten.length, 1);
  assert.strictEqual(k.kaarten[0].name, 'Live Leerling');
  assert.strictEqual(k.kaarten[0].vraag, 1);
  assert.strictEqual(k.kaarten[0].totaal, 2);
  assert.ok(/hallo wereld/.test(k.kaarten[0].snippet), 'begin van het antwoord');
  assert.ok(k.kaarten[0].resterendSec > 0 && k.kaarten[0].resterendSec <= 600, 'resterende tijd');
  assert.ok(k.kaarten[0].laatsteActiviteit > 0);
  assert.ok(events.some(e => e[0] === 'aan' && e[1] === 12), 'leerling kreeg aan-signaal met interval');
  // geldig beeld doorsturen; ongeldig (png) en te snel opeenvolgend negeren
  stud.emit('quiz_screenshot', { img: 'data:image/png;base64,AAAA' }); await wacht(150);
  assert.strictEqual(beelden.length, 0, 'png geweigerd');
  stud.emit('quiz_screenshot', { img: JPEG }); await wacht(300);
  assert.strictEqual(beelden.length, 1, 'jpeg doorgestuurd');
  stud.emit('quiz_screenshot', { img: JPEG }); await wacht(300);
  assert.strictEqual(beelden.length, 1, 'binnen 2 s genegeerd');
  // tweede leraar-observer krijgt het bewaarde beeld meteen
  const leraar2 = io(BASE, { transports: ['websocket'] });
  const b2 = []; leraar2.on('quiz_screenshot_update', (d) => b2.push(d));
  await new Promise(r => leraar2.on('connect', r));
  leraar2.emit('teacher_grid_observe', { code }); await wacht(600);
  assert.strictEqual(b2.length, 1, 'bewaard beeld voor een nieuwe observer');
  // stoppen: eerste observer weg, tweede blijft → geen uit; dan ook de tweede weg → uit + beeld gewist
  leraar.emit('teacher_grid_stop', { code }); await wacht(300);
  assert.ok(!events.some(e => e[0] === 'uit'), 'nog een observer → geen stop');
  leraar2.emit('teacher_grid_stop', { code }); await wacht(400);
  assert.ok(events.some(e => e[0] === 'uit'), 'laatste observer weg → leerling stopt');
  const sessie = (await new Promise(r => { const l3 = io(BASE, { transports: ['websocket'] }); l3.on('connect', () => { l3.on('quiz_screenshot_update', () => r('beeld')); l3.emit('teacher_grid_observe', { code }); setTimeout(() => r('geen'), 800); }); }));
  assert.strictEqual(sessie, 'geen', 'oude beelden zijn gewist');

  // 3. interval 0 → geen aan-signaal
  const stud0 = await new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    const ev0 = []; s._ev = ev0; s.on('quiz_screenshot_aan', () => ev0.push('aan'));
    s.on('quiz_state', () => { clearTimeout(t); resolve(s); });
    s.on('connect', () => s.emit('quiz_start', { code: c3, name: 'Geen Beeld', className: 'Preview' }));
  });
  const l0 = io(BASE, { transports: ['websocket'] }); const d0 = [];
  l0.on('quiz_live_data', (d) => d0.push(d));
  await new Promise(r => l0.on('connect', r)); l0.emit('teacher_grid_observe', { code: c3 }); await wacht(700);
  assert.strictEqual(d0[0].intervalSec, 0);
  assert.strictEqual(stud0._ev.length, 0, 'interval 0 → geen beeldverzoek');
  console.log('v145-live OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
