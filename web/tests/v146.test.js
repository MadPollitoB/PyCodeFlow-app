// v146 — timerregel (duur + deadline), herstel met extra tijd, echte sessiestatus
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const { berekenTimer, berekenHerstel } = require('../lib/herstel');
const { sessieStatus } = require('../lib/sessie-status');

const MIN = 60000;
const T = (u, m = 0) => Date.UTC(2026, 10, 18, u, m);   // 18/11/2026 u:m (UTC, enkel voor verschillen)

test('146 timer: geen duur en geen deadline → geen teller, niets automatisch', () => {
  const t = berekenTimer({ start: T(14), timerSeconds: null, noTimer: true, deadline: null });
  assert.strictEqual(t.modus, 'geen'); assert.strictEqual(t.heeftTeller, false); assert.strictEqual(t.eindAt, null);
});

test('146 timer: alleen een deadline → geen teller, wel een indienmoment', () => {
  const t = berekenTimer({ start: T(14, 20), noTimer: true, deadline: T(15) });
  assert.strictEqual(t.modus, 'deadline'); assert.strictEqual(t.heeftTeller, false);
  assert.strictEqual(t.eindAt, T(15)); assert.strictEqual(t.totaalSec, null);
});

test('146 timer: alleen een duur → start + duur', () => {
  const t = berekenTimer({ start: T(14), timerSeconds: 3600, deadline: null });
  assert.strictEqual(t.modus, 'duur'); assert.strictEqual(t.eindAt, T(15)); assert.strictEqual(t.totaalSec, 3600);
});

test('146 timer: duur + deadline → de kortste (voorbeelden 1–4)', () => {
  const dl = T(15);
  assert.strictEqual(berekenTimer({ start: T(14), timerSeconds: 3600, deadline: dl }).totaalSec, 3600);              // 1: 60:00
  const laat = berekenTimer({ start: T(14, 20), timerSeconds: 3600, deadline: dl });                                 // 2: 40:00
  assert.strictEqual(laat.totaalSec, 2400); assert.strictEqual(laat.eindAt, T(15)); assert.strictEqual(laat.modus, 'beide');
  assert.strictEqual(berekenTimer({ start: T(14), timerSeconds: 3600, deadline: T(17) }).eindAt, T(15));            // 3
  assert.strictEqual(berekenTimer({ start: T(16, 30), timerSeconds: 3600, deadline: T(17) }).totaalSec, 1800);      // 4: 30:00
});

test('146 timer: extra tijd mag de deadline overschrijden (voorbeeld 7)', () => {
  const t = berekenTimer({ start: T(14, 20), timerSeconds: 3600, deadline: T(15), extraSeconds: 15 * 60 });
  assert.strictEqual(t.eindAt, T(15, 15)); assert.strictEqual(t.totaalSec, 55 * 60);
  const d = berekenTimer({ start: T(14, 20), noTimer: true, deadline: T(15), extraSeconds: 15 * 60 });
  assert.strictEqual(d.eindAt, T(15, 15));
});

test('146 timer: deadline verschuiven tijdens de toets (voorbeelden 8 en 9)', () => {
  const nu = T(14, 40);
  // deadline 15:00 → 15:30: leerling A (start 14:00) blijft 15:00, leerling B (start 14:20) gaat van 15:00 naar 15:20
  const A = (dl) => berekenTimer({ start: T(14), timerSeconds: 3600, deadline: dl });
  const B = (dl) => berekenTimer({ start: T(14, 20), timerSeconds: 3600, deadline: dl });
  assert.strictEqual(A(T(15)).eindAt, T(15)); assert.strictEqual(A(T(15, 30)).eindAt, T(15));
  assert.strictEqual((B(T(15)).eindAt - nu) / MIN, 20); assert.strictEqual((B(T(15, 30)).eindAt - nu) / MIN, 40);
  // vervroegen naar 14:50 → iedereen 10 minuten
  assert.strictEqual((A(T(14, 50)).eindAt - nu) / MIN, 10); assert.strictEqual((B(T(14, 50)).eindAt - nu) / MIN, 10);
});

test('146 herstel: eindtijd verschuift niet (14u, 60 min, 25 min over) en wordt door de deadline begrensd (voorbeeld 5 en 6)', () => {
  const p5 = berekenHerstel({ start: T(14), timerSeconds: 3600, accessUntil: T(17), now: T(14, 35) });
  assert.strictEqual(p5.eigenEind, T(15)); assert.strictEqual(p5.resterendSec, 25 * 60);
  const p6 = berekenHerstel({ start: T(14), timerSeconds: 3600, accessUntil: T(14, 50), now: T(14, 35) });
  assert.strictEqual(p6.eigenEind, T(14, 50)); assert.strictEqual(p6.resterendSec, 15 * 60);
});

