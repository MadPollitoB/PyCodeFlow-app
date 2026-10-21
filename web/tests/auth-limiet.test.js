'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { maakLimiet, blokkadeTekst } = require('../lib/auth-limiet');
const { internToken, isLoopback } = require('../lib/intern-token');

function klok() { let t = 1_000_000; return { nu: () => t, tik: (ms) => { t += ms; } }; }

test('een leerling blokkeert enkel zichzelf, niet de klas of de leerkracht', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 6; i++) l.mislukt('10.0.0.1', 'bente@school.be');
  assert.ok(l.controleer('10.0.0.1', 'bente@school.be').geblokkeerdMs > 0);
  assert.equal(l.controleer('10.0.0.1', 'sten@school.be').geblokkeerdMs, 0);     // klasgenoot, zelfde IP
  assert.equal(l.controleer('10.0.0.1', 'lk:mr.claes').geblokkeerdMs, 0);        // leerkracht, zelfde IP
});
test('blokkade duurt 10 minuten en verloopt vanzelf', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 6; i++) l.mislukt('ip', 'a@b.be');
  k.tik(9 * 60 * 1000); assert.ok(l.controleer('ip', 'a@b.be').geblokkeerdMs > 0);
  k.tik(2 * 60 * 1000); assert.equal(l.controleer('ip', 'a@b.be').geblokkeerdMs, 0);
});
test('een hele klas die foute wachtwoorden typt legt het netwerk niet plat', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 25; i++) for (let j = 0; j < 3; j++) l.mislukt('school', `leerling${i}@school.be`);   // 75 fouten
  assert.equal(l.controleer('school', 'nieuwe@school.be').geblokkeerdMs, 0);
  assert.equal(l.controleer('school', 'lk:mr.claes').geblokkeerdMs, 0);
});
test('overspoelen vanaf één IP wordt wél geblokkeerd (hoog plafond)', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 100; i++) l.mislukt('aanvaller', `x${i}@s.be`);
  assert.ok(l.controleer('aanvaller', 'iemand@s.be').geblokkeerdMs > 0);
});
test('gespreid raden op één account over veel IP’s wordt geblokkeerd', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 40; i++) l.mislukt('ip' + i, 'doel@s.be');
  assert.ok(l.controleer('ip-nieuw', 'doel@s.be').geblokkeerdMs > 0);
});
test('leerkrachten en beheerders worden nooit geblokkeerd, enkel vertraagd (max 5 s)', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  let r;
  for (let i = 0; i < 200; i++) r = l.mislukt('ip', 'lk:admin', { zacht: true });
  assert.equal(r.geblokkeerdMs, 0);
  assert.equal(l.controleer('ip', 'lk:admin').geblokkeerdMs, 0);
  assert.ok(r.vertragingMs <= 5000 && r.vertragingMs >= 750);
});
test('geslaagde login wist enkel de eigen teller, niet de netwerkteller', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 5; i++) l.mislukt('ip', 'a@b.be');
  l.gelukt('ip', 'a@b.be');
  for (let i = 0; i < 5; i++) l.mislukt('ip', 'a@b.be');
  assert.equal(l.controleer('ip', 'a@b.be').geblokkeerdMs, 0);   // opnieuw vanaf nul
});
test('ontgrendelen per IP, per account en alles', () => {
  const k = klok(), l = maakLimiet({ now: k.nu });
  for (let i = 0; i < 6; i++) { l.mislukt('ip1', 'a@b.be'); l.mislukt('ip2', 'c@d.be'); }
  l.ontgrendelAccount('a@b.be');
  assert.equal(l.controleer('ip1', 'a@b.be').geblokkeerdMs, 0);
  assert.ok(l.controleer('ip2', 'c@d.be').geblokkeerdMs > 0);
  l.ontgrendelIp('ip2'); assert.equal(l.controleer('ip2', 'c@d.be').geblokkeerdMs, 0);
  for (let i = 0; i < 6; i++) l.mislukt('ip3', 'e@f.be');
  assert.ok(l.ontgrendelAlles() > 0); assert.equal(l.lijst().length, 0);
});
test('melding noemt de resterende tijd en de leerkracht', () => {
  assert.match(blokkadeTekst(5 * 60 * 1000), /5 minuten/);
  assert.match(blokkadeTekst(30 * 1000), /1 minuut /);
  assert.match(blokkadeTekst(1000), /leerkracht/);
});
test('intern token: enkel mét databasegeheim, loopback-controle', () => {
  assert.equal(internToken({}), '');
  assert.match(internToken({ POSTGRES_PASSWORD: 'x' }), /^[0-9a-f]{64}$/);
  assert.notEqual(internToken({ POSTGRES_PASSWORD: 'x' }), internToken({ POSTGRES_PASSWORD: 'y' }));
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('10.0.0.5') && !isLoopback(undefined));
});
test('server gebruikt de nieuwe limiet overal en de oude gedeelde IP-teller is weg', () => {
  const fs = require('fs'), srv = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(srv, /registerAuthFailure|clearAuthFailures|getAuthBlockRemainingMs|authFailures\b/);
  assert.match(srv, /authMislukt\(ip, lkAccount, \{ zacht: true \}\)/);
  assert.match(srv, /\/api\/teacher\/toegang\/netwerk/);
  assert.match(srv, /\/api\/intern\/netwerk-ontgrendelen/);
});
