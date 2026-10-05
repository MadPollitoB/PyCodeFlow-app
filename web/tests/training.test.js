'use strict';
// Sprint 97 — Trainingscenter: unit tests van lib/training.js (pure logica, geen databank)
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../lib/training');

const CFG = T.STANDAARD_INSTELLINGEN;
const TOPICS = ['herhaling', 'variabelen'];

// ── keuze in de popup ───────────────────────────────────────────────────────
test('training: aantal vragen moet tussen 10 en 30 liggen', () => {
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 9, topics: ['a'] }).ok, false);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 31, topics: ['a'] }).ok, false);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 10, topics: ['a'] }).ok, true);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 30, topics: ['a'] }).ok, true);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 12.5, topics: ['a'] }).ok, false);
});

test('training: 1 tot 5 onderwerpen, enkel bekende', () => {
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 10, topics: [] }).ok, false);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 10, topics: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok, false);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 10, topics: ['a', 'b', 'c', 'd', 'e'] }).ok, true);
  assert.strictEqual(T.valideerTrainingKeuze({ aantal: 10, topics: ['x'] }, ['a', 'b']).ok, false);
  // dubbels tellen één keer
  assert.deepStrictEqual(T.valideerTrainingKeuze({ aantal: 10, topics: ['a', 'a'] }).topics, ['a']);
});

// ── niveau-sturing ──────────────────────────────────────────────────────────
test('niveau: pas na een vol venster beslist het gemiddelde', () => {
  let r = T.nieuwNiveau({ niveau: 3, recent: [1], instellingen: CFG });
  assert.strictEqual(r.niveau, 3); assert.deepStrictEqual(r.recent, [1]);
  r = T.nieuwNiveau({ niveau: 3, recent: [1, 1], instellingen: CFG });
  assert.strictEqual(r.niveau, 4); assert.strictEqual(r.wijziging, 1); assert.deepStrictEqual(r.recent, []);
});

test('niveau: omlaag bij lage score, gelijk ertussen', () => {
  assert.strictEqual(T.nieuwNiveau({ niveau: 5, recent: [0, 0], instellingen: CFG }).niveau, 4);
  assert.strictEqual(T.nieuwNiveau({ niveau: 5, recent: [0.5, 0.5], instellingen: CFG }).niveau, 5);
  // precies op de grens telt mee (75 en 40)
  assert.strictEqual(T.nieuwNiveau({ niveau: 5, recent: [1, 0.5], instellingen: CFG }).niveau, 6);   // 75%
  assert.strictEqual(T.nieuwNiveau({ niveau: 5, recent: [0.4, 0.4], instellingen: CFG }).niveau, 4); // 40%
});

test('niveau: nooit onder 1 of boven het maximum van het onderwerp', () => {
  assert.strictEqual(T.nieuwNiveau({ niveau: 1, recent: [0, 0], instellingen: CFG }).niveau, 1);
  assert.strictEqual(T.nieuwNiveau({ niveau: 6, recent: [1, 1], maxNiveau: 6, instellingen: CFG }).niveau, 6);
});

test('niveau: grenzen zijn instelbaar en het venster ook', () => {
  const streng = { ...CFG, upPct: 95, downPct: 60, venster: 3 };
  assert.strictEqual(T.nieuwNiveau({ niveau: 4, recent: [1, 1], instellingen: streng }).niveau, 4);   // venster nog niet vol
  assert.strictEqual(T.nieuwNiveau({ niveau: 4, recent: [1, 1, 0.8], instellingen: streng }).niveau, 4); // 93% < 95%
  assert.strictEqual(T.nieuwNiveau({ niveau: 4, recent: [0.5, 0.5, 0.5], instellingen: streng }).niveau, 3);
});

test('niveau: start onder het laatst bereikte niveau, anders het standaard startniveau', () => {
  assert.strictEqual(T.startNiveauVoor(6, 10, CFG), 5);
  assert.strictEqual(T.startNiveauVoor(1, 10, CFG), 1);
  assert.strictEqual(T.startNiveauVoor(null, 10, CFG), 3);
  assert.strictEqual(T.startNiveauVoor(9, 5, CFG), 5);   // begrensd door het maximum van het onderwerp
});

// ── vraag kiezen ────────────────────────────────────────────────────────────
const POOL = [
  { id: 1, topic: 'a', level: 1 }, { id: 2, topic: 'a', level: 2 }, { id: 3, topic: 'a', level: 2 },
  { id: 4, topic: 'a', level: 4 }, { id: 5, topic: 'b', level: 3 },
];

