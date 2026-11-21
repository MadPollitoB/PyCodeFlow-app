'use strict';
// ════════════════════════════════════════════════════════════════════════════
// v151 — PyBlitz: pure logica (zonder server, volledig te testen).
//   • vragen valideren en normaliseren (tekst / python-code / foutmelding / afbeelding)
//   • punten: hoe sneller juist, hoe meer punten (+ reeksbonus, dubbel, geen)
//   • rangschikking, gastnamen, pincodes
//   • import: JSON en rijen uit een Excel-sjabloon
// De spelmotor zelf staat in lib/pyblitz-spel.js.
// ════════════════════════════════════════════════════════════════════════════

const LIMIETEN = {
  NAAM_MAX: 80, OMSCHRIJVING_MAX: 300, VRAGEN_MAX: 100,
  TEKST_MAX: 400, CODE_MAX: 1500, FOUT_MAX: 1000, OPTIE_MAX: 300, OPTIE_REGELS_MAX: 6, UITLEG_MAX: 300,
  TIJD_MIN: 5, TIJD_MAX: 120, TIJD_STANDAARD: 20,
};
const PUNTEN_SOORTEN = ['standaard', 'dubbel', 'geen'];
const LETTERS = ['A', 'B', 'C', 'D'];

const schoon = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim().slice(0, max);
const heleTekst = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
const eenRegel = (v, max) => schoon(v, max).replace(/\s*\n\s*/g, ' ');

function nieuwId(prefix = 'q') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function geldigId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v); }
function geldigAfbeeldingId(v) { return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v); }

// ── Vragen ────────────────────────────────────────────────────────────────────
// Eén vraag = tekst en/of code en/of foutmelding en/of afbeelding (minstens één), plus 2–4 opties
// (of Juist/Onjuist). `correct` is 0-gebaseerd binnen de app; bij import 1-gebaseerd/letter (zie hieronder).
function normaliseerVraag(raw, nr) {
  const fouten = [];
  const lab = nr != null ? `Vraag ${nr}: ` : '';
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = r.type === 'tf' ? 'tf' : 'mc';
  const tekst = eenRegel(r.text, LIMIETEN.TEKST_MAX);
  const code = heleTekst(r.code, LIMIETEN.CODE_MAX);
  const fout = heleTekst(r.error, LIMIETEN.FOUT_MAX);
  const afbeeldingId = geldigAfbeeldingId(r.imageId) ? r.imageId : null;
  if (!tekst && !code.trim() && !fout.trim() && !afbeeldingId) fouten.push(lab + 'vul een vraag in (tekst, code, foutmelding of afbeelding).');

  let opties;
  if (type === 'tf') {
    opties = [{ text: 'Juist' }, { text: 'Onjuist' }];
  } else {
    const lijst = Array.isArray(r.options) ? r.options : [];
    opties = lijst.slice(0, 4).map(o => {
      const t = typeof o === 'string' ? o : (o && o.text);
      // Een optie mag uit meerdere regels (code) bestaan: regels blijven behouden, ingesprongen of niet.
      let tekstO = heleTekst(t, LIMIETEN.OPTIE_MAX).replace(/^\n+/, '');
      tekstO = tekstO.split('\n').slice(0, LIMIETEN.OPTIE_REGELS_MAX).join('\n');
      const x = { text: tekstO.trim() ? tekstO : '' };
      if ((o && typeof o === 'object' && o.code === true) || tekstO.includes('\n')) x.code = true;   // meerdere regels = codeweergave
      return x;
    });
    if (opties.length < 2 || opties.some(o => !o.text)) fouten.push(lab + 'geef 2 tot 4 antwoordopties, elk met tekst.');
  }
  const correct = Number.isInteger(r.correct) ? r.correct : -1;
  if (correct < 0 || correct >= opties.length) fouten.push(lab + 'duid het juiste antwoord aan.');

  const seconden = Math.round(Number(r.seconds));
  const tijd = Number.isFinite(seconden) && seconden > 0
    ? Math.min(LIMIETEN.TIJD_MAX, Math.max(LIMIETEN.TIJD_MIN, seconden)) : LIMIETEN.TIJD_STANDAARD;
  const punten = PUNTEN_SOORTEN.includes(r.points) ? r.points : 'standaard';

  const vraag = {
    id: geldigId(r.id) ? r.id : nieuwId('q'),
    type, text: tekst, code, error: fout, imageId: afbeeldingId,
    options: opties, correct, seconds: tijd, points: punten,
    explanation: eenRegel(r.explanation, LIMIETEN.UITLEG_MAX),
  };
  return { ok: fouten.length === 0, vraag, fouten };
}

