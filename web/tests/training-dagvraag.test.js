'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../lib/training-dagvraag');

const NU = Date.parse('2026-10-07T10:00:00Z');   // woensdag

test('109 standaardwaarden vraag van de dag', () => {
  assert.deepStrictEqual(D.normaliseerDagvraagCfg({}).cfg, { ...D.DAG_STANDAARD });
  assert.deepStrictEqual({ ...D.DAG_STANDAARD }, { aan: true, maxPogingenMeerkeuze: 2, maxPogingenCode: 0, codeAandeelPct: 67, niveauVerschil: 0, jokersPerWeek: 1, inhaalDagen: 7 });
});

test('109 ongeldige klasinstellingen worden geweigerd', () => {
  assert.ok(D.normaliseerDagvraagCfg({ jokersPerWeek: 9 }).fouten.length);
  assert.ok(D.normaliseerDagvraagCfg({ niveauVerschil: 5 }).fouten.length);
  assert.ok(D.normaliseerDagvraagCfg({ codeAandeelPct: 101 }).fouten.length);
  assert.ok(D.normaliseerDagvraagCfg({ maxPogingenMeerkeuze: 0 }).fouten.length);
  assert.strictEqual(D.normaliseerDagvraagCfg({ aan: false }).cfg.aan, false);
});

test('109 meerdere klassen: ruimste regeling', () => {
  const e = D.effectieveDagvraagCfg([{ maxPogingenMeerkeuze: 1, maxPogingenCode: 3, jokersPerWeek: 0, aan: false }, { maxPogingenMeerkeuze: 4, maxPogingenCode: 0, jokersPerWeek: 2 }]);
  assert.strictEqual(e.maxPogingenMeerkeuze, 4); assert.strictEqual(e.maxPogingenCode, 0); assert.strictEqual(e.jokersPerWeek, 2); assert.strictEqual(e.aan, true);
});

const KAND = [];
for (const t of ['a', 'b']) for (let l = 1; l <= 5; l++) { KAND.push({ id: t + l + 'c', topic: t, level: l, type: 'code' }); KAND.push({ id: t + l + 'm', topic: t, level: l, type: 'single' }); }

test('109 keuze is stabiel per leerling+dag en volgt niveau en onderwerp', () => {
  const basis = { kandidaten: KAND, topics: ['a'], niveauPerTopic: { a: 3 }, cfg: D.DAG_STANDAARD, zaad: 'leerling1|2026-10-07' };
  const x = D.kiesDagvraag(basis), y = D.kiesDagvraag(basis);
  assert.strictEqual(x.id, y.id);
  assert.strictEqual(x.topic, 'a'); assert.strictEqual(x.level, 3);
  assert.strictEqual(D.kiesDagvraag({ ...basis, cfg: { ...D.DAG_STANDAARD, niveauVerschil: 1 } }).level, 4);
  assert.strictEqual(D.kiesDagvraag({ ...basis, niveauPerTopic: { a: 5 }, cfg: { ...D.DAG_STANDAARD, niveauVerschil: 3 } }).level, 5, 'nooit boven het hoogste niveau');
});

test('109 codeaandeel 100% geeft altijd code, 0% nooit', () => {
  for (let i = 0; i < 20; i++) {
    const z = 'x' + i;
    assert.strictEqual(D.kiesDagvraag({ kandidaten: KAND, topics: ['a', 'b'], niveauPerTopic: { a: 2, b: 2 }, cfg: { ...D.DAG_STANDAARD, codeAandeelPct: 100 }, zaad: z }).type, 'code');
    assert.notStrictEqual(D.kiesDagvraag({ kandidaten: KAND, topics: ['a', 'b'], niveauPerTopic: { a: 2, b: 2 }, cfg: { ...D.DAG_STANDAARD, codeAandeelPct: 0 }, zaad: z }).type, 'code');
  }
});

test('109 recent gebruikte vragen worden vermeden', () => {
  const recent = new Set(['a3c', 'a3m']);
  const x = D.kiesDagvraag({ kandidaten: KAND, topics: ['a'], niveauPerTopic: { a: 3 }, recent, zaad: 'z' });
  assert.ok(!recent.has(x.id));
  assert.strictEqual(D.kiesDagvraag({ kandidaten: [], topics: ['a'], zaad: 'z' }), null);
});