test('vraag kiezen: exact niveau, binnen het onderwerp', () => {
  const q = T.kiesVraag({ pool: POOL, topic: 'a', niveau: 2, rng: () => 0 });
  assert.strictEqual(q.level, 2); assert.strictEqual(q.topic, 'a');
});

test('vraag kiezen: nooit twee keer dezelfde in één training', () => {
  const q = T.kiesVraag({ pool: POOL, topic: 'a', niveau: 2, dezeRun: [2], rng: () => 0 });
  assert.strictEqual(q.id, 3);
});

test('vraag kiezen: geen vraag op dit niveau → dichtstbijzijnde, liefst makkelijker bij gelijkspel', () => {
  const q = T.kiesVraag({ pool: POOL, topic: 'a', niveau: 3, rng: () => 0 });
  assert.strictEqual(q.level, 2);                            // afstand 1 naar 2 én 4 → liever lager
  assert.strictEqual(T.kiesVraag({ pool: POOL, topic: 'a', niveau: 9 }).level, 4);
});

test('vraag kiezen: ongeziene vragen gaan voor, anders de oudst geziene', () => {
  const gezien = { 2: 500, 3: 100 };
  assert.strictEqual(T.kiesVraag({ pool: POOL, topic: 'a', niveau: 2, eerderGezien: { 2: 1 } }).id, 3);
  assert.strictEqual(T.kiesVraag({ pool: POOL.filter(q => q.id === 2 || q.id === 3), topic: 'a', niveau: 2, eerderGezien: gezien }).id, 3);
});

test('vraag kiezen: een al geziene vraag op het juiste niveau gaat voor een nieuwe een niveau ernaast', () => {
  const pool = [{ id: 1, topic: 'a', level: 2 }, { id: 2, topic: 'a', level: 3 }];
  assert.strictEqual(T.kiesVraag({ pool, topic: 'a', niveau: 2, eerderGezien: { 1: 50 }, rng: () => 0 }).id, 1);
  // maar een geziene vraag twee niveaus verder verliest van een nieuwe vlakbij
  const pool2 = [{ id: 1, topic: 'a', level: 2 }, { id: 2, topic: 'a', level: 4 }];
  assert.strictEqual(T.kiesVraag({ pool: pool2, topic: 'a', niveau: 3, eerderGezien: { 1: 50 }, rng: () => 0 }).id, 2);
});

test('vraag kiezen: leeg onderwerp geeft null', () => {
  assert.strictEqual(T.kiesVraag({ pool: POOL, topic: 'zzz', niveau: 1 }), null);
  assert.strictEqual(T.kiesVraag({ pool: POOL, topic: 'b', niveau: 3, dezeRun: [5] }), null);
});

test('onderwerp kiezen: het onderwerp dat het minst aan bod kwam', () => {
  assert.strictEqual(T.kiesOnderwerp(['a', 'b', 'c'], { a: 2, b: 1, c: 2 }), 'b');
  assert.strictEqual(T.kiesOnderwerp(['a', 'b'], {}, () => 0.99), 'b');   // gelijk → willekeurig
});

// ── nakijken ────────────────────────────────────────────────────────────────
test('single: juist of fout', () => {
  const q = { correct: [2] };
  assert.strictEqual(T.scoreSingle(q, 2), 1); assert.strictEqual(T.scoreSingle(q, [2]), 1);
  assert.strictEqual(T.scoreSingle(q, 1), 0); assert.strictEqual(T.scoreSingle(q, null), 0);
});

test('multiple: deelscore, fout aanvinken kost punten, alles aanvinken loont niet', () => {
  const q = { correct: [0, 2] };
  assert.strictEqual(T.scoreMultiple(q, [0, 2]), 1);
  assert.strictEqual(T.scoreMultiple(q, [0]), 0.5);
  assert.strictEqual(T.scoreMultiple(q, [0, 1, 2]), 0.5);
  assert.strictEqual(T.scoreMultiple(q, [0, 1, 2, 3]), 0);
  assert.strictEqual(T.scoreMultiple(q, [1]), 0);
  assert.strictEqual(T.scoreMultiple(q, []), 0);
});

