// Live-test v137: pool met gelijke punten + niveaumix + telling, placeholders met voorwaarde/controle,
// klasbord met resterende tijd, moeilijkheidsrapport.
//   DATABASE_URL=... BASE=http://localhost:3001 node tests/live/v137-live.js
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
(async () => {
  await db.init();
  // ── placeholders met voorwaarde en controle ───────────────────────────────
  const vars = [{ naam: 'a', type: 'geheel', min: 1, max: 9 }, { naam: 'b', type: 'geheel', min: 1, max: 9 }, { voorwaarde: 'a > b' }];
  let r = await api('POST', '/api/quiz/bank', { text: `Bereken {{a}} - {{b}}${tag}`, questionType: 'open', maxPoints: 2, variables: vars });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const opgeslagen = JSON.parse((await db.query(`SELECT variables_json FROM question_bank WHERE id=$1`, [r.data.id])).rows[0].variables_json);
  assert.deepStrictEqual(opgeslagen[2], { voorwaarde: 'a > b' });
  r = await api('POST', '/api/quiz/bank', { text: `Deel 10 door a: {{10//a}}${tag}`, questionType: 'open', maxPoints: 2, variables: [{ naam: 'a', type: 'geheel', min: 0, max: 3 }] });
  assert.strictEqual(r.status, 400, 'delen door nul wordt geweigerd'); assert.match(r.data.error, /nul|a=0/);
  r = await api('POST', '/api/quiz/bank', { text: `Deel 10 door a: {{10//a}}${tag}`, questionType: 'open', maxPoints: 2, variables: [{ naam: 'a', type: 'geheel', min: 0, max: 3 }, { voorwaarde: 'a > 0' }] });
  assert.strictEqual(r.status, 200, 'met voorwaarde a > 0 is het wel mogelijk');
  r = await api('POST', '/api/quiz/bank', { text: `x {{a}}${tag}`, questionType: 'open', maxPoints: 2, variables: [{ naam: 'a', type: 'geheel', min: 1, max: 3 }, { voorwaarde: 'a > 7' }] });
  assert.strictEqual(r.status, 400, 'geen enkele geldige combinatie'); 
  r = await api('POST', '/api/quiz/bank', { text: `{{a}} en {{z}}${tag}`, questionType: 'open', maxPoints: 2, variables: [{ naam: 'a', type: 'geheel', min: 1, max: 3 }, { naam: 'z', type: 'geheel', min: 1, max: 3 }, { naam: 'q', type: 'geheel', min: 1, max: 3 }] });
  assert.strictEqual(r.status, 200); assert.ok((r.data.waarschuwingen || []).some(w => /q/.test(w)), 'ongebruikte placeholder → waarschuwing');
  r = await api('POST', '/api/quiz/bank/variabelen-voorbeeld', { text: '{{a}} - {{b}}', questionType: 'open', variables: vars });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.data.aantalCombinaties, 36);
  r.data.voorbeelden.forEach(v => { const m = /^(\d+) - (\d+)$/.exec(v.text); assert.ok(m && +m[1] > +m[2]); });

  // ── bank: 3 makkelijk, 3 gemiddeld, 2 moeilijk (alle 2 punten) + 1 met 3 punten ───────────────────────
  const mk = async (naam, d, p = 2, extra = {}) => (await api('POST', '/api/quiz/bank', { text: `${naam}${tag}`, questionType: 'open', maxPoints: p, difficulty: d, ...extra })).data.id;
  const ids = {
    m1: await mk('M1', 'makkelijk'), m2: await mk('M2', 'makkelijk'), m3: await mk('M3', 'makkelijk'),
    g1: await mk('G1', 'gemiddeld'), g2: await mk('G2', 'gemiddeld'), g3: await mk('G3', 'gemiddeld'),
    d1: await mk('D1', 'moeilijk'), d2: await mk('D2', 'moeilijk'), x3: await mk('X3', 'gemiddeld', 3),
  };
  const groep0 = ['m1', 'm2', 'm3', 'g1', 'g2', 'g3', 'd1', 'd2'].map(k => ({ id: ids[k], text: k, points: 2, randomGroup: 0 }));
  const pool = { 0: { n: 4, mix: { makkelijk: 2, gemiddeld: 1, moeilijk: 1 } } };

  // telling vooraf: (3 kies 2) × (3 kies 1) × (2 kies 1) = 3 × 3 × 2 = 18
  r = await api('POST', '/api/quiz/pool-telling', { questions: groep0, pool });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.totaal, '18'); assert.strictEqual(r.data.perGroep[0].metMix, true);
  assert.deepStrictEqual(r.data.perGroep[0].niveaus, { makkelijk: 3, gemiddeld: 3, moeilijk: 2 });
  r = await api('POST', '/api/quiz/pool-telling', { questions: groep0, pool: { 0: 4 } });
  assert.strictEqual(r.data.totaal, String(70), 'C(8,4) zonder mix');

  // ongelijke punten in een pool → geweigerd bij aanmaken
  const ongelijk = [...groep0.slice(0, 3), { id: ids.x3, text: 'x3', points: 3, randomGroup: 0 }];
  r = await api('POST', '/api/quiz', { name: 'pool-ongelijk', type: 'toets', isTeacherPreview: true, randomize: false, questions: ongelijk, pool: { 0: 2 } });
  assert.strictEqual(r.status, 400, 'ongelijke punten: ' + JSON.stringify(r.data)); assert.match(r.data.error, /evenveel punten/);
  // zonder pool mag het wel
  r = await api('POST', '/api/quiz', { name: 'geen-pool-ongelijk', type: 'toets', isTeacherPreview: true, randomize: false, questions: ongelijk });
  assert.strictEqual(r.status, 200, 'zonder pool is ongelijke puntenverdeling toegestaan: ' + JSON.stringify(r.data));

  // ── toets met pool + mix: elke leerling krijgt precies de mix ───────────────────────────────────────
  r = await api('POST', '/api/quiz', { name: 'pool-mix', type: 'toets', isTeacherPreview: true, randomize: true, questions: groep0, pool, timerSeconds: 600 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const code = r.data.code;
  const snaps = await db.getQuizQuestions(code);
  assert.ok(snaps.every(s => ['makkelijk', 'gemiddeld', 'moeilijk'].includes(s.difficulty)), 'niveau staat in de snapshot');
  const niveauVan = Object.fromEntries(snaps.map(s => [s.id, s.difficulty]));
  const bewaardePool = JSON.parse((await db.getQuizMeta(code)).pool_json);
  assert.deepStrictEqual(bewaardePool[0], { n: 4, mix: { makkelijk: 2, gemiddeld: 1, moeilijk: 1 } });
  r = await api('GET', `/api/quiz/${code}/edit`); if (r.status === 200 && r.data.meta) assert.deepStrictEqual(r.data.meta.pool[0], bewaardePool[0], 'bewerkscherm krijgt de mix terug');

  const start = (naam) => new Promise((resolve, reject) => {
    const sock = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, 15000);
    sock.on('quiz_state', (st) => { clearTimeout(t); resolve({ sock, st }); });
    sock.on('connect', () => sock.emit('quiz_start', { code, name: naam, className: 'Preview' }));
  });
  const leerlingen = []; const sets = new Set();
  for (let i = 0; i < 8; i++) {
    const l = await start('V137 Leerling ' + i);
    const mix = { makkelijk: 0, gemiddeld: 0, moeilijk: 0 };
    l.st.questions.forEach(q => mix[niveauVan[q.id]]++);
    assert.strictEqual(l.st.questions.length, 4);
    assert.deepStrictEqual(mix, { makkelijk: 2, gemiddeld: 1, moeilijk: 1 }, 'elke leerling dezelfde niveaumix');
    sets.add(l.st.questions.map(q => q.id).sort().join());
    leerlingen.push(l);
  }
  assert.ok(sets.size > 1, 'maar niet allemaal dezelfde vragen: ' + sets.size + ' verschillende sets');

  // ── klasbord: eindtijd per leerling, geen vraagnummers ──────────────────────────────────────────────
  const bord = await new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const t = setTimeout(() => { s.close(); reject(new Error('geen bord-state')); }, 8000);
    s.on('quiz_bord_state', (st) => { clearTimeout(t); s.close(); resolve(st); });
    s.on('connect', () => s.emit('quiz_bord_join', { code }));
  });
  assert.ok(bord.nu && Math.abs(bord.nu - Date.now()) < 5000, 'servertijd meegestuurd');
  assert.ok(bord.leerlingen.length >= 8);
  bord.leerlingen.forEach(l => {
    assert.ok(!('vraag' in l) && !('totaal' in l), 'geen vraagnummer op het bord');
    const rest = (l.eindAt - bord.nu) / 1000;
    assert.ok(rest > 500 && rest <= 600, 'resterende tijd ± 600 s: ' + rest);
  });

  // ── moeilijkheidsrapport: antwoorden geven met scores ───────────────────────────────────────────────
  for (const [i, l] of leerlingen.entries()) {
    const answers = {};
    l.st.questions.forEach(q => { answers[q.id] = { code: 'antwoord', selectedChoices: [] }; });
    await new Promise((res) => { l.sock.on('quiz_submitted_ok', res); l.sock.emit('quiz_submit_all', { answers }); setTimeout(res, 2000); });
    for (const q of l.st.questions) {
      const makkelijk = niveauVan[q.id] === 'makkelijk';
      await db.query(`UPDATE quiz_answers SET score=$1 WHERE session_code=$2 AND student_id=$3 AND question_id=$4`,
        [makkelijk ? 2 : (niveauVan[q.id] === 'moeilijk' ? 0 : (i % 2 ? 2 : 0)), code, l.st.studentId, q.id]);
    }
    l.sock.close();
  }
  r = await api('GET', `/api/quiz/${code}/moeilijkheidsrapport`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.samenvatting.aantalLeerlingen, 8);
  assert.ok(r.data.vragen.length >= 4);
  const mkVraag = r.data.vragen.find(v => v.niveau === 'makkelijk' && v.aantal >= 5);
  if (mkVraag) assert.strictEqual(mkVraag.gemiddeldePct, 100);
  const mdVraag = r.data.vragen.find(v => v.niveau === 'moeilijk' && v.aantal >= 5);
  if (mdVraag) assert.strictEqual(mdVraag.gemiddeldePct, 0);
  assert.ok(r.data.leerlingen.every(l => l.aantalVragen === 4 && l.verwachtPct != null));
  console.log('V137 LIVE OK —', sets.size, 'sets bij 8 leerlingen; rapport:', r.data.samenvatting.setMin + '–' + r.data.samenvatting.setMax + ' % setzwaarte');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
