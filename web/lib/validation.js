// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Input-validatie helpers (pure, testbaar)
// Sprint 34a: basis voor consistente API-validatie (zie ook sprint 36c).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// Sessiecode: 8 hoofdletters/cijfers (formaat gebruikt door de app).
function isValidSessionCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code);
}

// Config-sleutels die via session-config aangepast mogen worden (whitelist).
const ALLOWED_CONFIG_KEYS = [
  'autoIndent', 'autoClosingBrackets', 'autoClosingQuotes',
  'quickSuggestions', 'parameterHints',
];

function isAllowedConfigKey(key) {
  return ALLOWED_CONFIG_KEYS.includes(key);
}

// Config-waarde moet boolean zijn.
function isValidConfigValue(value) {
  return typeof value === 'boolean';
}

// Begrens een string tot maxLen (trim + slice). Niet-strings → ''.
function clampString(value, maxLen) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

// Geheel getal binnen [min, max]; ongeldige input → fallback.
function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Rol-validatie voor leerkrachtaccounts.
// ── Sprint 48a3: e-maildomeinen per school ───────────────────────────────────
// Twee vormen, met een BEWUST verschil:
//   'athkiel.be'    → exact dat domein          ✓ marie@athkiel.be
//                                                ✗ marie@leerling.athkiel.be
//   '*.athkiel.be'  → enkel subdomeinen         ✓ marie@leerling.athkiel.be
//                                                ✗ marie@athkiel.be
// Wie beide wil, zet beide regels. Dat is strenger dan "wildcard dekt ook het
// hoofddomein", maar wél voorspelbaar — je krijgt precies wat er staat.

// Haalt het domein uit een adres: alles na de LAATSTE @ (een adres mag er meer bevatten),
// kleine letters, en een afsluitende punt weg — anders glipt 'marie@athkiel.be.' erlangs.
function domeinUitEmail(email) {
  const s = String(email || '').trim();
  if (!s.includes('@')) return '';
  return s.split('@').pop().toLowerCase().replace(/\.$/, '');
}

// Kern van de beveiliging: ANKEREN OP HET EINDE, nooit "bevat".
// Een naïeve check op "bevat athkiel.be" laat marie@athkiel.be.aanvaller.com binnen.
function domainMatches(email, pattern) {
  const d = domeinUitEmail(email);
  const p = String(pattern || '').trim().toLowerCase();
  if (!d || !p) return false;
  if (p.startsWith('*.')) {
    // '*.athkiel.be' → achtervoegsel '.athkiel.be' MET punt. Daardoor vallen af:
    // 'nepathkiel.be' (geen punt ervoor) en het kale 'athkiel.be' (punt ontbreekt).
    return d.endsWith(p.slice(1));
  }
  return d === p;
}

function emailPastBijDomeinen(email, patronen = []) {
  return patronen.some(p => domainMatches(email, p));
}