test('109 streak: gemiste dag wordt gered door de joker van die week, een tweede niet', () => {
  assert.strictEqual(D.berekenDagStreak(['2026-10-05', '2026-10-07'], NU, 1).streak, 2, 'dinsdag gemist, joker');
  assert.strictEqual(D.berekenDagStreak(['2026-10-05', '2026-10-07'], NU, 0).streak, 1, 'zonder joker breekt het');
  assert.strictEqual(D.berekenDagStreak(['2026-10-02', '2026-10-07'], NU, 1).streak, 1, 'maandag én dinsdag gemist: twee op een week');
});

test('109 streak: vandaag nog niet opgelost is niet gemist; weekend breekt niet', () => {
  assert.deepStrictEqual(D.berekenDagStreak(['2026-10-05', '2026-10-06'], NU, 1).streak, 2);
  const maandag = Date.parse('2026-10-05T10:00:00Z');
  assert.strictEqual(D.berekenDagStreak(['2026-10-01', '2026-10-02'], maandag, 0).streak, 2);
  const s = D.berekenDagStreak(['2026-10-05', '2026-10-07'], NU, 1);
  assert.strictEqual(s.jokersOver, 0); assert.deepStrictEqual(s.jokersGebruikt, ['2026-10-06']);
  assert.strictEqual(D.berekenDagStreak([], NU, 1).streak, 0);
});

test('109 dagstatus: rood pas na de dag of als je vergrendeld bent; groen bij opgelost', () => {
  const cfg = D.DAG_STANDAARD;
  assert.strictEqual(D.dagStatus(null, '2026-10-07', '2026-10-07', cfg), 'open');
  assert.strictEqual(D.dagStatus({ attempts: 1, solved: false, type: 'code' }, '2026-10-07', '2026-10-07', cfg), 'bezig');
  assert.strictEqual(D.dagStatus({ attempts: 2, solved: false, type: 'single' }, '2026-10-07', '2026-10-07', cfg), 'mislukt', 'meerkeuze: 2 pogingen op');
  assert.strictEqual(D.dagStatus({ attempts: 9, solved: false, type: 'code' }, '2026-10-07', '2026-10-07', cfg), 'bezig', 'code: onbeperkt');
  assert.strictEqual(D.dagStatus({ attempts: 1, solved: false, type: 'code' }, '2026-10-06', '2026-10-07', cfg), 'mislukt');
  assert.strictEqual(D.dagStatus({ attempts: 3, solved: true, type: 'single' }, '2026-10-06', '2026-10-07', cfg), 'opgelost');
});

test('109 weekstrook toont opgelost, mislukt, joker en weekend', () => {
  const rijen = { '2026-10-07': { attempts: 0, solved: false, type: 'code' }, '2026-10-05': { attempts: 1, solved: true, type: 'code' } };
  const w = D.weekStrook(rijen, NU, ['2026-10-06'], D.DAG_STANDAARD);
  const per = Object.fromEntries(w.map(x => [x.dag, x.status]));
  assert.strictEqual(w.length, 7);
  assert.strictEqual(per['2026-10-07'], 'open'); assert.strictEqual(per['2026-10-06'], 'joker'); assert.strictEqual(per['2026-10-05'], 'opgelost');
  assert.strictEqual(per['2026-10-04'], 'weekend'); assert.strictEqual(per['2026-10-02'], 'mislukt');
});

