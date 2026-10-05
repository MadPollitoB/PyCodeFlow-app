'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 97 — Trainingscenter: pure logica (geen databank, geen Express, geen klok).
// Alles wat beslist of berekent staat hier zodat het rechtstreeks testbaar is.
// ═══════════════════════════════════════════════════════════════════════════════

const MIN_VRAGEN = 10;
const MAX_VRAGEN = 30;
const MIN_ONDERWERPEN = 1;
const MAX_ONDERWERPEN = 5;
const MIN_NIVEAU = 1;
const MAX_NIVEAU = 10;
const VRAAG_TYPES = ['single', 'multiple', 'code'];

// Algemeen instelbaar (training_settings). Dit zijn enkel de startwaarden.
const STANDAARD_INSTELLINGEN = {
  upPct: 75,          // gemiddelde score (%) van de laatste N antwoorden → niveau omhoog
  downPct: 40,        // gemiddelde score (%) → niveau omlaag
  venster: 2,         // N: hoeveel antwoorden tellen mee voor de niveau-beslissing
  startNiveau: 3,     // beginniveau voor een onderwerp zonder geschiedenis
  startOffset: 1,     // een nieuwe training start zoveel niveaus onder het laatst bereikte
  topNiveauMinVragen: 20, // titel van het hoogste niveau vraagt minstens zoveel vragen
  titels: [
    { niveau: 1,  vanaf: 0,   titel: 'Starting Padawan' },
    { niveau: 2,  vanaf: 10,  titel: 'Youngling' },
    { niveau: 3,  vanaf: 20,  titel: 'Padawan Learner' },
    { niveau: 4,  vanaf: 30,  titel: 'Bug Hunter' },
    { niveau: 5,  vanaf: 40,  titel: 'Rebel Coder' },
    { niveau: 6,  vanaf: 50,  titel: 'Rogue Scripter' },
    { niveau: 7,  vanaf: 60,  titel: 'Jedi Knight' },
    { niveau: 8,  vanaf: 75,  titel: 'Jedi Guardian' },
    { niveau: 9,  vanaf: 90,  titel: 'Jedi Council Member' },
    { niveau: 10, vanaf: 100, titel: 'Jedi Code-Master' },
  ],
};

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

// ── Instellingen valideren/normaliseren (admin kan ze wijzigen) ──────────────
function normaliseerInstellingen(invoer) {
  const d = STANDAARD_INSTELLINGEN;
  const i = invoer || {};
  const num = (x, def) => { const n = Number(x); return Number.isFinite(n) ? n : def; };
  const fouten = [];
  let upPct = clamp(num(i.upPct, d.upPct), 1, 100);
  let downPct = clamp(num(i.downPct, d.downPct), 0, 99);
  if (downPct >= upPct) fouten.push('De grens om omlaag te gaan moet lager zijn dan de grens om omhoog te gaan.');
  const venster = clamp(Math.round(num(i.venster, d.venster)), 1, 5);
  const startNiveau = clamp(Math.round(num(i.startNiveau, d.startNiveau)), MIN_NIVEAU, MAX_NIVEAU);
  const startOffset = clamp(Math.round(num(i.startOffset, d.startOffset)), 0, 5);
  const topNiveauMinVragen = clamp(Math.round(num(i.topNiveauMinVragen, d.topNiveauMinVragen)), 1, 100);

  let titels = d.titels;
  if (Array.isArray(i.titels)) {
    const gekuist = i.titels
      .map(t => ({
        niveau: Math.round(Number(t && t.niveau)),
        vanaf: Number(t && t.vanaf),
        titel: String((t && t.titel) || '').trim().slice(0, 40),
      }))
      .filter(t => t.niveau >= MIN_NIVEAU && t.niveau <= MAX_NIVEAU && Number.isFinite(t.vanaf) && t.titel)
      .sort((a, b) => a.niveau - b.niveau);
    if (gekuist.length !== MAX_NIVEAU) {
      fouten.push('Er moeten precies 10 titels zijn (niveau 1 tot 10), elk met een naam.');
    } else {
      const uniek = new Set(gekuist.map(t => t.niveau));
      if (uniek.size !== MAX_NIVEAU) fouten.push('Elk niveau van 1 tot 10 moet precies één titel hebben.');
      for (let k = 1; k < gekuist.length; k++) {
        if (gekuist[k].vanaf < gekuist[k - 1].vanaf) { fouten.push('De scoregrenzen van de titels moeten oplopen.'); break; }
      }
      if (gekuist[0].vanaf !== 0) fouten.push('De eerste titel moet vanaf 0% gelden.');
      titels = gekuist.map(t => ({ niveau: t.niveau, vanaf: clamp(t.vanaf, 0, 100), titel: t.titel }));
    }
  }
  return { instellingen: { upPct, downPct, venster, startNiveau, startOffset, topNiveauMinVragen, titels }, fouten };
}

