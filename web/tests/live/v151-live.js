// Live-test v151: PyBlitz. Server: POC_BASIC_AUTH_ENABLED=false PORT=3001 DATABASE_URL=... node server.js
process.chdir(require('path').join(__dirname, '..', '..'));
const assert = require('assert');
const { io } = require('socket.io-client');
const db = require('../../db/database.js');
const URL = 'http://localhost:' + (process.env.TEST_PORT || 3001);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const verbind = () => new Promise((res, rej) => { const s = io(URL, { transports: ['websocket'], forceNew: true }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const ack = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
let CSRF = '';
const api = async (pad, o = {}) => {
  const r = await fetch(URL + pad, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, origin: URL }, body: o.body ? JSON.stringify(o.body) : undefined });
  let d = null; try { d = await r.json(); } catch { /* */ }
  return { status: r.status, d };
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(40, 1)]);
(async () => {
  await db.init();
  CSRF = (await api('/api/csrf-token')).d.token;

  // ── bibliotheek ──
  const vragen = [
    { type: 'mc', text: 'Wat print dit?', code: 'print(1+1)', options: ['1', '2', '11', 'fout'], correct: 1, seconds: 10 },
    { type: 'mc', text: 'Welke fout?', error: "NameError: name 'x' is not defined", options: ['Naamfout', 'Typefout'], correct: 0, seconds: 10, points: 'dubbel', explanation: 'x bestaat niet' },
    { type: 'tf', text: 'Python is hoofdlettergevoelig', correct: 0, seconds: 10 },
  ];
  const bewaard = await api('/api/pyblitz/sets/nieuw', { method: 'PUT', body: { name: 'Live test', description: 'd', questions: vragen } });
  assert.equal(bewaard.status, 200, JSON.stringify(bewaard.d)); const setId = bewaard.d.id;
  const slecht = await api('/api/pyblitz/sets/nieuw', { method: 'PUT', body: { name: '', questions: [] } });
  assert.equal(slecht.status, 400);
  const lijst = (await api('/api/pyblitz/sets')).d.sets; assert.ok(lijst.find(s => s.id === setId && s.questionCount === 3));
  // import json + xlsx-sjabloon rondrit
  const imp = await api('/api/pyblitz/import', { method: 'POST', body: { soort: 'json', tekst: JSON.stringify({ name: 'Imp', questions: [{ text: 'Q', options: ['a', 'b'], correct: 'B' }] }) } });
  assert.ok(imp.d.ok && imp.d.vragen[0].correct === 1, JSON.stringify(imp.d));
  const sj = await fetch(URL + '/api/pyblitz/sjabloon.xlsx'); assert.equal(sj.status, 200);
  const xb = Buffer.from(await sj.arrayBuffer());
  const impX = await api('/api/pyblitz/import', { method: 'POST', body: { soort: 'xlsx', base64: xb.toString('base64') } });
  assert.ok(impX.d.ok, JSON.stringify(impX.d)); assert.equal(impX.d.vragen.length, 3, JSON.stringify(impX.d));
  assert.equal(impX.d.vragen[2].type, 'tf', 'Waar/Onwaar → tf');
  assert.equal(impX.d.vragen[1].points, 'dubbel');
  // afbeelding
  const bad = await api('/api/pyblitz/image', { method: 'POST', body: { base64: Buffer.from('<svg onload=alert(1)>').toString('base64') } });
  assert.equal(bad.status, 400);
  const img = await api('/api/pyblitz/image', { method: 'POST', body: { base64: PNG.toString('base64') } }); assert.equal(img.status, 200);
  const ig = await fetch(URL + '/api/pyblitz/image/' + img.d.id); assert.equal(ig.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(URL + '/api/pyblitz/image/niet-bestaand-id')).status, 404);
  assert.equal((await fetch(URL + '/play')).status, 200);

  // ── sessie ──
  const t = await verbind();
  const gemaakt = new Promise(r => t.once('session_created', r));
  t.emit('teacher_create_session', { name: 'live pyblitz', mode: 'class' });
  const { code } = await gemaakt; t.emit('teacher_join_session', { code }); await sleep(400);
  let host = null; t.on('pyblitz_state', s => { host = s; });
  const st0 = await ack(t, 'teacher_pyblitz_status', {}); assert.ok(st0.ok && st0.mogelijk && !st0.koppeling);
  const ln = await verbind(); let ls = null, lclosed = null; ln.on('pyblitz_state', s => { ls = s; }); ln.on('pyblitz_closed', d => { lclosed = d; });
  ln.emit('student_join', { name: 'Anna', code, className: '' }); await sleep(600);

  const open = await ack(t, 'teacher_pyblitz_open', { setId }); assert.ok(open.ok, JSON.stringify(open)); await sleep(300);
  const pin = open.pin; assert.ok(/^\d{5}$/.test(pin));
  assert.equal(host.fase, 'lobby'); assert.deepEqual(host.namen.map(n => n.name), ['Anna']);
  assert.equal(ls.fase, 'lobby', 'klasleerling krijgt meteen de lobby');
  assert.ok((await ack(t, 'teacher_pyblitz_status', {})).koppeling.setId === setId, 'gekoppeld');

  // gasten
  const join = (naam, p = pin) => api('/api/pyblitz/join', { method: 'POST', body: { pin: p, naam } });
  assert.equal((await join('Noor', '00000')).status, 404, 'foute code');
  assert.equal((await join('Anna')).status, 409, 'naam van klaslid geweigerd');
  assert.equal((await join('  anna ')).status, 409, 'ook met hoofdletters/spaties');
  assert.equal((await join('x')).status, 400);
  const g1 = await join('Noor'); assert.equal(g1.d.naam, 'Noor');
  const g2 = await join('noor'); assert.equal(g2.d.naam, 'noor 2', JSON.stringify(g2.d));
  const g3 = await join('Noor'); assert.equal(g3.d.naam, 'Noor 3');
  // gast-socket met token; een ander token/geen token werkt niet
  const gs1 = await verbind(); let gst = null; gs1.on('pyblitz_state', s => { gst = s; });
  assert.equal((await ack(gs1, 'pyblitz_guest_connect', { token: 'nep' })).ok, false);
  assert.ok((await ack(gs1, 'pyblitz_guest_connect', { token: g1.d.token })).ok); await sleep(300);
  assert.equal(gst.fase, 'lobby'); assert.equal(gst.jij.naam, 'Noor');
  const gs2 = await verbind(); await ack(gs2, 'pyblitz_guest_connect', { token: g2.d.token });
  const gs3 = await verbind(); await ack(gs3, 'pyblitz_guest_connect', { token: g3.d.token });
  await sleep(300); assert.equal(host.spelers, 4);

  // een tweede leerkracht-socket zonder sessie mag niets
  const vreemd = await verbind(); assert.equal((await ack(vreemd, 'teacher_pyblitz_begin', {})).ok, false);
  // gast kan niet als host handelen
  assert.equal((await ack(gs1, 'teacher_pyblitz_begin', {})).ok, false);

  // spelen
  assert.ok((await ack(t, 'teacher_pyblitz_begin', {})).ok); await sleep(300);
  assert.equal(host.fase, 'question'); assert.equal(gst.fase, 'question'); assert.equal(ls.fase, 'question');
  assert.equal(gst.vraag.code, 'print(1+1)'); assert.equal(gst.juist, undefined, 'juiste antwoord niet vooraf');
  assert.equal(host.juist, undefined);
  const a = await ack(ln, 'pyblitz_answer', { gameId: ls.gameId, keuze: 1 }); assert.ok(a.ok);
  assert.equal((await ack(ln, 'pyblitz_answer', { gameId: ls.gameId, keuze: 0 })).ok, false, 'één antwoord per vraag');
  assert.ok((await ack(gs1, 'pyblitz_answer', { gameId: gst.gameId, keuze: 1 })).ok);
  assert.ok((await ack(gs2, 'pyblitz_answer', { gameId: gst.gameId, keuze: 0 })).ok);
  assert.equal((await ack(gs3, 'pyblitz_answer', { gameId: gst.gameId, keuze: 9 })).ok, false);
  assert.equal((await ack(vreemd, 'pyblitz_answer', { gameId: gst.gameId, keuze: 1 })).ok, false, 'niet-deelnemer');
  await sleep(300); assert.equal(host.beantwoord, 3);
  assert.ok((await ack(t, 'teacher_pyblitz_sluitvraag', {})).ok); await sleep(300);
  assert.equal(host.fase, 'reveal'); assert.equal(host.juist, 1); assert.deepEqual(host.tellingen, [1, 2, 0, 0]);
  assert.equal(ls.jij.resultaat.correct, true); assert.ok(ls.jij.resultaat.delta >= 500);
  assert.equal(gst.jij.resultaat.correct, true);
  // tweede en derde vraag
  for (let i = 0; i < 2; i++) {
    await ack(t, 'teacher_pyblitz_volgende', {}); await sleep(250);
    assert.equal(host.fase, 'question');
    await ack(ln, 'pyblitz_answer', { gameId: ls.gameId, keuze: 0 });
    await ack(t, 'teacher_pyblitz_sluitvraag', {}); await sleep(250);
  }
  assert.equal(host.laatste, true);
  await ack(t, 'teacher_pyblitz_volgende', {}); await sleep(400);
  assert.equal(host.fase, 'final'); assert.equal(ls.fase, 'final'); assert.ok(host.podium.length === 3);
  assert.ok(ls.jij.plaats >= 1);
  // resultaat bewaard
  const games = (await api('/api/pyblitz/games')).d.games; assert.ok(games.length >= 1);
  const gm = (await api('/api/pyblitz/games/' + games[0].id)).d.game; assert.equal(gm.results.spelers.length, 4);
  // leerkracht sluit eindresultaat → alles dicht
  let gClosed = null; gs1.on('pyblitz_closed', d => { gClosed = d; });
  assert.ok((await ack(t, 'teacher_pyblitz_sluit', {})).ok); await sleep(400);
  assert.ok(lclosed && gClosed, 'popups bij leerling en gast gesloten');
  assert.equal((await join('Laat')).status, 404, 'code werkt niet meer');
  assert.equal((await ack(gs1, 'pyblitz_guest_connect', { token: g1.d.token })).ok, false, 'token vervalt');
  // niet verwijderbaar tijdens spel maar nu wel
  assert.equal((await api('/api/pyblitz/sets/' + setId, { method: 'DELETE' })).status, 200);

  // examenmodus: nooit
  const te = await verbind(); const ge = new Promise(r => te.once('session_created', r));
  te.emit('teacher_create_session', { name: 'toets', mode: 'exam' }); const ex = await ge; te.emit('teacher_join_session', { code: ex.code }); await sleep(300);
  const nope = await ack(te, 'teacher_pyblitz_open', { setId: 'x' }); assert.equal(nope.ok, false); assert.ok(/klasmodus/.test(nope.error));
  // individuele werkfase: ook niet
  const setB = (await api('/api/pyblitz/sets/nieuw', { method: 'PUT', body: { name: 'B', questions: vragen } })).d.id;
  t.emit('teacher_toggle_class_workspace'); await sleep(400);
  const nope2 = await ack(t, 'teacher_pyblitz_open', { setId: setB }); assert.equal(nope2.ok, false, 'individuele fase');
  t.emit('teacher_toggle_class_workspace'); await sleep(400);
  const ok2 = await ack(t, 'teacher_pyblitz_open', { setId: setB }); assert.ok(ok2.ok, JSON.stringify(ok2));
  // vroegtijdig stoppen in de lobby sluit ook alles
  assert.ok((await ack(t, 'teacher_pyblitz_sluit', {})).ok);
  await api('/api/pyblitz/sets/' + setB, { method: 'DELETE' });
  console.log('v151 live: OK');
  process.exit(0);
})().catch(e => { console.error('FOUT', e); process.exit(1); });
