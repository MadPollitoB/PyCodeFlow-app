// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 34a — Unit tests: input-validatie (lib/validation.js)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const v = require('../lib/validation');

// ── Sessiecode ────────────────────────────────────────────────────────────────
test('sessiecode: geldig (8 hoofdletters/cijfers)', () => {
  assert.strictEqual(v.isValidSessionCode('ABC12345'), true);
  assert.strictEqual(v.isValidSessionCode('SAN8JYSV'), true);
});

test('sessiecode: ongeldig', () => {
  assert.strictEqual(v.isValidSessionCode('abc12345'), false); // kleine letters
  assert.strictEqual(v.isValidSessionCode('ABC123'), false);   // te kort
  assert.strictEqual(v.isValidSessionCode('ABC123456'), false); // te lang
  assert.strictEqual(v.isValidSessionCode('ABC-1234'), false); // streepje
  assert.strictEqual(v.isValidSessionCode(''), false);
  assert.strictEqual(v.isValidSessionCode(null), false);
  assert.strictEqual(v.isValidSessionCode('"ABC12345"'), false); // JSON quotes (29a bug!)
});

// ── Config-sleutels (whitelist) ───────────────────────────────────────────────
test('config-sleutel: toegestane sleutels', () => {
  assert.strictEqual(v.isAllowedConfigKey('autoIndent'), true);
  assert.strictEqual(v.isAllowedConfigKey('autoClosingBrackets'), true);
  assert.strictEqual(v.isAllowedConfigKey('parameterHints'), true);
});

test('config-sleutel: verboden sleutels geweigerd', () => {
  assert.strictEqual(v.isAllowedConfigKey('evilKey'), false);
  assert.strictEqual(v.isAllowedConfigKey('__proto__'), false);
  assert.strictEqual(v.isAllowedConfigKey(''), false);
});

test('config-waarde: enkel booleans', () => {
  assert.strictEqual(v.isValidConfigValue(true), true);
  assert.strictEqual(v.isValidConfigValue(false), true);
  assert.strictEqual(v.isValidConfigValue('true'), false);
  assert.strictEqual(v.isValidConfigValue(1), false);
  assert.strictEqual(v.isValidConfigValue(null), false);
});

// ── clampString ───────────────────────────────────────────────────────────────
test('clampString: begrenst lengte', () => {
  assert.strictEqual(v.clampString('hallo wereld', 5), 'hallo');
  assert.strictEqual(v.clampString('kort', 100), 'kort');
});

test('clampString: trimt witruimte', () => {
  assert.strictEqual(v.clampString('  spaties  ', 100), 'spaties');
});

test('clampString: niet-string → lege string', () => {
  assert.strictEqual(v.clampString(null, 10), '');
  assert.strictEqual(v.clampString(123, 10), '');
});

// ── clampInt ──────────────────────────────────────────────────────────────────
test('clampInt: binnen grenzen', () => {
  assert.strictEqual(v.clampInt('45', 1, 240, 60), 45);
});

test('clampInt: onder minimum → min', () => {
  assert.strictEqual(v.clampInt('0', 1, 240, 60), 1);
});

test('clampInt: boven maximum → max', () => {
  assert.strictEqual(v.clampInt('500', 1, 240, 60), 240);
});

test('clampInt: ongeldig → fallback', () => {
  assert.strictEqual(v.clampInt('abc', 1, 240, 60), 60);
  assert.strictEqual(v.clampInt(null, 1, 240, 60), 60);
});

// ── isValidRole ───────────────────────────────────────────────────────────────
test('rol: geldige rollen', () => {
  assert.strictEqual(v.isValidRole('teacher'), true);
  assert.strictEqual(v.isValidRole('admin'), true);
});

test('rol: ongeldige rollen geweigerd', () => {
  assert.strictEqual(v.isValidRole('superadmin'), false);
  assert.strictEqual(v.isValidRole('student'), false);
  assert.strictEqual(v.isValidRole(''), false);
});

// ── 30-cfg: apply-session-config scenario (server-validatie) ──────────────────
// Simuleert de filtering die server.js doet bij teacher_apply_session_config:
// enkel whitelisted sleutels met booleanwaarden worden toegepast.
function filterConfig(incoming) {
  const out = {};
  let applied = 0;
  for (const [key, value] of Object.entries(incoming)) {
    if (v.isAllowedConfigKey(key) && v.isValidConfigValue(value)) {
      out[key] = value;
      applied++;
    }
  }
  return { out, applied };
}

test('apply-config: geldige volledige config volledig toegepast', () => {
  const { out, applied } = filterConfig({
    autoIndent: true, autoClosingBrackets: false, autoClosingQuotes: true,
    quickSuggestions: false, parameterHints: true,
  });
  assert.strictEqual(applied, 5);
  assert.strictEqual(out.autoIndent, true);
  assert.strictEqual(out.autoClosingBrackets, false);
});

