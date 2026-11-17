// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Placeholders / variabelen per leerling (v135)
// Pure logica, geen databank/Express. Een vraag kan variabelen hebben (een geheel getal in een
// bereik, of een keuze uit een lijst). In de vraagtekst, de antwoordopties, het modelantwoord en
// de onderdelen staat dan {{naam}} of een eenvoudige berekening zoals {{n*2}} of {{a+b}}.
// Elke leerling krijgt vaste, eigen waarden: ze worden AFGELEID uit (sessie, leerling, vraag) via
// een deterministische generator. Er hoeft dus niets opgeslagen te worden en leerling, nazicht,
// PDF's en AI-nakijken zien altijd exact dezelfde waarden.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');

const MAX_VARIABELEN = 8;
const NAAM_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const TOKEN_RE = /\{\{([^{}]*)\}\}/g;
const TOKEN_INHOUD_RE = /^[\sA-Za-z0-9_+\-*\/%().]+$/;   // enkel "reken-achtige" inhoud telt als placeholder

function parseJson(v, standaard) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  try { const x = JSON.parse(v); return x === null || x === undefined ? standaard : x; } catch { return standaard; }
}

// Zuivert een variabelenlijst. Retourneert { variabelen, fouten }. Bij fouten is variabelen leeg.
function normaliseerVariabelen(ruw) {
  const alles = parseJson(ruw, []);
  if (!Array.isArray(alles)) return { variabelen: [], voorwaarde: '', fouten: ['Variabelen moeten een lijst zijn.'] };
  // v137: een optionele voorwaarde ("a > b") staat als los element { voorwaarde } in dezelfde lijst
  // (geen schemawijziging nodig; oudere code die enkel variabelen verwacht, negeert het).
  const voorwaardeEl = alles.find(v => v && typeof v === 'object' && typeof v.voorwaarde === 'string');
  const lijst = alles.filter(v => !(v && typeof v === 'object' && 'voorwaarde' in v && !('naam' in v)));
  let voorwaarde = voorwaardeEl ? voorwaardeEl.voorwaarde.trim() : '';
  const fouten = [];
  const uit = [];
  const namen = new Set();
  if (lijst.length > MAX_VARIABELEN) fouten.push(`Maximaal ${MAX_VARIABELEN} variabelen per vraag.`);
  for (const v of lijst.slice(0, MAX_VARIABELEN)) {
    const naam = String(v?.naam ?? '').trim();
    if (!NAAM_RE.test(naam)) { fouten.push(`Ongeldige naam "${naam}": begin met een letter, enkel letters/cijfers/_ (max. 16).`); continue; }
    if (namen.has(naam)) { fouten.push(`De naam "${naam}" komt twee keer voor.`); continue; }
    namen.add(naam);
    if (v.type === 'keuze') {
      const waarden = (Array.isArray(v.waarden) ? v.waarden : []).map(w => String(w ?? '').trim()).filter(Boolean);
      const uniek = Array.from(new Set(waarden));
      if (uniek.length < 2) { fouten.push(`"${naam}": geef minstens 2 verschillende waarden.`); continue; }
      if (uniek.length > 12) { fouten.push(`"${naam}": maximaal 12 waarden.`); continue; }
      if (uniek.some(w => w.length > 40)) { fouten.push(`"${naam}": een waarde is langer dan 40 tekens.`); continue; }
      uit.push({ naam, type: 'keuze', waarden: uniek });
    } else {
      const min = Number(v.min); const max = Number(v.max);
      if (!Number.isInteger(min) || !Number.isInteger(max)) { fouten.push(`"${naam}": min en max moeten gehele getallen zijn.`); continue; }
      if (Math.abs(min) > 1e6 || Math.abs(max) > 1e6) { fouten.push(`"${naam}": waarden tussen -1.000.000 en 1.000.000.`); continue; }
      if (min >= max) { fouten.push(`"${naam}": min moet kleiner zijn dan max.`); continue; }
      uit.push({ naam, type: 'geheel', min, max });
    }
  }
  if (voorwaarde) {
    if (voorwaarde.length > 120) fouten.push('De voorwaarde is te lang (max. 120 tekens).');
    else {
      const proef = {};
      for (const v of uit) proef[v.naam] = v.type === 'keuze' ? v.waarden[0] : v.min;
      if (evalueerVoorwaarde(voorwaarde, proef) === undefined) fouten.push(`De voorwaarde "${voorwaarde}" is ongeldig. Voorbeelden: a > b, n % 2 == 0, a != b and a + b < 50.`);
    }
  }
  return { variabelen: fouten.length ? [] : uit, voorwaarde: fouten.length ? '' : voorwaarde, fouten };
}

