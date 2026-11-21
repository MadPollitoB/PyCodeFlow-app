// Live-test v147: link naar de leerlingen. Server: POC_BASIC_AUTH_ENABLED=false PORT=3001 DATABASE_URL=... node server.js
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
  t.emit('teacher_create_session', { name: 'live link', mode: 'class' });
  const { code } = await gemaakt;
  t.emit('teacher_join_session', { code });
  let data = null; t.on('teacher_session_data', d => { data = d; });
  await sleep(400);
  assert.equal(data.link, null, 'standaard geen link');

  const g = await verbind(); let state = null, upd = null;
  g.on('student_state', d => { state = d; }); g.on('link_update', d => { upd = d; });
  g.emit('student_join', { name: 'Anna', code, className: '' }); await sleep(600);
  assert.equal(state.link, null);

  // onveilige links geweigerd
  for (const slecht of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.be', '']) {
    const r = await ack(t, 'teacher_send_link', { titel: 'x', url: slecht });
    assert.equal(r.ok, false, slecht);
  }
  // sturen
  const r1 = await ack(t, 'teacher_send_link', { titel: 'Hoofdstuk 4', url: 'cursus.voorbeeld.be/h4' });
  assert.ok(r1.ok, JSON.stringify(r1)); await sleep(300);
  assert.equal(upd.link.titel, 'Hoofdstuk 4'); assert.equal(upd.link.url, 'https://cursus.voorbeeld.be/h4');
  assert.equal(data.link.titel, 'Hoofdstuk 4');

  // laatkomer krijgt de link in zijn state
  const g2 = await verbind(); let st2 = null; g2.on('student_state', d => { st2 = d; });
  g2.emit('student_join', { name: 'Laat', code, className: '' }); await sleep(600);
  assert.equal(st2.link.url, 'https://cursus.voorbeeld.be/h4');

  // bewaren van een reeks links in de sessie (ook op een andere laptop)
  const rs = await ack(t, 'teacher_save_drafts', { opdrachten: ['a'], voorbeelden: ['print(1)'], links: [{ titel: 'Een', url: 'a.be' }, { titel: 'Twee', url: 'https://b.be/x' }, { titel: '', url: '' }] });
  assert.ok(rs.ok);
  const t2 = await verbind(); let d2 = null; t2.on('teacher_session_data', d => { d2 = d; });
  t2.emit('teacher_join_session', { code }); await sleep(500);
  assert.equal(d2.drafts.links.length, 3); assert.equal(d2.drafts.links[0].url, 'https://a.be/'); assert.equal(d2.drafts.links[1].titel, 'Twee');
  await sleep(2500);
  const rij = await db.query('SELECT config_json FROM sessions WHERE code=$1', [code]);
  assert.equal(JSON.parse(rij.rows[0].config_json)._drafts.links[1].url, 'https://b.be/x');

  // wissen door de leerkracht → weg bij iedereen
  await ack(t, 'teacher_clear_link', {}); await sleep(300);
  assert.equal(upd.link, null); assert.equal(d2.link, null);

  // individuele werkfase: sturen mag niet, en een actieve link verdwijnt
  await ack(t, 'teacher_send_link', { titel: 'T', url: 'https://a.be' }); await sleep(200);
  assert.ok(upd.link);
  t.emit('teacher_toggle_class_workspace'); await sleep(500);
  assert.equal(upd.link, null, 'link weg bij individuele modus');
  const r3 = await ack(t, 'teacher_send_link', { titel: 'T', url: 'https://a.be' });
  assert.equal(r3.ok, false);
  console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