test('apply-config: onbekende sleutel geweigerd', () => {
  const { out, applied } = filterConfig({ autoIndent: true, evilKey: true, __proto__: false });
  assert.strictEqual(applied, 1);
  assert.strictEqual(out.autoIndent, true);
  assert.strictEqual('evilKey' in out, false);
});

test('apply-config: niet-boolean waarde geweigerd', () => {
  const { out, applied } = filterConfig({ autoIndent: 'ja', quickSuggestions: 1, parameterHints: true });
  assert.strictEqual(applied, 1);
  assert.strictEqual(out.parameterHints, true);
  assert.strictEqual('autoIndent' in out, false);
});

test('apply-config: lege config → niets toegepast', () => {
  const { applied } = filterConfig({});
  assert.strictEqual(applied, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 48a3 — E-maildomeinen per school
// De 8 gevallen uit het testboek (§64), plus de randgevallen.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Exact domein ──
test('48a3: "athkiel.be" laat het exacte domein toe', () => {
  assert.strictEqual(v.domainMatches('marie@athkiel.be', 'athkiel.be'), true);
});

test('48a3: "athkiel.be" weigert een subdomein (exact betekent exact)', () => {
  assert.strictEqual(v.domainMatches('marie@leerling.athkiel.be', 'athkiel.be'), false);
});

// ── Wildcard ──
test('48a3: "*.athkiel.be" laat een subdomein toe', () => {
  assert.strictEqual(v.domainMatches('marie@leerling.athkiel.be', '*.athkiel.be'), true);
});

test('48a3: "*.athkiel.be" laat alles eronder toe', () => {
  assert.strictEqual(v.domainMatches('marie@a.b.athkiel.be', '*.athkiel.be'), true);
});

test('48a3: "*.athkiel.be" weigert het KALE domein (bewust verschil)', () => {
  assert.strictEqual(v.domainMatches('marie@athkiel.be', '*.athkiel.be'), false);
});

// ── De aanvallen ──
test('48a3 KERNTEST: athkiel.be.aanvaller.com wordt ALTIJD geweigerd', () => {
  // Een naïeve check op "bevat athkiel.be" zou dit binnenlaten.
  assert.strictEqual(v.domainMatches('marie@athkiel.be.aanvaller.com', 'athkiel.be'), false);
  assert.strictEqual(v.domainMatches('marie@athkiel.be.aanvaller.com', '*.athkiel.be'), false);
});

test('48a3 KERNTEST: nepathkiel.be wordt geweigerd (de punt telt)', () => {
  assert.strictEqual(v.domainMatches('marie@nepathkiel.be', '*.athkiel.be'), false);
  assert.strictEqual(v.domainMatches('marie@nepathkiel.be', 'athkiel.be'), false);
});

// ── Normalisatie ──
test('48a3: hoofdletters worden genormaliseerd', () => {
  assert.strictEqual(v.domainMatches('MARIE@ATHKIEL.BE', 'athkiel.be'), true);
  assert.strictEqual(v.domainMatches('marie@athkiel.be', 'ATHKIEL.BE'), true);
});

test('48a3: een afsluitende punt glipt er niet langs', () => {
  // 'marie@athkiel.be.' is technisch een geldig FQDN — zonder normalisatie zou dit
  // NIET matchen en de leerling onterecht weigeren.
  assert.strictEqual(v.domainMatches('marie@athkiel.be.', 'athkiel.be'), true);
});

test('48a3: adres met meerdere @ → het LAATSTE deel telt', () => {
  assert.strictEqual(v.domeinUitEmail('rare"@"naam@athkiel.be'), 'athkiel.be');
});

test('48a3: geen @ of lege invoer → geen match', () => {
  assert.strictEqual(v.domainMatches('geen-adres', 'athkiel.be'), false);
  assert.strictEqual(v.domainMatches('', 'athkiel.be'), false);
  assert.strictEqual(v.domainMatches('marie@athkiel.be', ''), false);
});

// ── Meerdere domeinen ──
test('48a3: emailPastBijDomeinen — één match volstaat', () => {
  const lijst = ['athkiel.be', '*.athkiel.be'];
  assert.strictEqual(v.emailPastBijDomeinen('marie@athkiel.be', lijst), true);
  assert.strictEqual(v.emailPastBijDomeinen('marie@leerling.athkiel.be', lijst), true);
  assert.strictEqual(v.emailPastBijDomeinen('marie@gmail.com', lijst), false);
  assert.strictEqual(v.emailPastBijDomeinen('marie@athkiel.be', []), false);
});

// ── Validatie bij het invoeren ──
test('48a3: "@athkiel.be" wordt vergevingsgezind opgeschoond', () => {
  const r = v.valideerDomein('  @Athkiel.BE ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.waarde, 'athkiel.be');
});

test('48a3: "*athkiel.be" (zonder punt) → melding over de juiste vorm', () => {
  const r = v.valideerDomein('*athkiel.be');
  assert.strictEqual(r.ok, false);
  assert.match(r.fout, /wildcard begint met/i);
});

test('48a3 KERNTEST: "*.be" is te breed en wordt geweigerd', () => {
  const r = v.valideerDomein('*.be');
  assert.strictEqual(r.ok, false);
  assert.match(r.fout, /te breed/i);
});

test('48a3: "*.com" idem', () => {
  assert.strictEqual(v.valideerDomein('*.com').ok, false);
});

test('48a3: "*.athkiel.be" is wél geldig', () => {
  const r = v.valideerDomein('*.athkiel.be');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.waarde, '*.athkiel.be');
});

test('48a3: spatie of @ middenin → melding "geef enkel het domein"', () => {
  assert.match(v.valideerDomein('athkiel be').fout, /enkel het domein/i);
  assert.match(v.valideerDomein('marie@athkiel.be').fout, /enkel het domein/i);
});

test('48a3: zonder punt is het geen domein', () => {
  assert.strictEqual(v.valideerDomein('athkiel').ok, false);
  assert.strictEqual(v.valideerDomein('').ok, false);
});

test('48a3: rare tekens worden geweigerd', () => {
  assert.strictEqual(v.valideerDomein('athkiel!.be').ok, false);
  assert.strictEqual(v.valideerDomein('athkiel .be').ok, false);
});

test('48a3: koppeltekens en cijfers mogen', () => {
  assert.strictEqual(v.valideerDomein('sint-jan2.athkiel.be').ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 48b1 — Automatische schoolkeuze bij het inloggen
// ═══════════════════════════════════════════════════════════════════════════════

test('48b1: geen scholen → null (dit is vandaag de normale toestand)', () => {
  assert.strictEqual(v.kiesActieveSchool([]), null);
  assert.strictEqual(v.kiesActieveSchool(), null);
  assert.strictEqual(v.kiesActieveSchool(null), null);
});

test('48b1: precies 1 school → die wordt meteen actief', () => {
  assert.strictEqual(v.kiesActieveSchool([{ id: 's1', name: 'Atheneum', active: true }]), 's1');
});

test('48b1: meerdere scholen → null, de leerkracht kiest zelf (48b2)', () => {
  assert.strictEqual(v.kiesActieveSchool([
    { id: 's1', active: true }, { id: 's2', active: true },
  ]), null);
});

test('48b1: een INACTIEVE school telt niet mee', () => {
  // Ook al is het je enige: op een uitgeschakelde school hoor je niet te belanden.
  assert.strictEqual(v.kiesActieveSchool([{ id: 's1', active: false }]), null);
});

test('48b1: 2 scholen waarvan 1 inactief → de actieve wordt gekozen', () => {
  assert.strictEqual(v.kiesActieveSchool([
    { id: 's1', active: false }, { id: 's2', active: true },
  ]), 's2');
});

test('48b1: active ontbreekt → als actief beschouwd', () => {
  assert.strictEqual(v.kiesActieveSchool([{ id: 's1' }]), 's1');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 43.14 — Expliciet toets/taak-type (isValidAssignmentType)
//
// Bug die dit voorkomt: "+ Nieuwe taak" opende een scherm dat het type afleidde
// uit de timerkeuze (noTimer ? 'taak' : 'toets') met timer standaard AAN → dus
// altijd een toets, ongeacht welke knop je had aangeklikt. Vanaf nu is het type
// EXPLICIET (komt uit de link) en wordt het hier — net als elk ander verplicht
// veld — gevalideerd i.p.v. blind vertrouwd.
// ═══════════════════════════════════════════════════════════════════════════════

test('43.14 KERNTEST: enkel "toets" en "taak" zijn geldig', () => {
  assert.strictEqual(v.isValidAssignmentType('toets'), true);
  assert.strictEqual(v.isValidAssignmentType('taak'), true);
});

test('43.14: ontbrekend of leeg type → ongeldig (geen gok naar "toets")', () => {
  assert.strictEqual(v.isValidAssignmentType(undefined), false);
  assert.strictEqual(v.isValidAssignmentType(null), false);
  assert.strictEqual(v.isValidAssignmentType(''), false);
});

test('43.14: type mag niet afgeleid worden uit iets anders dan de twee toegestane waarden', () => {
  assert.strictEqual(v.isValidAssignmentType('quiz'), false);
  assert.strictEqual(v.isValidAssignmentType('exam'), false);
  assert.strictEqual(v.isValidAssignmentType('Toets'), false); // hoofdlettergevoelig
  assert.strictEqual(v.isValidAssignmentType(true), false);
  assert.strictEqual(v.isValidAssignmentType(0), false);
});
