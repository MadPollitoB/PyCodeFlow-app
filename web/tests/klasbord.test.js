'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/klasbord');

test('klasbordActief: toets altijd, taak enkel met vinkje', () => {
  assert.equal(K.klasbordActief({ type: 'toets' }), true);
  assert.equal(K.klasbordActief({ type: 'toets', klasbord_enabled: false }), true);
  assert.equal(K.klasbordActief({ type: 'taak' }), false);
  assert.equal(K.klasbordActief({ type: 'taak', klasbord_enabled: false }), false);
  assert.equal(K.klasbordActief({ type: 'taak', klasbord_enabled: true }), true);
  assert.equal(K.klasbordActief(null), false);
});

test('bepaalStatus: kleur en voorrang', () => {
  assert.equal(K.bepaalStatus({ online: true }), 'groen');
  assert.equal(K.bepaalStatus({ online: false }), 'blauw');
  assert.equal(K.bepaalStatus({ online: true, rood: true }), 'rood');
  assert.equal(K.bepaalStatus({ online: true, handUp: true }), 'geel');
  // hand wint van rood, rood wint van offline
  assert.equal(K.bepaalStatus({ online: true, handUp: true, rood: true }), 'geel');
  assert.equal(K.bepaalStatus({ online: false, rood: true }), 'rood');
  assert.equal(K.bepaalStatus({ online: false, handUp: true }), 'geel');
  // ingediend wint van alles
  assert.equal(K.bepaalStatus({ online: false, handUp: true, rood: true, submitted: true }), 'grijs');
});

test('handVolgorde: nummert op volgorde van opsteken, negeert ingediende en lage handen', () => {
  const m = K.handVolgorde([
    { id: 'a', handUp: true, handAt: 300 },
    { id: 'b', handUp: true, handAt: 100 },
    { id: 'c', handUp: false, handAt: 50 },
    { id: 'd', handUp: true, handAt: 200 },
    { id: 'e', handUp: true, handAt: 10, submitted: true },
  ]);
  assert.equal(m.get('b'), 1);
  assert.equal(m.get('d'), 2);
  assert.equal(m.get('a'), 3);
  assert.equal(m.has('c'), false);
  assert.equal(m.has('e'), false);
});

test('handVolgorde: gelijke tijd geeft een stabiele volgorde', () => {
  const m = K.handVolgorde([{ id: 'z', handUp: true, handAt: 5 }, { id: 'a', handUp: true, handAt: 5 }]);
  assert.equal(m.get('a'), 1);
  assert.equal(m.get('z'), 2);
});

test('voortgangNummer = beantwoord + 1, begrensd op het totaal', () => {
  assert.equal(K.voortgangNummer(0, 10), 1);
  assert.equal(K.voortgangNummer(4, 10), 5);
  assert.equal(K.voortgangNummer(10, 10), 10);
  assert.equal(K.voortgangNummer(12, 10), 10);
  assert.equal(K.voortgangNummer(3, 0), 0);
  assert.equal(K.voortgangNummer(undefined, 8), 1);
});

test('voortgang hangt niet af van de willekeurige vraagvolgorde', () => {
  // twee leerlingen met 3 beantwoorde vragen (andere ids/volgorde) → allebei "vraag 4"
  const l = K.bouwBordLeerlingen([
    { id: 'x', name: 'An', online: true, quizAnswers: { q5: {}, q1: {}, q9: {} } },
    { id: 'y', name: 'Bo', online: true, quizAnswers: { q2: {}, q3: {}, q4: {} } },
  ], 10);
  assert.deepEqual(l.map(s => s.vraag), [4, 4]);
});

test('bouwBordLeerlingen: status, handnummer, ingediend, verwijderd en sortering', () => {
  const l = K.bouwBordLeerlingen([
    { id: '3', name: 'Zoë', online: true, klasbordHand: true, klasbordHandAt: 20, quizAnswers: {} },
    { id: '1', name: 'Aron', online: true, klasbordHand: true, klasbordHandAt: 10, quizAnswers: {} },
    { id: '2', name: 'Bram', online: false, quizAnswers: {} },
    { id: '4', name: 'Cleo', online: true, klasbordRood: true, klasbordWeg: true, klasbordWisselCount: 2, quizAnswers: {} },
    { id: '5', name: 'Dirk', online: true, quizSubmitted: true, quizAnswers: { a: {} } },
    { id: '6', name: 'Weg', online: true, removed: true },
  ], 5);
  assert.deepEqual(l.map(s => s.name), ['Aron', 'Bram', 'Cleo', 'Dirk', 'Zoë']);
  const per = Object.fromEntries(l.map(s => [s.name, s]));
  assert.equal(per.Aron.status, 'geel'); assert.equal(per.Aron.handNummer, 1);
  assert.equal(per['Zoë'].handNummer, 2);
  assert.equal(per.Bram.status, 'blauw');
  assert.equal(per.Cleo.status, 'rood'); assert.equal(per.Cleo.weg, true); assert.equal(per.Cleo.wisselCount, 2);
  assert.equal(per.Dirk.status, 'grijs'); assert.equal(per.Dirk.vraag, 5);
});

test('rood blijft staan na terugkeer tot de leerkracht reset (weg=false, rood=true)', () => {
  const [l] = K.bouwBordLeerlingen([{ id: '1', name: 'A', online: true, klasbordRood: true, klasbordWeg: false, quizAnswers: {} }], 3);
  assert.equal(l.status, 'rood');
  assert.equal(l.weg, false);
});

test('bordKolommen: 5 tot 25 leerlingen, daarna groeit het mee', () => {
  assert.equal(K.bordKolommen(0), 5);
  assert.equal(K.bordKolommen(10), 5);
  assert.equal(K.bordKolommen(25), 5);
  assert.equal(K.bordKolommen(26), 6);
  assert.equal(K.bordKolommen(36), 6);
  assert.equal(K.bordKolommen(37), 7);
});