// Sprint 52c: basale e-mailvorm-check (iets@iets.tld). Bewust simpel — de echte grendel
// is de schooldomein-check; dit vangt enkel tikfouten en onzin op. Puur + testbaar.
// Sprint 61: periodesleutel 'JJJJ-MM' voor de maandelijkse leerlingtelling.
// Puur en testbaar; overal dezelfde vorm zodat sorteren op tekst ook chronologisch is.
function maandPeriode(datum = new Date()) {
  const d = datum instanceof Date ? datum : new Date(datum);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── Sprint 70: één plek die bepaalt hoe een leerling ervoor staat ───────────
// Scherm, klasmatrix en Excel-export gebruiken allemaal deze functie, zodat ze nooit
// iets anders kunnen zeggen. Geeft: 'gewettigd' | 'nvt' | 'op_tijd' | 'te_laat' | 'niets'.
//
// De regels (afgesproken met de leerkracht):
//  • gewettigd afwezig overrulet alles en telt NIET mee voor het gemiddelde;
//  • lid geworden ná de deadline → 'nvt' (die toets bestond nog niet voor hem);
//  • geen inhoud (niets getypt, niets aangeklikt, nooit uitgevoerd) → 'niets',
//    óók als het systeem een lege inzending indiende;
//  • wél inhoud én ingediend:
//      - door de leerling zelf   → op tijd, tenzij ná de deadline ingediend;
//      - door de timer/deadline  → op tijd (hij mocht doorwerken tot het einde);
//      - door de leerkracht (⏹)  → te laat (hij had zelf niet ingediend);
//  • wél inhoud maar nooit ingediend → te laat.
function bepaalInleverStatus({
  handmatigeStatus = null, lidSinds = null, deadline = null,
  heeftInhoud = false, submittedAt = null, submittedBy = null,
} = {}) {
  if (handmatigeStatus) return handmatigeStatus;                 // 'gewettigd'
  if (lidSinds && deadline && Number(lidSinds) > Number(deadline)) return 'nvt';
  if (!heeftInhoud) return 'niets';
  if (!submittedAt) return 'te_laat';
  if (submittedBy === 'teacher') return 'te_laat';
  if (submittedBy === 'timer' || submittedBy === 'deadline') return 'op_tijd';
  if (deadline && Number(submittedAt) > Number(deadline)) return 'te_laat';
  return 'op_tijd';
}

// Telt deze status mee in het klasgemiddelde? Gewettigd afwezig en n.v.t. niet.
function teltMeeVoorGemiddelde(status) {
  return status !== 'gewettigd' && status !== 'nvt';
}

const INLEVER_STATUSSEN = {
  op_tijd:   { label: 'Op tijd ingeleverd', icoon: '✅', kleur: 'C6EFCE' },
  te_laat:   { label: 'Te laat',            icoon: '🟠', kleur: 'FFE0B2' },
  niets:     { label: 'Niets ingeleverd',   icoon: '⬜', kleur: 'E2E8F0' },
  gewettigd: { label: 'Gewettigd afwezig',  icoon: '🅰', kleur: 'BBDEFB' },
  nvt:       { label: 'Nog geen lid',       icoon: '➖', kleur: 'F5F5F5' },
};

function isGeldigEmail(email) {
  const s = String(email || '').trim();
  if (s.length < 5 || s.length > 254) return false;
  if (/\s/.test(s)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(s);
}

// Vergevingsgezind waar het kan: '@Athkiel.BE ' → 'athkiel.be'
function normaliseerDomein(invoer) {
  return String(invoer || '').trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
}

// Geeft { ok, waarde, fout } — de fout is de tekst die de beheerder te zien krijgt.
function valideerDomein(invoer) {
  const d = normaliseerDomein(invoer);
  if (!d) return { ok: false, fout: 'Geef een domein in, bv. athkiel.be' };
  if (/\s/.test(d) || d.includes('@')) {
    return { ok: false, fout: 'Geef enkel het domein, bv. athkiel.be' };
  }
  if (d.startsWith('*') && !d.startsWith('*.')) {
    return { ok: false, fout: 'Een wildcard begint met *. — bv. *.athkiel.be' };
  }
  const kern = d.startsWith('*.') ? d.slice(2) : d;
  if (!kern) return { ok: false, fout: 'Dat is geen geldig domein, bv. athkiel.be' };
  if (!/^[a-z0-9.-]+$/.test(kern)) {
    return { ok: false, fout: 'Een domein bevat enkel letters, cijfers, punten en koppeltekens.' };
  }
  // LET OP de volgorde: eerst "te breed", dan pas "geen geldig domein".
  // '*.be' heeft een geldige vorm maar is rampzalig — dan kan IEDEREEN met een
  // .be-adres zich bij deze school registreren. Die verdient zijn eigen melding;
  // "geen geldig domein" zou de beheerder op het verkeerde been zetten.
  if (d.startsWith('*.') && !kern.includes('.')) {
    return { ok: false, fout: `"${d}" is te breed: dan kan iedereen met een .${kern}-adres zich registreren. Gebruik bv. *.athkiel.be` };
  }
  if (!kern.includes('.') || kern.startsWith('.') || kern.endsWith('.')) {
    return { ok: false, fout: 'Dat is geen geldig domein, bv. athkiel.be' };
  }
  return { ok: true, waarde: d };
}

// ── Sprint 48b1: welke school wordt actief bij het inloggen? ─────────────────
// Pure regel, zodat elk geval getest kan worden zonder databank.
//
//   0 scholen  → null. Dit is vandaag de normale toestand: er hangt nog niets aan een
//                school. Alles blijft werken zoals altijd — daarom breekt 48b1 niets.
//   1 school   → meteen die. Geen keuzescherm voor een keuze die er niet is.
//   meerdere   → null; de leerkracht kiest zelf (48b2).
//
// Enkel ACTIEVE scholen tellen: op een uitgeschakelde school hoor je niet te belanden,
// ook niet als het toevallig je enige is.
function kiesActieveSchool(scholen = []) {
  const bruikbaar = (scholen || []).filter(s => s && s.active !== false);
  if (bruikbaar.length === 1) return bruikbaar[0].id;
  return null;
}

function isValidRole(role) {
  // 48c4: 'superadmin' = hosting-beheerder (over scholen heen).
  return role === 'teacher' || role === 'admin' || role === 'superadmin';
}

// ── Sprint 43.14: toets/taak-type is voortaan EXPLICIET, niet afgeleid uit de
// timerkeuze (dat was de bug: "+ Nieuwe taak" maakte via een hardgecodeerd scherm
// gewoon een toets). Het type komt uit de link waarmee het aanmaakscherm geopend
// werd en staat al vast op het moment van openen — de server vertrouwt het client-
// veld dus niet blind, maar valideert het net zoals elk ander verplicht veld.
function isValidAssignmentType(type) {
  return type === 'toets' || type === 'taak';
}

module.exports = {
  isValidSessionCode,
  ALLOWED_CONFIG_KEYS,
  isAllowedConfigKey,
  isValidConfigValue,
  clampString,
  clampInt,
  isValidRole,
  // Sprint 48a3: e-maildomeinen per school
  domeinUitEmail,
  domainMatches,
  emailPastBijDomeinen,
  isGeldigEmail,
  maandPeriode,
  bepaalInleverStatus,
  teltMeeVoorGemiddelde,
  INLEVER_STATUSSEN,
  normaliseerDomein,
  valideerDomein,
  // Sprint 48b1: automatische schoolkeuze
  kiesActieveSchool,
  // Sprint 43.14: expliciet toets/taak-type
  isValidAssignmentType,
};