// ── Instellingen van de training zelf (popup) ────────────────────────────────
function valideerTrainingKeuze({ aantal, topics } = {}, beschikbareTopics = null) {
  const n = Number(aantal);
  if (!Number.isInteger(n) || n < MIN_VRAGEN || n > MAX_VRAGEN) {
    return { ok: false, fout: `Kies tussen ${MIN_VRAGEN} en ${MAX_VRAGEN} vragen.` };
  }
  if (!Array.isArray(topics)) return { ok: false, fout: 'Kies minstens één onderwerp.' };
  const uniek = [...new Set(topics.map(t => String(t || '').trim()).filter(Boolean))];
  if (uniek.length < MIN_ONDERWERPEN) return { ok: false, fout: 'Kies minstens één onderwerp.' };
  if (uniek.length > MAX_ONDERWERPEN) return { ok: false, fout: `Kies maximaal ${MAX_ONDERWERPEN} onderwerpen.` };
  if (beschikbareTopics) {
    const toegestaan = new Set(beschikbareTopics);
    if (uniek.some(t => !toegestaan.has(t))) return { ok: false, fout: 'Een gekozen onderwerp is niet beschikbaar.' };
  }
  return { ok: true, aantal: n, topics: uniek };
}

// ── Niveau-sturing ───────────────────────────────────────────────────────────
// `recent` = scores (0..1) van de laatste antwoorden op het HUIDIGE niveau van dit onderwerp.
// Pas als er `venster` antwoorden zijn beslist het gemiddelde: ≥ upPct → omhoog,
// ≤ downPct → omlaag, ertussen → zelfde niveau (het venster schuift gewoon op).
function nieuwNiveau({ niveau, recent, maxNiveau = MAX_NIVEAU, instellingen = STANDAARD_INSTELLINGEN }) {
  const venster = instellingen.venster;
  const lijst = (recent || []).slice(-venster);
  if (lijst.length < venster) return { niveau, recent: lijst, wijziging: 0 };
  const gem = (lijst.reduce((a, b) => a + b, 0) / lijst.length) * 100;
  if (gem >= instellingen.upPct && niveau < maxNiveau) return { niveau: niveau + 1, recent: [], wijziging: 1 };
  if (gem <= instellingen.downPct && niveau > MIN_NIVEAU) return { niveau: niveau - 1, recent: [], wijziging: -1 };
  return { niveau, recent: lijst, wijziging: 0 };
}

function startNiveauVoor(opgeslagenNiveau, maxNiveau, instellingen = STANDAARD_INSTELLINGEN) {
  const basis = Number.isInteger(opgeslagenNiveau)
    ? opgeslagenNiveau - instellingen.startOffset
    : instellingen.startNiveau;
  return clamp(basis, MIN_NIVEAU, maxNiveau || MAX_NIVEAU);
}

// ── Onderwerp voor de volgende vraag: het onderwerp dat tot nu toe het minst aan bod kwam ──
function kiesOnderwerp(topics, aantalPerTopic, rng = Math.random) {
  let min = Infinity;
  for (const t of topics) min = Math.min(min, aantalPerTopic[t] || 0);
  const kandidaten = topics.filter(t => (aantalPerTopic[t] || 0) === min);
  return kandidaten[Math.floor(rng() * kandidaten.length)];
}

// ── Vraag kiezen ─────────────────────────────────────────────────────────────
// pool: [{id, topic, level, ...}] reeds gefilterd op zichtbaarheid voor deze leerling.
// Elke kandidaat krijgt een "afstand": het niveauverschil (iets zwaarder als de vraag
// moeilijker is dan gevraagd) plus een straf als de leerling de vraag al eerder kreeg.
// De straf (0,75) is bewust kleiner dan één niveau: een al geziene vraag op het juiste
// niveau gaat voor een nieuwe vraag een niveau ernaast, want de sturing moet kloppen.
// Bij gelijke afstand: onbekende vragen willekeurig, geziene vragen de oudst geziene.
// Nooit twee keer dezelfde vraag in één training.
const STRAF_GEZIEN = 0.75;
const STRAF_TE_MOEILIJK = 0.1;

