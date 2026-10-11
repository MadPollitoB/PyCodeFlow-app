'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// v2026.2.51.119 — Trainingscenter: vraag van de dag (pure logica, geen databank/Express)
//   • persoonlijke vraag per dag, op niveau en onderwerpen van de leerling
//   • streak = opeenvolgende dagen met een juist antwoord; weekend breekt niet; joker per week
//   • per klas instelbaar (standaardwaarden hieronder)
// ═══════════════════════════════════════════════════════════════════════════════

const G = require('./training-groei');

const DAG_STANDAARD = Object.freeze({
  aan: true,
  maxPogingenMeerkeuze: 2,   // meerkeuze: zo vaak mag je proberen (anders raad je gewoon alles)
  maxPogingenCode: 0,        // code: 0 = onbeperkt
  codeAandeelPct: 67,        // kans (%) dat de vraag van de dag een programmeeropdracht is
  niveauVerschil: 0,         // -3..+3 t.o.v. het niveau van de leerling
  jokersPerWeek: 1,          // gemiste schooldagen per week die de streak niet breken
  inhaalDagen: 7,            // v110: zoveel kalenderdagen terug mag je een gemiste dag inhalen (0 = niet toegestaan)
});

function normaliseerDagvraagCfg(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fouten = [];
  const geheel = (naam, min, max, label) => {
    if (r[naam] == null || r[naam] === '') return DAG_STANDAARD[naam];
    const n = Number(r[naam]);
    if (!Number.isInteger(n) || n < min || n > max) { fouten.push(`${label} moet een geheel getal van ${min} tot ${max} zijn.`); return DAG_STANDAARD[naam]; }
    return n;
  };
  const cfg = {
    aan: r.aan == null ? DAG_STANDAARD.aan : (r.aan === true || r.aan === 'true' || r.aan === 1),
    maxPogingenMeerkeuze: geheel('maxPogingenMeerkeuze', 1, 10, 'Pogingen bij meerkeuze'),
    maxPogingenCode: geheel('maxPogingenCode', 0, 50, 'Pogingen bij code'),
    codeAandeelPct: geheel('codeAandeelPct', 0, 100, 'Aandeel codevragen'),
    niveauVerschil: geheel('niveauVerschil', -3, 3, 'Niveauverschil'),
    jokersPerWeek: geheel('jokersPerWeek', 0, 3, 'Jokers per week'),
    inhaalDagen: geheel('inhaalDagen', 0, 30, 'Dagen inhalen'),
  };
  return { cfg, fouten };
}

// Leerling in meerdere klassen: de ruimste regeling.
function effectieveDagvraagCfg(lijst) {
  const l = (lijst || []).map(x => normaliseerDagvraagCfg(x).cfg);
  if (!l.length) return { ...DAG_STANDAARD };
  if (l.length === 1) return l[0];
  return {
    aan: l.some(x => x.aan),
    maxPogingenMeerkeuze: Math.max(...l.map(x => x.maxPogingenMeerkeuze)),
    maxPogingenCode: l.some(x => x.maxPogingenCode === 0) ? 0 : Math.max(...l.map(x => x.maxPogingenCode)),
    codeAandeelPct: Math.round(l.reduce((a, x) => a + x.codeAandeelPct, 0) / l.length),
    niveauVerschil: Math.max(...l.map(x => x.niveauVerschil)),
    jokersPerWeek: Math.max(...l.map(x => x.jokersPerWeek)),
    inhaalDagen: Math.max(...l.map(x => x.inhaalDagen)),
  };
}

const maxPogingen = (type, cfg) => type === 'code' ? cfg.maxPogingenCode : cfg.maxPogingenMeerkeuze;   // 0 = onbeperkt

