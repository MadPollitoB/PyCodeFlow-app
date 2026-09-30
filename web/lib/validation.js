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
  heeftInhoud = false, submittedAt = null, submittedBy = null, now = Date.now(),
} = {}) {
  if (handmatigeStatus) return handmatigeStatus;                 // 'gewettigd'
  if (lidSinds && deadline && Number(lidSinds) > Number(deadline)) return 'nvt';
  if (!heeftInhoud) return 'niets';
  // Bugfix (sprint 81): "wel inhoud maar nog niet ingediend" gaf hier altijd 'te_laat'
  // terug, zelfs als de toets/taak nog gewoon OPEN staat (deadline nog niet verstreken)
  // — een leerling die simpelweg nog aan het werk is, zag zichzelf dan al als "te laat"
  // getoond bij de leerkracht, wat nooit klopte. 'te_laat' betekent nu enkel nog: er is
  // geen indiening EN de deadline is al voorbij. Zolang de deadline nog niet verstreken
  // is (of er is geen deadline), is dat gewoon 'bezig'.
  if (!submittedAt) return (deadline && Number(now) > Number(deadline)) ? 'te_laat' : 'bezig';
  if (submittedBy === 'teacher') return 'te_laat';
  if (submittedBy === 'timer' || submittedBy === 'deadline') return 'op_tijd';
  // Sprint 84: anti-spiek (sprint 83) diende voorheen gewoon door naar 'op_tijd' (de
  // deadline was doorgaans nog niet voorbij op het moment van de overtreding) — de
  // leerkracht zag zo'n leerling dan onopzettelijk als een gewone, tijdige inzending,
  // zonder enig signaal dat er iets aan de hand was. Een eigen status maakt dit meteen
  // zichtbaar in Voortgang/Klasmatrix/Excel (die lezen allemaal generisch uit
  // INLEVER_STATUSSEN), zodat de leerkracht bewust kan beslissen: laten staan, of
  // heropenen (de "↺ Heropenen"-knop werkte an sich al voor élke ingediende status,
  // maar was tot nu toe niet makkelijk te vínden voor dit specifieke geval).
  if (submittedBy === 'tab_switch') return 'tab_switch';
  if (deadline && Number(submittedAt) > Number(deadline)) return 'te_laat';
  return 'op_tijd';
}

// Telt deze status mee in het klasgemiddelde? Gewettigd afwezig, n.v.t. en "nog bezig"
// (de toets/taak staat nog open, dus dit is geen definitief resultaat) niet.
function teltMeeVoorGemiddelde(status) {
  return status !== 'gewettigd' && status !== 'nvt' && status !== 'bezig';
}

// Sprint 86: "↺ Heropenen" zet een leerling terug op "bezig" zodat hij verder kan werken —
// maar zodra de toets/taak ZELF afgelopen is (gestopt door de leerkracht, of de deadline
// is verstreken), kan die leerling er sowieso niet meer in: `quiz_start` weigert dat altijd,
// ongeacht de per-leerling indienstatus. Heropenen leek dan wel iets te doen, maar loste
// niets op — de leerling bleef even vast zitten. Deze pure functie is de ene bron van
// waarheid voor "mag dit nog?", gebruikt zowel voor de knop zelf (verbergen i.p.v. tonen)
// als voor de server-side validatie bij de heropen-actie (nooit enkel op de client
// vertrouwen). Een leerkracht die dit toch nodig heeft, verlengt eerst de deadline via
// "Bewerken" — dan werkt Heropenen weer.
function magHeropenen({ stoppedAt = null, deadline = null, now = Date.now() } = {}) {
  if (stoppedAt) return false;
  if (deadline && Number(now) > Number(deadline)) return false;
  return true;
}

const INLEVER_STATUSSEN = {
  op_tijd:    { label: 'Op tijd ingeleverd', icoon: '✅', kleur: 'C6EFCE' },
  te_laat:    { label: 'Te laat',            icoon: '🟠', kleur: 'FFE0B2' },
  bezig:      { label: 'Bezig (nog niet ingediend)', icoon: '🕓', kleur: 'FDE68A' },
  // Sprint 84: automatisch ingediend door anti-spiek (te veel tabwissels/fullscreen
  // verlaten tijdens een toets). Telt WEL mee voor het gemiddelde (het is een échte
  // inzending, net als bij een timer/deadline) — enkel het label/icoon is anders, zodat
  // de leerkracht dit meteen opmerkt en zelf kan beslissen: laten staan, of heropenen.
  tab_switch: { label: 'Auto-ingediend (tabwissel)', icoon: '🚫', kleur: 'FCA5A5' },
  niets:      { label: 'Niets ingeleverd',   icoon: '⬜', kleur: 'E2E8F0' },
  gewettigd:  { label: 'Gewettigd afwezig',  icoon: '🅰', kleur: 'BBDEFB' },
  nvt:        { label: 'Nog geen lid',       icoon: '➖', kleur: 'F5F5F5' },
};

