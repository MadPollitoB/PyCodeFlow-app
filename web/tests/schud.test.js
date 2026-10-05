'use strict';
// Sprint 98 — antwoordopties in willekeurige volgorde (public/schud.js)
const { test } = require('node:test');
const assert = require('node:assert');
const { schud } = require('../public/schud.js');

const OPTIES = ['A', 'B', 'C', 'D', 'E', 'F'].map(t => ({ id: 'id-' + t, text: 'optie ' + t }));

test('schud: dezelfde sleutel geeft altijd dezelfde volgorde (stabiel bij herladen/aanvinken)', () => {
  const a = schud(OPTIES, 'TOETS1|Emma|vraag7').map(o => o.id);
  const b = schud(OPTIES, 'TOETS1|Emma|vraag7').map(o => o.id);
  assert.deepStrictEqual(a, b);
});

test('schud: geen optie gaat verloren of komt dubbel voor, het origineel blijft ongemoeid', () => {
  const kopie = OPTIES.map(o => o.id);
  const r = schud(OPTIES, 'x');
  assert.deepStrictEqual(r.map(o => o.id).sort(), kopie.slice().sort());
  assert.deepStrictEqual(OPTIES.map(o => o.id), kopie);
});

test('schud: verschillende leerlingen krijgen verschillende volgordes', () => {
  const volgordes = new Set();
  for (let i = 0; i < 40; i++) volgordes.add(schud(OPTIES, `TOETS1|leerling${i}|vraag1`).map(o => o.id).join(','));
  assert.ok(volgordes.size > 20, 'verwacht veel verschillende volgordes, kreeg ' + volgordes.size);
});

test('schud: de volgorde is niet gewoon het origineel (positie van het juiste antwoord verspringt)', () => {
  let opPlaatsEen = 0;
  for (let i = 0; i < 300; i++) if (schud(OPTIES, 'k' + i)[0].id === 'id-A') opPlaatsEen++;
  // eerlijk gespreid: rond 1/6 van 300 = 50; zeker niet altijd (300) of nooit (0)
  assert.ok(opPlaatsEen > 20 && opPlaatsEen < 90, 'A stond ' + opPlaatsEen + ' keer eerst');
});

test('schud: werkt ook met gewone teksten, lege lijst en onbekende invoer', () => {
  assert.strictEqual(schud(['a', 'b', 'c'], 's').length, 3);
  assert.deepStrictEqual(schud([], 's'), []);
  assert.deepStrictEqual(schud(null, 's'), []);
});

test('schud: "Alle bovenstaande" en "Geen van bovenstaande" blijven onderaan', () => {
  const lijst = [{ text: 'een' }, { text: 'twee' }, { text: 'Alle bovenstaande' }, { text: 'drie' }, { text: 'Geen van bovenstaande' }];
  for (let i = 0; i < 30; i++) {
    const r = schud(lijst, 'k' + i).map(o => o.text);
    assert.deepStrictEqual(r.slice(3).sort(), ['Alle bovenstaande', 'Geen van bovenstaande']);
  }
});
