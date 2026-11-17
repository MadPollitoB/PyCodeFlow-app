// Live-test v136: gelijkenisrapport.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/gelijkenis-live.js
process.chdir(require('path').join(__dirname, '..', '..'));
const db = require('../../db/database.js');
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3001';
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data, headers: r.headers };
};
const tag = ' ' + Date.now();
const kopie = 'def som(n):\n    totaal = 0\n    for i in range(n):\n        totaal += i\n    return totaal\nprint(som(10))';
const hernoemd = 'def bereken(x):\n    r = 0\n    for k in range(x):\n        r += k\n    return r\nprint(bereken(10))';
const eigen = 'a = int(input())\nb = int(input())\nprint(a * b + 7)\nprint("klaar met rekenen")';
(async () => {
  await db.init();
  const maakVraag = async (body) => (await api('POST', '/api/quiz/bank', body)).data.id;
  const idCode = await maakVraag({ text: 'Schrijf som' + tag, questionType: 'code', maxPoints: 4 });
  const mcKeuzes = [{ id: 'A', text: 'juist', correct: true }, { id: 'B', text: 'fout1', correct: false }, { id: 'C', text: 'fout2', correct: false }];
  const idMc1 = await maakVraag({ text: 'MC1' + tag, questionType: 'single', maxPoints: 2, choices: mcKeuzes });
  const idMc2 = await maakVraag({ text: 'MC2' + tag, questionType: 'single', maxPoints: 2, choices: mcKeuzes });
  let r = await api('POST', '/api/quiz', { name: 'gl-test', type: 'toets', isTeacherPreview: true, randomize: false, questions: [
    { id: idCode, text: 'Schrijf som' + tag, points: 4 }, { id: idMc1, text: 'MC1' + tag, points: 2 }, { id: idMc2, text: 'MC2' + tag, points: 2 }] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  const snaps = await db.getQuizQuestions(code);
  const sid = (bank) => snaps.find(s => s.bank_question_id === bank).id;
  // keuze-id's van de snapshot
  const keuzesVan = (bank) => JSON.parse(snaps.find(s => s.bank_question_id === bank).choices_json);
  const start = (naam) => new Promise((resolve, reject) => {
    const sock = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, 15000);
    sock.on('quiz_state', (st) => { clearTimeout(t); resolve({ sock, st }); });
    sock.on('connect', () => sock.emit('quiz_start', { code, name: naam, className: 'Preview' }));
  });
  const plan = [
    ['Gl Anna', kopie, 'fout'], ['Gl Bram', kopie, 'fout'], ['Gl Chloë', hernoemd, 'juist'], ['Gl Dries', eigen, 'juist'],
    ['Gl Eva', eigen + '\n# eigen', 'juist'], ['Gl Finn', eigen.replace('7', '9'), 'juist'], ['Gl Gert', eigen.replace('klaar', 'gedaan'), 'juist'],
  ];
  const leerlingen = [];
  for (const [naam, c, mc] of plan) {
    const l = await start(naam);
    const answers = {};
    for (const [bank, fn] of [[idCode, () => ({ code: c, selectedChoices: [] })],
      [idMc1, () => ({ code: '', selectedChoices: [(keuzesVan(idMc1).find(k => (mc === 'juist') === !!k.correct) || {}).id] })],
      [idMc2, () => ({ code: '', selectedChoices: [(keuzesVan(idMc2).find(k => (mc === 'juist') === !!k.correct) || {}).id] })]]) {
      answers[sid(bank)] = fn();
    }
    await new Promise((res) => { l.sock.on('quiz_submitted_ok', res); l.sock.emit('quiz_submit_all', { answers }); setTimeout(res, 2500); });
    l.sock.close(); leerlingen.push(l.st);
  }
  r = await api('GET', `/api/quiz/${code}/gelijkenisrapport`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const rap = r.data;
  const naamVan = (id) => leerlingen.find(s => s.studentId === id)?.studentName;
  const paarNamen = rap.paren.map(p => [naamVan(p.leerling1.id), naamVan(p.leerling2.id)].sort().join('+'));
  assert.ok(paarNamen.includes('Gl Anna+Gl Bram'), 'Anna+Bram (zelfde code + zelfde foute keuzes): ' + paarNamen);
  const ab = rap.paren.find(p => [naamVan(p.leerling1.id), naamVan(p.leerling2.id)].sort().join('+') === 'Gl Anna+Gl Bram');
  assert.ok(ab.gedeeldeFouten === 2 && ab.items.some(i => i.soort === 'tekst' && i.tekstPct === 100));
  assert.ok(paarNamen.some(n => n.includes('Gl Chloë') && (n.includes('Gl Anna') || n.includes('Gl Bram'))), 'hernoemde code gevonden');
  assert.ok(rap.paren.every(p => p.risico && p.punten > 0));
  // oud endpoint blijft werken, zelfde vorm
  r = await api('GET', `/api/quiz/${code}/similarity`);
  assert.ok(Array.isArray(r.data) && r.data.some(x => x.similarity === 100 && x.student1 && x.student2));
  // CSV
  r = await api('GET', `/api/quiz/${code}/gelijkenisrapport?format=csv&drempel=70`);
  assert.strictEqual(r.status, 200); assert.match(String(r.headers.get('content-type')), /csv/);
  assert.match(r.data, /"Risico";"Leerling 1";"Leerling 2"/);
  // drempel buiten bereik wordt begrensd, geen crash
  r = await api('GET', `/api/quiz/${code}/gelijkenisrapport?drempel=5`);
  assert.strictEqual(r.status, 200);
  console.log('GELIJKENIS LIVE OK —', rap.paren.length, 'paren; Anna+Bram', ab.risico, ab.punten + 'pt');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