function normaliseerVragen(lijst) {
  const fouten = [];
  const uit = [];
  const bron = Array.isArray(lijst) ? lijst : [];
  if (bron.length > LIMIETEN.VRAGEN_MAX) fouten.push(`Maximaal ${LIMIETEN.VRAGEN_MAX} vragen per PyBlitz.`);
  bron.slice(0, LIMIETEN.VRAGEN_MAX).forEach((r, i) => {
    const n = normaliseerVraag(r, i + 1);
    if (n.ok) uit.push(n.vraag); else fouten.push(...n.fouten);
  });
  // unieke id's binnen één set
  const gezien = new Set();
  for (const v of uit) { if (gezien.has(v.id)) v.id = nieuwId('q'); gezien.add(v.id); }
  return { ok: fouten.length === 0, vragen: uit, fouten };
}

function normaliseerSet(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const naam = eenRegel(r.name, LIMIETEN.NAAM_MAX);
  const fouten = [];
  if (!naam) fouten.push('Geef de PyBlitz een naam.');
  const v = normaliseerVragen(r.questions);
  fouten.push(...v.fouten);
  return { ok: fouten.length === 0, naam, omschrijving: eenRegel(r.description, LIMIETEN.OMSCHRIJVING_MAX), vragen: v.vragen, fouten };
}

// ── Punten ────────────────────────────────────────────────────────────────────
// Juist = tussen 1000 (meteen) en 500 (op het allerlaatste moment). Dubbel = ×2, geen = 0.
// Reeksbonus: vanaf 2 juiste op rij +50 per extra vraag, maximaal +200.
function berekenPunten({ juist, verstrekenMs, limietMs, punten = 'standaard', reeks = 0 } = {}) {
  if (!juist || punten === 'geen') return { basis: 0, bonus: 0, totaal: 0 };
  const f = limietMs > 0 ? Math.min(1, Math.max(0, verstrekenMs / limietMs)) : 1;
  const basis = Math.round(1000 * (1 - f / 2)) * (punten === 'dubbel' ? 2 : 1);
  const bonus = reeks >= 2 ? Math.min(reeks - 1, 4) * 50 : 0;
  return { basis, bonus, totaal: basis + bonus };
}

// Rangschikking met gedeelde plaatsen (1, 2, 2, 4). Meeste punten, dan meeste juist, dan snelst, dan naam.
function rangschik(spelers) {
  const lijst = [...spelers].sort((a, b) =>
    (b.points - a.points) || ((b.correct || 0) - (a.correct || 0)) || ((a.totalMs || 0) - (b.totalMs || 0))
    || String(a.name).localeCompare(String(b.name), 'nl'));
  let vorige = null, plaats = 0;
  lijst.forEach((s, i) => {
    const gelijk = vorige && vorige.points === s.points && (vorige.correct || 0) === (s.correct || 0);
    if (!gelijk) plaats = i + 1;
    s.rank = plaats; vorige = s;
  });
  return lijst;
}