test('code: uitvoer negeert lege regels en spaties achteraan', () => {
  assert.strictEqual(T.uitvoerKomtOvereen('7\n14\n21', '\n7 \n14\n\n21\n'), true);
  assert.strictEqual(T.uitvoerKomtOvereen('Hoi', 'hoi'), false);    // hoofdletters tellen wel
  assert.strictEqual(T.uitvoerKomtOvereen('', '\n\n'), true);       // "niets tonen" klopt
  assert.strictEqual(T.uitvoerKomtOvereen('1\n2', '1'), false);
});

test('code: score is het aandeel geslaagde testen', () => {
  assert.strictEqual(T.scoreCode([{ ok: true }, { ok: false }, { ok: true }, { ok: true }]), 0.75);
  assert.strictEqual(T.scoreCode([]), 0);
});

// ── titel ───────────────────────────────────────────────────────────────────
test('titel: de scoregrens bepaalt het niveau, begrensd door het bereikte niveau', () => {
  assert.strictEqual(T.bepaalTitel({ scorePct: 0, bereiktNiveau: 1, aantalVragen: 10 }).titel, 'Starting Padawan');
  assert.strictEqual(T.bepaalTitel({ scorePct: 55, bereiktNiveau: 10, aantalVragen: 15 }).titel, 'Rogue Scripter');
  // alles juist maar enkel op niveau 3 → geen hoge titel
  assert.strictEqual(T.bepaalTitel({ scorePct: 100, bereiktNiveau: 3, aantalVragen: 30 }).niveau, 3);
});

test('titel: de top-titel vraagt genoeg vragen', () => {
  assert.strictEqual(T.bepaalTitel({ scorePct: 100, bereiktNiveau: 10, aantalVragen: 15 }).niveau, 9);
  assert.strictEqual(T.bepaalTitel({ scorePct: 100, bereiktNiveau: 10, aantalVragen: 20 }).titel, 'Jedi Code-Master');
  assert.strictEqual(T.bepaalTitel({ scorePct: 99, bereiktNiveau: 10, aantalVragen: 30 }).niveau, 9);
});

test('titel: onderwerp met lager maximum wordt herschaald', () => {
  assert.strictEqual(T.herschaalNiveau(6, 6), 10);
  assert.strictEqual(T.herschaalNiveau(3, 6), 5);
  assert.strictEqual(T.herschaalNiveau(5, 10), 5);
});

// ── instellingen ────────────────────────────────────────────────────────────
test('instellingen: standaard is geldig en grenzen moeten logisch zijn', () => {
  assert.deepStrictEqual(T.normaliseerInstellingen({}).fouten, []);
  assert.ok(T.normaliseerInstellingen({ upPct: 50, downPct: 60 }).fouten.length > 0);
  assert.strictEqual(T.normaliseerInstellingen({ upPct: 80, downPct: 30 }).instellingen.upPct, 80);
});

test('instellingen: titels moeten 10 stuks zijn met oplopende grenzen vanaf 0%', () => {
  const ok = CFG.titels.map(t => ({ ...t }));
  assert.deepStrictEqual(T.normaliseerInstellingen({ titels: ok }).fouten, []);
  assert.ok(T.normaliseerInstellingen({ titels: ok.slice(0, 9) }).fouten.length > 0);
  const aflopend = ok.map(t => ({ ...t })); aflopend[5].vanaf = 5;
  assert.ok(T.normaliseerInstellingen({ titels: aflopend }).fouten.length > 0);
  const geenNul = ok.map(t => ({ ...t })); geenNul[0].vanaf = 5;
  assert.ok(T.normaliseerInstellingen({ titels: geenNul }).fouten.length > 0);
});

test('instellingen: de 10 standaardtitels zijn die van de leerkracht', () => {
  assert.strictEqual(CFG.titels.length, 10);
  assert.strictEqual(CFG.titels[0].titel, 'Starting Padawan');
  assert.strictEqual(CFG.titels[9].titel, 'Jedi Code-Master');
  assert.deepStrictEqual(CFG.titels.map(t => t.vanaf), [0, 10, 20, 30, 40, 50, 60, 75, 90, 100]);
});

// ── JSON-import ─────────────────────────────────────────────────────────────
const GOED_SINGLE = { topic: 'herhaling', level: 3, type: 'single', text: 'Vraag?', choices: ['a', 'b'], correct: [1] };
const GOED_MULTI = { topic: 'herhaling', level: 4, type: 'multiple', text: 'Vraag?', choices: ['a', 'b', 'c'], correct: [0, 2] };
const GOED_CODE = { topic: 'herhaling', level: 5, type: 'code', text: 'Schrijf iets', tests: [{ input: ['3'], output: '1\n2' }] };

