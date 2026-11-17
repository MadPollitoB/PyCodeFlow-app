// Live-test v134: vragenpool (trek N uit M per groep) — meerdere leerlingen, aanvullen, nazicht, export, dupliceren.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/pool-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
const api = async (method, path, body, raw) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: raw ? await r.text() : await r.json().catch(() => ({})) };
};
const tag = ' ' + Date.now();
(async () => {
  await db.init();
  // 8 vragen: groep 0 = 5 meerkeuze (2 p), groep 1 = 3 open (3 p)
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `pool-mc${i}${tag}`, questionType: 'single', maxPoints: 2,
      choices: [{ text: 'A', correct: true }, { text: 'B', correct: false }] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); ids.push(r.data.id);
  }
  for (let i = 0; i < 3; i++) {
    const r = await api('POST', '/api/quiz/bank', { text: `pool-open${i}${tag}`, questionType: 'open', maxPoints: 3 });
    ids.push(r.data.id);
  }
  const vragen = ids.map((id, i) => ({ id, text: 'x', points: i < 5 ? 2 : 3, randomGroup: i < 5 ? 0 : 1 }));
  // ongeldige pool (N = M, onbestaande groep) wordt weggefilterd; geldige blijft
  let r = await api('POST', '/api/quiz', { name: 'pool-test', type: 'toets', isTeacherPreview: true, randomize: true, questions: vragen,
    pool: { 0: 2, 1: 3, 7: 1 } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  assert.deepStrictEqual(JSON.parse((await db.getQuizMeta(code)).pool_json), { 0: 2 });
  r = await api('GET', `/api/quiz/${code}/edit`);
  assert.deepStrictEqual(r.data.meta.pool, { 0: 2 });
  // 6 leerlingen starten: elk 2 (groep 0) + 3 (groep 1) = 5 vragen
  const sn = await db.getQuizQuestions(code);
  const start = (naam) => new Promise((resolve, reject) => {
    const sock = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => { sock.close(); reject(new Error('timeout ' + naam)); }, 15000);
    sock.on('error_message', (m) => { clearTimeout(t); sock.close(); reject(new Error(JSON.stringify(m))); });
    sock.on('quiz_state', (st) => { clearTimeout(t); resolve({ sock, st }); });
    sock.on('connect', () => sock.emit('quiz_start', { code, name: naam, className: 'Preview' }));
  });
  const leerlingen = [];
  for (let i = 0; i < 6; i++) leerlingen.push(await start('Pool Leerling ' + i));
  const lijsten = [];
  for (const l of leerlingen) {
    const qs = l.st.questions || [];
    assert.strictEqual(qs.length, 5, 'elke leerling krijgt 2 + 3 vragen');
    lijsten.push(qs.map(q => q.id).sort().join(','));
  }
  assert.ok(new Set(lijsten).size > 1, 'niet iedereen dezelfde vragen: ' + new Set(lijsten).size);
  // volgorde bewaard bij herverbinden (zelfde trekking)
  const eerste = leerlingen[0].st.questions.map(q => q.id).join(',');
  leerlingen[0].sock.close();
  const again = await start('Pool Leerling 0');
  assert.strictEqual(again.st.questions.map(q => q.id).join(','), eerste, 'herverbinden → dezelfde vragen in dezelfde volgorde');
  leerlingen[0] = again;
  // toewijzing (nakijkscherm) en voortgang
  r = await api('GET', `/api/quiz/${code}`);
  assert.ok(r.data.toewijzing, 'toewijzing aanwezig bij een pool');
  const aantalStudenten = Object.keys(r.data.toewijzing).length;
  assert.ok(aantalStudenten >= 6, 'toewijzing voor elke leerling: ' + aantalStudenten);
  for (const lijst of Object.values(r.data.toewijzing)) assert.strictEqual(lijst.length, 5);
  // leerling 1 dient de eerste vraag (1 antwoord) in en gaat verder niet; leerling 2 dient alles in
  const stuur = (l, aantal) => new Promise((resolve) => {
    const answers = {};
    l.st.questions.slice(0, aantal).forEach(q => { answers[q.id] = { code: 'x', selectedChoices: [] }; });
    l.sock.on('quiz_submitted_ok', () => resolve());
    l.sock.emit('quiz_submit_all', { answers });
    setTimeout(resolve, 2500);
  });
  await stuur(leerlingen[1], 5);
  // 'fill': iemand die maar deels antwoordt wordt enkel voor ZIJN vragen aangevuld (niet voor alle 8)
  const deel = leerlingen[2];
  await db.saveQuizAnswer({ sessionCode: code, studentId: deel.st.studentId, studentName: deel.st.studentName, studentClass: 'Preview',
    questionId: deel.st.questions[0].id, personalOrder: 0, code: 'x', runCount: 0, selectedChoices: '[]' });
  await db.fillMissingQuizAnswers(code);
  const rijen = await db.getQuizAnswers(code);
  const perLeerling = (id) => rijen.filter(a => a.student_id === id);
  assert.strictEqual(perLeerling(deel.st.studentId).length, 5, 'aangevuld tot 5 eigen vragen, niet 8');
  const eigenIds = new Set(deel.st.questions.map(q => q.id));
  assert.ok(perLeerling(deel.st.studentId).every(a => eigenIds.has(a.question_id)), 'enkel eigen vragen');
  // nazicht van de leerling zelf: enkel eigen vragen + juist maximum
  const mijn = await db.getMyResult(code, deel.st.studentId);
  assert.strictEqual(mijn.length, 5);
  const maxEigen = deel.st.questions.reduce((s, q) => s + Number(sn.find(x => x.id === q.id).points), 0);
  assert.strictEqual(mijn.reduce((s, x) => s + Number(x.points), 0), maxEigen);
  // CSV: extra kolom met het eigen maximum
  r = await api('GET', `/api/quiz/${code}/export/csv`, undefined, true);
  assert.strictEqual(r.status, 200); assert.match(r.data, /Maximum \(eigen vragen\)/);
  // dupliceren neemt de pool mee
  r = await api('POST', `/api/quiz/${code}/duplicate`, { name: 'pool-kopie' });
  assert.ok(r.data.ok, JSON.stringify(r.data));
  assert.deepStrictEqual(JSON.parse((await db.getQuizMeta(r.data.code)).pool_json), { 0: 2 });
  // zonder pool: alles ongewijzigd (toewijzing null, volledige lijst)
  const zonder = await api('POST', '/api/quiz', { name: 'zonder-pool', type: 'toets', isTeacherPreview: true, randomize: false, questions: vragen });
  assert.strictEqual(JSON.parse((await db.getQuizMeta(zonder.data.code)).pool_json) && Object.keys(JSON.parse((await db.getQuizMeta(zonder.data.code)).pool_json)).length, 0);
  const g = await api('GET', `/api/quiz/${zonder.data.code}`);
  assert.strictEqual(g.data.toewijzing, null);
  const l0 = await new Promise((res, rej) => { const s = io(BASE, { transports: ['websocket'] }); s.on('quiz_state', st => { s.close(); res(st); });
    s.on('connect', () => s.emit('quiz_start', { code: zonder.data.code, name: 'Zonder pool', className: 'Preview' })); setTimeout(() => rej(new Error('timeout')), 10000); });
  assert.strictEqual(l0.questions.length, 8, 'zonder pool krijgt iedereen alle 8');
  leerlingen.forEach(l => l.sock.close());
  console.log('POOL LIVE OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