// ── Namen (gasten) ────────────────────────────────────────────────────────────
const VERBODEN = ['kut', 'klootzak', 'kanker', 'tyfus', 'tering', 'hoer', 'slet', 'fuck', 'shit', 'bitch', 'dick', 'nazi', 'hitler', 'nigg', 'fag', 'cunt', 'pik', 'lul', 'sukkel', 'mongool', 'neuk'];
function naamSleutel(naam) {
  return String(naam || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function normaliseerGastNaam(naam) {
  let n = String(naam == null ? '' : naam).normalize('NFC').replace(/[\u0000-\u001f\u007f<>&"`\\]/g, '').replace(/\s+/g, ' ').trim();
  n = n.slice(0, 20).trim();
  if (n.length < 2) return { ok: false, error: 'Kies een naam van minstens 2 tekens.' };
  const k = naamSleutel(n).replace(/[^a-z0-9]/g, '');
  if (VERBODEN.some(w => k.includes(w))) return { ok: false, error: 'Kies een andere naam.' };
  return { ok: true, naam: n };
}
// "Noor" → "Noor 2" → "Noor 3" … zolang de naam al bezet is (sleutels = naamSleutel van bezette namen).
function uniekeNaam(naam, bezetteSleutels) {
  const bezet = bezetteSleutels instanceof Set ? bezetteSleutels : new Set(bezetteSleutels || []);
  if (!bezet.has(naamSleutel(naam))) return naam;
  for (let i = 2; i < 1000; i++) {
    const k = naam.slice(0, 17) + ' ' + i;
    if (!bezet.has(naamSleutel(k))) return k;
  }
  return naam + ' ' + Date.now().toString(36).slice(-3);
}

function nieuwePin(bezet, lengte = 5) {
  const b = bezet instanceof Set ? bezet : new Set(bezet || []);
  for (let i = 0; i < 200; i++) {
    const p = String(Math.floor(Math.random() * Math.pow(10, lengte))).padStart(lengte, '0');
    if (!/^0/.test(p) && !b.has(p)) return p;
  }
  return null;
}

// ── Import ────────────────────────────────────────────────────────────────────
function letterOfNummerNaarIndex(v, opties) {
  if (v == null) return -1;
  if (typeof v === 'boolean') return v ? 0 : 1;
  const s = String(v).trim();
  if (!s) return -1;
  const l = s.toUpperCase();
  if (/^[A-D]$/.test(l)) return l.charCodeAt(0) - 65;
  if (/^[1-4]$/.test(s)) return Number(s) - 1;
  const i = (opties || []).findIndex(o => String(o).trim().toLowerCase() === s.toLowerCase());
  return i;
}
const ISJUIST = new Set(['juist', 'waar', 'true', 'ja']);
const ISONJUIST = new Set(['onjuist', 'fout', 'onwaar', 'false', 'nee']);

// Eén vraag uit een bronobject (JSON of rij) naar het interne formaat; fouten komen via normaliseerVraag.
function vraagUitBron(b, nr) {
  const opties = Array.isArray(b.options) ? b.options.map(o => (o && typeof o === 'object' ? o.text : o)) : [];
  const codeVlag = Array.isArray(b.options) ? b.options.map(o => !!(o && typeof o === 'object' && o.code === true)) : [];
  const nietLeeg = opties.filter(o => String(o == null ? '' : o).trim() !== '');
  const nietLeegCode = codeVlag.filter((_, i) => String(opties[i] == null ? '' : opties[i]).trim() !== '');
  const isTf = b.type === 'tf'
    || (nietLeeg.length === 2 && ISJUIST.has(String(nietLeeg[0]).trim().toLowerCase()) && ISONJUIST.has(String(nietLeeg[1]).trim().toLowerCase()));
  let correct;
  if (isTf) {
    const c = b.correct;
    if (typeof c === 'boolean') correct = c ? 0 : 1;
    else {
      const s = String(c == null ? '' : c).trim().toLowerCase();
      correct = ISJUIST.has(s) || s === 'a' || s === '1' ? 0 : (ISONJUIST.has(s) || s === 'b' || s === '2' ? 1 : -1);
    }
  } else {
    correct = letterOfNummerNaarIndex(b.correct != null ? b.correct : b.answer, opties.map(o => String(o == null ? '' : o)));
    // lege opties vooraan/achteraan laten we weg; de index telt enkel over de overgebleven opties
    if (nietLeeg.length !== opties.length && correct >= 0) {
      const gekozen = opties[correct];
      correct = nietLeeg.findIndex(o => o === gekozen);
    }
  }
  const raw = {
    id: b.id, type: isTf ? 'tf' : 'mc', text: b.text != null ? b.text : b.question, code: b.code, error: b.error,
    imageId: b.imageId, options: isTf ? [] : nietLeeg.map((o, i) => (nietLeegCode[i] ? { text: String(o), code: true } : String(o))),
    correct, seconds: b.seconds != null ? b.seconds : b.time, points: b.points, explanation: b.explanation,
  };
  return normaliseerVraag(raw, nr);
}

function importeerJson(tekst) {
  let data;
  try { data = JSON.parse(String(tekst || '')); }
  catch { return { ok: false, vragen: [], fouten: ['Het bestand is geen geldige JSON.'] }; }
  const lijst = Array.isArray(data) ? data : (data && Array.isArray(data.questions) ? data.questions : null);
  if (!lijst) return { ok: false, vragen: [], fouten: ['Verwacht een lijst met vragen (of { "questions": [...] }).'] };
  return verwerkBronnen(lijst, data && !Array.isArray(data) ? { naam: eenRegel(data.name, LIMIETEN.NAAM_MAX), omschrijving: eenRegel(data.description, LIMIETEN.OMSCHRIJVING_MAX) } : {});
}

function verwerkBronnen(lijst, extra = {}) {
  const fouten = [], vragen = [];
  if (!lijst.length) fouten.push('Er staan geen vragen in het bestand.');
  if (lijst.length > LIMIETEN.VRAGEN_MAX) fouten.push(`Maximaal ${LIMIETEN.VRAGEN_MAX} vragen per PyBlitz; de rest is genegeerd.`);
  lijst.slice(0, LIMIETEN.VRAGEN_MAX).forEach((b, i) => {
    const n = vraagUitBron(b && typeof b === 'object' ? b : {}, i + 1);
    if (n.ok) vragen.push(n.vraag); else fouten.push(...n.fouten);
  });
  return { ok: vragen.length > 0, vragen, fouten, ...extra };
}

// Excel: eerste rij = kopteksten. Herkende kolommen (hoofdletterongevoelig): zie KOLOMMEN.
const KOLOMMEN = {
  text: ['vraag', 'text', 'question', 'tekst'],
  code: ['code', 'python', 'pythoncode'],
  error: ['foutmelding', 'fout', 'error', 'traceback'],
  A: ['a', 'optie a', 'antwoord a'], B: ['b', 'optie b', 'antwoord b'],
  C: ['c', 'optie c', 'antwoord c'], D: ['d', 'optie d', 'antwoord d'],
  correct: ['juist', 'juiste', 'juist antwoord', 'correct', 'antwoord'],
  seconds: ['tijd', 'seconden', 'time', 'seconds'],
  points: ['punten', 'points'],
  explanation: ['uitleg', 'toelichting', 'explanation'],
};
function importeerRijen(rijen) {
  if (!Array.isArray(rijen) || rijen.length < 2) return { ok: false, vragen: [], fouten: ['Het blad is leeg: verwacht kopteksten in rij 1 en vragen vanaf rij 2.'] };
  const kop = rijen[0].map(c => String(c == null ? '' : c).trim().toLowerCase());
  const kolom = {};
  for (const [sleutel, namen] of Object.entries(KOLOMMEN)) {
    const i = kop.findIndex(k => namen.includes(k));
    if (i >= 0) kolom[sleutel] = i;
  }
  if (kolom.text == null && kolom.code == null) return { ok: false, vragen: [], fouten: ['Kolom "Vraag" niet gevonden in de eerste rij. Gebruik het sjabloon.'] };
  const bronnen = [];
  const tekstBij = (r, k) => (kolom[k] != null && r[kolom[k]] != null ? r[kolom[k]] : '');
  const rijNrs = [];
  rijen.slice(1).forEach((r, i) => {
    if (!Array.isArray(r) || r.every(c => c == null || String(c).trim() === '')) return;
    const p = String(tekstBij(r, 'points')).trim().toLowerCase();
    bronnen.push({
      text: tekstBij(r, 'text'), code: tekstBij(r, 'code'), error: tekstBij(r, 'error'),
      options: [tekstBij(r, 'A'), tekstBij(r, 'B'), tekstBij(r, 'C'), tekstBij(r, 'D')],
      correct: tekstBij(r, 'correct'), seconds: tekstBij(r, 'seconds'),
      points: p === 'dubbel' || p === 'x2' || p === '2' ? 'dubbel' : (p === 'geen' || p === '0' ? 'geen' : 'standaard'),
      explanation: tekstBij(r, 'explanation'),
    });
    rijNrs.push(i + 2);
  });
  // foutmeldingen verwijzen naar de rij in Excel i.p.v. het volgnummer
  const res = { fouten: [], vragen: [] };
  if (!bronnen.length) return { ok: false, vragen: [], fouten: ['Er staan geen vragen in het blad.'] };
  bronnen.slice(0, LIMIETEN.VRAGEN_MAX).forEach((b, i) => {
    const n = vraagUitBron(b, null);
    if (n.ok) res.vragen.push(n.vraag);
    else res.fouten.push(...n.fouten.map(f => `Rij ${rijNrs[i]}: ${f}`));
  });
  if (bronnen.length > LIMIETEN.VRAGEN_MAX) res.fouten.push(`Maximaal ${LIMIETEN.VRAGEN_MAX} vragen per PyBlitz; de rest is genegeerd.`);
  return { ok: res.vragen.length > 0, vragen: res.vragen, fouten: res.fouten };
}

// Export naar hetzelfde JSON-formaat dat de import begrijpt (afbeeldingen blijven als imageId).
function exporteerJson(set) {
  return {
    name: set.name, description: set.description || '',
    questions: (set.questions || []).map(q => ({
      type: q.type, text: q.text, code: q.code || undefined, error: q.error || undefined, imageId: q.imageId || undefined,
      options: q.type === 'tf' ? undefined : q.options.map(o => (o.code ? { text: o.text, code: true } : o.text)),
      correct: q.type === 'tf' ? q.correct === 0 : LETTERS[q.correct],
      seconds: q.seconds, points: q.points, explanation: q.explanation || undefined,
    })),
  };
}

module.exports = {
  LIMIETEN, PUNTEN_SOORTEN, LETTERS, KOLOMMEN,
  normaliseerVraag, normaliseerVragen, normaliseerSet,
  berekenPunten, rangschik, naamSleutel, normaliseerGastNaam, uniekeNaam, nieuwePin, nieuwId,
  importeerJson, importeerRijen, exporteerJson, geldigAfbeeldingId, geldigId,
};