test('import: geldige vragen van alle drie de types', () => {
  const r = T.valideerImport([GOED_SINGLE, GOED_MULTI, GOED_CODE], TOPICS);
  assert.strictEqual(r.geldig.length, 3); assert.deepStrictEqual(r.fouten, []);
});

test('import: fouten per vraag met volgnummer', () => {
  const r = T.valideerImport([
    GOED_SINGLE,
    { ...GOED_SINGLE, topic: 'onbekend' },
    { ...GOED_SINGLE, level: 11 },
    { ...GOED_SINGLE, correct: [0, 1] },
    { ...GOED_MULTI, correct: [0] },
    { ...GOED_SINGLE, correct: [5] },
    { ...GOED_CODE, tests: [] },
    { ...GOED_SINGLE, type: 'open' },
  ], TOPICS);
  assert.strictEqual(r.geldig.length, 1);
  assert.deepStrictEqual(r.fouten.map(f => f.nr), [2, 3, 4, 5, 6, 7, 8]);
});

test('import: een code-opdracht waarbij niets getoond moet worden is toegestaan', () => {
  const r = T.valideerImport([{ ...GOED_CODE, tests: [{ input: ['0'], output: '' }] }], TOPICS);
  assert.strictEqual(r.geldig.length, 1);
});

test('import: tekst-JSON, ongeldige JSON en geen lijst', () => {
  assert.strictEqual(T.valideerImport(JSON.stringify([GOED_SINGLE]), TOPICS).geldig.length, 1);
  assert.strictEqual(T.valideerImport(JSON.stringify({ questions: [GOED_SINGLE] }), TOPICS).geldig.length, 1);
  assert.strictEqual(T.valideerImport('{kapot', TOPICS).fouten[0].nr, 0);
  assert.strictEqual(T.valideerImport({ a: 1 }, TOPICS).fouten[0].nr, 0);
});

test('import: dezelfde vraag geeft dezelfde vingerafdruk, andere niveau een andere', () => {
  const a = T.valideerImport([GOED_SINGLE], TOPICS).geldig[0];
  const b = T.valideerImport([{ ...GOED_SINGLE, text: '  Vraag?  ' }], TOPICS).geldig[0];
  const c = T.valideerImport([{ ...GOED_SINGLE, level: 4 }], TOPICS).geldig[0];
  assert.strictEqual(T.vraagHash(a), T.vraagHash(b));
  assert.notStrictEqual(T.vraagHash(a), T.vraagHash(c));
});

// ── veiligheid ──────────────────────────────────────────────────────────────
test('leerling krijgt nooit de juiste antwoorden of de testen te zien', () => {
  const single = { id: 1, topic: 'a', level: 2, type: 'single', text: 't', choices: ['x', 'y'], correct: [1], explanation: 'uitleg' };
  const code = { id: 2, topic: 'a', level: 2, type: 'code', text: 't', choices: [], correct: [], starter: 's', tests: [{ input: [], output: 'geheim' }] };
  for (const q of [single, code]) {
    const uit = JSON.stringify(T.vraagVoorLeerling(q, 1, 10, 2));
    assert.ok(!uit.includes('correct')); assert.ok(!uit.includes('tests')); assert.ok(!uit.includes('geheim')); assert.ok(!uit.includes('uitleg'));
  }
  assert.strictEqual(T.vraagVoorLeerling(single, 1, 10, 2).meerdere, false);
});

test('de meegeleverde startpool is geldig en bevat alle onderwerpen en types', () => {
  const seed = require('../db/training-seed.json');
  const topics = ['stroomdiagrammen', 'print-input', 'variabelen', 'datatypes', 'expressies', 'beslissingen', 'herhaling', 'foutmeldingen', 'debuggen'];
  const r = T.valideerImport(seed, topics);
  assert.deepStrictEqual(r.fouten, []);
  assert.strictEqual(new Set(r.geldig.map(T.vraagHash)).size, r.geldig.length, 'geen dubbels');
  for (const t of topics) {
    for (let n = 1; n <= 6; n++) {
      assert.ok(r.geldig.filter(q => q.topic === t && q.level === n).length >= 3, `${t} niveau ${n}: minstens 3 vragen`);
    }
  }
  for (const type of ['single', 'multiple', 'code']) assert.ok(r.geldig.some(q => q.type === type), type);
});
