'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bepaalOverzichtStatus: st, knoppenVoorStatus: kn, isVolledigVerbeterd, isGestart } = require('../lib/overzicht-status');

const basis = { availability: 'open', ingediend: 0, verbeterd: 0 };

test('status: open of gepland = actief', () => {
  assert.equal(st(basis), 'actief');
  assert.equal(st({ ...basis, availability: 'pending' }), 'actief');
});
test('status: concept en archief hebben voorrang', () => {
  assert.equal(st({ ...basis, isPreview: true }), 'concept');
  assert.equal(st({ ...basis, availability: 'closed', archived: true }), 'archief');
});
test('status: gesloten met onverbeterde inleveringen = te verbeteren', () => {
  assert.equal(st({ availability: 'closed', ingediend: 5, verbeterd: 3 }), 'te_verbeteren');
  assert.equal(st({ availability: 'expired', ingediend: 5, verbeterd: 0 }), 'te_verbeteren');
  assert.equal(st({ availability: 'open', stoppedAt: 1, ingediend: 2, verbeterd: 1 }), 'te_verbeteren');
});
test('status: alles verbeterd of niemand ingediend = afgerond', () => {
  assert.equal(st({ availability: 'closed', ingediend: 5, verbeterd: 5 }), 'afgerond');
  assert.equal(st({ availability: 'closed', ingediend: 0, verbeterd: 0 }), 'afgerond');
});
test('status: open individuele heropening maakt een gesloten toets weer actief', () => {
  assert.equal(st({ availability: 'closed', ingediend: 5, verbeterd: 5, individualOpen: true }), 'actief');
});
test('na heropenen en opnieuw sluiten met nieuwe indiening: terug te verbeteren', () => {
  assert.equal(st({ availability: 'closed', ingediend: 6, verbeterd: 5 }), 'te_verbeteren');
  assert.equal(isVolledigVerbeterd(6, 5), false);
});
test('knoppen: actief gestart met klasbord → klasbord + live achter pijltje', () => {
  const r = { availability: 'open', klasbordActief: true };
  const k = kn('actief', r);
  assert.equal(k.primary, 'klasbord');
  assert.ok(k.more.includes('live') && k.more.includes('voortgang') && k.more.includes('stoppen'));
});
test('knoppen: taak zonder klasbord → live is hoofdknop', () => {
  assert.equal(kn('actief', { availability: 'open', klasbordActief: false }).primary, 'live');
});
test('knoppen: actief niet gestart → bewerken (indien bewerkbaar)', () => {
  const r = { availability: 'pending', editable: true };
  assert.equal(isGestart(r), false);
  assert.equal(kn('actief', r).primary, 'bewerken');
  assert.ok(!kn('actief', r).more.includes('live'));
});
test('knoppen: live/klasbord/voortgang enkel bij actief', () => {
  for (const s of ['te_verbeteren', 'afgerond', 'archief', 'concept']) {
    const k = kn(s, { klasbordActief: true });
    const alle = [k.primary, ...k.more];
    for (const x of ['live', 'klasbord', 'voortgang', 'stoppen']) assert.ok(!alle.includes(x), s + ' mag ' + x + ' niet tonen');
  }
});
test('knoppen: hoofdknop per status', () => {
  assert.equal(kn('te_verbeteren').primary, 'verbeteren');
  assert.equal(kn('afgerond').primary, 'scores');
  assert.equal(kn('archief').primary, 'scores');
  assert.equal(kn('concept').primary, 'activeren');
});
test('knoppen: archief heeft uit_archief, geen directe heropen; afgerond heeft heropenen + archiveren', () => {
  assert.ok(kn('archief').more.includes('uit_archief'));
  assert.ok(!kn('archief').more.includes('heropenen'));
  assert.ok(kn('afgerond').more.includes('heropenen') && kn('afgerond').more.includes('archiveren'));
});
test('testaccounts worden vóór de statusbepaling uitgesloten (ingediend telt enkel echte leerlingen)', () => {
  // Server telt enkel niet-testaccounts; zonder echte inleveringen is een gesloten toets afgerond.
  assert.equal(st({ availability: 'closed', ingediend: 0, verbeterd: 0 }), 'afgerond');
});
