// Live-test v126: cursus in een sessie. Server: POC_BASIC_AUTH_ENABLED=false PORT=3001 DATABASE_URL=... node server.js
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
  t.emit('teacher_create_session', { name: 'live cursus', mode: 'class' });
  const { code } = await gemaakt;
  t.emit('teacher_join_session', { code });
  let data = null; t.on('teacher_session_data', d => { data = d; });
  await sleep(400);
  assert.equal(data.cursus.enabled, false, 'standaard uit');
  assert.equal(data.cursus.url, 'https://cursus.pycodeflow.org/');

  const g = await verbind(); let state = null, upd = null;
  g.on('student_state', d => { state = d; }); g.on('cursus_update', d => { upd = d; });
  g.emit('student_join', { name: 'Gastje', code, className: '' }); await sleep(600);
  assert.equal(state.cursus.enabled, false, 'leerling krijgt de stand in zijn state');

  // aan (klasmodus!) -> leerling krijgt meteen een update
  const r1 = await ack(t, 'teacher_set_cursus', { enabled: true, url: 'https://cursus.pycodeflow.org/h3-variabelen.html' });
  assert.ok(r1.ok); await sleep(300);
  assert.deepEqual(upd, { enabled: true, url: 'https://cursus.pycodeflow.org/h3-variabelen.html' });
  assert.equal(data.cursus.enabled, true);

  // onveilige links worden geweigerd
  for (const slecht of ['http://x.be', 'javascript:alert(1)', 'data:text/html,x']) {
    const r = await ack(t, 'teacher_set_cursus', { enabled: true, url: slecht });
    assert.equal(r.ok, false, slecht + ' geweigerd');
  }
  assert.equal(data.cursus.url, 'https://cursus.pycodeflow.org/h3-variabelen.html', 'stand blijft ongewijzigd');

  // late join krijgt de stand; een andere laptop ziet ze ook
  const g2 = await verbind(); let st2 = null; g2.on('student_state', d => { st2 = d; });
  g2.emit('student_join', { name: 'Laatkomer', code, className: '' }); await sleep(600);
  assert.equal(st2.cursus.enabled, true);
  const t2 = await verbind(); let d2 = null; t2.on('teacher_session_data', d => { d2 = d; });
  t2.emit('teacher_join_session', { code }); await sleep(500);
  assert.equal(d2.cursus.url, 'https://cursus.pycodeflow.org/h3-variabelen.html');

  // uit
  await ack(t2, 'teacher_set_cursus', { enabled: false }); await sleep(300);
  assert.equal(upd.enabled, false);

  // bewaard in de database
  await sleep(2500);
  const rij = await db.query('SELECT config_json FROM sessions WHERE code=$1', [code]);
  assert.equal(JSON.parse(rij.rows[0].config_json)._cursus.url, 'https://cursus.pycodeflow.org/h3-variabelen.html');
  // CSP: de leerlingpagina mag een https-kader tonen, andere pagina's niet
  const csp = async p => (await fetch(URL + p)).headers.get('content-security-policy') || '';
  assert.match(await csp('/student-app.html'), /frame-src 'self' https:/);
  assert.doesNotMatch(await csp('/teacher-app.html'), /frame-src/);
  console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
