'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// v2026.2.51.119 — Trainingscenter: groeimogelijkheden (pure logica, geen databank/Express)
//   • herhaling van fouten (Leitner-doosjes: 1, 3, 7, 14, 30 dagen)
//   • streak (weekend-vriendelijk) en "Dagelijkse 5"
//   • groeipad: wat is de volgende stap per onderwerp
// ═══════════════════════════════════════════════════════════════════════════════

const DAG_MS = 86400000;
const HERHAAL_DAGEN = [1, 3, 7, 14, 30];     // wachttijd na 1x, 2x, ... 5x juist herhaald
const FOUT_WACHT_MS = 18 * 3600 * 1000;       // een fout komt de volgende dag (of 18u later) terug
const DAGELIJKS_AANTAL = 5;
const DAGELIJKS_MAX_ONDERWERPEN = 3;
const HERHAAL_ELKE = 3;                       // elke 3e vraag is een herhaalvraag (als die er zijn)

// Nieuwe doosstand na een antwoord. null = niet (meer) bijhouden.
//   bestaand: { box } of null; goed: boolean (volledig juist)
function volgendeHerhaling(bestaand, goed, nuMs) {
  if (!goed) return { box: 0, dueAt: nuMs + FOUT_WACHT_MS };
  if (!bestaand) return null;                              // eerste keer juist: niets te herhalen
  const box = (bestaand.box || 0) + 1;
  if (box > HERHAAL_DAGEN.length) return null;             // 5x juist herhaald: geleerd
  return { box, dueAt: nuMs + HERHAAL_DAGEN[box - 1] * DAG_MS };
}

// Moet de volgende vraag een herhaalvraag zijn? nr = aantal reeds beantwoorde vragen in deze training.
function isHerhaalMoment(nr) { return nr >= 2 && nr % HERHAAL_ELKE === HERHAAL_ELKE - 1; }

function dagSleutel(ms, tz = 'Europe/Brussels') {
  // formatToParts: onafhankelijk van de ICU-versie (sommige Node-builds geven bij en-CA geen YYYY-MM-DD)
  const o = {}; for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}`;
}
function isWeekend(sleutel) { const d = new Date(sleutel + 'T12:00:00Z').getUTCDay(); return d === 0 || d === 6; }
function dagVoor(sleutel) { return new Date(new Date(sleutel + 'T12:00:00Z').getTime() - DAG_MS).toISOString().slice(0, 10); }

// Aantal opeenvolgende "oefendagen". Weekenddagen breken de reeks niet; een dag zonder oefening
// breekt ze pas als de dag voorbij is (vandaag nog niet geoefend telt dus nog niet als gemist).
function berekenStreak(tijdstippenMs, nuMs, tz) {
  const dagen = new Set((tijdstippenMs || []).map(t => dagSleutel(t, tz)));
  const vandaag = dagSleutel(nuMs, tz);
  const vandaagGedaan = dagen.has(vandaag);
  let d = vandaagGedaan ? vandaag : dagVoor(vandaag);
  let streak = 0;
  for (let i = 0; i < 800; i++) {
    if (dagen.has(d)) streak++;
    else if (!isWeekend(d)) break;
    d = dagVoor(d);
  }
  return { streak, vandaagGedaan };
}

// Welke onderwerpen voor de Dagelijkse 5: eerst wat herhaald moet worden, dan het zwakste.
//   rijen: [{ id, aantal }], stats: { topic: { n, gem } }, due: { topic: n }
function kiesDagelijkseOnderwerpen(rijen, stats, due, max = DAGELIJKS_MAX_ONDERWERPEN) {
  const kandidaat = (rijen || []).filter(r => r.aantal > 0);
  const prio = r => {
    const st = (stats || {})[r.id]; const d = (due || {})[r.id] || 0;
    const gem = st && st.gem != null ? st.gem : 55;           // onbekend = middelmatig
    return { d, gem };
  };
  kandidaat.sort((a, b) => { const x = prio(a), y = prio(b); return y.d - x.d || x.gem - y.gem; });
  return kandidaat.slice(0, max).map(r => r.id);
}

// Wat is de volgende stap voor dit onderwerp? soort: herhaal | start | oefen | door | blijf
function volgendeStap({ due = 0, n = 0, gem = null, niveau = null, maxLevel = 10 } = {}) {
  if (due > 0) return { soort: 'herhaal', tekst: `Herhaal ${due} vraag${due === 1 ? '' : 'en'} die eerder fout ging${due === 1 ? '' : 'en'}` };
  if (!n) return { soort: 'start', tekst: 'Begin hier: de eerste vragen bepalen je niveau' };
  if (gem != null && gem < 50) return { soort: 'oefen', tekst: `Oefen verder${niveau ? ' op niveau ' + niveau : ''}: je zit nog onder de 50%` };
  if (gem != null && gem >= 80 && niveau && niveau < maxLevel) return { soort: 'door', tekst: `Sterk bezig! Probeer een hogere uitdaging dan niveau ${niveau}` };
  if (niveau && niveau >= maxLevel && gem != null && gem >= 80) return { soort: 'blijf', tekst: 'Je zit op het hoogste niveau. Houd het scherp met een herhaling.' };
  return { soort: 'blijf', tekst: 'Blijf oefenen om te groeien' };
}

module.exports = {
  DAG_MS, HERHAAL_DAGEN, FOUT_WACHT_MS, DAGELIJKS_AANTAL, DAGELIJKS_MAX_ONDERWERPEN, HERHAAL_ELKE,
  volgendeHerhaling, isHerhaalMoment, dagSleutel, berekenStreak, kiesDagelijkseOnderwerpen, volgendeStap,
};
