// Live-test v152: spelmotor in de browser + framing-regels. Server: POC_BASIC_AUTH_ENABLED=false PORT=3001 DATABASE_URL=... node server.js
const assert = require('assert');
const vm = require('vm');
const URL = 'http://localhost:' + (process.env.TEST_PORT || 3001);
(async () => {
  const eng = await fetch(URL + '/pyblitz-engine.js'); assert.equal(eng.status, 200);
  const ctx = { window: {}, setTimeout, clearTimeout, Date }; vm.createContext(ctx); vm.runInContext(await eng.text(), ctx);
  const E = ctx.window.PyBlitzEngine; assert.ok(E && E.P && E.maakSpel);
  const n = E.P.normaliseerSet({ name: 'x', questions: [{ type: 'mc', text: 'q', options: ['for i in range(3):\n    print(i)', 'b'], correct: 0 }] });
  assert.ok(n.ok); assert.equal(n.vragen[0].options[0].code, true);
  const g = E.maakSpel({ id: 'p', pin: '1', set: { id: 'p', name: 'x', questions: n.vragen } });
  g.voegSpelerToe({ id: 'jij', naam: 'Jij' }); assert.ok(g.begin().ok); assert.ok(g.antwoord('jij', 0).ok);
  assert.equal(g.fase(), 'reveal'); g.stop();
  const proef = await fetch(URL + '/pyblitz-proef.html');
  assert.equal(proef.status, 200); assert.equal(proef.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(proef.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const play = await fetch(URL + '/play'); assert.equal(play.headers.get('x-frame-options'), 'DENY', 'andere pagina\'s blijven niet inbedbaar');
  console.log('v152 live: OK');
})().catch(e => { console.error('FOUT', e); process.exit(1); });