// Wat in variables_json wordt bewaard: de variabelen + (optioneel) de voorwaarde.
function opslagVan(variabelen, voorwaarde) {
  const l = (variabelen || []).slice();
  if (voorwaarde && String(voorwaarde).trim() && l.length) l.push({ voorwaarde: String(voorwaarde).trim() });
  return l;
}

// ── mini-rekenmachine (geen eval) ──────────────────────────────────────────────
function tokeniseer(s) {
  const tokens = [];
  const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\*\*|\/\/|[-+*\/%()])/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) { if (/^\s*$/.test(s.slice(pos))) break; return null; }
    tokens.push(m[1]); pos = re.lastIndex;
  }
  return tokens;
}

// Retourneert een getal, een string (enkel bij een kale tekst-variabele) of undefined bij een fout.
function evalueer(inhoud, waarden) {
  const t = tokeniseer(inhoud);
  if (!t || !t.length) return undefined;
  if (t.length === 1 && /^[A-Za-z_]/.test(t[0])) {
    return Object.prototype.hasOwnProperty.call(waarden, t[0]) ? waarden[t[0]] : undefined;
  }
  let i = 0;
  const fout = () => { throw new Error('x'); };
  const expr = () => { let l = term(); while (t[i] === '+' || t[i] === '-') { const op = t[i++]; const r = term(); l = op === '+' ? l + r : l - r; } return l; };
  const term = () => {
    let l = unair();
    while (t[i] === '*' || t[i] === '/' || t[i] === '//' || t[i] === '%') {
      const op = t[i++]; const r = unair();
      if ((op === '/' || op === '//' || op === '%') && r === 0) fout();
      l = op === '*' ? l * r : op === '/' ? l / r : op === '//' ? Math.floor(l / r) : ((l % r) + r) % r;   // % zoals in Python
    }
    return l;
  };
  const unair = () => { if (t[i] === '-') { i++; return -unair(); } if (t[i] === '+') { i++; return unair(); } return macht(); };
  const macht = () => { const b = atoom(); if (t[i] === '**') { i++; const e = unair(); const r = Math.pow(b, e); if (!Number.isFinite(r) || Math.abs(r) > 1e12) fout(); return r; } return b; };
  const atoom = () => {
    const x = t[i++];
    if (x === undefined) fout();
    if (x === '(') { const v = expr(); if (t[i++] !== ')') fout(); return v; }
    if (/^\d/.test(x)) return Number(x);
    if (/^[A-Za-z_]/.test(x)) {
      if (!Object.prototype.hasOwnProperty.call(waarden, x) || typeof waarden[x] !== 'number') fout();
      return waarden[x];
    }
    return fout();
  };
  try {
    const v = expr();
    if (i !== t.length || !Number.isFinite(v)) return undefined;
    return v;
  } catch { return undefined; }
}

function formatGetal(x) {
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toFixed(4)));
}

// ── voorwaarden (v137): "a > b", "n % 2 == 0", "a != b and a + b < 50" ──────────────
function splitBuiten(s, scheiders) {   // splits op woorden/tekens op haakjesdiepte 0
  const delen = []; let diepte = 0; let start = 0; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') diepte++; else if (c === ')') diepte--;
    if (diepte === 0) {
      const hit = scheiders.find(w => s.slice(i, i + w.length).toLowerCase() === w &&
        (!/^[a-z]/.test(w) || (!/[A-Za-z0-9_]/.test(s[i - 1] || ' ') && !/[A-Za-z0-9_]/.test(s[i + w.length] || ' '))));
      if (hit) { delen.push(s.slice(start, i)); i += hit.length; start = i; continue; }
    }
    i++;
  }
  delen.push(s.slice(start));
  return delen;
}
function vergelijk(deel, waarden) {
  const m = /^(.*?)(==|!=|<=|>=|<|>)(.*)$/.exec(deel);
  if (!m) return undefined;
  const l = evalueer(m[1].trim(), waarden), r = evalueer(m[3].trim(), waarden);
  if (l === undefined || r === undefined) return undefined;
  const isNum = typeof l === 'number' && typeof r === 'number';
  const op = m[2];
  if (!isNum && op !== '==' && op !== '!=') return undefined;
  const a = isNum ? l : String(l), b = isNum ? r : String(r);
  return op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
}
// true/false, of undefined bij een fout. Geen eval.
function evalueerVoorwaarde(expr, waarden) {
  if (typeof expr !== 'string' || !expr.trim()) return true;
  if (!/^[\sA-Za-z0-9_+\-*\/%().=!<>&|]+$/.test(expr)) return undefined;
  const e = expr.replace(/&&/g, ' and ').replace(/\|\|/g, ' or ');
  let of = false;
  for (const orDeel of splitBuiten(e, ['or'])) {
    let en = true;
    for (const deel of splitBuiten(orDeel, ['and'])) {
      const r = vergelijk(deel.trim(), waarden);
      if (r === undefined) return undefined;
      en = en && r;
    }
    of = of || en;
  }
  return of;
}