// ── willekeur met zaadje: dezelfde leerling + dag geeft altijd dezelfde keuze ─────────────
function hashZaad(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function rng(zaad) { let a = hashZaad(String(zaad)); return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Kiest de vraag van de dag.
//   kandidaten: [{ id, topic, level, type }]   (actief + zichtbaar voor de leerling)
//   topics:     onderwerpen in volgorde van prioriteit (al geoefend, herhaling/zwak eerst)
//   niveauPerTopic: { topic: niveau }          gezien: { vraagId: ms }   recent: Set(vraagId)
function kiesDagvraag({ kandidaten, topics, niveauPerTopic = {}, maxLevel = 10, gezien = {}, recent = new Set(), cfg = DAG_STANDAARD, zaad = '' }) {
  const rand = rng(zaad);
  const lijst = (topics || []).filter(t => (kandidaten || []).some(k => k.topic === t));
  if (!lijst.length) return null;
  const start = Math.floor(rand() * lijst.length);
  for (let i = 0; i < lijst.length; i++) {
    const topic = lijst[(start + i) % lijst.length];
    const doel = Math.max(1, Math.min(maxLevel, (niveauPerTopic[topic] || 1) + cfg.niveauVerschil));
    let pool = kandidaten.filter(k => k.topic === topic);
    const nieuw = pool.filter(k => !recent.has(k.id));
    if (nieuw.length) pool = nieuw;
    const wilCode = rand() * 100 < cfg.codeAandeelPct;
    const metType = pool.filter(k => (k.type === 'code') === wilCode);
    if (metType.length) pool = metType;
    const afstand = k => Math.abs(k.level - doel);
    const best = Math.min(...pool.map(afstand));
    let groep = pool.filter(k => afstand(k) === best);
    const ongezien = groep.filter(k => !gezien[k.id]);
    if (ongezien.length) groep = ongezien;
    else { const oudste = Math.min(...groep.map(k => gezien[k.id] || 0)); groep = groep.filter(k => (gezien[k.id] || 0) === oudste); }
    return groep[Math.floor(rand() * groep.length)];
  }
  return null;
}

// ── streak met joker ───────────────────────────────────────────────────────────────────────
const weekStart = sleutel => { const d = new Date(sleutel + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * G.DAG_MS).toISOString().slice(0, 10); };
const isWeekend = sleutel => { const d = new Date(sleutel + 'T12:00:00Z').getUTCDay(); return d === 0 || d === 6; };
const dagVoor = sleutel => new Date(new Date(sleutel + 'T12:00:00Z').getTime() - G.DAG_MS).toISOString().slice(0, 10);

// opgelost: Set of array van 'YYYY-MM-DD'. Een gemiste schooldag breekt de streak enkel als de joker
// van die week al op is. Vandaag nog niet opgelost telt niet als gemist.
function berekenDagStreak(opgelost, nuMs, jokersPerWeek, tz) {
  const set = new Set(opgelost || []);
  const vandaag = G.dagSleutel(nuMs, tz);
  const vandaagOpgelost = set.has(vandaag);
  let d = vandaagOpgelost ? vandaag : dagVoor(vandaag);
  let streak = 0; const gebruikt = []; let wacht = []; const perWeek = {};
  for (let i = 0; i < 800; i++) {
    if (set.has(d)) { streak++; gebruikt.push(...wacht); wacht = []; }
    else if (!isWeekend(d)) {
      const w = weekStart(d); const al = perWeek[w] || 0;
      if (al < jokersPerWeek) { perWeek[w] = al + 1; wacht.push(d); } else break;
    }
    d = dagVoor(d);
  }
  const dezeWeek = weekStart(vandaag);
  const gebruiktDezeWeek = gebruikt.filter(x => weekStart(x) === dezeWeek).length;
  return { streak, vandaagOpgelost, jokersGebruikt: gebruikt, jokersOver: Math.max(0, jokersPerWeek - gebruiktDezeWeek) };
}

// Langste reeks ooit (zonder joker, weekend breekt niet).
function langsteReeks(opgelost) {
  const dagen = [...new Set(opgelost || [])].sort(); let beste = 0; let huidig = 0; let vorige = null;
  for (const d of dagen) {
    if (vorige) {
      let x = dagVoor(d); while (x > vorige && isWeekend(x)) x = dagVoor(x);
      huidig = x === vorige ? huidig + 1 : 1;
    } else huidig = 1;
    beste = Math.max(beste, huidig); vorige = d;
  }
  return beste;
}

// Pogingen die meetellen voor de vergrendeling: bij een inhaalpoging tel je vanaf het begin van het inhalen.
const actievePogingen = rij => Math.max(0, (rij ? rij.attempts : 0) - (rij && rij.inhaal ? (rij.inhaalBasis || 0) : 0));

// Mag deze dag nog ingehaald worden? Alleen een voorbije schooldag binnen het venster, na de eerste vraag.
function kanInhalen(dag, vandaag, cfg, eersteDag) {
  if (!cfg || !(cfg.inhaalDagen > 0) || !(dag < vandaag) || isWeekend(dag)) return false;
  if (eersteDag && dag < eersteDag) return false;
  return dag >= dagTerug(vandaag, cfg.inhaalDagen);
}
function dagTerug(sleutel, n) { return new Date(new Date(sleutel + 'T12:00:00Z').getTime() - n * G.DAG_MS).toISOString().slice(0, 10); }

// Een inhaalpoging die al volledig is opgebruikt: dan is er niets meer te proberen.
function inhaalVergrendeld(rij, cfg) {
  if (!rij || !rij.inhaal) return false;
  const max = maxPogingen(rij.type, cfg);
  return max > 0 && actievePogingen(rij) >= max;
}

// Status van één dag. rij = { solved, attempts, type, inhaal, inhaalBasis } of null.
//   'ingehaald' = achteraf opgelost: telt niet mee voor de streak (de joker dekt die dag)
function dagStatus(rij, dag, vandaag, cfg) {
  if (rij && rij.solved) return rij.inhaal ? 'ingehaald' : 'opgelost';
  const max = rij ? maxPogingen(rij.type, cfg) : 0;
  const act = actievePogingen(rij);
  const vergrendeld = !!(rij && max > 0 && act >= max);
  if (vergrendeld) return 'mislukt';
  if (dag < vandaag && !(rij && rij.inhaal)) return 'mislukt';
  return rij && act > 0 ? 'bezig' : 'open';
}

// Mag het antwoord getoond worden? Enkel als opgelost, of als de dag voorbij is en er niets meer in te halen valt.
function magOnthullen(rij, dag, vandaag, cfg, eersteDag) {
  if (rij && rij.solved) return true;
  if (!(dag < vandaag)) return false;
  if (rij && rij.inhaal) return dagStatus(rij, dag, vandaag, cfg) === 'mislukt';   // vergrendeld
  return !kanInhalen(dag, vandaag, cfg, eersteDag);
}

// De laatste 7 kalenderdagen voor het strookje bovenaan.
function weekStrook(rijenPerDag, nuMs, jokerDagen, cfg, tz, aantal = 7, eersteDag = null) {
  const vandaag = G.dagSleutel(nuMs, tz); const uit = []; let d = vandaag;
  const NAMEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  for (let i = 0; i < aantal; i++) {
    const rij = rijenPerDag[d] || null; let status;
    if (eersteDag && d < eersteDag && !rij) status = 'voor';       // vóór de eerste vraag: neutraal, geen rood kruis
    else if (rij) status = dagStatus(rij, d, vandaag, cfg);
    else if (d === vandaag) status = 'open';
    else if ((jokerDagen || []).includes(d)) status = 'joker';
    else status = isWeekend(d) ? 'weekend' : 'mislukt';
    if (status === 'mislukt' && (jokerDagen || []).includes(d)) status = 'joker';
    const inhaalbaar = d < vandaag && !(rij && rij.solved) && kanInhalen(d, vandaag, cfg, eersteDag) && !inhaalVergrendeld(rij, cfg);
    uit.unshift({ dag: d, naam: NAMEN[new Date(d + 'T12:00:00Z').getUTCDay()], status, inhaalbaar });
    d = dagVoor(d);
  }
  return uit;
}

module.exports = {
  DAG_STANDAARD, normaliseerDagvraagCfg, effectieveDagvraagCfg, maxPogingen,
  kiesDagvraag, berekenDagStreak, langsteReeks, dagStatus, actievePogingen, kanInhalen, inhaalVergrendeld, magOnthullen, weekStrook, weekStart, isWeekend, dagVoor,
};