function kiesVraag({ pool, topic, niveau, dezeRun = [], eerderGezien = {}, rng = Math.random }) {
  const run = new Set(dezeRun);
  const kandidaten = pool.filter(q => q.topic === topic && !run.has(q.id));
  if (!kandidaten.length) return null;
  const gezien = id => eerderGezien[id] || 0;               // tijdstip laatst gezien (0 = nooit)
  const gewicht = q => Math.abs(q.level - niveau) + (q.level > niveau ? STRAF_TE_MOEILIJK : 0) + (gezien(q.id) ? STRAF_GEZIEN : 0);
  let min = Infinity;
  for (const q of kandidaten) min = Math.min(min, gewicht(q));
  const beste = kandidaten.filter(q => Math.abs(gewicht(q) - min) < 1e-9);
  const ongezien = beste.filter(q => !gezien(q.id));
  if (ongezien.length) return ongezien[Math.floor(rng() * ongezien.length)];
  return beste.sort((a, b) => gezien(a.id) - gezien(b.id))[0];
}

// ── Nakijken ─────────────────────────────────────────────────────────────────
function scoreSingle(vraag, antwoord) {
  const juist = (vraag.correct || [])[0];
  const gekozen = Array.isArray(antwoord) ? antwoord[0] : antwoord;
  return Number(gekozen) === juist ? 1 : 0;
}

// Meerdere juiste antwoorden: (goed aangevinkt − fout aangevinkt) / aantal juiste, minstens 0.
// Zo loont gokken door alles aan te vinken niet.
function scoreMultiple(vraag, antwoord) {
  const juist = new Set(vraag.correct || []);
  const gekozen = [...new Set((Array.isArray(antwoord) ? antwoord : []).map(Number))];
  if (!juist.size) return 0;
  let goed = 0; let fout = 0;
  for (const g of gekozen) { if (juist.has(g)) goed++; else fout++; }
  return Math.max(0, (goed - fout) / juist.size);
}

// Uitvoer vergelijken: lege regels en spaties achteraan elke regel tellen niet mee.
function normaliseerUitvoer(tekst) {
  return String(tekst == null ? '' : tekst)
    .replace(/\r/g, '')
    .split('\n')
    .map(r => r.replace(/\s+$/, ''))
    .filter(r => r.length > 0)
    .join('\n');
}

function uitvoerKomtOvereen(verwacht, gekregen) {
  return normaliseerUitvoer(verwacht) === normaliseerUitvoer(gekregen);
}

// resultaten: [{ok:boolean}] per test → 0..1
function scoreCode(resultaten) {
  if (!resultaten || !resultaten.length) return 0;
  return resultaten.filter(r => r.ok).length / resultaten.length;
}

// ── Titel ────────────────────────────────────────────────────────────────────
// Het titel-niveau is het LAAGSTE van twee dingen:
//   (a) het hoogste titelniveau waarvan "vanaf" ≤ de score, en
//   (b) het bereikte moeilijkheidsniveau (hoogste eindniveau over de gekozen onderwerpen,
//       herschaald naar 1-10 wanneer een onderwerp een lager maximum heeft).
// Het hoogste titelniveau vraagt bovendien minstens `topNiveauMinVragen` vragen, zodat een
// korte training nooit meteen de top-titel geeft.
function bepaalTitel({ scorePct, bereiktNiveau, aantalVragen, instellingen = STANDAARD_INSTELLINGEN }) {
  const titels = instellingen.titels;
  let perScore = titels[0];
  for (const t of titels) if (scorePct >= t.vanaf) perScore = t;
  let niveau = Math.min(perScore.niveau, clamp(Math.round(bereiktNiveau || 1), MIN_NIVEAU, MAX_NIVEAU));
  const top = titels[titels.length - 1].niveau;
  if (niveau >= top && aantalVragen < instellingen.topNiveauMinVragen) niveau = top - 1;
  const gekozen = titels.find(t => t.niveau === niveau) || titels[0];
  return { niveau: gekozen.niveau, titel: gekozen.titel };
}

// Herschaal een eindniveau van een onderwerp met een eigen maximum naar de 1-10-schaal.
function herschaalNiveau(niveau, maxNiveau) {
  const max = maxNiveau || MAX_NIVEAU;
  if (max >= MAX_NIVEAU) return niveau;
  return clamp(Math.round((niveau / max) * MAX_NIVEAU), MIN_NIVEAU, MAX_NIVEAU);
}

// ── JSON-import van vragen ───────────────────────────────────────────────────
function tekst(x, max) { return String(x == null ? '' : x).trim().slice(0, max); }

