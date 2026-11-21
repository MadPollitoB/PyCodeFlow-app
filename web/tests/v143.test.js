// v143 — tijdens de toets: toegang herstellen, hervatten, vergrendelscherm, start, enquête, deadline
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const herstel = require('../lib/herstel');
const validation = require('../lib/validation');

const T = (h, m = 0) => Date.parse(`2026-11-18T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

test('143 herstel: de eindtijd is start + duur en schuift NIET op (14u, 60 min, weg om 14:30, hersteld 14:35)', () => {
  const p = herstel.berekenHerstel({ start: T(14), timerSeconds: 3600, now: T(14, 35) });
  assert.strictEqual(p.eigenEind, T(15));
  assert.strictEqual(p.resterendSec, 25 * 60);
  assert.strictEqual(p.tijdOp, false);
  assert.strictEqual(p.individueelTot, T(15));
});

test('143 herstel: extra minuten zijn optioneel en tellen enkel op wat de leerkracht ingeeft', () => {
  const p = herstel.berekenHerstel({ start: T(14), timerSeconds: 3600, extraMinuten: 10, now: T(14, 35) });
  assert.strictEqual(p.eigenEind, T(15, 10));
  assert.strictEqual(p.extraSeconden, 600);
  assert.strictEqual(herstel.normaliseerExtraMinuten(-5), 0);
  assert.strictEqual(herstel.normaliseerExtraMinuten('abc'), 0);
  assert.strictEqual(herstel.normaliseerExtraMinuten('7,6'), 8);
  assert.strictEqual(herstel.normaliseerExtraMinuten(99999), herstel.MAX_EXTRA_MIN);
});

test('143 herstel: werkt in élke toestand (gestopt, deadline voorbij, tijd op, geen start, geen timer)', () => {
  const now = T(16);
  const gestopt = herstel.berekenHerstel({ start: T(14), timerSeconds: 7200, stoppedAt: T(15, 30), accessUntil: T(15), now: T(15, 40) });
  assert.ok(gestopt.individueelTot > T(15, 40));
  assert.deepStrictEqual(gestopt.toestand, { gestopt: true, deadlineVoorbij: true });
  const tijdOp = herstel.berekenHerstel({ start: T(14), timerSeconds: 3600, now });
  assert.strictEqual(tijdOp.tijdOp, true);
  assert.strictEqual(tijdOp.resterendSec, 0);
  assert.ok(tijdOp.individueelTot >= now + 60000, 'toch minstens 1 minuut toegangsvenster, zodat hij binnen kan');
  const zonderStart = herstel.berekenHerstel({ start: null, timerSeconds: 3600, now });
  assert.strictEqual(zonderStart.eigenEind, null);
  assert.strictEqual(zonderStart.terugval, true);
  assert.ok(zonderStart.individueelTot >= now + 15 * 60000);
  const zonderTimer = herstel.berekenHerstel({ start: T(14), noTimer: true, accessUntil: T(17), now });
  assert.strictEqual(zonderTimer.individueelTot, T(17));
});

test('143 hervatten: 1 kans per vraag → eerste NIET bevestigde vraag (7 bevestigd van 10 → vraag 8)', () => {
  const vragen = Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, question_type: 'open' }));
  const opgeslagen = {};
  for (let i = 0; i < 7; i++) opgeslagen['q' + i] = { confirmed_at: 1 + i, code: i === 3 ? '' : 'x' };   // ook een leeg antwoord telt als bevestigd
  assert.strictEqual(herstel.bepaalHervatIndex({ vragen, opgeslagen, noBack: true }), 7);
  for (let i = 7; i < 10; i++) opgeslagen['q' + i] = { confirmed_at: 9 };
  assert.strictEqual(herstel.bepaalHervatIndex({ vragen, opgeslagen, noBack: true }), 9, 'alles bevestigd → laatste vraag');
});

test('143 hervatten: terugbladeren toegestaan → eerste onbeantwoorde vraag, anders waar hij bleef; niets read-only', () => {
  const vragen = Array.from({ length: 5 }, (_, i) => ({ id: 'q' + i, question_type: 'open' }));
  const heeft = (t, rij) => !!(rij && rij.code);
  const opgeslagen = { q0: { code: 'a' }, q1: { code: 'b' }, q2: { code: '' }, q3: { code: 'd' } };
  assert.strictEqual(herstel.bepaalHervatIndex({ vragen, opgeslagen, noBack: false, huidige: 3, heeftAntwoord: heeft }), 2);
  const alles = { q0: { code: 'a' }, q1: { code: 'b' }, q2: { code: 'c' }, q3: { code: 'd' }, q4: { code: 'e' } };
  assert.strictEqual(herstel.bepaalHervatIndex({ vragen, opgeslagen: alles, noBack: false, huidige: 3, heeftAntwoord: heeft }), 3);
  assert.strictEqual(herstel.bepaalHervatIndex({ vragen: [], opgeslagen: {} }), 0);
});

test('143 deadline: moet in de toekomst liggen en na de start', () => {
  const nu = T(14);
  assert.strictEqual(validation.valideerNieuweDeadline({ nieuw: NaN, nu }).ok, false);
  assert.strictEqual(validation.valideerNieuweDeadline({ nieuw: nu - 1, nu }).ok, false);
  assert.strictEqual(validation.valideerNieuweDeadline({ nieuw: nu + 1000, nu, accessFrom: nu + 5000 }).ok, false);
  assert.strictEqual(validation.valideerNieuweDeadline({ nieuw: nu + 3600000, nu, accessFrom: nu - 1000 }).ok, true);
});

test('143 enquête: elk onderdeel heeft een exclusieve uitweg die als geldig antwoord telt', () => {
  // vier onderdelen krijgen "Niet van toepassing"; Aandachtspunten had al zijn eigen "geen aandachtspunten" (sprint 96)
  for (const c of validation.ENQUETE_CATEGORIEEN) {
    const uitweg = c.items.find(i => i.id === (c.id === 'aandachtspunten' ? 'geen_aandachtspunten' : 'nvt'));
    assert.ok(uitweg && uitweg.exclusief === true, c.id);
  }
  const antwoorden = {};
  for (const c of validation.ENQUETE_CATEGORIEEN) antwoorden[c.id] = [c.id === 'aandachtspunten' ? 'geen_aandachtspunten' : 'nvt'];
  assert.strictEqual(validation.valideerZelfevaluatie({ stemming: 'goed', antwoorden }).ok, true);
  // client en leerkrachtoverzicht lopen gelijk
  for (const f of ['public/quiz-student.js', 'public/app.js']) {
    assert.strictEqual((r(f).match(/id: 'nvt'/g) || []).length, 4, f);
  }
});

test('143 server: herstelroutes, deadline, bevestigd en start uit de databank', () => {
  const s = r('server.js');
  assert.match(s, /roster\/:studentId\/herstel-info/);
  assert.match(s, /roster\/:studentId\/herstel'/);
  assert.match(s, /app\.put\('\/api\/quiz\/:code\/deadline'/);
  assert.match(s, /'toegang_hersteld'/);
  assert.match(s, /session\._deadlineHandled = false/);
  assert.match(s, /bevestigdeVragen:/);
  assert.match(s, /bevestigd: bevestigd === true/);
  assert.match(s, /quizStartedAt: await bepaalStartTijdLeerling/);
  // tabwissels blijven: de herstelroute zet tabSwitchCount NIET op 0
  const blok = s.slice(s.indexOf("app.post('/api/quiz-sessions/:code/roster/:studentId/herstel'"), s.indexOf("app.get('/api/quiz/:code/deadline-info'"));
  assert.ok(!/tabSwitchCount\s*=\s*0/.test(blok));
  assert.ok(/live\.removed = false/.test(blok));
});

test('143 databank: kolommen confirmed_at en extra_seconden, additief', () => {
  const d = r('db/database.js');
  assert.match(d, /ADD COLUMN confirmed_at BIGINT/);
  assert.match(d, /ADD COLUMN extra_seconds INTEGER NOT NULL DEFAULT 0/);
  assert.match(d, /confirmed_at     = COALESCE\(quiz_answers\.confirmed_at, EXCLUDED\.confirmed_at\)/);
  assert.match(d, /async updateAssignmentDeadline/);
});

test('143 leerling: hervat-sprong, bevestigen bij vooruitgaan, vergrendelscherm, start-vinkje en dubbel tabblad', () => {
  const j = r('public/quiz-student.js');
  assert.match(j, /goToQuestion\(hervatIdx, \{ hervat: true \}\)/);
  assert.match(j, /!opties\.hervat && _state\?\.noBack && \(idx < _currentIdx/);
  assert.match(j, /saveCurrentAnswer\(code, \{ bevestig: bevestigVraag \}\)/);
  assert.match(j, /payload\.bevestigd = true/);
  assert.match(j, /function zetTerugkeerVergrendelingAan/);
  assert.match(j, /meldIncident\('weg_van_toets'/);
  assert.match(j, /id="start-akkoord"|start-akkoord/);   // v148: het vinkje staat nu op het startscherm zelf
  assert.match(j, /meldIncident\('startbevestiging'/);
  assert.match(j, /new BroadcastChannel\('pcf-toets-'/);
  const h = r('public/quiz-student.html');
  assert.match(h, /id="terugkeer-overlay"/);
  assert.match(h, /id="dubbel-overlay"/);
  assert.match(r('public/popups.js'), /py-modal-vinkje-box/);
});

test('143 leerkracht: knop Toegang herstellen overal, deadline-knop bij lopende toets', () => {
  const a = r('public/app.js');
  assert.match(a, /window\.herstelLeerling = async function/);
  assert.match(a, /Toegang herstellen<\/button>/);
  assert.ok(!/kanHeropenen\)\s*\n\s*\? `<button class="btn btn-muted small" style="font-size:0.78rem;padding:2px 8px;"\s*\n\s*onclick="heropenLeerling/.test(a));
  assert.match(r('public/assignment-overview.js'), /window\.deadlineAanpassen = async function/);
  assert.match(r('lib/overzicht-status.js'), /more\.push\('deadline'\)/);
});