// ── Sprint 89: "is deze vraag beantwoord?" — server-kant tegenhanger van de
// client-functie heeftAntwoord() in quiz-student.js (sprint 71). Nodig zodat de
// leerkracht in de Voortgang ook écht kan zien hoeveel vragen een leerling al
// beantwoord heeft (X/Y), zonder daarvoor op de leerling zijn eigen, ongeverifieerde
// in-memory status te moeten vertrouwen. Werkt op een opgeslagen quiz_answers-rij
// (server-veldnamen: code, part_answers, answer_flowchart_json, selected_choices — de
// vertaling van de camelCase-clientvelden naar deze snake_case-DB-kolommen gebeurt in
// database.js/server.js, niet hier), en moet exact dezelfde regel volgen per vraagtype
// als de client, anders lopen de twee tellingen (student vs. leerkracht) uiteen.
function heeftAntwoordServer(questionType, rij = {}) {
  const qType = questionType || 'code';
  if (qType === 'code' || qType === 'open') {
    return !!(rij.code && String(rij.code).trim());
  }
  if (qType === 'composite') {
    let pa = {};
    try { pa = JSON.parse(rij.part_answers || '{}') || {}; } catch { pa = {}; }
    return Object.values(pa).some(v => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim()));
  }
  if (qType === 'stroomdiagram') {
    try {
      const d = JSON.parse(rij.answer_flowchart_json || '');
      return Array.isArray(d?.blocks) && d.blocks.length > 0;
    } catch { return false; }
  }
  // single / multiple (keuzevragen)
  let keuzes = [];
  try { keuzes = JSON.parse(rij.selected_choices || '[]'); } catch { keuzes = []; }
  return Array.isArray(keuzes) && keuzes.length > 0;
}

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

// ── Sprint 83: anti-spiek voor een toets (nooit voor een taak) ──────────────────
// "Automatisch indienen bij tabwissel" + "verplicht volledig scherm" gelden enkel
// bij een toets. Deze functie is de ENE plek die beslist wat er effectief opgeslagen
// wordt, zodat server.js (aanmaken én bewerken) niet twee keer dezelfde regel
// hoeft te herhalen — en zodat we dit apart en zonder een draaiende server kunnen
// testen. Een taak krijgt ALTIJD enabled=false/threshold=0, ongeacht wat een
// aanroeper (opzettelijk of per vergissing) meestuurt.
function bepaalTabWisselInstellingen({ type, enabled, threshold, graceSeconds } = {}) {
  const magSpiekbeveiliging = type === 'toets';
  const effectiveEnabled = magSpiekbeveiliging && enabled === true;
  const effectiveThreshold = effectiveEnabled ? clampInt(threshold, 1, 20, 1) : 0;
  // Sprint 94: het respijt (tot dan vast op 5 sec) is nu instelbaar per toets, tussen 0
  // (geen respijt, telt onmiddellijk) en 30 sec. Bij een uitstaande anti-spiek blijft dit
  // altijd de veilige default (5), zodat een latere heractivering niet op een rare 0
  // uitkomt die de leerkracht nooit bewust koos.
  const effectiveGraceSeconds = effectiveEnabled ? clampInt(graceSeconds, 0, 30, 5) : 5;
  return { enabled: effectiveEnabled, threshold: effectiveThreshold, graceSeconds: effectiveGraceSeconds };
}

// Cursus-link (optioneel zijpaneel tijdens een toets): leeg is toegestaan (= geen
// cursus), anders moet het een https-link zijn. Enkel https, om twee redenen: (1)
// een http-iframe in een https-pagina wordt door browsers standaard geblokkeerd
// ("gemengde inhoud"), en (2) de CSP frame-src op quiz-student.html staat bewust
// enkel https: toe.
function isValidCursusUrl(url) {
  if (url === null || url === undefined || url === '') return true;
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2000) return false;
  return /^https:\/\//i.test(trimmed);
}

// ── Sprint 90: zelfevaluatie-enquête ná het indienen (enkel bij een toets) ──────
// Vaste, niet-configureerbare vragenlijst (leerkracht kan enkel aan/uit zetten
// per toets — nooit de inhoud aanpassen). id's zijn stabiel: ze worden gebruikt
// als sleutels in antwoorden_json en mogen dus nooit hernoemd worden zonder
// bestaande data te breken.
const ENQUETE_STEMMINGEN = [
  { id: 'zeer_slecht', icoon: '💀', label: 'Heel slecht' },
  { id: 'slecht', icoon: '☹️', label: 'Slecht' },
  { id: 'neutraal', icoon: '😐', label: 'Neutraal' },
  { id: 'goed', icoon: '🙂', label: 'Goed' },
  { id: 'uitstekend', icoon: '⭐', label: 'Uitstekend' },
];