// ── waarden per leerling ────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministische waarden: dezelfde seed geeft altijd dezelfde waarden.
function trekEenmaal(variabelen, seed) {
  const waarden = {};
  for (const v of variabelen || []) {
    const h = crypto.createHash('sha256').update(String(seed) + '|' + v.naam).digest();
    const rnd = mulberry32(h.readUInt32BE(0));
    if (v.type === 'keuze') waarden[v.naam] = v.waarden[Math.floor(rnd() * v.waarden.length)];
    else waarden[v.naam] = v.min + Math.floor(rnd() * (v.max - v.min + 1));
  }
  return waarden;
}

// v137: met een voorwaarde wordt opnieuw getrokken (deterministisch: seed#1, seed#2, …) tot ze klopt.
// Zonder voorwaarde is het resultaat identiek aan v135 (bestaande toetsen blijven dezelfde waarden geven).
function berekenWaarden(variabelen, seed, voorwaarde) {
  let w = trekEenmaal(variabelen, seed);
  if (!voorwaarde) return w;
  for (let poging = 1; poging <= 500 && evalueerVoorwaarde(voorwaarde, w) !== true; poging++) {
    w = trekEenmaal(variabelen, seed + '#' + poging);
  }
  return w;
}

function seedVoor(sessieCode, leerlingId, vraagId) {
  return `${sessieCode}|${leerlingId}|${vraagId}`;
}

// Vervang alle {{...}} in een tekst. Onbekende of ongeldige tokens blijven letterlijk staan.
function vulIn(tekst, waarden) {
  if (typeof tekst !== 'string' || !tekst.includes('{{')) return tekst;
  return tekst.replace(TOKEN_RE, (hele, inhoud) => {
    if (!TOKEN_INHOUD_RE.test(inhoud)) return hele;
    const r = evalueer(inhoud, waarden);
    if (r === undefined) return hele;
    return typeof r === 'number' ? formatGetal(r) : String(r);
  });
}

// Alle tekstvelden van een vraag (bankvraag of snapshot) die placeholders mogen bevatten.
function tekstenVanVraag(q) {
  const t = [q.text_snapshot, q.text, q.model_answer, q.modelAnswer];
  for (const c of parseJson(q.choices_json ?? q.choicesJson, [])) if (c) t.push(c.text);
  for (const p of parseJson(q.answer_parts ?? q.answerParts, [])) if (p) { t.push(p.label); t.push(p.modelAnswer); }
  return t.filter(x => typeof x === 'string');
}

// Controleer dat elke {{...}} in de teksten naar een bekende variabele/berekening verwijst.
function controleerTokens(variabelen, teksten) {
  const fouten = [];
  if (!variabelen || !variabelen.length) return fouten;
  // v137: een token mag bij sommige waarden mislukken (bv. 10//a bij a=0 — dat meldt de combinatiecontrole,
  // of de voorwaarde sluit het uit). Het is pas een vaste fout als het bij GEEN enkele proefwaarde lukt.
  const proeven = [0, 1, 2].map(k => {
    const proef = {};
    for (const v of variabelen) {
      proef[v.naam] = v.type === 'keuze'
        ? v.waarden[k === 0 ? 0 : k === 1 ? v.waarden.length - 1 : Math.floor(v.waarden.length / 2)]
        : (k === 0 ? v.min : k === 1 ? v.max : Math.floor((v.min + v.max) / 2));
    }
    return proef;
  });
  for (const tekst of teksten || []) {
    for (const m of String(tekst).matchAll(TOKEN_RE)) {
      if (!TOKEN_INHOUD_RE.test(m[1])) continue;
      if (proeven.every(proef => evalueer(m[1], proef) === undefined)) fouten.push(`{{${m[1].trim()}}} kan niet berekend worden (onbekende variabele of fout in de formule).`);
    }
  }
  return Array.from(new Set(fouten));
}