test('109 het antwoord lekt nooit vóór juist/einde van de dag (broncontrole)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'training-routes.js'), 'utf8');
  const blok = src.slice(src.indexOf("app.post('/api/training/dagvraag/answer'"), src.indexOf("// hint en check van de vraag van de dag"));
  assert.ok(/if \(juist\) \{ uit\.onthulling/.test(blok), 'uitleg/antwoord alleen bij juist');
  assert.ok(!/verwacht/.test(blok.replace(/\/\/.*$/gm, '')), 'het verwachte antwoord wordt niet teruggestuurd');
  const dag = src.slice(src.indexOf("app.get('/api/training/dagvraag/dag/:dag'"));
  assert.ok(/const toon = D\.magOnthullen\(rij, dag, vandaag, cfg, eerste\);/.test(dag), 'antwoord enkel als opgelost of inhaaltermijn voorbij');
  assert.ok(src.indexOf("'/api/training/dagvraag/start'") < src.indexOf("app.get('/api/training/:id/state'"), 'dagvraag-routes vóór /:id-routes');
});

test('109 weekstrook: dagen vóór de eerste vraag zijn neutraal (geen rood kruis)', () => {
  const w = D.weekStrook({ '2026-10-07': { attempts: 0, solved: false, type: 'code' } }, NU, [], D.DAG_STANDAARD, undefined, 7, '2026-10-07');
  assert.deepStrictEqual(w.slice(0, 6).map(x => x.status), ['voor', 'voor', 'voor', 'voor', 'voor', 'voor']);
  assert.strictEqual(w[6].status, 'open');
});

// ── v110: gemiste dagen inhalen ────────────────────────────────────────────────────────
test('110 inhaalvenster: enkel voorbije schooldagen binnen het venster en na de eerste vraag', () => {
  const cfg = { ...D.DAG_STANDAARD };
  assert.ok(D.kanInhalen('2026-10-06', '2026-10-07', cfg, '2026-09-01'));
  assert.ok(!D.kanInhalen('2026-10-07', '2026-10-07', cfg, null), 'vandaag niet');
  assert.ok(!D.kanInhalen('2026-10-03', '2026-10-07', cfg, null), 'weekend niet');
  assert.ok(!D.kanInhalen('2026-09-28', '2026-10-07', cfg, null), 'buiten venster');
  assert.ok(!D.kanInhalen('2026-10-06', '2026-10-07', cfg, '2026-10-07'), 'vóór de eerste vraag');
  assert.ok(!D.kanInhalen('2026-10-06', '2026-10-07', { ...cfg, inhaalDagen: 0 }, null), 'uitgeschakeld');
  assert.ok(D.normaliseerDagvraagCfg({ inhaalDagen: 31 }).fouten.length);
});

test('110 ingehaalde dag telt niet mee voor de streak; enkel de joker dekt hem', () => {
  // wo 7 okt vandaag; di 6 gemist maar ingehaald => niet in de lijst met tijdig opgeloste dagen
  const zonderInhaal = ['2026-10-07', '2026-10-05', '2026-10-02'];
  const a = D.berekenDagStreak(zonderInhaal, NU, 1);
  assert.strictEqual(a.streak, 3);                       // di door joker gedekt
  const b = D.berekenDagStreak(zonderInhaal, NU, 0);
  assert.strictEqual(b.streak, 1, 'zonder joker breekt de gemiste (ingehaalde) dag de reeks');
  // tijdig opgeloste dag telt wél mee
  assert.strictEqual(D.berekenDagStreak([...zonderInhaal, '2026-10-06'], NU, 0).streak, 4);
});

test('110 status ingehaald, pogingen tellen vanaf het inhalen, antwoord pas na juist of einde venster', () => {
  const cfg = { ...D.DAG_STANDAARD };
  const rij = { solved: false, attempts: 2, type: 'single', inhaal: true, inhaalBasis: 2 };
  assert.strictEqual(D.actievePogingen(rij), 0);
  assert.strictEqual(D.dagStatus(rij, '2026-10-06', '2026-10-07', cfg), 'open');
  assert.strictEqual(D.dagStatus({ ...rij, attempts: 4 }, '2026-10-06', '2026-10-07', cfg), 'mislukt');
  assert.ok(D.inhaalVergrendeld({ ...rij, attempts: 4 }, cfg));
  assert.strictEqual(D.dagStatus({ ...rij, solved: true }, '2026-10-06', '2026-10-07', cfg), 'ingehaald');
  assert.strictEqual(D.dagStatus({ solved: true, attempts: 1, type: 'single' }, '2026-10-06', '2026-10-07', cfg), 'opgelost');
  // niet-opgeloste voorbije dag binnen venster: geen onthulling; na het venster wel
  const gemist = { solved: false, attempts: 2, type: 'single' };
  assert.ok(!D.magOnthullen(gemist, '2026-10-06', '2026-10-07', cfg, null));
  assert.ok(D.magOnthullen(gemist, '2026-09-20', '2026-10-07', cfg, null));
  assert.ok(D.magOnthullen({ ...gemist, solved: true }, '2026-10-07', '2026-10-07', cfg, null));
  assert.ok(!D.magOnthullen(gemist, '2026-10-07', '2026-10-07', cfg, null), 'vandaag nooit');
});