test('146 herstel: extra minuten "bovenop zijn eindtijd" of "vanaf nu"', () => {
  const basis = { start: T(14), timerSeconds: 3600, accessUntil: T(15), now: T(15, 10) };
  const tijdOp = berekenHerstel({ ...basis, extraMinuten: 0 });
  assert.strictEqual(tijdOp.tijdOp, true); assert.strictEqual(tijdOp.individueelTot, T(15, 11));   // minstens 1 minuut venster
  const eind = berekenHerstel({ ...basis, extraMinuten: 10, extraModus: 'eind' });      // A1: 15:00 + 10 = 15:10 → al om
  assert.strictEqual(eind.eigenEind, T(15, 10)); assert.strictEqual(eind.tijdOp, true);
  const nu = berekenHerstel({ ...basis, extraMinuten: 10, extraModus: 'vanafNu' });     // A2: 15:10 + 10 = 15:20
  assert.strictEqual(nu.eigenEind, T(15, 20)); assert.strictEqual(nu.resterendSec, 600); assert.strictEqual(nu.extraSeconden, 1200);
  // vanaf nu mag zijn tijd nooit inkorten
  const korter = berekenHerstel({ start: T(14), timerSeconds: 3600, accessUntil: T(17), now: T(14, 35), extraMinuten: 5, extraModus: 'vanafNu' });
  assert.strictEqual(korter.eigenEind, T(15));
});

test('146 herstel: toets met enkel een deadline en toets zonder alles', () => {
  const d = berekenHerstel({ start: T(14), noTimer: true, accessUntil: T(17), now: T(14, 30) });
  assert.strictEqual(d.modus, 'deadline'); assert.strictEqual(d.heeftTimer, false); assert.strictEqual(d.individueelTot, T(17)); assert.strictEqual(d.terugval, false);
  const voorbij = berekenHerstel({ start: T(14), noTimer: true, accessUntil: T(15), now: T(16) });
  assert.strictEqual(voorbij.terugval, true);
  const geen = berekenHerstel({ start: T(14), noTimer: true, accessUntil: null, now: T(16) });
  assert.strictEqual(geen.modus, 'geen'); assert.strictEqual(geen.terugval, true);
});

test('146 sessiestatus: echte status per toets, geblokkeerd en klas', () => {
  const nu = T(15);
  const s = (o) => sessieStatus({ mode: 'quiz', now: nu, ...o });
  assert.strictEqual(s({ meta: { access_until: T(16) } }).status, 'lopend');
  assert.strictEqual(s({ meta: { access_until: T(16) } }).lopend, true);
  assert.strictEqual(s({ meta: { access_until: T(14) } }).status, 'deadline_voorbij');
  assert.strictEqual(s({ meta: { access_until: T(14) } }).lopend, false);
  assert.strictEqual(s({ meta: { access_until: T(14) }, online: 2 }).lopend, true);   // nog iemand bezig
  assert.strictEqual(s({ meta: { stopped_at: 5, access_until: T(16) } }).status, 'gestopt');
  assert.strictEqual(s({ meta: { archived: true } }).status, 'gearchiveerd');
  assert.strictEqual(s({ meta: { access_from: T(17) } }).status, 'gepland');
  assert.strictEqual(s({ blocked: true, meta: { stopped_at: 5 } }).status, 'geblokkeerd');
  assert.strictEqual(sieK({ online: 0 }).status, 'rustig');
  assert.strictEqual(sieK({ online: 0 }).lopend, false);
  assert.strictEqual(sieK({ online: 3 }).status, 'actief');
  function sieK(o) { return sessieStatus({ mode: 'class', now: nu, ...o }); }
});

test('146 server/client: timerregel overal gebruikt, deadline-job kent extra tijd, monitoring-lijst blijft volledig', () => {
  const sv = r('server.js');
  assert.match(sv, /function timerVoorLeerling\(/);
  assert.match(sv, /timerSeconds: timerInfo\.totaalSec/);
  assert.match(sv, /startQuizTimer\(session, student, timerInfo\.totaalSec, timerInfo\.eindAt\)/);
  assert.match(sv, /function herberekenTijden\(/);
  assert.match(sv, /herberekenTijden\(session, \{ \.\.\.meta, access_until: nieuw \}\)/);
  assert.match(sv, /quiz_tijd_wijziging/);
  assert.match(sv, /student\.quizExtraSeconds > 0 && now < Number\(meta\.access_until\)/);
  assert.match(sv, /sessieStatusLib\.sessieStatus/);
  const js = r('public/quiz-student.js');
  assert.match(js, /function toonGeenTeller\(/);
  assert.match(js, /socket\.on\('quiz_tijd_wijziging'/);
  assert.match(js, /wordt automatisch ingediend op/i);
  assert.match(r('public/monitoring.js'), /toon ook gestopt\/afgerond\/rustig/);
  assert.match(r('public/app.js'), /id="herstel-voorbeeld"/);   // v149: de keuzelijst is vervangen door vaste minuten + live voorbeeld
});