const ENQUETE_CATEGORIEEN = [
  {
    id: 'voorbereiding',
    titel: 'Voorbereiding',
    items: [
      { id: 'gelezen_1x', tekst: 'Ik heb de leerstof 1 keer gelezen.' },
      { id: 'gelezen_meermaals', tekst: 'Ik heb de leerstof meerdere keren gelezen.' },
      { id: 'grondig_geleerd', tekst: 'Ik heb de leerstof grondig geleerd.' },
    ],
  },
  {
    id: 'verwerking',
    titel: 'Verwerking van de leerstof',
    items: [
      { id: 'samenvatting', tekst: 'Ik heb een samenvatting gemaakt.' },
      { id: 'herhaald_3x', tekst: 'Ik heb de samenvatting minstens 3 keer herhaald.' },
      { id: 'begrippenlijst', tekst: 'Ik heb een begrippenlijst geleerd.' },
      { id: 'extra_uitleg', tekst: 'Ik heb extra uitleg gevraagd (aan de leerkracht of een klasgenoot).' },
      { id: 'ondervraagd', tekst: 'Iemand heeft mij ondervraagd.' },
    ],
  },
  {
    id: 'oefenen',
    titel: 'Oefenen',
    items: [
      { id: 'oefeningen_gemaakt', tekst: 'Ik heb oefeningen gemaakt.' },
      { id: 'oefeningen_herhaald', tekst: 'Ik heb oefeningen opnieuw gemaakt / herhaald.' },
      { id: 'extra_oefeningen', tekst: 'Ik heb extra oefeningen gemaakt (online of in het boek).' },
      { id: 'geen_oefeningen', tekst: 'Ik heb geen oefeningen gemaakt.' },
    ],
  },
  {
    id: 'planning',
    titel: 'Planning',
    items: [
      { id: 'op_tijd', tekst: 'Ik ben op tijd begonnen met leren (enkele dagen op voorhand).' },
      { id: 'laat', tekst: 'Ik ben laat begonnen (de dag ervoor).' },
      { id: 'zelfde_dag', tekst: 'Ik ben pas op de dag zelf begonnen.' },
    ],
  },
  {
    id: 'aandachtspunten',
    titel: 'Aandachtspunten',
    items: [
      { id: 'niet_voldoende', tekst: 'Ik heb niet (voldoende) geleerd.' },
      { id: 'verkeerde_leerstof', tekst: 'Ik heb de verkeerde leerstof geleerd.' },
      { id: 'vergeten', tekst: 'Ik was vergeten dat er een toets was.' },
    ],
  },
];

// Toets-only gate, zelfde patroon als bepaalTabWisselInstellingen hierboven: een
// taak krijgt ALTIJD false, ongeacht wat een aanroeper meestuurt.
function bepaalZelfevaluatieInstelling({ type, enabled } = {}) {
  return type === 'toets' && enabled === true;
}

// Server-side validatie van een ingevulde enquête. Wordt enkel gebruikt om te
// beslissen of een enquête de moeite waard is om op te slaan (dbModule.saveZelfevaluatie)
// — een ontbrekende of ongeldige enquête mag NOOIT de eigenlijke toets-inzending
// laten mislukken; "verplicht" is een client-side UX-regel (knop blijft
// uitgeschakeld), geen harde server-side afwijzingsregel.
function valideerZelfevaluatie({ stemming, antwoorden } = {}) {
  const geldigeStemmingen = ENQUETE_STEMMINGEN.map((s) => s.id);
  if (typeof stemming !== 'string' || !geldigeStemmingen.includes(stemming)) {
    return { ok: false, fout: 'ongeldige_stemming' };
  }
  if (!antwoorden || typeof antwoorden !== 'object') {
    return { ok: false, fout: 'ontbrekende_antwoorden' };
  }
  for (const categorie of ENQUETE_CATEGORIEEN) {
    const geldigeItemIds = categorie.items.map((it) => it.id);
    const gekozen = Array.isArray(antwoorden[categorie.id]) ? antwoorden[categorie.id] : [];
    const heeftGeldigItem = gekozen.some((id) => geldigeItemIds.includes(id));
    if (!heeftGeldigItem) {
      return { ok: false, fout: `categorie_leeg:${categorie.id}` };
    }
  }
  return { ok: true, fout: null };
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
  magHeropenen,
  INLEVER_STATUSSEN,
  normaliseerDomein,
  valideerDomein,
  // Sprint 48b1: automatische schoolkeuze
  kiesActieveSchool,
  // Sprint 43.14: expliciet toets/taak-type
  isValidAssignmentType,
  // Sprint 83: anti-spiek (fullscreen verplicht + auto-indienen bij tabwissel)
  bepaalTabWisselInstellingen,
  isValidCursusUrl,
  // Sprint 89: voortgang (X/Y beantwoord) in de Voortgang-weergave van de leerkracht
  heeftAntwoordServer,
  // Sprint 90: zelfevaluatie-enquête ná het indienen (enkel bij een toets)
  ENQUETE_STEMMINGEN,
  ENQUETE_CATEGORIEEN,
  bepaalZelfevaluatieInstelling,
  valideerZelfevaluatie,
};