function heeftVariabelen(q) {
  const l = parseJson(q && (q.variables_json ?? q.variablesJson), []);
  return Array.isArray(l) && l.some(v => v && typeof v === 'object' && 'naam' in v);
}

// Geef een kopie van de vraag met alle placeholders ingevuld voor deze leerling. Zonder variabelen
// wordt hetzelfde object teruggegeven (geen kopie, geen risico voor bestaande vragen).
function vulVraagIn(q, sessieCode, leerlingId) {
  if (!q || !heeftVariabelen(q)) return q;
  const nv = normaliseerVariabelen(q.variables_json ?? q.variablesJson);
  if (!nv.variabelen.length) return q;
  const waarden = berekenWaarden(nv.variabelen, seedVoor(sessieCode, leerlingId, q.id), nv.voorwaarde);
  return vulVraagInMetWaarden(q, waarden);
}

// v137: de waarden van één leerling voor een vraag (of null zonder variabelen).
function waardenVoorVraag(q, sessieCode, leerlingId, vraagId) {
  const nv = normaliseerVariabelen(q && (q.variables_json ?? q.variablesJson));
  if (!nv.variabelen.length) return null;
  return berekenWaarden(nv.variabelen, seedVoor(sessieCode, leerlingId, vraagId), nv.voorwaarde);
}

function vulVraagInMetWaarden(q, waarden) {
  const kopie = { ...q };
  for (const veld of ['text_snapshot', 'text', 'model_answer', 'modelAnswer']) {
    if (typeof kopie[veld] === 'string') kopie[veld] = vulIn(kopie[veld], waarden);
  }
  for (const [veld, tekstvelden] of [['choices_json', ['text']], ['choicesJson', ['text']], ['answer_parts', ['label', 'modelAnswer']], ['answerParts', ['label', 'modelAnswer']]]) {
    if (kopie[veld] === undefined) continue;
    const isString = typeof kopie[veld] === 'string';
    const lijst = parseJson(kopie[veld], null);
    if (!Array.isArray(lijst)) continue;
    const nieuw = lijst.map(item => {
      if (!item || typeof item !== 'object') return item;
      const kopieItem = { ...item };
      for (const f of tekstvelden) if (typeof kopieItem[f] === 'string') kopieItem[f] = vulIn(kopieItem[f], waarden);
      return kopieItem;
    });
    kopie[veld] = isString ? JSON.stringify(nieuw) : nieuw;
  }
  kopie._waarden = waarden;
  return kopie;
}

// Voorbeeld-invullingen voor de vraag-editor ("zo ziet leerling 1, 2, 3 het").
function voorbeeldVoorbeelden(q, aantal = 3) {
  const nv = normaliseerVariabelen(q.variables_json ?? q.variablesJson ?? q.variabelen);
  const variabelen = nv.variabelen;
  const uit = [];
  for (let i = 0; i < aantal; i++) {
    const waarden = berekenWaarden(variabelen, `voorbeeld|${i + 1}`, nv.voorwaarde);
    uit.push({ waarden, vraag: vulVraagInMetWaarden({ text: q.text || '', model_answer: q.model_answer || q.modelAnswer || '',
      choices_json: q.choices_json ?? q.choicesJson ?? '[]', answer_parts: q.answer_parts ?? q.answerParts ?? '[]' }, waarden) });
  }
  return uit;
}

// ── v137: aantal combinaties en controle op onmogelijke situaties ──────────────────────────
const MAX_OPSOMMING = 50000;
function aantalVoorVariabele(v) { return v.type === 'keuze' ? v.waarden.length : (v.max - v.min + 1); }
function waardeOpIndex(v, i) { return v.type === 'keuze' ? v.waarden[i] : v.min + i; }

// Alle (of een steekproef van) combinaties; roept cb(waarden) aan. Geeft { totaal, volledig }.
function overCombinaties(variabelen, cb, max = MAX_OPSOMMING) {
  const tellers = variabelen.map(aantalVoorVariabele);
  const totaal = tellers.reduce((p, n) => p * n, 1);
  if (totaal <= max) {
    const idx = variabelen.map(() => 0);
    for (let k = 0; k < totaal; k++) {
      const w = {}; variabelen.forEach((v, j) => { w[v.naam] = waardeOpIndex(v, idx[j]); });
      cb(w);
      for (let j = variabelen.length - 1; j >= 0; j--) { if (++idx[j] < tellers[j]) break; idx[j] = 0; }
    }
    return { totaal, volledig: true };
  }
  const rnd = mulberry32(12345);
  for (let k = 0; k < max; k++) {
    const w = {}; variabelen.forEach((v, j) => { w[v.naam] = waardeOpIndex(v, Math.floor(rnd() * tellers[j])); });
    cb(w);
  }
  return { totaal, volledig: false };
}

