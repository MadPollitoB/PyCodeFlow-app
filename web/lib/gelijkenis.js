'use strict';
// v136 — Gelijkenisrapport (anti-spiek, voor de leerkracht).
//
// Pure functies zonder database of netwerk, zodat alles testbaar is.
// Het rapport vergelijkt per PAAR leerlingen:
//   1. tekst/code-antwoorden: gelijkenis van de tekst én van de "structuur" (code waarbij
//      namen en getallen vervangen zijn — vangt hernoemde variabelen op);
//   2. gedeelde FOUTE keuzes bij meerkeuze (zeldzame combinaties wegen zwaarder);
//   3. placeholders: hetzelfde antwoord ondanks andere waarden, of de waarden van de
//      ander in het eigen antwoord;
//   4. timing: hoe dicht de opgeslagen/ingediende tijdstippen bij elkaar liggen;
//   5. context: incidenten (plakken, tabwissel) per leerling.
// Het is een SIGNAAL, geen bewijs: het rapport zegt dat expliciet.

const DREMPEL_TEKST = 80;        // % gelijkenis van de tekst
const DREMPEL_STRUCTUUR = 90;    // % gelijkenis van de gestripte structuur
const MIN_TOKENS = 8;            // kortere antwoorden zeggen niets
const MAX_TOKENS = 1500;         // bescherming tegen reusachtige invoer
const TIJD_NAUW_SEC = 90;        // ingediend binnen zoveel seconden na elkaar

const PY_KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else except ' +
  'finally for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
  'print input range len int str float list dict set tuple bool open sum min max abs round sorted enumerate zip map').split(' '));

