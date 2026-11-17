'use strict';
// v137 — Moeilijkheidsrapport: hoe moeilijk bleken de vragen écht, en hoe zwaar was de set van elke leerling?
// Pure functies (geen databank). Bedoeld voor vragenpools: elke leerling kan een andere set vragen gehad hebben.
//   • per vraag: gemiddelde score en slaagpercentage, vergeleken met het ingestelde niveau
//   • per leerling: de VERWACHTE score van zijn set (op basis van het klasgemiddelde per vraag) naast de werkelijke score
//     → wie een zwaardere set had, zie je meteen; het verschil toont wie beter/slechter deed dan de set voorspelde.

const NIVEAUS = ['makkelijk', 'gemiddeld', 'moeilijk'];
// Verwacht gemiddeld scorepercentage per ingesteld niveau (richtwaarden, aanpasbaar via opties).
const VERWACHT = { makkelijk: [70, 100], gemiddeld: [45, 85], moeilijk: [20, 65] };
const MIN_LEERLINGEN = 5;      // onder dit aantal geen oordeel over een vraag
const SET_AFWIJKING = 5;       // procentpunten verschil in setzwaarte dat we melden

const afronden = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const niveauVan = (x) => (NIVEAUS.includes(x) ? x : 'gemiddeld');

function telMee(r) {
  if (r.is_test_account) return false;
  if (/afwezig|absent/i.test(String(r.student_status || ''))) return false;
  return true;
}

function bouwRapport(rijen, opties = {}) {
  const verwacht = opties.verwacht || VERWACHT;
  const minL = opties.minLeerlingen ?? MIN_LEERLINGEN;
  const perVraag = new Map();
  const perLeerling = new Map();
  for (const r of rijen || []) {
    if (!telMee(r)) continue;
    const max = Number(r.points) || 0;
    if (max <= 0) continue;
    const score = r.score == null ? null : Number(r.score);
    const v = perVraag.get(r.question_id) || { vraagId: String(r.question_id), orde: Number(r.order_index) || 0,
      tekst: String(r.text_snapshot || '').slice(0, 80), niveau: niveauVan(r.difficulty), max, scores: [], zonderScore: 0 };
    if (score == null) v.zonderScore++; else v.scores.push({ leerling: String(r.student_id), pct: Math.max(0, Math.min(1, score / max)) });
    perVraag.set(r.question_id, v);
    const l = perLeerling.get(r.student_id) || { id: String(r.student_id), naam: r.student_name || '', rijen: [] };
    l.rijen.push({ vraagId: r.question_id, max, score });
    perLeerling.set(r.student_id, l);
  }
  const vragen = [...perVraag.values()].sort((a, b) => a.orde - b.orde).map(v => {
    const n = v.scores.length;
    const gem = n ? v.scores.reduce((s, x) => s + x.pct, 0) / n : null;
    const slaag = n ? v.scores.filter(x => x.pct >= 0.5).length / n : null;
    const bereik = verwacht[v.niveau];
    let signaal = null;
    if (n >= minL && gem != null) {
      const g = gem * 100;
      if (g < bereik[0]) signaal = 'moeilijker';
      else if (g > bereik[1]) signaal = 'makkelijker';
    }
    v.gem = gem;
    return { vraagId: v.vraagId, tekst: v.tekst, niveau: v.niveau, punten: v.max, aantal: n, nietNagekeken: v.zonderScore,
      gemiddeldePct: afronden(gem == null ? null : gem * 100), slaagPct: afronden(slaag == null ? null : slaag * 100),
      verwachtPct: bereik, signaal };
  });
  const gemVan = new Map(vragen.map(v => [v.vraagId, v.gemiddeldePct == null ? null : v.gemiddeldePct / 100]));

  const leerlingen = [...perLeerling.values()].map(l => {
    let maxTotaal = 0, verwachtPunten = 0, werkelijk = 0, beoordeeld = 0;
    for (const r of l.rijen) {
      const g = gemVan.get(String(r.vraagId)) ?? gemVan.get(r.vraagId);
      if (r.score == null || g == null) continue;
      maxTotaal += r.max; verwachtPunten += r.max * g; werkelijk += r.score; beoordeeld++;
    }
    const setPct = maxTotaal ? (verwachtPunten / maxTotaal) * 100 : null;
    const werkPct = maxTotaal ? (werkelijk / maxTotaal) * 100 : null;
    const niveaus = { makkelijk: 0, gemiddeld: 0, moeilijk: 0 };
    for (const r of l.rijen) { const v = perVraag.get(r.vraagId); if (v) niveaus[v.niveau]++; }
    return { id: l.id, naam: l.naam, aantalVragen: l.rijen.length, beoordeeld, niveaus,
      verwachtPct: afronden(setPct), werkelijkPct: afronden(werkPct),
      verschil: setPct == null || werkPct == null ? null : afronden(werkPct - setPct) };
  }).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));

  const sets = leerlingen.map(l => l.verwachtPct).filter(x => x != null);
  const gemSet = sets.length ? sets.reduce((s, x) => s + x, 0) / sets.length : null;
  for (const l of leerlingen) {
    l.setZwaarte = gemSet == null || l.verwachtPct == null ? null
      : (l.verwachtPct <= gemSet - SET_AFWIJKING ? 'zwaarder' : l.verwachtPct >= gemSet + SET_AFWIJKING ? 'lichter' : 'gelijk');
  }
  return {
    vragen, leerlingen,
    samenvatting: {
      aantalLeerlingen: leerlingen.length, aantalVragen: vragen.length,
      setMin: sets.length ? afronden(Math.min(...sets)) : null, setMax: sets.length ? afronden(Math.max(...sets)) : null,
      setGemiddelde: afronden(gemSet), spreiding: sets.length ? afronden(Math.max(...sets) - Math.min(...sets)) : null,
      afwijkendeVragen: vragen.filter(v => v.signaal).length,
    },
    opmerking: 'Richtwaarden: makkelijk 70–100 %, gemiddeld 45–85 %, moeilijk 20–65 % gemiddelde score. Een oordeel pas vanaf ' + minL + ' leerlingen per vraag.',
  };
}

module.exports = { NIVEAUS, VERWACHT, MIN_LEERLINGEN, SET_AFWIJKING, bouwRapport };
