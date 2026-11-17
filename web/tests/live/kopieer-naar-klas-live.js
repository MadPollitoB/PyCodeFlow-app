// Live-test v128: leerling kopieert zijn (zichtbare) werkblad naar de klascode.
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
  t.emit('teacher_create_session', { name: 'live kopieer', mode: 'class' });
  const { code } = await gemaakt;
  t.emit('teacher_join_session', { code });
  let data = null; t.on('teacher_session_data', d => { data = d; });
  await sleep(400);

  const a = await verbind(); let sa = null, aShared = null;
  a.on('student_state', d => { sa = d; }); a.on('shared_code_update', d => { aShared = d; });
  a.emit('student_join', { name: 'Anna', code, className: '' });
  const b = await verbind(); let sb = null, bShared = null;
  b.on('student_state', d => { sb = d; }); b.on('shared_code_update', d => { bShared = d; });
  b.emit('student_join', { name: 'Bram', code, className: '' });
  await sleep(800);
  const idA = sa.student.id, idB = sb.student.id;

  // reeks van 2 opdrachten + individuele werkfase
  t.emit('teacher_send_assignments', { items: ['Opdracht 1', 'Opdracht 2'], index: 0 }); await sleep(300);
  t.emit('teacher_toggle_class_workspace'); await sleep(400);
  assert.equal(data.session.classWorkspaceMode, 'personal');

  // zonder recht: geweigerd, klascode ongewijzigd
  a.emit('code_update', { codeText: 'print("een")', workspace: 'personal' }); await sleep(200);
  // standaard heeft niemand recht? zet Anna en Bram expliciet op "geen recht"
  const toonRecht = (st) => st.student.classCanEdit;
  if (toonRecht(sa)) { t.emit('teacher_toggle_student', { studentId: idA, field: 'code' }); await sleep(200); }
  if (toonRecht(sb)) { t.emit('teacher_toggle_student', { studentId: idB, field: 'code' }); await sleep(200); }
  assert.equal(toonRecht(sa), false, 'Anna zonder recht');
  const r0 = await ack(a, 'student_copy_to_class', {});
  assert.deepEqual(r0, { ok: false, reden: 'geen-recht' });

  // met recht (exclusief): Anna krijgt het, Bram niet
  t.emit('teacher_toggle_student', { studentId: idA, field: 'code' }); await sleep(300);
  assert.equal(toonRecht(sa), true); assert.equal(toonRecht(sb), false);
  const rB = await ack(b, 'student_copy_to_class', {});
  assert.equal(rB.ok, false, 'Bram heeft geen recht');

  // werkblad opdracht 1 en opdracht 2 hebben verschillende code; kopieer wat zichtbaar is
  a.emit('code_update', { codeText: 'print("opdracht een")', workspace: 'personal' }); await sleep(200);
  a.emit('student_select_assignment', { index: 1 }); await sleep(300);
  a.emit('code_update', { codeText: 'print("opdracht twee")', workspace: 'personal' }); await sleep(200);
  const r1 = await ack(a, 'student_copy_to_class', {});
  assert.deepEqual(r1, { ok: true });
  await sleep(400);
  assert.equal(bShared.sharedCode, 'print("opdracht twee")', 'andere leerling krijgt de zichtbare code (opdracht 2)');
  assert.equal(aShared.sharedCode, 'print("opdracht twee")', 'ook de kopiërende leerling');
  assert.equal((data.view || data.teacherView || {}).code, 'print("opdracht twee")', 'leerkracht ziet de klascode');
  const meldA = data.students.find(s => s.id === idA);
  assert.ok(meldA.codeNaarKlasAt, 'melding voor de leerkracht');
  assert.match(data.statusText, /Anna heeft zijn code naar de klas gezet/);

  // terug naar opdracht 1 en opnieuw kopiëren: overschrijft altijd
  a.emit('student_select_assignment', { index: 0 }); await sleep(300);
  const r2 = await ack(a, 'student_copy_to_class', {}); assert.ok(r2.ok); await sleep(300);
  assert.equal(bShared.sharedCode, 'print("opdracht een")');

  // leeg werkblad kopieert niets
  a.emit('student_select_assignment', { index: 1 }); await sleep(200);
  a.emit('code_update', { codeText: '   ', workspace: 'personal' }); await sleep(200);
  const r3 = await ack(a, 'student_copy_to_class', {});
  assert.deepEqual(r3, { ok: false, reden: 'leeg' });
  assert.equal(bShared.sharedCode, 'print("opdracht een")');

  // leerkracht wist de melding
  t.emit('teacher_reset_copy', { studentId: idA }); await sleep(300);
  assert.equal(data.students.find(s => s.id === idA).codeNaarKlasAt, null);

  // bewaard in de database na herstart-veilig persist
  await sleep(2500);
  const rij = await db.query('SELECT 1 FROM sessions WHERE code=$1', [code]);
  assert.equal(rij.rows.length, 1);
  console.log('LIVE OK'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
