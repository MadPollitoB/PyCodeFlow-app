// Live-test v124 (sessieblad): server op PORT 3001 met POC_BASIC_AUTH_ENABLED=false en DATABASE_URL naar een sandbox-DB.
// Gebruik: DATABASE_URL=... node tests/live/sessieblad-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const assert = require('assert');
const crypto = require('crypto');
const { io } = require('socket.io-client');
const db = require('../../db/database.js');
const authLib = require('../../lib/auth.js');
const URL = 'http://localhost:' + (process.env.TEST_PORT || 3001);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const verbind = (cookie) => new Promise((res, rej) => {
  const s = io(URL, { extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'], forceNew: true });
  s.on('connect', () => res(s)); s.on('connect_error', rej);
});
(async () => {
  await db.init();
  const naam = 'Test Lln ' + Date.now().toString(36);
  const sid = await db.createStudent(naam, null, 'manual', 'active');
  const token = crypto.randomBytes(24).toString('hex');
  await db.createStudentSession({ tokenHash: authLib.hashSessionToken(token), studentId: sid, expiresAt: Date.now() + 3600e3 });
  const cookie = 'student_sid=' + token;

  const t = await verbind();
  const toState = new Promise(r => t.once('session_created', r));
  t.emit('teacher_create_session', { name: 'live dedupe', mode: 'class' });
  const { code } = await toState;
  t.emit('teacher_join_session', { code });
  let laatste = null; t.on('teacher_session_data', d => { laatste = d; });
  await sleep(500);

  // 1) ingelogde leerling joint twee keer vanaf twee apparaten → 1 blok, actieve verbinding, geen Gast
  const a = await verbind(cookie); let overgenomen = null; a.on('sessie_overgenomen', d => { overgenomen = d; });
  a.emit('student_join', { name: 'iets anders getypt', code, className: '' }); await sleep(600);
  const b = await verbind(cookie);
  b.emit('student_join', { name: 'nog iets', code, className: '' }); await sleep(800);
  const lijst = (laatste.students || []).filter(x => x.dbStudentId === sid);
  assert.equal(lijst.length, 1, 'één blok per leerling');
  assert.equal(lijst[0].name, naam, 'naam komt van account');
  assert.notEqual(lijst[0].joinBadge, 'guest', 'geen Gast-badge');
  assert.equal(lijst[0].online, true);
  assert.ok(overgenomen && /elders/.test(overgenomen.message), 'oude verbinding krijgt melding');

  // 2) offline → offlineSince gezet; heraanmelden → weer online, nog steeds 1 blok
  b.disconnect(); await sleep(800);
  let l2 = laatste.students.filter(x => x.dbStudentId === sid);
  assert.equal(l2.length, 1); assert.equal(l2[0].online, false); assert.ok(l2[0].offlineSince > 0);
  const c = await verbind(cookie); c.emit('student_join', { name: naam, code, className: '' }); await sleep(800);
  l2 = laatste.students.filter(x => x.dbStudentId === sid);
  assert.equal(l2.length, 1); assert.equal(l2[0].online, true); assert.equal(l2[0].offlineSince, null);

  // 3) twee echte gasten met dezelfde naam: tweede wordt geweigerd; met resumeId neemt hij het blok over
  const g1 = await verbind(); let g1id = null; g1.on('student_state', d => { g1id = d.student.id; });
  g1.emit('student_join', { name: 'Gasty', code, className: '' }); await sleep(600);
  const g2 = await verbind(); let fout = null; g2.on('error_message', m => { fout = m; });
  g2.emit('student_join', { name: 'Gasty', code, className: '' }); await sleep(500);
  assert.ok(/al iemand/.test(fout || ''), 'tweede gast met dezelfde naam geweigerd');
  const g3 = await verbind(); g3.emit('student_join', { name: 'Gasty', code, className: '', resumeId: g1id }); await sleep(700);
  assert.equal(laatste.students.filter(x => x.name === 'Gasty').length, 1, 'gast met resumeId = zelfde blok');

  // 4) opruimen: offline blokken weg, online blijft
  c.disconnect(); g3.disconnect(); await sleep(700);
  t.emit('teacher_cleanup_offline'); await sleep(700);
  assert.equal(laatste.students.length, 0, 'offline opgeruimd');
  console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
