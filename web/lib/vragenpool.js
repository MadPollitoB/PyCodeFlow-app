// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Vragenpool (v134): "trek N uit M" per groep
// Pure logica, geen databank/Express. Een groep = een aaneengesloten reeks vragen met
// hetzelfde random_group-nummer (zie berekenGroepen in quiz-teacher.js). Voor een groep kan de
// leerkracht instellen dat elke leerling maar N van de M vragen krijgt, willekeurig per leerling.
// De trekking wordt bij het starten vastgelegd in quiz_student_order (de persoonlijke
// vraaglijst), dus een herstart of herverbinding geeft dezelfde vragen.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');

// Splits vragen (in volgorde) in groepen op basis van random_group. Elke vraag: { id, random_group }.
function bouwGroepen(vragen) {
  const groepen = [];
  let vorige = null;
  for (const q of vragen || []) {
    const g = Number(q.random_group) || 0;
    if (vorige === null || g !== vorige) { groepen.push({ nr: g, vragen: [] }); vorige = g; }
    groepen[groepen.length - 1].vragen.push(q);
  }
  return groepen;
}

const NIVEAUS = ['makkelijk', 'gemiddeld', 'moeilijk'];
const niveauVan = (q) => (NIVEAUS.includes(q && q.difficulty) ? q.difficulty : 'gemiddeld');

// v137: een pool-waarde is een getal N, of { n, mix: { makkelijk, gemiddeld, moeilijk } }.
const poolN = (w) => (w && typeof w === 'object' ? Number(w.n) : Number(w));
const poolMix = (w) => (w && typeof w === 'object' && w.mix && typeof w.mix === 'object' ? w.mix : null);

// Zuivert een pool-instelling { groepNr: N | {n, mix} } tegen de werkelijke groepen.
// Een geldige regel heeft 1 ≤ N < aantal vragen in de groep; al het andere wordt weggelaten
// (N = M betekent "alle vragen", dus geen pool). Een mix blijft enkel staan als ze kan: de som is N en
// er zijn per niveau genoeg vragen in de groep; anders valt de regel terug op gewoon "trek N".
function normaliseerPool(poolRuw, vragen) {
  let obj = poolRuw;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = {}; } }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const grootte = {}; const perNiveau = {};
  for (const g of bouwGroepen(vragen)) {
    grootte[g.nr] = (grootte[g.nr] || 0) + g.vragen.length;
    perNiveau[g.nr] = perNiveau[g.nr] || {};
    for (const q of g.vragen) perNiveau[g.nr][niveauVan(q)] = (perNiveau[g.nr][niveauVan(q)] || 0) + 1;
  }
  const uit = {};
  for (const [sleutel, waarde] of Object.entries(obj)) {
    const nr = Number(sleutel);
    const n = Math.floor(poolN(waarde));
    if (!Number.isInteger(nr) || !grootte[nr]) continue;
    if (!Number.isFinite(n) || n < 1 || n >= grootte[nr]) continue;
    const mixRuw = poolMix(waarde);
    if (mixRuw) {
      const mix = {}; let som = 0; let ok = true;
      for (const k of NIVEAUS) {
        const a = Math.floor(Number(mixRuw[k] || 0));
        if (!Number.isFinite(a) || a < 0 || a > (perNiveau[nr][k] || 0)) { ok = false; break; }
        if (a > 0) mix[k] = a;
        som += a;
      }
      if (ok && som === n && Object.keys(mix).length) { uit[nr] = { n, mix }; continue; }
    }
    uit[nr] = n;
  }
  return uit;
}

function poolActief(pool) {
  return !!pool && typeof pool === 'object' && Object.keys(pool).length > 0;
}

function willekeurigeIndex(max) {            // 0 ≤ i < max, zonder modulo-bias die ertoe doet bij kleine max
  return crypto.randomInt(0, max);
}