test('110 weekstrook toont inhaalbare dagen', () => {
  const st = D.weekStrook({}, NU, [], D.DAG_STANDAARD, undefined, 7, '2026-09-01');
  const di = st.find(x => x.dag === '2026-10-06'); const vandaag = st.find(x => x.dag === '2026-10-07'); const zo = st.find(x => x.dag === '2026-10-04');
  assert.ok(di.inhaalbaar && di.status === 'mislukt'); assert.ok(!vandaag.inhaalbaar); assert.ok(!zo.inhaalbaar);
});

test('110 routes sturen nooit het antwoord mee bij inhalen en gebruiken de inhaalregels', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'training-routes.js'), 'utf8');
  assert.ok(/doelDag\(req\.student\.id, cfg, req\.body && req\.body\.dag\)/.test(src));
  assert.ok(/D\.magOnthullen\(/.test(src));
  assert.ok(/getDagvraagOpgelost/.test(src));
  const db = fs.readFileSync(path.join(__dirname, '..', 'db', 'database.js'), 'utf8');
  assert.ok(/solved_at IS NOT NULL AND NOT inhaal/.test(db), 'ingehaalde dagen tellen niet mee voor de streak');
});

test('110 inline scripts van de trainingspagina zijn syntactisch geldig + laatste antwoord wordt teruggegeven', () => {
  for (const f of ['training.html', 'training-overzicht.html']) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    for (const m of s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), f);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'training-routes.js'), 'utf8');
  assert.ok(/uit\.laatsteAntwoord = /.test(src) && /laatsteAntwoord: pogingen\.length/.test(src));
  const juist = src.slice(src.indexOf('async function dagvraagToestand'), src.indexOf("app.post('/api/training/dagvraag/start'"));
  assert.ok(!/q\.correct/.test(juist.replace(/onthulling\(q\)/g, '')), 'toestand geeft het juiste antwoord niet vrij');
});

test('110 niveau verandert enkel in een echte training (niet bij vraag van de dag of Extra oefenen)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'training-routes.js'), 'utf8');
  assert.ok(/state\.herh && state\.herh\[vraag\.id\]\) \|\| !!state\.dagelijks/.test(src), 'dagelijkse run stuurt niveau niet bij');
  assert.ok(/if \(n && !state\.dagelijks\) await dbModule\.setStudentTrainingLevels/.test(src), 'dagelijkse run bewaart geen niveau');
  const dag = src.slice(src.indexOf("app.post('/api/training/dagvraag/answer'"), src.indexOf('// hint en check van de vraag van de dag'));
  assert.ok(!/setStudentTrainingLevels|nieuwNiveau/.test(dag), 'vraag van de dag raakt het niveau niet');
});

test('110 nakijken negeert de vraagtekst in input(); opdrachten vragen er niet meer om te schrappen', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'training-routes.js'), 'utf8');
  assert.ok(/zonderPrompt\(String\(code\)\)/.test(src) && /_pcf_b\.input = lambda/.test(src), 'prompt wordt bij het nakijken weggelaten');
  assert.ok(/__future__/.test(src), 'from __future__ blijft de eerste regel');
  const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'training-seed.json'), 'utf8');
  assert.ok(!/zonder tekst tussen de haakjes/.test(seed), 'seed bevat de oude zin niet meer');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'training-overzicht.html'), 'utf8');
  assert.ok(!/zonder tekst tussen de haakjes/.test(ui));
});