// Hoeveel verschillende (geldige) invullingen heeft deze vraag? { aantal, exact, onmogelijk }
function telCombinaties(variabelen, voorwaarde) {
  if (!variabelen || !variabelen.length) return { aantal: 1, exact: true, onmogelijk: false };
  const totaal = variabelen.reduce((p, v) => p * aantalVoorVariabele(v), 1);
  if (!voorwaarde) return { aantal: totaal, exact: true, onmogelijk: false };
  let geldig = 0; let bekeken = 0;
  const r = overCombinaties(variabelen, (w) => { bekeken++; if (evalueerVoorwaarde(voorwaarde, w) === true) geldig++; });
  if (r.volledig) return { aantal: geldig, exact: true, onmogelijk: geldig === 0 };
  return { aantal: Math.round(totaal * geldig / bekeken), exact: false, onmogelijk: geldig === 0 };
}

// Controle: levert elke geldige combinatie een berekenbare tekst op? Geeft { fouten, waarschuwingen }.
// fouten blokkeren het opslaan (onmogelijk), waarschuwingen niet (bv. decimalen, gelijke opties).
function controleerCombinaties(variabelen, voorwaarde, vraag) {
  const fouten = []; const waarschuwingen = [];
  if (!variabelen || !variabelen.length) return { fouten, waarschuwingen, aantal: 1, exact: true };
  const teksten = tekstenVanVraag(vraag || {});
  const keuzes = parseJson(vraag && (vraag.choices_json ?? vraag.choicesJson), []);
  const tel = telCombinaties(variabelen, voorwaarde);
  if (tel.onmogelijk) fouten.push('Er is geen enkele combinatie die aan de voorwaarde voldoet.');
  const gezien = new Set(); let decimalen = false; let gelijkeOpties = false; let ongebruikt = new Set(variabelen.map(v => v.naam));
  const alleTokens = [];
  for (const t of teksten) for (const m of String(t).matchAll(TOKEN_RE)) if (TOKEN_INHOUD_RE.test(m[1])) alleTokens.push(m[1]);
  for (const t of alleTokens) for (const v of variabelen) if (new RegExp('\\b' + v.naam + '\\b').test(t)) ongebruikt.delete(v.naam);
  if (!tel.onmogelijk) {
    overCombinaties(variabelen, (w) => {
      if (voorwaarde && evalueerVoorwaarde(voorwaarde, w) !== true) return;
      for (const tok of alleTokens) {
        const r = evalueer(tok, w);
        if (r === undefined) { const f = `{{${tok.trim()}}} kan geen uitkomst geven bij ${beschrijf(w)} (bv. delen door nul).`; if (!gezien.has(f) && gezien.size < 3) { gezien.add(f); fouten.push(f); } }
        else if (typeof r === 'number' && !Number.isInteger(r)) decimalen = true;
      }
      if (Array.isArray(keuzes) && keuzes.length > 1 && !gelijkeOpties) {
        const gevuld = keuzes.map(c => vulIn(String(c && c.text || ''), w).trim().toLowerCase());
        if (new Set(gevuld).size < gevuld.length) gelijkeOpties = true;
      }
    });
  }
  if (gelijkeOpties) fouten.push('Bij sommige combinaties krijgen twee antwoordopties dezelfde tekst. Pas de waarden of de voorwaarde aan.');
  if (decimalen) waarschuwingen.push('Bij sommige combinaties is een uitkomst geen geheel getal (bv. door een deling met /).');
  if (ongebruikt.size && alleTokens.length) waarschuwingen.push('Niet gebruikt in de vraag: ' + [...ongebruikt].join(', ') + '.');
  return { fouten, waarschuwingen, aantal: tel.aantal, exact: tel.exact };
}
function beschrijf(w) { return Object.entries(w).map(([k, v]) => `${k}=${v}`).join(', '); }

module.exports = {
  evalueerVoorwaarde, opslagVan, waardenVoorVraag, telCombinaties, controleerCombinaties,
  MAX_VARIABELEN, normaliseerVariabelen, berekenWaarden, seedVoor, vulIn, evalueer, formatGetal,
  tekstenVanVraag, controleerTokens, heeftVariabelen, vulVraagIn, vulVraagInMetWaarden, voorbeeldVoorbeelden,
};
