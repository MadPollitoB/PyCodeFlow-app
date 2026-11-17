// Live-test v132: cursus-links per vraag (aanmaken, bewerken, dupliceren, migratie, leerling-state).
// Vereist een draaiende server met POC_BASIC_AUTH_ENABLED=false:
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/cursus-links-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
(async () => {
  await db.init();
  const ids = [];
  for (let i = 1; i <= 4; i++) ids.push(await db.createQuizQuestion({ text: 'cl-vraag ' + i + ' ' + Date.now(), questionType: 'open', maxPoints: 1 }));
  const qid = (x) => (typeof x === 'string' ? x : (x.id || x));
  const bank = ids.map(qid);
  const basis = {
    name: 'cl-test', type: 'toets', isTeacherPreview: true, randomize: true, noTimer: false, timerSeconds: 1800,
    questions: bank.map((id, i) => ({ id, text: 'cl-vraag ' + (i + 1), points: 1, randomGroup: i < 2 ? 0 : 1 })),
  };
  // ongeldige links
  let r = await api('POST', '/api/quiz', { ...basis, cursusLinks: [{ url: 'http://onveilig.test', questionIds: [bank[0]] }] });
  assert.strictEqual(r.status, 400, 'http-link moet geweigerd worden');
  r = await api('POST', '/api/quiz', { ...basis, cursusLinks: [{ title: 'x', url: '', questionIds: [] }] });
  assert.strictEqual(r.status, 400, 'link zonder adres moet geweigerd worden');
  // aanmaken: link 1 voor groep 2 (vraag 3 en 4), link 2 voor vraag 3 (+ een onbekende vraag die eruit gefilterd wordt)
  r = await api('POST', '/api/quiz', { ...basis, cursusLinks: [
    { id: 'a', title: 'Cursus', url: 'https://cursus.test/a', questionIds: [bank[2], bank[3]] },
    { id: 'b', title: 'Spiekbrief', url: 'https://cursus.test/b', questionIds: [bank[2], 'onbekend'] },
  ] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  const meta = await db.getQuizMeta(code);
  const opgeslagen = JSON.parse(meta.cursus_links);
  assert.deepStrictEqual(opgeslagen.map(l => l.questionIds.length), [2, 1]);
  assert.strictEqual(meta.cursus_url, null);
  // edit-GET geeft de links terug
  r = await api('GET', `/api/quiz/${code}/edit`);
  assert.deepStrictEqual(r.data.meta.cursusLinks.map(l => l.title), ['Cursus', 'Spiekbrief']);
  // leerling-state: koppeling bank-id -> snapshot-id
  const snaps = await db.getQuizQuestions(code);
  const snapVan = (b) => snaps.find(s => s.bank_question_id === b).id;
  const state = await new Promise((resolve, reject) => {
    const sock = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('geen quiz_state')), 8000);
    sock.on('quiz_state', (st) => { clearTimeout(t); sock.close(); resolve(st); });
    sock.on('error_message', (m) => { clearTimeout(t); sock.close(); reject(new Error('error_message: ' + m)); });
    sock.on('connect', () => sock.emit('quiz_start', { code, name: 'Leerling Test', className: 'Preview' }));
  });
  assert.deepStrictEqual(state.cursusLinks.map(l => l.title), ['Cursus', 'Spiekbrief']);
  assert.deepStrictEqual(state.cursusLinks[0].vragen.sort(), [snapVan(bank[2]), snapVan(bank[3])].sort());
  assert.deepStrictEqual(state.cursusLinks[1].vragen, [snapVan(bank[2])]);
  assert.strictEqual(state.cursusUrl, undefined);
  // dupliceren: zelfde links (zelfde bank-id's)
  r = await api('POST', `/api/quiz/${code}/duplicate`, { name: 'cl-kopie' });
  assert.ok(r.data.ok, JSON.stringify(r.data));
  const kopie = await db.getQuizMeta(r.data.code);
  assert.deepStrictEqual(JSON.parse(kopie.cursus_links), opgeslagen);
  // bewerken: vraag 4 verwijderen, link 2 weg => koppelingen volgen de vragen
  const echt = { ...basis, isTeacherPreview: false, accessUntil: Date.now() + 3600e3 };   // een preview kan niet bewerkt worden
  const eerste = await api('POST', '/api/quiz', { ...echt, name: 'cl-edit', cursusLinks: [{ id: 'a', title: 'Cursus', url: 'https://cursus.test/a', questionIds: [bank[2], bank[3]] }] });
  r = await api('PUT', `/api/quiz/${eerste.data.code}`, { ...echt, name: 'cl-edit', questions: basis.questions.slice(0, 3),
    cursusLinks: [{ id: 'a', title: 'Cursus', url: 'https://cursus.test/a', questionIds: [bank[2], bank[3]] }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.deepStrictEqual(JSON.parse((await db.getQuizMeta(eerste.data.code)).cursus_links)[0].questionIds, [bank[2]]);
  // oude client met enkel cursusUrl => één link voor alle vragen
  r = await api('POST', '/api/quiz', { ...basis, name: 'cl-oud', cursusUrl: 'https://oud.test/c' });
  const oud = JSON.parse((await db.getQuizMeta(r.data.code)).cursus_links);
  assert.strictEqual(oud.length, 1); assert.strictEqual(oud[0].questionIds.length, 4);
  // migratie: bestaande cursus_url wordt een link voor alle vragen
  await db.query(`UPDATE assignment_bank SET cursus_url = 'https://migratie.test/x', cursus_links = '[]' WHERE session_code = $1`, [code]);
  await db.init();
  const gemigreerd = await db.getQuizMeta(code);
  const ml = JSON.parse(gemigreerd.cursus_links);
  assert.strictEqual(gemigreerd.cursus_url, null);
  assert.strictEqual(ml[0].url, 'https://migratie.test/x'); assert.strictEqual(ml[0].questionIds.length, 4);
  // een toets zonder links blijft zonder links
  r = await api('POST', '/api/quiz', { ...basis, name: 'cl-geen' });
  assert.deepStrictEqual(JSON.parse((await db.getQuizMeta(r.data.code)).cursus_links), []);
  console.log('CURSUS-LINKS LIVE OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
