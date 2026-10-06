'use strict';
// PyCodeFlow — klasbord (v2026.2.51.99)
// Pure logica (geen I/O) voor het live klasbord bij toetsen en taken:
//  - statuskleur per leerling (groen / geel / rood / blauw / grijs)
//  - volgnummer van opgestoken handen
//  - voortgangsnummer ("vraag n van totaal" = beantwoord + 1)
// Staat in een eigen module zodat het zonder server of database te testen is.

const STATUSSEN = ['groen', 'geel', 'rood', 'blauw', 'grijs'];

// Een klasbord is altijd aan bij een toets; bij een taak enkel als de leerkracht
// het vinkje "klasbord + hand opsteken" aanzette (taak thuis hoeft dit niet).
function klasbordActief(meta) {
  if (!meta) return false;
  if (meta.type === 'toets') return true;
  return meta.klasbord_enabled === true;
}

// Voorrang (hoog → laag): ingediend (grijs) → hand (geel) → rood → offline (blauw) → groen.
function bepaalStatus(s) {
  if (!s) return 'blauw';
  if (s.submitted) return 'grijs';
  if (s.handUp) return 'geel';
  if (s.rood) return 'rood';
  if (!s.online) return 'blauw';
  return 'groen';
}

// Volgnummer per opgestoken hand, op volgorde van opsteken (1 = eerst).
// Gelijke tijdstippen worden op id opgelost zodat de volgorde stabiel blijft.
function handVolgorde(leerlingen) {
  const met = (leerlingen || []).filter(s => s && s.handUp && !s.submitted);
  met.sort((a, b) => ((a.handAt || 0) - (b.handAt || 0)) || String(a.id).localeCompare(String(b.id)));
  const nummers = new Map();
  met.forEach((s, i) => nummers.set(s.id, i + 1));
  return nummers;
}

// "Op welke vraag zit deze leerling": aantal beantwoorde vragen + 1, begrensd op het totaal.
// Los van de (willekeurige) volgorde waarin de leerling de vragen krijgt.
function voortgangNummer(beantwoord, totaal) {
  const t = Math.max(0, Number(totaal) || 0);
  const b = Math.max(0, Number(beantwoord) || 0);
  if (t === 0) return 0;
  return Math.min(b + 1, t);
}

// Bouwt de lijst die naar het bord gaat. `leerlingen` zijn de ruwe sessie-leerlingen.
function bouwBordLeerlingen(leerlingen, totaalVragen) {
  const lijst = (leerlingen || []).filter(s => s && !s.removed).map(s => ({
    id: s.id,
    name: s.name,
    online: Boolean(s.online),
    submitted: Boolean(s.quizSubmitted),
    handUp: Boolean(s.klasbordHand),
    handAt: s.klasbordHandAt || null,
    rood: Boolean(s.klasbordRood),
    weg: Boolean(s.klasbordWeg),
    wisselCount: s.klasbordWisselCount || 0,
    beantwoord: s.quizAnswers ? Object.keys(s.quizAnswers).length : 0,
  }));
  const nummers = handVolgorde(lijst);
  return lijst
    .map(s => ({
      id: s.id,
      name: s.name,
      status: bepaalStatus(s),
      handNummer: nummers.get(s.id) || null,
      weg: s.weg,
      wisselCount: s.wisselCount,
      vraag: s.submitted ? totaalVragen : voortgangNummer(s.beantwoord, totaalVragen),
      totaal: totaalVragen,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

// Kolommen voor het bord: 5 bij ≤25 leerlingen, daarna groeit het mee zodat er
// nooit gescrold hoeft te worden (≤36 → 6, ≤49 → 7, enz.).
function bordKolommen(aantal) {
  const n = Math.max(0, Number(aantal) || 0);
  if (n <= 25) return 5;
  return Math.ceil(Math.sqrt(n));
}

module.exports = {
  STATUSSEN, klasbordActief, bepaalStatus, handVolgorde,
  voortgangNummer, bouwBordLeerlingen, bordKolommen,
};
