// Live-test v135: variabelen/placeholders per leerling.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/placeholders-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const ph = require('../../lib/placeholders.js');
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const tag = ' ' + Date.now();
(async () => {
  await db.init();
  const vars = [{ naam: 'n', type: 'geheel', min: 10, max: 999 }, { naam: 'wie', type: 'keuze', waarden: ['Anna', 'Bram', 'Chloë', 'Dries'] }];
  // 1. validatie bij het opslaan
  let r = await api('POST', '/api/quiz/bank', { text: `{{m}} fout${tag}`, questionType: 'open', maxPoints: 2, variables: vars });
  assert.strictEqual(r.status, 400, 'onbekende variabele in de tekst → 400'); assert.match(r.data.error, /m/);
  r = await api('POST', '/api/quiz/bank', { text: `x${tag}`, questionType: 'open', maxPoints: 2, variables: [{ naam: 'n', type: 'geheel', min: 5, max: 5 }] });
  assert.strictEqual(r.status, 400, 'min ≥ max → 400');
  r = await api('POST', '/api/quiz/bank', { text: `{{ghost}} stond er altijd${tag}`, questionType: 'open', maxPoints: 2 });
  assert.strictEqual(r.status, 200, 'zonder variabelen mag er van alles in staan (bestaande vragen blijven geldig)');
  // 2. meerkeuze met variabelen
  r = await api('POST', '/api/quiz/bank', { text: `{{wie}} telt de getallen van 1 tot {{n}}. Wat is de som?${tag}`, questionType: 'single', maxPoints: 2, variables: vars,
    choices: [{ text: '{{n*(n+1)//2}}', correct: true }, { text: '{{n*(n+1)//2+1}}', correct: false }, { text: '{{n*n}}', correct: false }],
    modelAnswer: 'print({{n*(n+1)//2}})' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const idMc = r.data.id;
  const rij = (await db.query(`SELECT variables_json FROM question_bank WHERE id=$1`, [idMc])).rows[0];
  assert.strictEqual(JSON.parse(rij.variables_json).length, 2);
  r = await api('POST', '/api/quiz/bank', { text: `Normale vraag${tag}`, questionType: 'open', maxPoints: 1 });
  const idNormaal = r.data.id;
  // 3. voorbeeld-endpoint
  r = await api('POST', '/api/quiz/bank/variabelen-voorbeeld', { text: 'n={{n}}', questionType: 'open', variables: vars });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.data.voorbeelden.length, 3);
  assert.match(r.data.voorbeelden[0].text, /^n=\d+$/);
  // 4. JSON-import met variabelen
  r = await api('POST', '/api/quiz/bank/import-json', { data: { vragen: [
    { title: 'imp ok', type: 'open', points: 1, text: 'Tel tot {{n}} ' + tag, variabelen: [{ naam: 'n', type: 'geheel', min: 2, max: 50 }] },
    { title: 'imp fout', type: 'open', points: 1, text: 'Tel tot {{q}} ' + tag, variabelen: [{ naam: 'n', type: 'geheel', min: 2, max: 50 }] },
  ] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.added, 1, JSON.stringify(r.data)); assert.ok((r.data.errors || []).some(e => /overgeslagen/.test(e)));
  // 5. toets met deze vragen; leerlingen zien eigen waarden
  r = await api('POST', '/api/quiz', { name: 'ph-test', type: 'toets', isTeacherPreview: true, randomize: false, questions: [
    { id: idMc, text: `{{wie}} telt de getallen van 1 tot {{n}}. Wat is de som?${tag}`, points: 2, randomGroup: 0 }, { id: idNormaal, text: `Normale vraag${tag}`, points: 1, randomGroup: 0 }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  const snaps = await db.getQuizQuestions(code);
  assert.ok(snaps.every(s => typeof s.variables_json === 'string'));
  assert.strictEqual(JSON.parse(snaps.find(s => s.bank_question_id === idMc).variables_json).length, 2, 'snapshot kreeg de variabelen');
  const start = (naam) => new Promise((resolve, reject) => {
    const sock = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, 15000);
    sock.on('error_message', (m) => { clearTimeout(t); sock.close(); reject(new Error(JSON.stringify(m))); });
    sock.on('quiz_state', (st) => { clearTimeout(t); sock.close(); resolve(st); });
    sock.on('connect', () => sock.emit('quiz_start', { code, name: naam, className: 'Preview' }));
  });
  const tekstenPer = [];
  const stat = [];
  for (let i = 0; i < 4; i++) {
    const st = await start('Ph Leerling ' + i);
    const q = st.questions.find(x => x.id === snaps.find(s => s.bank_question_id === idMc).id);
    assert.ok(!/\{\{/.test(q.text_snapshot), 'geen placeholders meer bij de leerling: ' + q.text_snapshot);
    const mm = /tot (\d+)\./.exec(q.text_snapshot); assert.ok(mm, 'tekst: ' + q.text_snapshot); const n = Number(mm[1]);
    assert.ok(n >= 10 && n <= 999);
    const opt = JSON.parse(q.choices_json);
    assert.strictEqual(opt.find(o => o.correct).text, String(n * (n + 1) / 2), 'juiste optie klopt met de eigen n');
    assert.ok(q.model_answer.includes(String(n * (n + 1) / 2)));
    const normaal = st.questions.find(x => x.id === snaps.find(s => s.bank_question_id === idNormaal).id);
    assert.strictEqual(normaal.text_snapshot, `Normale vraag${tag}`);
    tekstenPer.push(q.text_snapshot); stat.push({ id: st.studentId, tekst: q.text_snapshot });
  }
  assert.ok(new Set(tekstenPer).size > 1, 'leerlingen krijgen niet allemaal dezelfde waarden');
  // herverbinden → exact dezelfde tekst
  const again = await start('Ph Leerling 0');
  const q0 = again.questions.find(x => x.id === snaps.find(s => s.bank_question_id === idMc).id);
  assert.strictEqual(q0.text_snapshot, tekstenPer[0], 'herverbinden → zelfde waarden');
  // leerkracht ziet per leerling dezelfde tekst als de leerling
  for (const s of stat) {
    const rv = await api('GET', `/api/quiz/${code}/vragen-van/${encodeURIComponent(s.id)}`);
    assert.strictEqual(rv.status, 200);
    assert.strictEqual(rv.data.find(x => x.bank_question_id === idMc).text_snapshot, s.tekst, 'nakijkscherm toont de vraag zoals de leerling ze zag');
  }
  const g = await api('GET', `/api/quiz/${code}`);
  assert.strictEqual(g.data.heeftVariabelen, true);
  // nazicht van de leerling (db-rijen + substitutie zoals de server doet)
  const rows = await db.getMyResult(code, stat[1].id);
  const gevuld = rows.map(rw => ph.vulVraagIn({ ...rw, id: rw.question_id }, code, stat[1].id));
  assert.strictEqual(gevuld.find(x => x.question_id === snaps.find(s => s.bank_question_id === idMc).id).text_snapshot, stat[1].tekst);
  // 6. dupliceren neemt de variabelen mee
  r = await api('POST', `/api/quiz/${code}/duplicate`, { name: 'ph-kopie' });
  assert.ok(r.data.ok, JSON.stringify(r.data));
  const kopieSnaps = await db.getQuizQuestions(r.data.code);
  assert.strictEqual(JSON.parse(kopieSnaps.find(s => s.bank_question_id === idMc).variables_json).length, 2);
  // 7. bank-vraag bewerken (PUT) en dupliceren
  r = await api('PUT', `/api/quiz/bank/${idMc}`, { text: `{{wie}} telt tot {{n}}${tag}`, questionType: 'open', maxPoints: 2, variables: vars });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  r = await api('POST', `/api/quiz/bank/${idMc}/duplicate`);
  if (r.status === 200 && r.data.id) assert.strictEqual(JSON.parse((await db.query(`SELECT variables_json FROM question_bank WHERE id=$1`, [r.data.id])).rows[0].variables_json).length, 2);
  console.log('PLACEHOLDERS LIVE OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