function valideerVraag(v, bekendeTopics) {
  const f = [];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { fouten: ['Geen geldig object.'] };
  const topic = tekst(v.topic, 60);
  if (!topic) f.push('"topic" ontbreekt.');
  else if (bekendeTopics && !bekendeTopics.includes(topic)) f.push(`Onbekend onderwerp "${topic}".`);
  const level = Number(v.level);
  if (!Number.isInteger(level) || level < MIN_NIVEAU || level > MAX_NIVEAU) f.push('"level" moet een geheel getal van 1 tot 10 zijn.');
  const type = tekst(v.type, 20);
  if (!VRAAG_TYPES.includes(type)) f.push(`"type" moet ${VRAAG_TYPES.join(', ')} zijn.`);
  const text = tekst(v.text, 4000);
  if (!text) f.push('"text" ontbreekt.');
  const uit = {
    topic, level, type, text,
    code: tekst(v.code, 4000),
    explanation: tekst(v.explanation, 1500),
    choices: [], correct: [], starter: '', tests: [],
  };
  if (type === 'single' || type === 'multiple') {
    const keuzes = Array.isArray(v.choices) ? v.choices.map(c => tekst(c, 400)) : [];
    if (keuzes.length < 2 || keuzes.length > 8 || keuzes.some(c => !c)) f.push('"choices" moet 2 tot 8 niet-lege keuzes bevatten.');
    const juist = Array.isArray(v.correct) ? [...new Set(v.correct.map(Number))] : [];
    if (juist.some(i => !Number.isInteger(i) || i < 0 || i >= keuzes.length)) f.push('"correct" bevat een ongeldige index.');
    if (type === 'single' && juist.length !== 1) f.push('Bij "single" moet "correct" precies één index bevatten.');
    if (type === 'multiple' && juist.length < 2) f.push('Bij "multiple" moet "correct" minstens twee indexen bevatten.');
    uit.choices = keuzes; uit.correct = juist.sort((a, b) => a - b);
  } else if (type === 'code') {
    uit.starter = String(v.starter == null ? '' : v.starter).slice(0, 4000);
    const tests = Array.isArray(v.tests) ? v.tests : [];
    if (!tests.length || tests.length > 10) f.push('"tests" moet 1 tot 10 testgevallen bevatten.');
    uit.tests = tests.map(t => ({
      input: (Array.isArray(t && t.input) ? t.input : []).map(r => String(r)).slice(0, 20),
      output: String(t && t.output != null ? t.output : '').slice(0, 2000),
    }));
  }
  return { fouten: f, vraag: f.length ? null : uit };
}

// Controleert een hele lijst; geeft geldige vragen + per fout het volgnummer (1-gebaseerd).
function valideerImport(invoer, bekendeTopics) {
  let lijst = invoer;
  if (typeof invoer === 'string') {
    try { lijst = JSON.parse(invoer); } catch (e) { return { geldig: [], fouten: [{ nr: 0, fouten: ['Geen geldige JSON: ' + e.message] }] }; }
  }
  if (lijst && !Array.isArray(lijst) && Array.isArray(lijst.questions)) lijst = lijst.questions;
  if (!Array.isArray(lijst)) return { geldig: [], fouten: [{ nr: 0, fouten: ['De JSON moet een lijst van vragen zijn.'] }] };
  if (lijst.length > 1000) return { geldig: [], fouten: [{ nr: 0, fouten: ['Maximaal 1000 vragen per import.'] }] };
  const geldig = []; const fouten = [];
  lijst.forEach((v, i) => {
    const r = valideerVraag(v, bekendeTopics);
    if (r.fouten.length) fouten.push({ nr: i + 1, fouten: r.fouten }); else geldig.push(r.vraag);
  });
  return { geldig, fouten };
}

// Stabiele vingerafdruk om dubbels te herkennen (zelfde onderwerp + niveau + tekst + code).
function vraagHash(v) {
  const s = [v.topic, v.level, v.type, String(v.text).replace(/\s+/g, ' ').trim(), String(v.code || '').replace(/\s+/g, ' ').trim()].join('|');
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// Wat een leerling te zien krijgt: NOOIT de juiste antwoorden of de tests.
function vraagVoorLeerling(q, nr, totaal, niveau) {
  return {
    nr, totaal, niveau,
    id: q.id, topic: q.topic, level: q.level, type: q.type,
    text: q.text, code: q.code || '',
    choices: q.type === 'code' ? [] : q.choices,
    starter: q.type === 'code' ? (q.starter || '') : '',
    meerdere: q.type === 'multiple',
  };
}

module.exports = {
  MIN_VRAGEN, MAX_VRAGEN, MIN_ONDERWERPEN, MAX_ONDERWERPEN, MIN_NIVEAU, MAX_NIVEAU, VRAAG_TYPES,
  STANDAARD_INSTELLINGEN,
  normaliseerInstellingen, valideerTrainingKeuze,
  nieuwNiveau, startNiveauVoor, kiesOnderwerp, kiesVraag,
  scoreSingle, scoreMultiple, scoreCode, normaliseerUitvoer, uitvoerKomtOvereen,
  bepaalTitel, herschaalNiveau,
  valideerVraag, valideerImport, vraagHash, vraagVoorLeerling,
};
