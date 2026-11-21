'use strict';
// v144: spiek-/fraudepogingen per leerling. Zet het ruwe incidentenlogboek om in groepen per
// vraag en soort, met een leesbare samenvatting en een risicokleur. Zuivere functies (testbaar).

// Soorten die NIET als pogingen tellen (info of handelingen van de leerkracht).
const INFO_TYPES = new Set(['startbevestiging', 'toegang_hersteld', 'deadline_aangepast']);

const LABELS = {
  plakken: 'Plakken', kopieren: 'Kopiëren', knippen: 'Knippen', slepen: 'Slepen',
  tweede_scherm: 'Tweede scherm', tweede_scherm_start: 'Tweede scherm bij start',
  fullscreen_uit: 'Volledig scherm verlaten', dubbel_tabblad: 'Zelfde toets in twee tabbladen',
  weg_van_toets: 'Weg van de toets', tabwissel: 'Tabwissel (telt mee)',
  grote_invoer: 'Code in één keer verschenen', weinig_toetsen: 'Weinig toetsaanslagen voor de lengte',
  sneltoets: 'Verdachte sneltoets', venster_kleiner: 'Venster plots kleiner',
  wijziging_na_terugkeer: 'Grote wijziging kort na terugkeer',
};

const RISICO_VOLGORDE = { hoog: 3, middel: 2, laag: 1 };

function parseDetail(detail) {
  if (!detail || typeof detail !== 'string') return {};
  const t = detail.trim();
  if (t[0] !== '{') return { tekst: t };
  try { const o = JSON.parse(t); return o && typeof o === 'object' ? o : {}; } catch { return { tekst: t }; }
}

function hoogsteRisico(a, b) { return (RISICO_VOLGORDE[b] || 0) > (RISICO_VOLGORDE[a] || 0) ? b : a; }

const ZWARE_SNELTOETSEN = new Set(['F12', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C', 'Ctrl+U']);

function risicoVan(type, d) {
  switch (type) {
    case 'plakken': case 'slepen': return 'hoog';
    case 'kopieren': case 'knippen': return 'middel';
    case 'grote_invoer': case 'dubbel_tabblad': case 'tweede_scherm': return 'hoog';
    case 'wijziging_na_terugkeer': case 'weinig_toetsen': case 'venster_kleiner': case 'fullscreen_uit': case 'tweede_scherm_start': return 'middel';
    case 'sneltoets': return ZWARE_SNELTOETSEN.has(d.toets) ? 'middel' : 'laag';
    case 'weg_van_toets': {
      const s = Number(d.secs);
      if (d.fase === 'weg' || !Number.isFinite(s)) return 'laag';
      return s >= 60 ? 'hoog' : s >= 10 ? 'middel' : 'laag';
    }
    default: return 'laag';
  }
}

function korteTekst(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Leesbare samenvatting van één incident.
function samenvatting(type, d) {
  switch (type) {
    case 'plakken': case 'slepen': case 'kopieren': case 'knippen': {
      const len = d.len != null ? `${d.len} tekens` : '';
      return [len, d.tekst ? `«${korteTekst(d.tekst, 500)}»` : ''].filter(Boolean).join(' · ') || 'poging geblokkeerd';
    }
    case 'grote_invoer': return `${d.delta || '?'} tekens in één keer${d.tekst ? ' · «' + korteTekst(d.tekst, 300) + '»' : ''}`;
    case 'weinig_toetsen': return `${d.len || '?'} tekens toegevoegd met slechts ${d.keys != null ? d.keys : '?'} toetsaanslagen`;
    case 'sneltoets': return String(d.toets || 'sneltoets');
    case 'venster_kleiner': return `venster ${d.w}×${d.h} (was ${d.basisW}×${d.basisH})`;
    case 'wijziging_na_terugkeer': return `${d.delta || '?'} tekens, ${d.secs != null ? d.secs : '?'} s na terugkeer`;
    case 'weg_van_toets': {
      const delen = [];
      if (d.oorzaak) delen.push(d.oorzaak);
      if (d.fase === 'terug' && d.secs != null) delen.push(`${d.secs} s weg`);
      if (d.fase === 'weg') delen.push('weggegaan');
      return delen.join(' · ') || 'weg van de toets';
    }
    case 'dubbel_tabblad': return d.fase === 'voor_start' ? 'voor het starten' : 'tijdens de toets';
    default: return d.tekst || '';
  }
}

// Alle incidenten van één leerling → groepen per (soort, vraag).
function groepeerFraude(incidenten, studentId) {
  const groepen = new Map();
  let risico = 'laag';
  let totaal = 0;
  for (const i of incidenten || []) {
    if (studentId && i.studentId !== studentId) continue;
    if (INFO_TYPES.has(i.type)) continue;
    const d = parseDetail(i.detail);
    const vraag = d.q != null ? String(d.q) : null;
    const sleutel = i.type + '|' + (vraag || '');
    let g = groepen.get(sleutel);
    if (!g) { g = { type: i.type, label: LABELS[i.type] || i.type, vraag, aantal: 0, risico: 'laag', items: [] }; groepen.set(sleutel, g); }
    g.aantal++; totaal++;
    const r = risicoVan(i.type, d);
    g.risico = hoogsteRisico(g.risico, r);
    risico = hoogsteRisico(risico, r);
    g.items.push({ at: i.at, tekst: samenvatting(i.type, d), risico: r });
  }
  const lijst = [...groepen.values()].sort((a, b) =>
    (RISICO_VOLGORDE[b.risico] - RISICO_VOLGORDE[a.risico]) || (b.aantal - a.aantal));
  return { risico: totaal ? risico : null, totaal, groepen: lijst };
}

// Plakpogingen per leerling en per vraag (voor het gelijkenisrapport).
function plakTellingen(incidenten) {
  const uit = {};
  for (const i of incidenten || []) {
    if (!i.studentId || !/^(plakken|slepen)$/.test(i.type)) continue;
    const d = parseDetail(i.detail);
    const q = d.q != null ? String(d.q) : '?';
    const o = uit[i.studentId] || (uit[i.studentId] = {});
    o[q] = (o[q] || 0) + 1;
  }
  return uit;
}

module.exports = { INFO_TYPES, LABELS, parseDetail, risicoVan, samenvatting, groepeerFraude, plakTellingen };