/** Verwijdert #-commentaar, normaliseert witruimte en hoofdletters. */
function normaliseerTekst(s) {
  return String(s == null ? '' : s)
    .replace(/#[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Tokens: woorden/getallen/leestekens. */
function tokens(s) {
  const t = normaliseerTekst(s).match(/[a-z_À-ɏ][a-z0-9_À-ɏ]*|\d+(?:\.\d+)?|"[^"]*"|'[^']*'|[^\s]/g) || [];
  return t.slice(0, MAX_TOKENS);
}

/** Structuur: eigen namen → ID, getallen → NUM, strings → STR; sleutelwoorden blijven. */
function structuur(s) {
  return tokens(s).map(t => {
    if (/^\d/.test(t)) return 'NUM';
    if (/^["']/.test(t)) return 'STR';
    if (/^[a-z_À-ɏ]/.test(t)) return PY_KEYWORDS.has(t) ? t : 'ID';
    return t;
  });
}

/** Levenshtein op tokenlijsten (twee rijen geheugen). */
function afstand(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let vorige = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const huidige = [i];
    for (let j = 1; j <= b.length; j++) {
      huidige[j] = a[i - 1] === b[j - 1]
        ? vorige[j - 1]
        : 1 + Math.min(vorige[j], huidige[j - 1], vorige[j - 1]);
    }
    vorige = huidige;
  }
  return vorige[b.length];
}

function pctTussen(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return Math.round((1 - afstand(a, b) / max) * 100);
}

/**
 * Vergelijkt twee antwoorden. Geeft null als ze te kort zijn om iets te zeggen.
 * @returns {{tekst:number, structuur:number, tokens:number}|null}
 */
function vergelijkAntwoorden(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length < MIN_TOKENS || tb.length < MIN_TOKENS) return null;
  return {
    tekst: pctTussen(ta, tb),
    structuur: pctTussen(structuur(a), structuur(b)),
    tokens: Math.min(ta.length, tb.length),
  };
}

/** Sleutel van een gekozen set keuze-id's (volgorde-onafhankelijk). */
function keuzeSleutel(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort().join('|');
}

function parseJson(s, fallback) {
  if (s == null) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * Bevat het antwoord een waarde die bij de ANDERE leerling hoort maar niet bij de eigen?
 * (placeholders: dan heeft iemand de oplossing van de ander overgenomen.)
 */
function bevatVreemdeWaarde(antwoord, eigen, ander) {
  const toks = new Set(tokens(antwoord));
  const hits = [];
  for (const naam of Object.keys(ander || {})) {
    const e = String((eigen || {})[naam] ?? '');
    const o = String(ander[naam] ?? '');
    if (!o || o === e) continue;
    const ol = o.toLowerCase();
    if (ol.length < 2 && !/^\d+$/.test(ol)) continue;           // 1 letter zegt niets
    if (toks.has(ol) && !toks.has(e.toLowerCase())) hits.push(naam);
  }
  return hits;
}

/**
 * Zet de ruwe databaserijen om naar "eenheden": één per (leerling, vraag[, onderdeel]).
 * Tekst-eenheden hebben `tekst`, keuze-eenheden hebben `keuze` + `fout`.
 */
function eenhedenUit(rijen, opties = {}) {
  const waardenVan = opties.waardenVan || (() => null);
  const eenheden = [];
  for (const r of rijen || []) {
    if (r.is_test_account) continue;
    if (r.student_status && r.student_status !== 'aanwezig' && r.student_status !== 'present' && r.student_status !== null) {
      if (/afwezig|absent/i.test(String(r.student_status))) continue;
    }
    const basis = {
      leerlingId: String(r.student_id), naam: r.student_name || '', vraagId: String(r.question_id),
      vraagTekst: String(r.text_snapshot || '').slice(0, 80),
      opgeslagen: r.saved_at != null ? Number(r.saved_at) : null,
      ingediend: r.submitted_at != null ? Number(r.submitted_at) : null,
      waarden: waardenVan(r),
    };
    const type = r.question_type || 'code';
    if (type === 'single' || type === 'multiple') {
      const gekozen = parseJson(r.selected_choices, []);
      if (!gekozen.length) continue;
      const max = Number(r.points) || 0;
      const score = r.score != null ? Number(r.score) : null;
      eenheden.push({ ...basis, soort: 'keuze', keuze: keuzeSleutel(gekozen),
        fout: score != null && max > 0 && score < max });
    } else if (type === 'composite') {
      const pa = parseJson(r.part_answers, {});
      const ps = parseJson(r.part_scores, {});
      const delen = parseJson(r.answer_parts, []);
      for (const d of Array.isArray(delen) ? delen : []) {
        const waarde = pa[d.id];
        if (typeof waarde === 'string') {
          eenheden.push({ ...basis, vraagId: `${r.question_id}:${d.id}`, vraagTekst: String(d.label || basis.vraagTekst).slice(0, 80),
            soort: 'tekst', tekst: waarde, type: d.type || 'open' });
        } else if (Array.isArray(waarde) && waarde.length) {
          const max = Number(d.points) || 0;
          const sc = ps[d.id] != null ? Number(ps[d.id]) : null;
          eenheden.push({ ...basis, vraagId: `${r.question_id}:${d.id}`, vraagTekst: String(d.label || basis.vraagTekst).slice(0, 80),
            soort: 'keuze', keuze: keuzeSleutel(waarde), fout: sc != null && max > 0 && sc < max });
        }
      }
    } else if (type === 'open' || type === 'code' || !type) {
      eenheden.push({ ...basis, soort: 'tekst', tekst: String(r.code || ''), type });
    }
  }
  return eenheden;
}

function risicoVan(punten) {
  if (punten >= 6) return 'hoog';
  if (punten >= 3) return 'middel';
  return 'laag';
}

/**
 * Het eigenlijke rapport.
 * @param {object[]} eenheden  uit eenhedenUit()
 * @param {object[]} incidenten  [{studentId,type,at}]
 * @param {{drempelTekst?:number,drempelStructuur?:number}} opties
 */
function bouwRapport(eenheden, incidenten = [], opties = {}) {
  const dT = opties.drempelTekst ?? DREMPEL_TEKST;
  const dS = opties.drempelStructuur ?? DREMPEL_STRUCTUUR;
  const perVraag = new Map();
  for (const e of eenheden) {
    if (!perVraag.has(e.vraagId)) perVraag.set(e.vraagId, []);
    perVraag.get(e.vraagId).push(e);
  }
  const paren = new Map();   // "idA|idB" → { a, b, items:[], punten }
  const paar = (x, y) => {
    const [a, b] = String(x.leerlingId) < String(y.leerlingId) ? [x, y] : [y, x];
    const sleutel = `${a.leerlingId}|${b.leerlingId}`;
    if (!paren.has(sleutel)) paren.set(sleutel, {
      leerling1: { id: a.leerlingId, naam: a.naam }, leerling2: { id: b.leerlingId, naam: b.naam },
      items: [], punten: 0, gedeeldeFouten: 0, tijdsverschilIndienenSec: null,
    });
    return { rec: paren.get(sleutel), a, b };
  };
  const perVraagLijst = [];   // verenigbaar met het oude /similarity-endpoint

  for (const [vraagId, lijst] of perVraag) {
    const tekstEenh = lijst.filter(e => e.soort === 'tekst');
    for (let i = 0; i < tekstEenh.length; i++) {
      for (let j = i + 1; j < tekstEenh.length; j++) {
        const x = tekstEenh[i], y = tekstEenh[j];
        const v = vergelijkAntwoorden(x.tekst, y.tekst);
        if (!v) continue;
        if (v.tekst < dT && v.structuur < dS) continue;
        const { rec, a, b } = paar(x, y);
        let pt = v.tekst >= 98 ? 3 : v.tekst >= 90 ? 2 : 1;
        if (v.tekst < dT) pt = 1;   // enkel structuur: lichter signaal
        const item = {
          soort: 'tekst', vraagId, vraagTekst: x.vraagTekst, tekstPct: v.tekst, structuurPct: v.structuur,
          hernoemd: v.structuur >= dS && v.tekst < dT,
          tijdsverschilSec: x.opgeslagen != null && y.opgeslagen != null ? Math.round(Math.abs(x.opgeslagen - y.opgeslagen) / 1000) : null,
        };
        // placeholders
        if (x.waarden && y.waarden) {
          const verschillend = Object.keys(x.waarden).some(k => String(x.waarden[k]) !== String(y.waarden[k]));
          if (verschillend) {
            item.andereWaarden = true;
            const hitX = bevatVreemdeWaarde(x.tekst, x.waarden, y.waarden);
            const hitY = bevatVreemdeWaarde(y.tekst, y.waarden, x.waarden);
            if (hitX.length || hitY.length) { item.vreemdeWaarden = [...new Set([...hitX, ...hitY])]; pt += 3; }
            else if (v.tekst >= 90) pt += 2;       // identiek ondanks andere getallen
          }
        }
        if (item.tijdsverschilSec != null && item.tijdsverschilSec <= 30 && v.tekst >= 90) pt += 1;
        item.punten = pt;
        rec.items.push(item); rec.punten += pt;
        if (v.tekst >= dT) perVraagLijst.push({
          questionId: vraagId, questionText: x.vraagTekst,
          student1: { id: a.leerlingId, name: a.naam }, student2: { id: b.leerlingId, name: b.naam },
          similarity: v.tekst,
        });
      }
    }
    // gedeelde foute keuzes
    const keuzeEenh = lijst.filter(e => e.soort === 'keuze');
    if (keuzeEenh.length >= 2) {
      const telling = new Map();
      for (const e of keuzeEenh) telling.set(e.keuze, (telling.get(e.keuze) || 0) + 1);
      const grens = Math.max(2, Math.floor(keuzeEenh.length * 0.25));
      for (let i = 0; i < keuzeEenh.length; i++) {
        for (let j = i + 1; j < keuzeEenh.length; j++) {
          const x = keuzeEenh[i], y = keuzeEenh[j];
          if (x.keuze !== y.keuze || !x.fout || !y.fout) continue;
          const groep = telling.get(x.keuze);
          if (groep > grens) continue;      // veelgemaakte fout: geen signaal
          const { rec } = paar(x, y);
          const pt = groep === 2 ? 2 : 1;
          rec.items.push({ soort: 'keuze', vraagId, vraagTekst: x.vraagTekst, gelijkeFout: true, aantalMetDezelfdeFout: groep, punten: pt });
          rec.punten += pt; rec.gedeeldeFouten++;
        }
      }
    }
  }

  // timing van indienen + context
  const laatsteIndiening = new Map();
  for (const e of eenheden) if (e.ingediend != null) {
    laatsteIndiening.set(e.leerlingId, Math.max(laatsteIndiening.get(e.leerlingId) || 0, e.ingediend));
  }
  const incPer = {};
  for (const i of incidenten || []) {
    if (!i.studentId) continue;
    const o = incPer[i.studentId] || (incPer[i.studentId] = { plakken: 0, tabwissel: 0, andere: 0 });
    if (/past|plak|paste/i.test(i.type)) o.plakken++;
    else if (/tab|focus|blur|visib/i.test(i.type)) o.tabwissel++;
    else o.andere++;
  }
  const resultaat = [];
  for (const rec of paren.values()) {
    const ta = laatsteIndiening.get(rec.leerling1.id), tb = laatsteIndiening.get(rec.leerling2.id);
    if (ta && tb) {
      rec.tijdsverschilIndienenSec = Math.round(Math.abs(ta - tb) / 1000);
      if (rec.tijdsverschilIndienenSec <= TIJD_NAUW_SEC) rec.punten += 1;
    }
    rec.context = { [rec.leerling1.id]: incPer[rec.leerling1.id] || null, [rec.leerling2.id]: incPer[rec.leerling2.id] || null };
    rec.aantalItems = rec.items.length;
    rec.risico = risicoVan(rec.punten);
    rec.items.sort((p, q) => q.punten - p.punten);
    resultaat.push(rec);
  }
  resultaat.sort((p, q) => q.punten - p.punten || q.aantalItems - p.aantalItems);
  perVraagLijst.sort((p, q) => q.similarity - p.similarity);
  return {
    paren: resultaat,
    perVraag: perVraagLijst,
    drempels: { tekst: dT, structuur: dS, minTokens: MIN_TOKENS },
    opmerking: 'Een signaal, geen bewijs: gelijke antwoorden kunnen ook ontstaan bij korte of standaardoplossingen. Beoordeel altijd zelf.',
  };
}

module.exports = {
  DREMPEL_TEKST, DREMPEL_STRUCTUUR, MIN_TOKENS,
  normaliseerTekst, tokens, structuur, afstand, vergelijkAntwoorden,
  keuzeSleutel, bevatVreemdeWaarde, eenhedenUit, bouwRapport, risicoVan,
};