// Trek de vragen voor één leerling. Retourneert de gekozen vragen in de oorspronkelijke volgorde.
// pool = { groepNr: N }. rng(max) mag overschreven worden voor tests.
function trekUit(lijst, n, rng) {          // partiële Fisher-Yates op indices → Set van gekozen posities
  const idx = lijst.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + rng(idx.length - i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return new Set(idx.slice(0, n));
}

function trekVragen(vragen, pool, rng = willekeurigeIndex) {
  if (!poolActief(pool)) return (vragen || []).slice();
  const resultaat = [];
  for (const groep of bouwGroepen(vragen)) {
    const w = pool[groep.nr];
    const n = poolN(w);
    if (!n || n >= groep.vragen.length) { resultaat.push(...groep.vragen); continue; }
    const mix = poolMix(w);
    const gekozen = new Set();
    if (mix) {
      // per niveau apart trekken (posities in de groep); zo krijgt elke leerling dezelfde niveaumix
      for (const k of NIVEAUS) {
        const posities = groep.vragen.map((q, i) => (niveauVan(q) === k ? i : -1)).filter(i => i >= 0);
        const aantal = Math.min(Number(mix[k] || 0), posities.length);
        if (aantal > 0) for (const p of trekUit(posities, aantal, rng)) gekozen.add(posities[p]);
      }
    } else {
      for (const p of trekUit(groep.vragen, n, rng)) gekozen.add(p);
    }
    groep.vragen.forEach((q, i) => { if (gekozen.has(i)) resultaat.push(q); });
  }
  return resultaat;
}

// Minimum en maximum aantal punten per leerling (voor het bevestigingsscherm en waarschuwingen).
function puntenBereik(vragen, pool) {
  let min = 0; let max = 0; const afwijkend = [];
  for (const groep of bouwGroepen(vragen)) {
    const punten = groep.vragen.map(q => Number(q.points) || 0).sort((a, b) => a - b);
    const pn = pool && pool[groep.nr] ? poolN(pool[groep.nr]) : 0;
    const n = pn && pn < punten.length ? pn : punten.length;
    min += punten.slice(0, n).reduce((s, p) => s + p, 0);
    max += punten.slice(punten.length - n).reduce((s, p) => s + p, 0);
    if (n < punten.length && punten[0] !== punten[punten.length - 1]) afwijkend.push(groep.nr);
  }
  return { min, max, afwijkendeGroepen: afwijkend };
}

// v137: in een groep met een pool moeten alle vragen evenveel punten waard zijn, zodat elke leerling
// evenveel punten kan halen. Geeft de groepen terug waar dat niet zo is.
function controleerGelijkePunten(vragen, pool) {
  const slecht = [];
  for (const groep of bouwGroepen(vragen)) {
    if (!pool || !pool[groep.nr]) continue;
    const punten = groep.vragen.map(q => Number(q.points) || 0);
    if (punten.some(p => p !== punten[0])) slecht.push({ nr: groep.nr, punten: Array.from(new Set(punten)).sort((a, b) => a - b) });
  }
  return slecht;
}

// e_k van een lijst gewichten (som over alle k-deelverzamelingen van het product van hun gewichten), met BigInt.
function elementairSymmetrisch(gewichten, k) {
  const dp = Array(k + 1).fill(0n); dp[0] = 1n;
  for (const g of gewichten) for (let j = k; j >= 1; j--) dp[j] += dp[j - 1] * g;
  return dp[k];
}

// v137: hoeveel verschillende toetsen kunnen er getrokken worden? `varianten`: { vraagId: aantal invullingen }
// (placeholders; ontbrekend = 1). Exact, via BigInt. Resultaat in strings (veilig voor JSON).
function telUniekeToetsen(vragen, pool, varianten = {}) {
  const gewicht = (q) => BigInt(Math.max(1, Math.floor(Number(varianten[q.id]) || 1)));
  let totaal = 1n; const perGroep = [];
  for (const groep of bouwGroepen(vragen)) {
    const w = pool && pool[groep.nr];
    const n = w ? poolN(w) : 0;
    let aantal; let gewone = true;
    if (!n || n >= groep.vragen.length) {
      aantal = groep.vragen.reduce((p, q) => p * gewicht(q), 1n);
    } else if (poolMix(w)) {
      aantal = 1n; gewone = false;
      for (const k of NIVEAUS) {
        const a = Number(poolMix(w)[k] || 0);
        if (a > 0) aantal *= elementairSymmetrisch(groep.vragen.filter(q => niveauVan(q) === k).map(gewicht), a);
      }
    } else {
      aantal = elementairSymmetrisch(groep.vragen.map(gewicht), n);
    }
    perGroep.push({ nr: groep.nr, m: groep.vragen.length, n: n && n < groep.vragen.length ? n : groep.vragen.length, aantal: aantal.toString(), metMix: !gewone });
    totaal *= aantal;
  }
  return { perGroep, totaal: totaal.toString() };
}

module.exports = { NIVEAUS, niveauVan, poolN, poolMix, controleerGelijkePunten, telUniekeToetsen, bouwGroepen, normaliseerPool, poolActief, trekVragen, puntenBereik };
