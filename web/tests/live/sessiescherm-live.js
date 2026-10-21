// Live-test v125: bewaren van opdrachten/voorbeelden, opmaak-sanering, rebind zonder rechten-reset, hartslag.
// Server: POC_BASIC_AUTH_ENABLED=false PORT=3001 DATABASE_URL=... node server.js
process.chdir(require('path').join(__dirname, '..', '..'));
const assert = require('assert');
const { io } = require('socket.io-client');
const db = require('../../db/database.js');
const URL = 'http://localhost:' + (process.env.TEST_PORT || 3001);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const verbind = () => new Promise((res, rej) => { const s = io(URL, { transports: ['websocket'], forceNew: true }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const ack = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
(async () => {
  await db.init();
  const t = await verbind();
  const gemaakt = new Promise(r => t.once('session_created', r));
  t.emit('teacher_create_session', { name: 'live drafts', mode: 'class' });
  const { code } = await gemaakt;
  t.emit('teacher_join_session', { code });
  let data = null; t.on('teacher_session_data', d => { data = d; });
  await sleep(400);
  assert.equal(data.drafts, null, 'nog niets bewaard');

  // bewaren op knop; opmaak wordt gesaneerd
  const r1 = await ack(t, 'teacher_save_drafts', { opdrachten: ['<b>Oef 1</b><script>x()</script>', 'gewone tekst'], voorbeelden: ['print(1)', 'for i in range(3):\n    print(i)'] });
  assert.ok(r1.ok);
  await sleep(300);
  const t2 = await verbind(); let d2 = null; t2.on('teacher_session_data', d => { d2 = d; });
  t2.emit('teacher_join_session', { code }); await sleep(500);
  assert.deepEqual(d2.drafts.opdrachten, ['<b>Oef 1</b>x()', 'gewone tekst'], 'andere laptop ziet de bewaarde opdrachten (script weg)');
  assert.equal(d2.drafts.voorbeelden[1], 'for i in range(3):\n    print(i)');

  // verstuurde opdracht: gesaneerd voor de leerlingen
  const g = await verbind(); let ann = null; g.on('announcement_update', d => { ann = d.text; });
  g.emit('student_join', { name: 'Gastje', code, className: '' }); await sleep(500);
  t2.emit('teacher_send_announcement', { text: '<span class="rt-c1" onclick="x()">rood</span><img src=x onerror=1>' }); await sleep(400);
  assert.equal(ann, '<span class="rt-c1">rood</span>');

  // rechten + rebind: rebind behoudt rechten, join reset ze
  const sid = d2.students[0].id;
  t2.emit('teacher_toggle_student', { studentId: sid, field: 'run' }); await sleep(300);
  assert.equal(d2.students[0].canRun, true);
  const t3 = await verbind(); let d3 = null; t3.on('teacher_session_data', d => { d3 = d; });
  t3.emit('teacher_rebind', { code }); await sleep(500);
  assert.equal(d3.students[0].canRun, true, 'rebind laat de rechten staan');
  const ping = await new Promise(r => t3.emit('teacher_ping', r));
  assert.equal(ping.ok, true, 'hartslag: server kent de nieuwe socket als leerkracht');
  const pingOud = await new Promise(r => t2.emit('teacher_ping', r));
  assert.equal(pingOud.ok, false, 'oude socket is niet langer de leerkracht van de sessie');

  // opgeslagen in de DB (config_json) → overleeft een herstart
  await sleep(2500);
  const rij = await db.query('SELECT config_json FROM sessions WHERE code=$1', [code]);
  assert.ok(JSON.parse(rij.rows[0].config_json)._drafts.opdrachten.length === 2, 'drafts staan in de database');
  console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
