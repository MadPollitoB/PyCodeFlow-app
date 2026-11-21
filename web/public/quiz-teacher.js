// PyCodeFlow — geextraheerd uit quiz-teacher.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

// ── Sprint 43.14: type (toets/taak) staat al vast bij het OPENEN van dit scherm ──
// Komt uit de link (?type=toets|taak) vanuit taak-overzicht/toets-overzicht/
// teacher-sessions — NIET meer afgeleid uit de timerkeuze (dat was de bug: "+
// Nieuwe taak" opende een scherm dat overal "toets" zei en er ook echt één maakte).
// Ontbreekt of is het type ongeldig (rechtstreekse link, oude bookmark), dan tonen
// we een korte keuze i.p.v. te gokken. Eenmaal gekozen staat het vast: er is geen
// UI om het tijdens het aanmaken nog te wijzigen (bevestigd 16/07/2026).
const QUIZ_TYPE_META = {
  toets: {
    badge: 'Nieuwe toets', title: 'Nieuwe toets aanmaken',
    sub: 'Stel een toets in met vragen uit de vragenbank.',
    noun: 'toets', nameLabel: 'Naam van de toets', namePlaceholder: 'Bv. Toets Functies H2',
    createLabel: 'Toets aanmaken', confirmTitle: 'Bevestig toets',
    createdLabel: 'Toets aangemaakt', previewNoun: 'de toets',
    defaultTimer: 'timed',
  },
  taak: {
    badge: 'Nieuwe taak', title: 'Nieuwe taak aanmaken',
    sub: 'Stel een taak in met vragen uit de vragenbank.',
    noun: 'taak', nameLabel: 'Naam van de taak', namePlaceholder: 'Bv. Taak Functies H2',
    createLabel: 'Taak aanmaken', confirmTitle: 'Bevestig taak',
    createdLabel: 'Taak aangemaakt', previewNoun: 'de taak',
    // Standaard geen tijdslimiet, maar — anders dan vroeger — instelbaar: een taak
    // MAG een tijdslimiet hebben, dat is enkel niet verplicht.
    defaultTimer: 'notimer',
  },
};

const QUIZ_TYPE = (function resolveQuizType() {
  const param = new URLSearchParams(location.search).get('type');
  if (param === 'toets' || param === 'taak') return param;
  const chooser = document.getElementById('type-chooser');
  if (chooser) chooser.style.display = 'block';
  return null;
})();

// ── Sprint 50 (bug 2): bewerkmodus ───────────────────────────────────────────
// ?edit=CODE opent dit scherm om een BESTAANDE toets/taak aan te passen. Het type
// verandert nooit (een taak blijft een taak, een toets een toets). De data wordt
// ingeladen via loadForEdit() zodra QUIZ_TYPE bekend is.
const EDIT_CODE = new URLSearchParams(location.search).get('edit') || '';
const IS_EDIT = !!EDIT_CODE;

if (QUIZ_TYPE) {
  const meta = QUIZ_TYPE_META[QUIZ_TYPE];
  document.title = 'PyCodeFlow — ' + (IS_EDIT ? meta.noun.charAt(0).toUpperCase() + meta.noun.slice(1) + ' aanpassen' : meta.title);
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('type-badge', IS_EDIT ? meta.noun.charAt(0).toUpperCase() + meta.noun.slice(1) + ' aanpassen' : meta.badge);
  setText('page-h1', IS_EDIT ? meta.noun.charAt(0).toUpperCase() + meta.noun.slice(1) + ' aanpassen' : meta.title);
  setText('page-sub', IS_EDIT ? 'Pas de instellingen en vragen aan. Kan enkel zolang niemand gestart is.' : meta.sub);
  setText('name-label', meta.nameLabel);
  setText('preview-noun', meta.previewNoun);
  const nameInput = document.getElementById('quiz-name');
  if (nameInput) nameInput.placeholder = meta.namePlaceholder;
  const createBtn = document.getElementById('create-btn');
  if (createBtn) createBtn.textContent = IS_EDIT ? '💾 Wijzigingen opslaan' : '✅ ' + meta.createLabel;
  // Sprint 83: anti-spiek (verplicht volledig scherm + optioneel auto-indienen bij
  // tabwissel) is enkel zinvol bij een toets — verborgen bij een taak.
  const antiSpiekSectie = document.getElementById('quiz-antispiek-sectie');
  if (antiSpiekSectie) antiSpiekSectie.style.display = '';  // v114: toets én taak
  // v99: klasbord + hand opsteken is bij een toets altijd aan; bij een taak een keuze (vinkje)
  const klasbordSectie = document.getElementById('quiz-klasbord-sectie');
  if (klasbordSectie) klasbordSectie.style.display = QUIZ_TYPE === 'taak' ? '' : 'none';
  const timerRadio = document.querySelector('[name=quiz-timer-type][value="' + meta.defaultTimer + '"]');
  if (timerRadio) {
    timerRadio.checked = true;
    const timerInput = document.getElementById('quiz-timer-min');
    if (timerInput) timerInput.disabled = meta.defaultTimer === 'notimer';
  }
  const root = document.getElementById('wizard-root');
  if (root) root.style.display = 'block';
  // In bewerkmodus is "Test als leerkracht (preview)" niet zinvol: je bewerkt een echte,
  // bestaande toets/taak. We verbergen die optie om verwarring te vermijden.
  if (IS_EDIT) {
    const prevRow = document.getElementById('quiz-is-preview');
    if (prevRow && prevRow.closest('label')) prevRow.closest('label').style.display = 'none';
  }
}

let _bank = [];
let _selected = {}; // { id: { ...question, points: override } }
// Sprint 76: expliciete volgorde (los van selectievolgorde) + groepsscheidingen voor
// onafhankelijke randomisatie per groep (bv. theorie apart van oefeningen husselen, maar
// de oefeningen altijd na de theorie). _groupBreaks bevat de id's waarvóór een nieuwe
// groep begint; het eerste geselecteerde item start altijd groep 0.
let _selectedOrder = []; // [id, id, ...] — bepaalt de weergave- én verzendvolgorde
let _groupBreaks = new Set();
// v134: vragenpool — per groep "trek N van de M vragen" (willekeurig per leerling). Sleutel = id van de
// eerste vraag van de groep, zodat de instelling meebeweegt als groepen verschoven worden.
let _poolPerStart = {};
let _poolMixPerStart = {};   // v137: optionele niveaumix per groep: { eersteId: { makkelijk, gemiddeld, moeilijk } }
let _poolMixOpen = {};

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadBank() {
  const r = await fetch('/api/quiz/bank');
  _bank = await r.json();
  // Subjects
  const subjects = [...new Set(_bank.map(q => q.subject).filter(Boolean))].sort();
  const sel = document.getElementById('sel-subject');
  sel.innerHTML = '<option value="">Alle onderwerpen</option>' +
    subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  // Sprint 66: tags zijn een komma-gescheiden tekstveld per vraag (zie CSV-import) —
  // hier uitgesplitst tot een unieke, gesorteerde lijst voor de dropdown.
  const alleTags = new Set();
  _bank.forEach(q => (q.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => alleTags.add(t)));
  const tagSel = document.getElementById('sel-tag');
  if (tagSel) {
    tagSel.innerHTML = '<option value="">Alle tags</option>' +
      [...alleTags].sort().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }
  filterBank();
}

function filterBank() {
  const subj = document.getElementById('sel-subject').value;
  const diff = document.getElementById('sel-difficulty').value;
  const tag = document.getElementById('sel-tag')?.value || '';
  const filtered = _bank.filter(q =>
    (!subj || q.subject === subj) && (!diff || q.difficulty === diff) && !q.archived &&
    (!tag || (q.tags || '').split(',').map(t => t.trim()).includes(tag))
  );
  const list = document.getElementById('q-select-list');
  if (!filtered.length) {
    list.innerHTML = '<p class="muted">Geen vragen gevonden. Voeg vragen toe in de vragenbank.</p>';
    return;
  }
  list.innerHTML = filtered.map(q => `
    <div class="q-select-item ${_selected[q.id] ? 'selected' : ''}" onclick="toggleSelect('${q.id}')">
      <input type="checkbox" ${_selected[q.id] ? 'checked' : ''} onclick="e=>e.stopPropagation()"/>
      <div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
          ${q.subject ? `<span class="badge">${esc(q.subject)}</span>` : ''}
          <span class="diff-badge diff-${q.difficulty}" style="padding:1px 7px;border-radius:5px;font-size:0.72rem;font-weight:700;
            background:${q.difficulty==='makkelijk'?'#d1fae5':q.difficulty==='moeilijk'?'#fee2e2':'#fef3c7'};
            color:${q.difficulty==='makkelijk'?'#065f46':q.difficulty==='moeilijk'?'#991b1b':'#92400e'};">
            ${q.difficulty}</span>
          <span class="muted" style="font-size:0.78rem;">${fmtP(q.max_points)} pt</span>
          ${(q.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(t =>
            `<span class="badge" style="background:var(--surface-soft);font-size:0.7rem;">#${esc(t)}</span>`).join('')}
        </div>
        <div style="font-size:0.9rem;line-height:1.5;">${esc(q.text.slice(0, 120))}${q.text.length > 120 ? '...' : ''}</div>
      </div>
    </div>`).join('');
}

function toggleSelect(id) {
  const q = _bank.find(x => x.id === id);
  if (!q) return;
  if (_selected[id]) {
    delete _selected[id];
    _selectedOrder = _selectedOrder.filter(x => x !== id);
    _groupBreaks.delete(id);
  } else {
    _selected[id] = { ...q, points: q.max_points };
    _selectedOrder.push(id);
  }
  filterBank();
  renderSelectedList();
}

// Sprint 76: item één plaats naar boven/onder verplaatsen in de verzendvolgorde.
function moveSelected(id, richting) {
  const i = _selectedOrder.indexOf(id);
  const j = i + richting;
  if (i < 0 || j < 0 || j >= _selectedOrder.length) return;
  [_selectedOrder[i], _selectedOrder[j]] = [_selectedOrder[j], _selectedOrder[i]];
  renderSelectedList();
}

// v137: invoer voor de niveaumix van één groep
function mixHtml(id, g, n) {
  const t = niveauTelling(g);
  const mix = _poolMixPerStart[id] || { makkelijk: 0, gemiddeld: 0, moeilijk: 0 };
  const som = ['makkelijk', 'gemiddeld', 'moeilijk'].reduce((x, k) => x + (Number(mix[k]) || 0), 0);
  const ok = mixGeldig(g, n, _poolMixPerStart[id]);
  return `<div style="font-size:0.8rem;margin:0 0 6px 12px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;">
    <div class="muted" style="margin-bottom:4px;">Elke leerling krijgt precies:</div>
    ${['makkelijk', 'gemiddeld', 'moeilijk'].map(k => `<label style="margin-right:12px;">
      <input type="number" min="0" max="${t[k]}" step="1" value="${mix[k] || 0}" ${t[k] === 0 ? 'disabled' : ''} style="width:56px;padding:2px 6px;" aria-label="Aantal ${NIVEAU_LABELS[k]}e vragen"
        onchange="zetMix('${id}', '${k}', this.value)"/> ${NIVEAU_LABELS[k]} <span class="muted">(van ${t[k]})</span></label>`).join('')}
    <div style="margin-top:4px;${ok ? 'color:#047857;' : 'color:#b91c1c;'}">${ok ? '✓ Mix klopt: ' + n + ' vragen' : `Totaal moet ${n} zijn (nu ${som}) — tot dan wordt gewoon willekeurig getrokken.`}</div>
  </div>`;
}

// v134: de groepen als lijst: [{ nr, ids:[...], eersteId }]
function groepenLijst() {
  const groepPerId = berekenGroepen();
  const uit = [];
  _selectedOrder.forEach((id) => {
    const nr = groepPerId[id] || 0;
    if (!uit.length || uit[uit.length - 1].nr !== nr) uit.push({ nr, ids: [], eersteId: id });
    uit[uit.length - 1].ids.push(id);
  });
  return uit;
}

const NIVEAU_LABELS = { makkelijk: 'makkelijk', gemiddeld: 'gemiddeld', moeilijk: 'moeilijk' };
const niveauVanVraag = (id) => (['makkelijk', 'gemiddeld', 'moeilijk'].includes(_selected[id] && _selected[id].difficulty) ? _selected[id].difficulty : 'gemiddeld');

// Aantal vragen per niveau in een groep.
function niveauTelling(g) {
  const t = { makkelijk: 0, gemiddeld: 0, moeilijk: 0 };
  g.ids.forEach(id => { t[niveauVanVraag(id)]++; });
  return t;
}

// Een geldige mix: som = N en per niveau niet meer dan er beschikbaar zijn.
function mixGeldig(g, n, mix) {
  if (!mix) return false;
  const t = niveauTelling(g);
  let som = 0;
  for (const k of Object.keys(t)) {
    const a = Number(mix[k] || 0);
    if (!Number.isInteger(a) || a < 0 || a > t[k]) return false;
    som += a;
  }
  return som === n;
}

// v134: geldige pool-instellingen (1 ≤ N < aantal vragen in de groep); de rest wordt opgeruimd.
// v137: geeft N terug, of { n, mix } als er een geldige niveaumix is ingesteld.
function geldigePool() {
  const uit = {}; const mixUit = {};
  groepenLijst().forEach(g => {
    const n = _poolPerStart[g.eersteId];
    if (Number.isInteger(n) && n >= 1 && n < g.ids.length) {
      uit[g.eersteId] = n;
      if (_poolMixPerStart[g.eersteId]) mixUit[g.eersteId] = _poolMixPerStart[g.eersteId];   // ook halve invoer bewaren tot ze klopt
    }
  });
  _poolPerStart = uit;
  _poolMixPerStart = mixUit;
  return uit;
}

function zetPool(eersteId, waarde) {
  const n = parseInt(String(waarde).trim(), 10);
  if (Number.isInteger(n) && n >= 1) _poolPerStart[eersteId] = n; else { delete _poolPerStart[eersteId]; delete _poolMixPerStart[eersteId]; }
  renderSelectedList();
}

// v137: niveaumix aan/uit en waarden
function wisselMix(eersteId) {
  _poolMixOpen[eersteId] = !_poolMixOpen[eersteId];
  if (!_poolMixOpen[eersteId]) delete _poolMixPerStart[eersteId];
  renderSelectedList();
}
function zetMix(eersteId, niveau, waarde) {
  const a = parseInt(String(waarde).trim(), 10);
  const huidig = Object.assign({}, _poolMixPerStart[eersteId] || { makkelijk: 0, gemiddeld: 0, moeilijk: 0 });
  huidig[niveau] = Number.isInteger(a) && a >= 0 ? a : 0;
  _poolMixPerStart[eersteId] = huidig;
  renderSelectedList();
}

// v137: alle vragen in een poolgroep evenveel punten geven (neemt de punten van de eerste vraag).
function maakPuntenGelijk(eersteId) {
  const g = groepenLijst().find(x => x.eersteId === eersteId);
  if (!g) return;
  const p = _selected[g.ids[0]].points || 1;
  g.ids.forEach(id => { _selected[id].points = p; });
  renderSelectedList();
}

// v137: groepen met een pool waarin de vragen niet evenveel punten waard zijn.
function poolGroepenMetOngelijkePunten() {
  const pool = geldigePool();
  return groepenLijst().filter(g => pool[g.eersteId] && g.ids.some(id => (_selected[id].points || 0) !== (_selected[g.ids[0]].points || 0)));
}

// v134: punten per leerling bij een pool: kleinste en grootste mogelijke totaal.
function puntenPerLeerling() {
  const pool = geldigePool();
  let min = 0; let max = 0; let verschillendePunten = false;
  groepenLijst().forEach(g => {
    const p = g.ids.map(id => _selected[id].points || 0).sort((a, b) => a - b);
    const n = pool[g.eersteId] || p.length;
    min += p.slice(0, n).reduce((s, x) => s + x, 0);
    max += p.slice(p.length - n).reduce((s, x) => s + x, 0);
    if (pool[g.eersteId] && p[0] !== p[p.length - 1]) verschillendePunten = true;
  });
  return { min, max, verschillendePunten, aantal: groepenLijst().reduce((s, g) => s + (pool[g.eersteId] || g.ids.length), 0) };
}

// Sprint 76: groepsscheiding vóór dit item aan/uit-zetten (enkel zinvol bij random
// per leerling — bij een vaste volgorde is randomiseren toch niet aan de orde).
function toggleGroupBreak(id) {
  if (_groupBreaks.has(id)) _groupBreaks.delete(id);
  else _groupBreaks.add(id);
  renderSelectedList();
}

// Sprint 76: leidt uit _selectedOrder + _groupBreaks het groepnummer per id af —
// groep 0 voor de eerste vragen, +1 bij elke geactiveerde scheiding.
function berekenGroepen() {
  const groepPerId = {};
  let groepNr = 0;
  _selectedOrder.forEach((id, i) => {
    if (i > 0 && _groupBreaks.has(id)) groepNr++;
    groepPerId[id] = groepNr;
  });
  return groepPerId;
}


// ── v132: cursus-links per vraag ────────────────────────────────────────────────
// Rooster onderaan stap 2. Elke link: titel (tabnaam), https-adres en de gekoppelde vragen
// (bank-id's). Koppelen gaat via een popup met checkboxes per vraag én per groep.
let _cursusLinks = [];   // [{ id, title, url, questionIds:[bankId, ...] }]
let _clTeller = 0;

function voegCursusLinkToe(link) {
  _clTeller++;
  _cursusLinks.push(Object.assign({ id: 'c' + Date.now().toString(36) + _clTeller, title: '', url: '', questionIds: [] }, link || {}));
  renderCursusLinks();
}

function verwijderCursusLink(i) {
  _cursusLinks.splice(i, 1);
  renderCursusLinks();
}

// Houd de koppelingen in de pas met de geselecteerde vragen (een verwijderde vraag valt weg).
function synchroniseerCursusKoppelingen() {
  const geldig = new Set(_selectedOrder.map(String));
  _cursusLinks.forEach(l => { l.questionIds = (l.questionIds || []).map(String).filter(id => geldig.has(id)); });
}

// "Vragen 1, 3 en 4", "Groep 2" of "alle vragen" — voor het rooster én het bevestigingsscherm.
function beschrijfKoppeling(questionIds) {
  const set = new Set((questionIds || []).map(String));
  if (!set.size) return '';
  if (set.size >= _selectedOrder.length) return 'alle vragen';
  const groepPerId = berekenGroepen();
  const groepen = {};
  _selectedOrder.forEach((id, i) => { const g = groepPerId[id] || 0; (groepen[g] = groepen[g] || []).push({ id: String(id), nr: i + 1 }); });
  const aantalGroepen = Object.keys(groepen).length;
  const delen = [];
  const losse = [];
  Object.keys(groepen).forEach(g => {
    const leden = groepen[g];
    if (aantalGroepen > 1 && leden.length > 1 && leden.every(m => set.has(m.id))) delen.push('Groep ' + (Number(g) + 1));
    else leden.forEach(m => { if (set.has(m.id)) losse.push(m.nr); });
  });
  if (losse.length) delen.push((losse.length === 1 ? 'vraag ' : 'vragen ') + losse.join(', '));
  return delen.join(' + ');
}

function renderCursusLinks() {
  const el = document.getElementById('cl-lijst');
  if (!el) return;
  synchroniseerCursusKoppelingen();
  const teller = document.getElementById('cl-count');
  if (teller) teller.textContent = _cursusLinks.length ? `${_cursusLinks.length} ${_cursusLinks.length === 1 ? 'link' : 'links'}` : 'geen links';
  el.textContent = '';
  _cursusLinks.forEach((l, i) => {
    const rij = document.createElement('div');
    rij.className = 'cl-rij';
    const titel = document.createElement('input');
    titel.type = 'text'; titel.maxLength = 40; titel.placeholder = 'Titel (bv. Cursus)'; titel.value = l.title || '';
    titel.setAttribute('aria-label', 'Titel van link ' + (i + 1));
    titel.oninput = () => { l.title = titel.value; };
    const url = document.createElement('input');
    url.type = 'url'; url.maxLength = 2000; url.placeholder = 'https://… (bv. een gedeelde PDF)'; url.value = l.url || '';
    url.setAttribute('aria-label', 'Adres van link ' + (i + 1));
    url.oninput = () => { l.url = url.value; };
    const samen = document.createElement('span');
    const tekst = beschrijfKoppeling(l.questionIds);
    samen.className = 'cl-samen' + (tekst ? '' : ' leeg');
    samen.textContent = tekst ? '→ ' + tekst : '⚠️ nog niet gekoppeld';
    const koppel = document.createElement('button');
    koppel.type = 'button'; koppel.className = 'btn btn-soft small'; koppel.textContent = '🔗 Vragen koppelen';
    koppel.onclick = () => openCursusKoppeling(i);
    const weg = document.createElement('button');
    weg.type = 'button'; weg.className = 'btn btn-muted small'; weg.textContent = '✕';
    weg.title = 'Link verwijderen'; weg.setAttribute('aria-label', 'Link ' + (i + 1) + ' verwijderen');
    weg.onclick = () => verwijderCursusLink(i);
    rij.append(titel, url, samen, koppel, weg);
    el.appendChild(rij);
  });
}

// Popup: alle geselecteerde vragen met checkboxes. Een groep aanvinken vinkt al haar vragen aan
// (en omgekeerd); de groepcheckbox staat op "gedeeltelijk" als maar een deel is aangevinkt.
function openCursusKoppeling(i) {
  const link = _cursusLinks[i];
  if (!link) return;
  if (!_selectedOrder.length) { pyAlert('Selecteer eerst vragen om een link aan te koppelen.', 'warn'); return; }
  const keuze = new Set((link.questionIds || []).map(String));
  const groepPerId = berekenGroepen();
  const groepen = {};
  _selectedOrder.forEach((id, idx) => { const g = groepPerId[id] || 0; (groepen[g] = groepen[g] || []).push({ id: String(id), nr: idx + 1 }); });
  const groepNrs = Object.keys(groepen).map(Number).sort((a, b) => a - b);
  const toonGroepen = groepNrs.length > 1;

  const overlay = document.createElement('div');
  overlay.className = 'cl-overlay';
  const modal = document.createElement('div');
  modal.className = 'cl-modal';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const kop = document.createElement('div');
  kop.className = 'cl-modal-kop';
  const h = document.createElement('strong');
  h.textContent = 'Vragen koppelen' + (link.title ? ' — ' + link.title : '');
  const uitleg = document.createElement('div');
  uitleg.className = 'muted'; uitleg.style.cssText = 'font-size:0.8rem;margin-top:4px;';
  uitleg.textContent = 'Vink de vragen aan waarbij deze link zichtbaar is. Een groep aanvinken vinkt al haar vragen aan.';
  kop.append(h, uitleg);
  const lijst = document.createElement('div');
  lijst.className = 'cl-modal-lijst';

  const vraagBoxen = {};   // id -> checkbox
  const groepBoxen = {};   // groepnr -> checkbox
  let alleBox = null;
  const verfris = () => {
    groepNrs.forEach(g => {
      const n = groepen[g].filter(m => keuze.has(m.id)).length;
      const gb = groepBoxen[g];
      if (gb) { gb.checked = n === groepen[g].length; gb.indeterminate = n > 0 && n < groepen[g].length; }
    });
    const tot = _selectedOrder.filter(id => keuze.has(String(id))).length;
    alleBox.checked = tot === _selectedOrder.length;
    alleBox.indeterminate = tot > 0 && tot < _selectedOrder.length;
    Object.keys(vraagBoxen).forEach(id => { vraagBoxen[id].checked = keuze.has(id); });
  };
  const zetVragen = (ids, aan) => { ids.forEach(id => { if (aan) keuze.add(id); else keuze.delete(id); }); verfris(); };

  const alleRij = document.createElement('label');
  alleRij.className = 'cl-groepkop'; alleRij.style.background = '#f1f5f9'; alleRij.style.color = 'var(--text)';
  alleBox = document.createElement('input'); alleBox.type = 'checkbox';
  alleBox.onchange = () => zetVragen(_selectedOrder.map(String), alleBox.checked);
  const alleTxt = document.createElement('span'); alleTxt.textContent = 'Alle vragen';
  alleRij.append(alleBox, alleTxt);
  lijst.appendChild(alleRij);

  groepNrs.forEach(g => {
    if (toonGroepen) {
      const gr = document.createElement('label');
      gr.className = 'cl-groepkop';
      const gb = document.createElement('input'); gb.type = 'checkbox';
      gb.onchange = () => zetVragen(groepen[g].map(m => m.id), gb.checked);
      groepBoxen[g] = gb;
      const gt = document.createElement('span');
      gt.textContent = '✂️ Groep ' + (g + 1) + ' · ' + groepen[g].length + (groepen[g].length === 1 ? ' vraag' : ' vragen');
      gr.append(gb, gt);
      lijst.appendChild(gr);
    }
    groepen[g].forEach(m => {
      const q = _selected[m.id] || {};
      const rij = document.createElement('label');
      rij.className = 'cl-vraagrij';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.onchange = () => { if (cb.checked) keuze.add(m.id); else keuze.delete(m.id); verfris(); };
      vraagBoxen[m.id] = cb;
      const t = document.createElement('span');
      const tekst = String(q.text || '');
      t.textContent = m.nr + '. ' + tekst.slice(0, 90) + (tekst.length > 90 ? '…' : '');
      rij.append(cb, t);
      lijst.appendChild(rij);
    });
  });

  const voet = document.createElement('div');
  voet.className = 'cl-modal-voet';
  const annuleer = document.createElement('button');
  annuleer.type = 'button'; annuleer.className = 'btn btn-muted small'; annuleer.textContent = 'Annuleren';
  const opslaan = document.createElement('button');
  opslaan.type = 'button'; opslaan.className = 'btn btn-primary small'; opslaan.textContent = 'Koppeling opslaan';
  const sluit = () => { document.removeEventListener('keydown', toets); overlay.remove(); };
  const toets = (e) => { if (e.key === 'Escape') sluit(); };
  annuleer.onclick = sluit;
  opslaan.onclick = () => {
    link.questionIds = _selectedOrder.map(String).filter(id => keuze.has(id));
    sluit();
    renderCursusLinks();
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) sluit(); });
  document.addEventListener('keydown', toets);
  voet.append(annuleer, opslaan);
  modal.append(kop, lijst, voet);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  verfris();
  opslaan.focus();
}

// De rijen die echt iets bevatten, klaar voor de server. Geeft { fout } terug bij een
// onvolledige rij (titel of koppeling ingevuld, maar geen adres).
function verzamelCursusLinks() {
  synchroniseerCursusKoppelingen();
  const uit = [];
  for (let i = 0; i < _cursusLinks.length; i++) {
    const l = _cursusLinks[i];
    const url = (l.url || '').trim(), titel = (l.title || '').trim();
    if (!url && !titel && !(l.questionIds || []).length) continue;   // lege rij negeren
    if (!url) return { fout: 'Cursus-link ' + (i + 1) + ' heeft nog geen adres.' };
    if (!/^https:\/\//i.test(url)) return { fout: 'Cursus-link ' + (i + 1) + ': enkel https://-links zijn toegelaten.' };
    uit.push({ id: l.id, title: titel, url, questionIds: (l.questionIds || []).map(String) });
  }
  return { links: uit };
}

function renderSelectedList() {
  const ids = _selectedOrder;
  const total = ids.reduce((s, id) => s + (_selected[id].points || 0), 0);
  document.getElementById('sel-count').textContent = `${ids.length} geselecteerd · ${fmtP(total)} punten`;
  const random = document.querySelector('[name=quiz-order]:checked')?.value === 'random';
  const groepPerId = berekenGroepen();
  const aantalGroepen = new Set(Object.values(groepPerId)).size;
  geldigePool();   // v134: ruim verouderde pool-instellingen op
  const ppl = puntenPerLeerling();
  if (Object.keys(_poolPerStart).length) document.getElementById('sel-count').textContent += ` · per leerling ${ppl.aantal} vragen, ${ppl.min === ppl.max ? fmtP(ppl.min) : fmtP(ppl.min) + '–' + fmtP(ppl.max)} punten`;
  document.getElementById('sel-list').innerHTML = ids.map((id, i) => {
    const q = _selected[id];
    const isBreak = i > 0 && _groupBreaks.has(id);
    // Sprint 76: bij een groepsscheiding tonen we eerst een deellijn met de nieuwe
    // groepsnaam, zodat duidelijk is welke vragen straks samen (apart van de rest)
    // gehusseld worden.
    const breakHtml = isBreak ? `<div style="display:flex;align-items:center;gap:8px;margin:10px 0 4px;">
      <div style="flex:1;border-top:2px dashed var(--primary);"></div>
      <span style="font-size:0.74rem;font-weight:700;color:var(--primary);">✂️ Nieuwe groep — Groep ${groepPerId[id] + 1}</span>
      <div style="flex:1;border-top:2px dashed var(--primary);"></div>
    </div>` : '';
    // v134: pool-instelling bovenaan elke groep ("Trek N uit M").
    const groepStart = i === 0 || isBreak;
    const poolHtml = groepStart ? (() => {
      const g = groepenLijst().find(x => x.eersteId === id);
      const m = g ? g.ids.length : 1;
      const n = _poolPerStart[id];
      return `<div class="pool-regel" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:${i === 0 ? '0' : '2px'} 0 4px;font-size:0.8rem;">
        <span class="muted">🎲 Vragenpool ${aantalGroepen > 1 ? 'groep ' + (groepPerId[id] + 1) : ''}:</span>
        <label>trek <input type="number" class="pool-n" min="1" max="${Math.max(1, m - 1)}" step="1" value="${n || ''}" placeholder="alle" ${m < 2 ? 'disabled' : ''}
          style="width:64px;padding:2px 6px;" aria-label="Aantal vragen dat elke leerling uit deze groep krijgt"
          onchange="zetPool('${id}', this.value)"/> uit ${m}</label>
        <span class="muted">${n && n < m ? '(elke leerling krijgt zijn eigen willekeurige ' + n + ')' : '(leeg = alle vragen)'}</span>
        ${n && n < m ? `<button type="button" class="btn btn-muted small" onclick="wisselMix('${id}')" title="Zorg dat elke leerling evenveel makkelijke, gemiddelde en moeilijke vragen krijgt">⚖️ niveaumix ${_poolMixOpen[id] ? '▲' : '▼'}</button>` : ''}
      </div>
      ${n && n < m && _poolMixOpen[id] ? mixHtml(id, g, n) : ''}
      ${n && n < m && g.ids.some(x => (_selected[x].points || 0) !== (_selected[g.ids[0]].points || 0))
        ? `<div style="font-size:0.78rem;color:#b91c1c;margin:0 0 4px;">⚠️ In een pool moeten alle vragen evenveel punten waard zijn (nu verschillend).
            <button type="button" class="btn btn-muted small" onclick="maakPuntenGelijk('${id}')">Zet alle op ${fmtP(_selected[g.ids[0]].points || 1)} punt</button></div>` : ''}`;
    })() : '';
    const groepBadge = random && aantalGroepen > 1
      ? `<span class="muted" style="font-size:0.7rem;border:1px solid var(--border);border-radius:5px;padding:1px 5px;" title="Groep ${groepPerId[id] + 1} wordt apart gehusseld van de andere groepen">G${groepPerId[id] + 1}</span>` : '';
    return `${breakHtml}${poolHtml}<div class="sel-row">
      <span style="display:flex;flex-direction:column;gap:0;">
        <button type="button" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0;line-height:1;" title="Naar boven verplaatsen" aria-label="Vraag naar boven verplaatsen" ${i===0?'disabled':''} onclick="moveSelected('${id}',-1)">▲</button>
        <button type="button" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0;line-height:1;" title="Naar onder verplaatsen" aria-label="Vraag naar onder verplaatsen" ${i===ids.length-1?'disabled':''} onclick="moveSelected('${id}',1)">▼</button>
      </span>
      <span style="font-weight:700;min-width:24px;">${i+1}.</span>
      <span style="flex:1;font-size:0.88rem;">${esc(q.text.slice(0, 60))}...</span>
      ${groepBadge}
      <input type="number" class="pts" value="${q.points}" min="0.5" max="100" step="0.5"
        onchange="{ const n = parseFloat(String(this.value).replace(',', '.')); _selected['${id}'].points = (isFinite(n) && n >= 0.5) ? Math.round(n * 2) / 2 : 1; renderSelectedList(); }"/>
      <span class="muted" style="font-size:0.78rem;">pt</span>
      ${i > 0 ? `<button type="button" style="background:none;border:none;cursor:pointer;color:${isBreak ? 'var(--primary)' : 'var(--muted)'};" title="Groepsscheiding hier aan/uit — een groep wordt apart gehusseld en kan een eigen vragenpool (trek N uit M) hebben" aria-label="Groepsscheiding hier aan of uit zetten" onclick="toggleGroupBreak('${id}')">✂️</button>` : ''}
      <button type="button" style="background:none;border:none;cursor:pointer;color:var(--muted);" title="Vraag uit selectie verwijderen" aria-label="Vraag uit selectie verwijderen" onclick="toggleSelect('${id}')">✕</button>
    </div>`;
  }).join('');
  renderCursusLinks();   // v132: koppelingen volgen de geselecteerde vragen en groepen
}

async function goStep(n) {
  if (n >= 2 && !document.getElementById('quiz-name').value.trim()) {
    await pyAlert('Voer een naam in voor de ' + (QUIZ_TYPE_META[QUIZ_TYPE]?.noun || 'toets') + '.', 'warn'); return;
  }
  if (n >= 3 && !Object.keys(_selected).length) {
    await pyAlert('Selecteer minstens 1 vraag.', 'warn'); return;
  }
  if (n === 3) buildPreview();
  if (n === 4) renderConfirm();
  [1,2,3,4].forEach(i => {
    const el = document.getElementById('step-' + i);
    if (el) el.style.display = i === n ? 'block' : 'none';
    const ind = document.getElementById('step-' + i + '-ind');
    if (ind) ind.className = 'wizard-step' + (i === n ? ' active' : i < n ? ' done' : '');
  });
  if (n === 2) loadBank();
}

// 25h: Info-kader preprocessing
function preprocessMarkdown(text) {
  return text.replace(/:::(\w+)\n([\s\S]*?):::/g, function(_, type, content) {
    var map = { tip:'info-tip', opgelet:'info-opgelet', kader:'info-kader-blauw', hint:'info-hint' };
    return '<div class="info-kader ' + (map[type] || 'info-kader-blauw') + '">' + content.trim() + '</div>';
  });
}

// 25h: Preview hulpfuncties
var _previewOrder = [];
var _previewActive = 0;

// Sprint 76: husselt _previewOrder, maar per groep afzonderlijk (net als de server) —
// zo toont de preview correct dat bv. oefeningen altijd na de theorie blijven staan.
function shuffleMetGroepen() {
  var groepPerId = berekenGroepen();
  var groepen = [];
  var vorigeGroep = null;
  _selectedOrder.forEach(function (id) {
    var g = groepPerId[id];
    if (vorigeGroep === null || g !== vorigeGroep) { groepen.push([]); vorigeGroep = g; }
    groepen[groepen.length - 1].push(id);
  });
  groepen.forEach(function (groep) {
    for (var i = groep.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = groep[i]; groep[i] = groep[j]; groep[j] = tmp;
    }
  });
  return [].concat.apply([], groepen);
}

function buildPreview() {
  var random = document.querySelector('[name=quiz-order]:checked')?.value === 'random';
  _previewOrder = random ? shuffleMetGroepen() : _selectedOrder.slice();
  document.getElementById('shuffle-btn').style.display = random ? '' : 'none';
  _previewActive = 0;
  renderPreviewNav();
  renderPreviewQuestion(0);
}

function shufflePreview() {
  _previewOrder = shuffleMetGroepen();
  renderPreviewNav();
  renderPreviewQuestion(_previewActive);
}

function renderPreviewNav() {
  var nav = document.getElementById('preview-nav');
  nav.innerHTML = _previewOrder.map(function(id, i) {
    var q = _selected[id];
    var typeIcon = { code:'🐍', open:'✏️', single:'◉', multiple:'☑' }[q.question_type || 'code'] || '❓';
    var isActive = i === _previewActive;
    return '<button onclick="renderPreviewQuestion(' + i + ')" style="text-align:left;border:1.5px solid ' + (isActive?'var(--primary)':'var(--border)') + ';border-radius:8px;padding:8px 10px;background:' + (isActive?'var(--primary)':'var(--surface)') + ';color:' + (isActive?'#fff':'var(--text)') + ';cursor:pointer;font-size:0.82rem;width:100%;">' +
      '<strong>' + (i+1) + '.</strong> ' + typeIcon + ' ' + esc(q.text.slice(0,28)) + (q.text.length>28?'…':'') +
      '</button>';
  }).join('');
}

function renderPreviewQuestion(idx) {
  _previewActive = idx;
  renderPreviewNav();
  var id = _previewOrder[idx];
  var q  = _selected[id];
  var type = q.question_type || 'code';
  var typeLabel = { code:'🐍 Python code', open:'✏️ Open vraag', single:'◉ Single choice', multiple:'☑ Meerkeuze' }[type] || type;
  var rawText = q.text_snapshot || q.text || '';
  var renderedText = window.marked
    ? window.marked.parse(preprocessMarkdown(rawText), { breaks:true, gfm:true })
    : esc(rawText);

  var answerHtml = '';
  if (type === 'code') {
    answerHtml = '<div style="background:#1e1e1e;color:#6a9955;padding:14px;border-radius:8px;font-family:Consolas,monospace;font-size:0.85rem;margin-top:12px;"># Schrijf hier jouw code</div>' +
      '<div style="margin-top:8px;"><button class="btn btn-soft small" disabled style="opacity:0.6;">▶ Uitvoeren (niet actief in preview)</button></div>';
  } else if (type === 'open') {
    answerHtml = '<textarea placeholder="Leerling schrijft hier zijn antwoord..." style="width:100%;min-height:100px;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-top:12px;font-size:0.9rem;"></textarea>';
  } else {
    var choices = [];
    try { choices = JSON.parse(q.choices_json || '[]'); } catch(e) {}
    answerHtml = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">' +
      choices.map(function(ch) {
        var textHtml = ch.isCode
          ? '<pre style="background:#1e1e1e;color:#d4d4d4;padding:8px 12px;border-radius:6px;font-family:Consolas,monospace;font-size:0.82rem;margin:0;overflow-x:auto;white-space:pre-wrap;">' + esc(ch.text) + '</pre>'
          : '<span style="font-size:0.95rem;line-height:1.5;">' + esc(ch.text) + '</span>';
        // Sprint 46: expliciet font-weight/margin overschrijft de globale regel
        // `label{display:block;font-weight:800;margin-bottom:8px}` (styles.css) die anders in de
        // preview inlekte. min-width:0 op de tekstkolom voorkomt dat lange opties/code overlopen en
        // rechts afgesneden worden (dezelfde aanpak als de echte leerling-weergave in quiz-student.js).
        return '<label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:2px solid var(--border);border-radius:10px;cursor:pointer;background:var(--surface);font-weight:400;margin:0;box-sizing:border-box;width:100%;">' +
          '<input type="' + (type==='single'?'radio':'checkbox') + '" name="prev-ch-' + id + '" style="margin-top:' + (ch.isCode?'10px':'2px') + ';width:16px;height:16px;flex-shrink:0;"/>' +
          '<div style="flex:1;min-width:0;overflow-wrap:anywhere;">' + textHtml + '</div></label>';
      }).join('') + '</div>';
  }

  var prevBtn = idx > 0 ? '<button class="btn btn-muted small" onclick="renderPreviewQuestion(' + (idx-1) + ')">← Vorige</button>' : '';
  var nextBtn = idx < _previewOrder.length - 1 ? '<button class="btn btn-soft small" onclick="renderPreviewQuestion(' + (idx+1) + ')">Volgende →</button>' : '<span class="muted" style="font-size:0.85rem;">Laatste vraag</span>';

  document.getElementById('preview-content').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">' +
      '<span class="badge" style="background:#f0f9ff;color:#0369a1;">' + typeLabel + '</span>' +
      '<span class="muted" style="font-size:0.82rem;">Vraag ' + (idx+1) + ' van ' + _previewOrder.length + ' · ' + fmtP(q.points) + ' punten</span>' +
    '</div>' +
    '<div class="md-preview" style="padding:0;border:none;background:none;">' + renderedText + '</div>' +
    answerHtml +
    '<div style="margin-top:20px;display:flex;gap:8px;">' + prevBtn + nextBtn + '</div>';
}

function renderConfirm() {
  const ids = _selectedOrder;
  const total = ids.reduce((s, id) => s + (_selected[id].points || 0), 0);
  const timerType = document.querySelector('[name=quiz-timer-type]:checked')?.value;
  const noTimer = timerType === 'notimer';
  const mins = parseInt(document.getElementById('quiz-timer-min').value) || 45;
  const random = document.querySelector('[name=quiz-order]:checked')?.value === 'random';
  const groepPerId = berekenGroepen();
  const aantalGroepen = new Set(Object.values(groepPerId)).size;
  const isPreview = document.getElementById('quiz-is-preview').checked;
  const schoolYear = document.getElementById('quiz-school-year').value.trim();
  const targetClassEl = document.getElementById('quiz-target-class');
  const targetClassName = targetClassEl.options[targetClassEl.selectedIndex]?.text || '—';
  const meta = QUIZ_TYPE_META[QUIZ_TYPE] || QUIZ_TYPE_META.toets;
  // v131: alle instellingen van het eerste scherm in het overzicht tonen.
  const aan = (id, standaard) => { const el = document.getElementById(id); return el ? el.checked : standaard; };
  const fmtDatum = (id) => { const v = document.getElementById(id)?.value; return v ? new Date(v).toLocaleString('nl-BE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : null; };
  const start = fmtDatum('quiz-access-from'), einde = fmtDatum('quiz-access-until');
  const tabAan = aan('quiz-tabswitch-enabled', false);
  const tabDrempel = parseInt(document.getElementById('quiz-tabswitch-threshold')?.value) || 1;
  const gr = parseInt(document.getElementById('quiz-tabswitch-grace')?.value);
  const tabGrace = isNaN(gr) ? 5 : gr;
  // v132: cursus-links per vraag (met waarschuwing als een link nergens aan gekoppeld is)
  const cl = verzamelCursusLinks().links || [];
  const hostVan = (u) => { try { return new URL(u).host; } catch { return u; } };
  const cursusRijen = cl.length
    ? cl.map((l, i) => {
        const k = beschrijfKoppeling(l.questionIds);
        return ['Cursus-link ' + (i + 1) + ': ' + esc(l.title || 'Link ' + (i + 1)),
          esc(hostVan(l.url)) + (k ? ' <span class="muted">→ ' + esc(k) + '</span>' : ' <span style="color:#b45309;">⚠️ niet gekoppeld aan een vraag: wordt nergens getoond</span>')];
      })
    : [['Cursus-links', '—']];
  const vink = (b) => b ? '✅ Aan' : '❌ Uit';
  const instellingen = [
    ['Start', start || 'Direct beschikbaar'],
    ['Deadline', einde || '—'],
    ['Automatisch indienen', vink(aan('quiz-auto-submit', true)) + ' <span class="muted">(bij de deadline)</span>'],
    ['1 kans per vraag', vink(aan('quiz-no-back', false)) + ' <span class="muted">(niet terug kunnen)</span>'],
    ['Anti-spiek', tabAan ? `✅ Aan <span class="muted">(drempel ${tabDrempel}, respijt ${tabGrace} s)</span>` : '❌ Uit'],
    ['Volledig scherm', vink(aan('quiz-fullscreen-required', true)) + ' <span class="muted">(verplicht)</span>'],
    ['Kopiëren/plakken', aan('quiz-copypaste-blocked', true) ? '🚫 Geblokkeerd' : '✅ Toegestaan'],
    ['Schermbeeld live-overzicht', liveBeeldSec() === 0 ? '❌ Uit' : `📷 Om de ${liveBeeldSec()} s <span class="muted">(enkel terwijl het overzicht open is)</span>`],
    ['Meerkeuze (meerdere juist)', (document.getElementById('quiz-mc-scoring')?.value === 'klassiek') ? 'Klassiek <span class="muted">(pro rata, één fout = 0)</span>' : 'Gedeeld juist <span class="muted">(halve punten, gemist/fout kost punten)</span>'],
    ['Min. 1 run per vraag', vink(aan('quiz-min-runs', false))],
    ['Vraag verbergen op scherm', vink(aan('quiz-hide-question', false))],
  ].concat(cursusRijen);
  if (QUIZ_TYPE === 'toets') instellingen.push(['Zelfevaluatie na indienen', vink(aan('quiz-self-eval', false))]);
  if (QUIZ_TYPE === 'taak') instellingen.push(['Klasbord / hand opsteken', vink(aan('quiz-klasbord', false))]);
  const groepInfo = {};
  ids.forEach(id => { const g = groepPerId[id] || 0; (groepInfo[g] = groepInfo[g] || { n: 0, p: 0 }); groepInfo[g].n++; groepInfo[g].p += (_selected[id].points || 0); });
  // v134: vragenpool op het bevestigingsscherm
  const poolConfirm = geldigePool();
  const ppl = puntenPerLeerling();
  const poolRegel = Object.keys(poolConfirm).length ? `<tr><td style="padding:6px 0;color:var(--muted);">Per leerling</td><td><strong>🎲 ${ppl.aantal} vragen · ${ppl.min === ppl.max ? fmtP(ppl.min) : fmtP(ppl.min) + '–' + fmtP(ppl.max)} punten</strong>${ppl.verschillendePunten ? '<div style="color:#b91c1c;font-size:0.8rem;margin-top:2px;font-weight:700;">⛔ In een pool moeten alle vragen van een groep evenveel punten hebben. Pas dit aan in stap 2 — aanmaken is geblokkeerd.</div>' : ''}<div id="pool-telling" class="muted" style="font-size:0.84rem;margin-top:6px;">Aantal mogelijke toetsen berekenen…</div></td></tr>` : '';
  document.getElementById('confirm-panel').innerHTML = `
    <h3 style="margin:0 0 16px;">${meta.confirmTitle}</h3>
    ${isPreview ? '<div style="background:#fef3c7;color:#92400e;padding:10px;border-radius:8px;margin-bottom:14px;font-weight:700;">⚠️ PREVIEW MODE — antwoorden worden niet opgeslagen</div>' : ''}
    <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:var(--muted);width:140px;">Naam</td><td><strong>${esc(document.getElementById('quiz-name').value)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:var(--muted);">Timer</td><td><strong>${noTimer ? '∞ Geen tijdslimiet' : mins + ' minuten'}</strong></td></tr>
      <tr><td style="padding:6px 0;color:var(--muted);">Volgorde</td><td><strong>${random ? '🔀 Random per leerling' : '📋 Vast voor iedereen'}</strong>${random && aantalGroepen > 1 ? ` <span class="muted" style="font-size:0.8rem;">(${aantalGroepen} groepen, elk apart gehusseld)</span>` : ''}</td></tr>
      <tr><td style="padding:6px 0;color:var(--muted);">Vragen</td><td><strong>${ids.length} vragen · ${fmtP(total)} punten</strong></td></tr>
      ${poolRegel}
      ${schoolYear ? `<tr><td style="padding:6px 0;color:var(--muted);">Schooljaar</td><td><strong>${esc(schoolYear)}</strong></td></tr>` : ''}
      <tr><td style="padding:6px 0;color:var(--muted);">Klas</td><td><strong>${esc(targetClassName)}</strong></td></tr>
    </table>
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
      <div style="font-size:0.8rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Instellingen</div>
      <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
        ${instellingen.map(r => `<tr><td style="padding:4px 0;color:var(--muted);width:200px;">${r[0]}</td><td><strong>${r[1]}</strong></td></tr>`).join('')}
      </table>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
      ${ids.map((id, i) => {
        const q = _selected[id];
        const heeftPool = Object.keys(poolConfirm).length > 0;
        const isBreak = (aantalGroepen > 1 || heeftPool) && (i === 0 || _groupBreaks.has(id));
        const gi = groepInfo[groepPerId[id] || 0] || { n: 0, p: 0 };
        const poolN = poolConfirm[id];
        return `${isBreak ? `<div style="font-size:0.74rem;font-weight:700;color:var(--primary);margin:8px 0 2px;">✂️ Groep ${(groepPerId[id] || 0) + 1} <span class="muted" style="font-weight:600;">· ${gi.n} ${gi.n === 1 ? 'vraag' : 'vragen'} · ${fmtP(gi.p)} ${gi.p === 1 ? 'punt' : 'punten'}</span>${poolN ? ` <span style="font-weight:700;">· 🎲 elke leerling krijgt ${poolN} van ${gi.n} (willekeurig)</span>` : ''}</div>` : ''}<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.88rem;">
          <strong>${i+1}.</strong> ${esc(q.text.slice(0,90))}${q.text.length > 90 ? '…' : ''} <span class="muted">(${fmtP(q.points)}pt)</span>
        </div>`;
      }).join('')}
    </div>`;
  // v137: blokkeer aanmaken bij ongelijke punten in een pool, en toon het aantal unieke toetsen
  const createBtnC = document.getElementById('create-btn');
  if (createBtnC) createBtnC.disabled = poolGroepenMetOngelijkePunten().length > 0;
  if (Object.keys(poolConfirm).length) laadPoolTelling(ids, groepPerId);
}

// v137: hoeveel verschillende toetsen levert deze pool op? (server rekent exact, ook met niveaumix en placeholders)
async function laadPoolTelling(ids, groepPerId) {
  const el = document.getElementById('pool-telling');
  if (!el) return;
  try {
    const r = await fetch('/api/quiz/pool-telling', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: ids.map(id => ({ id, randomGroup: groepPerId[id] || 0, points: _selected[id].points })), pool: poolVoorPayload() }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Fout');
    const fmt = (str) => { const x = BigInt(str); return x > 1000000000000n ? 'meer dan 10¹²' : Number(x).toLocaleString('nl-BE'); };
    const groepen = d.perGroep.filter(g => g.n < g.m).map(g =>
      `groep ${g.nr + 1}: <strong>${fmt(g.aantal)}</strong> mogelijkheden (${g.n} uit ${g.m}${g.metMix ? ', met niveaumix' : ''})`).join(' · ');
    const klas = Array.isArray(window._selectedStudentIds) ? window._selectedStudentIds.length : 0;
    const totaal = BigInt(d.totaal);
    const te_weinig = klas > 0 && totaal < BigInt(klas);
    el.innerHTML = `🧮 <strong>${fmt(d.totaal)} verschillende toetsen</strong> mogelijk${d.metPlaceholders ? ' (incl. placeholder-waarden)' : ''}.<br>${groepen}` +
      (te_weinig ? `<div style="color:#b91c1c;margin-top:2px;">⚠️ Minder unieke toetsen (${fmt(d.totaal)}) dan leerlingen (${klas}): sommigen krijgen dezelfde toets.</div>` : '') +
      (totaal < 30n ? `<div style="color:#92400e;margin-top:2px;">⚠️ Minder dan 30 mogelijke toetsen: in een klas zullen leerlingen identieke toetsen krijgen. Vergroot de pool of voeg placeholders toe.</div>` : '');
  } catch (e) { el.textContent = 'Telling niet beschikbaar: ' + e.message; }
}

// v134: pool-instelling voor de server: groepNummer → N.
function poolVoorPayload() {
  const pool = geldigePool();
  const uit = {};
  groepenLijst().forEach(g => {
    if (!pool[g.eersteId]) return;
    const mix = _poolMixPerStart[g.eersteId];
    uit[g.nr] = (mix && mixGeldig(g, pool[g.eersteId], mix)) ? { n: pool[g.eersteId], mix } : pool[g.eersteId];   // enkel een kloppende mix gaat mee
  });
  return uit;
}

async function createQuiz() {
  if (poolGroepenMetOngelijkePunten().length) { await pyAlert('In een vragenpool moeten alle vragen van een groep evenveel punten hebben.', 'warn'); return; }   // v137
  const createBtn  = document.getElementById('create-btn');
  const backBtn    = document.getElementById('back-btn');
  const statusEl   = document.getElementById('create-status');
  const meta       = QUIZ_TYPE_META[QUIZ_TYPE] || QUIZ_TYPE_META.toets;

  // 22h: guard: al bezig?
  if (createBtn.disabled) return;

  // Sprint 43.14: zonder (geldig) type niet aanmaken — de type-chooser vangt dit
  // normaal af vóór de wizard zelfs zichtbaar wordt, dit is de laatste veiligheidsgordel.
  if (!QUIZ_TYPE) { await pyAlert('Geen type gekozen (toets/taak). Herlaad de pagina.', 'error'); return; }

  const name = document.getElementById('quiz-name').value.trim();
  if (!name) { await pyAlert('Voer een naam in voor de ' + meta.noun + '.', "warn"); return; }
  if (!Object.keys(_selected).length) { await pyAlert('Selecteer minstens 1 vraag.', "warn"); return; }

  const timerType    = document.querySelector('[name=quiz-timer-type]:checked')?.value;
  const noTimer      = timerType === 'notimer';
  const timerSeconds = noTimer ? null : (parseInt(document.getElementById('quiz-timer-min').value) || 45) * 60;
  const randomize    = document.querySelector('[name=quiz-order]:checked')?.value === 'random';
  const schoolYear   = document.getElementById('quiz-school-year').value.trim();
  const targetClass  = document.getElementById('quiz-target-class').value;
  const accessFromEl  = document.getElementById('quiz-access-from');
  const accessUntilEl = document.getElementById('quiz-access-until');
  const accessFrom    = accessFromEl?.value  ? new Date(accessFromEl.value).getTime()  : null;
  const accessUntil   = accessUntilEl?.value ? new Date(accessUntilEl.value).getTime() : null;
  const autoSubmitLate        = document.getElementById('quiz-auto-submit')?.checked !== false;
  const hideQuestionOnScreen  = document.getElementById('quiz-hide-question').checked;
  const minRunsPerQ           = document.getElementById('quiz-min-runs').checked ? 1 : 0;
  const noBack                = document.getElementById('quiz-no-back')?.checked === true;  // Sprint 69
  const isTeacherPreview      = document.getElementById('quiz-is-preview').checked;
  // Sprint 83: anti-spiek — enkel zinvol bij een toets; bij een taak sturen we gewoon
  // 'false'/'' mee (de server negeert/dwingt dit sowieso af, maar zo is het ook meteen
  // correct zichtbaar mocht iemand ooit rechtstreeks de payload bekijken).
  const isToetsType           = QUIZ_TYPE === 'toets';
  const tabSwitchEnabled      = document.getElementById('quiz-tabswitch-enabled')?.checked === true;  // v114: ook bij een taak
  const tabSwitchThreshold    = parseInt(document.getElementById('quiz-tabswitch-threshold')?.value) || 1;
  // Sprint 94: instelbaar respijt (0 is een geldige waarde — geen respijt — dus geen "|| 5").
  const parsedGrace           = parseInt(document.getElementById('quiz-tabswitch-grace')?.value);
  const tabSwitchGraceSeconds = isNaN(parsedGrace) ? 5 : parsedGrace;
  // v132: cursus-links per vraag (vervangt de ene cursus-link van de eerste pagina)
  const clResultaat = verzamelCursusLinks();
  if (clResultaat.fout) { await pyAlert(clResultaat.fout, 'warn'); return; }
  const cursusLinks = clResultaat.links;
  const copyPasteBlocked      = document.getElementById('quiz-copypaste-blocked')?.checked !== false;
  const fullscreenRequired    = document.getElementById('quiz-fullscreen-required')?.checked !== false;
  // Sprint 90: zelfevaluatie-enquête — zelfde toets-only redenering als hierboven.
  const selfEvalEnabled       = isToetsType && document.getElementById('quiz-self-eval')?.checked === true;
  // v99: klasbord + hand opsteken — enkel een keuze bij een taak
  const klasbordEnabled       = QUIZ_TYPE === 'taak' && document.getElementById('quiz-klasbord')?.checked === true;

  if (accessFrom && accessUntil && accessFrom >= accessUntil) {
    await pyAlert('Deadline moet na de startdatum liggen.', "warn"); return;
  }
  // Sprint 43.3: einddatum + uur is verplicht voor toets én taak (preview uitgezonderd).
  if (!isTeacherPreview && !accessUntil) {
    await pyAlert('Een einddatum en uur (deadline) is verplicht voor een toets én een taak.', 'warn');
    accessUntilEl?.focus();
    return;
  }

  // Sprint 76: expliciete volgorde (_selectedOrder, kan handmatig herschikt zijn) i.p.v.
  // de vroegere selectievolgorde, en het groepnummer per vraag voor onafhankelijke
  // randomisatie per groep. Bij "vast voor iedereen" is groeperen niet zinvol/zichtbaar,
  // maar er zit dan hoe dan ook maar 1 groep (0) in — geen effect.
  const groepPerId = berekenGroepen();
  const questions = _selectedOrder.map(id => {
    const q = _selected[id];
    return {
      id: q.id, text: q.text, subject: q.subject, points: q.points, max_points: q.max_points,
      randomGroup: groepPerId[id] || 0,
    };
  });

  // 22h: loading state
  createBtn.disabled    = true;
  backBtn.disabled      = true;
  createBtn.textContent = '⏳ Bezig…';
  statusEl.style.display = 'inline';

  // Sprint 50 (bug 2): in bewerkmodus sturen we een PUT naar de bestaande code i.p.v. een
  // nieuwe toets aan te maken. Preview bestaat niet in bewerkmodus. We gebruiken de globale
  // apiFetch (voegt het CSRF-token toe) — een PUT vereist dat, een POST /api/quiz niet.
  const doFetch = window.apiFetch || fetch;
  try {
    const payload = { name, questions, randomize, timerSeconds, noTimer, minRunsPerQ,
                      hideQuestionOnScreen, schoolYear, targetClass,
                      accessFrom, accessUntil, autoSubmitLate, noBack,
                      // Sprint 83: anti-spiek (sprint 94: + instelbaar respijt)
                      tabSwitchEnabled, tabSwitchThreshold, tabSwitchGraceSeconds, cursusLinks,
                      // Sprint 90: zelfevaluatie-enquête
                      selfEvalEnabled,
                      // v99: klasbord + hand opsteken bij een taak
                      klasbordEnabled,
                      // v113: beveiliging (toets én taak)
                      copyPasteBlocked, fullscreenRequired,
                      // v145: interval schermbeeld in het live-overzicht (0 = uit)
                      liveScreenshotSec: liveBeeldSec(),
                      // v134: vragenpool { groepNr: N }
                      pool: poolVoorPayload(),
                      // v133: meerkeuze-berekening
                      mcScoring: document.getElementById('quiz-mc-scoring')?.value === 'klassiek' ? 'klassiek' : 'gedeeld',
                      // Leerling-selectie: in bewerkmodus ALTIJD meesturen (ook leeg =
                      // beperking opheffen). Bij aanmaken enkel als er een selectie is.
                      studentIds: IS_EDIT
                        ? (window._selectedStudentIds || [])
                        : ((window._selectedStudentIds && window._selectedStudentIds.length)
                            ? window._selectedStudentIds : undefined) };
    let r;
    if (IS_EDIT) {
      r = await doFetch('/api/quiz/' + encodeURIComponent(EDIT_CODE), {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
    } else {
      payload.isTeacherPreview = isTeacherPreview;
      // Sprint 43.14: type komt van de link (?type=), staat al vast bij het openen.
      payload.type = QUIZ_TYPE;
      r = await doFetch('/api/quiz', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
    }
    const data = await r.json();
    if (data.ok) {
      if (IS_EDIT) {
        pyToast('Wijzigingen opgeslagen!', 'success', 5000);
        setTimeout(() => { location.href = '/' + (QUIZ_TYPE === 'taak' ? 'taak' : 'toets') + '-overzicht.html'; }, 1000);
      } else {
        const previewUrl = `/quiz-student.html?code=${data.code}&name=${encodeURIComponent('Leerkracht Test')}&class=${encodeURIComponent('Preview')}`;
        if (isTeacherPreview) {
          const gaNaar = await pyConfirm({
            title: `${meta.createdLabel} (PREVIEW)`,
            body: `Code: ${data.code}\n\nWil je de preview openen als leerling?`,
            confirmLabel: 'Open preview'
          });
          if (gaNaar) window.open(previewUrl, '_blank');
        } else {
          pyToast(`${meta.createdLabel}! Sessiecode: ${data.code}`, 'success', 6000);
          setTimeout(() => { location.href = '/teacher-sessions.html'; }, 1200);
        }
      }
    } else {
      await pyAlert('Fout bij ' + (IS_EDIT ? 'opslaan' : 'aanmaken') + ': ' + (data.error || 'Onbekende fout'), "error");
    }
  } catch(e) {
    await pyAlert('Netwerkfout: ' + e.message, "error");
  } finally {
    createBtn.disabled    = false;
    backBtn.disabled      = false;
    createBtn.textContent = IS_EDIT ? '💾 Wijzigingen opslaan' : '✅ ' + meta.createLabel;
    statusEl.style.display = 'none';
  }
}

function toggleTimer(val) {
  const timerInput = document.getElementById('quiz-timer-min');
  if (timerInput) timerInput.disabled = val === 'notimer';
}

// Sprint 83: de drempel heeft geen betekenis zolang "automatisch indienen bij
// tabwissel" uitstaat.
function toggleTabSwitchThreshold(enabled) {
  const thresholdInput = document.getElementById('quiz-tabswitch-threshold');
  if (thresholdInput) thresholdInput.disabled = !enabled;
  // Sprint 94: het respijt heeft, net als de drempel hierboven, geen betekenis zolang
  // "automatisch indienen bij tabwissel" uitstaat.
  const graceInput = document.getElementById('quiz-tabswitch-grace');
  if (graceInput) graceInput.disabled = !enabled;
}

// Sprint 51s (bugfix): het schooljaar van een toets werd altijd blind berekend uit de
// HUIDIGE systeemdatum (augustus = nieuw jaar) — nooit uit de gekozen klas. Werd een toets
// aangemaakt ná de jaarwissel voor een klas die zelf nog het vorige schooljaar draagt, dan
// kreeg de toets een ander schooljaar dan de klas. Gevolg: de toets viel stilzwijgend uit het
// Klasoverzicht (dat filtert op exact dat schooljaar). Nu: een dropdown met de bestaande,
// actieve schooljaren, die automatisch meeschuift met de gekozen klas (klas is de bron van
// waarheid) en enkel vrij instelbaar is zolang er geen klas gekozen is.
const _schoolYearReady = (async function() {
  const el = document.getElementById('quiz-school-year');
  if (!el) return [];
  let jaren = [];
  try {
    const r = await fetch('/api/admin/school-years');
    const data = await r.json();
    jaren = (Array.isArray(data) ? data : []).filter(j => !j.allArchived).map(j => j.schoolYear);
  } catch (e) { console.warn('[quiz-teacher] schooljaren laden mislukt:', e.message); }

  // Sprint 51x (bugfix): de default gebruikte hier nog de kale kalenderberekening
  // (augustus = nieuw jaar), niet het ECHTE actieve schooljaar van de leerkracht (sprint
  // 51u) — na een jaarwissel toonde deze dropdown dus het verkeerde jaar als default. De
  // kalenderberekening blijft enkel de allerlaatste terugval (bv. niet ingelogd/preview).
  let huidigLabel;
  try {
    const r = await fetch('/api/teacher/active-school-year');
    const data = await r.json();
    huidigLabel = data.schoolYear || null;
  } catch (e) { /* val terug op kalenderberekening hieronder */ }
  if (!huidigLabel) {
    const now = new Date();
    const huidig = (now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
    huidigLabel = huidig + '-' + (huidig + 1);
  }
  if (!jaren.includes(huidigLabel)) jaren.unshift(huidigLabel); // altijd minstens het actieve jaar als optie

  jaren.forEach(function(j) {
    const opt = document.createElement('option');
    opt.value = j; opt.textContent = j;
    el.appendChild(opt);
  });
  el.value = huidigLabel;
  return jaren;
})();

// Wanneer de klas verandert: schooljaar automatisch overnemen van die klas (klas = bron van
// waarheid, voorkomt de mismatch die het Klasoverzicht liet haperen). Geen klas gekozen?
// Dan blijft het schooljaar vrij instelbaar door de leerkracht. Dit hangt enkel aan een
// ECHTE klaswijziging (het 'change'-event) — bij het laden van een bestaande toets (bewerken)
// blijft het opgeslagen schooljaar zichtbaar tot de leerkracht de klas zelf aanraakt; zie
// applyClassYearLock() voor de louter-visuele (niet-waarde-wijzigende) staat bij het laden.
function syncSchoolYearWithClass() {
  const clsSel = document.getElementById('quiz-target-class');
  const yearSel = document.getElementById('quiz-school-year');
  const hint = document.getElementById('quiz-school-year-hint');
  if (!clsSel || !yearSel) return;
  const klasJaar = clsSel.options[clsSel.selectedIndex]?.dataset?.schoolYear;
  if (clsSel.value && klasJaar) {
    if (![...yearSel.options].some(o => o.value === klasJaar)) {
      const opt = document.createElement('option');
      opt.value = klasJaar; opt.textContent = klasJaar;
      yearSel.appendChild(opt);
    }
    yearSel.value = klasJaar;
    yearSel.disabled = true;
    if (hint) hint.style.display = '';
  } else {
    yearSel.disabled = false;
    if (hint) hint.style.display = 'none';
  }
}

// Enkel de visuele (uitgeschakeld/hint) staat toepassen, zonder de huidige waarde te
// overschrijven — gebruikt bij het laden van een bestaande toets (bewerken), zodat het
// opgeslagen schooljaar zichtbaar blijft ook als het toevallig niet overeenkomt met de klas.
function applyClassYearLock() {
  const clsSel = document.getElementById('quiz-target-class');
  const yearSel = document.getElementById('quiz-school-year');
  const hint = document.getElementById('quiz-school-year-hint');
  if (!clsSel || !yearSel) return;
  const heeftKlas = !!clsSel.value;
  yearSel.disabled = heeftKlas;
  if (hint) hint.style.display = heeftKlas ? '' : 'none';
}

// Klassen laden — als promise, zodat de bewerkmodus kan wachten tot de opties bestaan
// vóór hij de opgeslagen klas selecteert.
const _classesReady = (async function() {
  try {
    const r = await fetch('/api/classes');
    const classes = await r.json();
    const sel = document.getElementById('quiz-target-class');
    if (!sel) return;
    classes.forEach(function(cl) {
      const opt = document.createElement('option');
      opt.value = cl.id; opt.textContent = cl.name;
      opt.dataset.schoolYear = cl.school_year || '';
      sel.appendChild(opt);
    });
    // Sprint 51s: bij een NIEUWE toets (geen klas voorgeselecteerd) heeft de klaskeuze een
    // 'change'-listener die het schooljaar meesynchroniseert. Bij het laden zelf enkel de
    // visuele lock toepassen (zie loadForEdit voor hoe het bewerkscherm dit verder afhandelt).
    await _schoolYearReady;
    sel.addEventListener('change', syncSchoolYearWithClass);
    applyClassYearLock();
  } catch (e) { console.warn('[quiz-teacher] fout:', e.message); }
})();

// ── Sprint 50 (bug 2): bestaande toets/taak inladen om te bewerken ───────────
async function loadForEdit() {
  if (!IS_EDIT) return;
  try {
    const r = await fetch('/api/quiz/' + encodeURIComponent(EDIT_CODE) + '/edit');
    const data = await r.json();
    if (!r.ok) { await pyAlert(data.error || 'Kon de gegevens niet laden.', 'error'); location.href = '/' + (QUIZ_TYPE === 'taak' ? 'taak' : 'toets') + '-overzicht.html'; return; }
    if (!data.editable) {
      await pyAlert(data.reason || 'Deze toets/taak kan niet meer bewerkt worden.', 'warn');
      location.href = '/' + (data.type === 'taak' ? 'taak' : 'toets') + '-overzicht.html';
      return;
    }

    // Naam + basisinstellingen
    const setVal = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
    setVal('quiz-name', data.name || '');
    const m = data.meta || {};
    // Timer
    const timerType = m.noTimer ? 'notimer' : 'timed';
    const tRadio = document.querySelector('[name=quiz-timer-type][value="' + timerType + '"]');
    if (tRadio) { tRadio.checked = true; }
    const tMin = document.getElementById('quiz-timer-min');
    if (tMin) { tMin.disabled = m.noTimer; if (!m.noTimer && m.timerSeconds) tMin.value = Math.round(m.timerSeconds / 60); }
    // Volgorde
    const ordRadio = document.querySelector('[name=quiz-order][value="' + (m.randomize ? 'random' : 'fixed') + '"]');
    if (ordRadio) ordRadio.checked = true;
    // Overige vlaggen
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    setChk('quiz-hide-question', m.hideQuestionOnScreen);
    setChk('quiz-no-back', m.noBack);
    setChk('quiz-min-runs', m.minRunsPerQ);
    setChk('quiz-auto-submit', m.autoSubmitLate);
    // Sprint 83: anti-spiek (enkel relevant/zichtbaar bij een toets — sectie is al
    // verborgen bij een taak, zie de QUIZ_TYPE-init hierboven).
    setChk('quiz-tabswitch-enabled', m.tabSwitchEnabled);
    setVal('quiz-tabswitch-threshold', m.tabSwitchThreshold || 1);
    // Sprint 94: instelbaar respijt — 0 is een geldige waarde, dus expliciet op undefined
    // checken i.p.v. "|| 5" (dat zou een bewuste 0 tonen als 5).
    setVal('quiz-tabswitch-grace', m.tabSwitchGraceSeconds !== undefined && m.tabSwitchGraceSeconds !== null ? m.tabSwitchGraceSeconds : 5);
    toggleTabSwitchThreshold(!!m.tabSwitchEnabled);
    // v132: cursus-links per vraag; het rooster wordt getekend zodra de vragen hersteld zijn (hieronder).
    _cursusLinks = (Array.isArray(m.cursusLinks) ? m.cursusLinks : []).map((l, i) => ({
      id: l.id || ('c' + (i + 1)), title: l.title || '', url: l.url || '',
      questionIds: Array.isArray(l.questionIds) ? l.questionIds.map(String) : [],
    }));
    // Sprint 90: zelfevaluatie-enquête
    setChk('quiz-self-eval', m.selfEvalEnabled);
    // v99: klasbord + hand opsteken bij een taak
    setChk('quiz-klasbord', m.klasbordEnabled);
    setChk('quiz-copypaste-blocked', m.copyPasteBlocked !== false);
    { const mc = document.getElementById('quiz-mc-scoring'); if (mc) mc.value = m.mcScoring === 'gedeeld' ? 'gedeeld' : 'klassiek'; }   // v133
    setChk('quiz-fullscreen-required', m.fullscreenRequired !== false);
    setVal('quiz-live-screenshot-sec', m.liveScreenshotSec !== undefined && m.liveScreenshotSec !== null ? m.liveScreenshotSec : 30);   // v145
    // Sprint 51s: wacht tot de schooljaar-dropdown zijn opties heeft, en voeg het opgeslagen
    // jaar toe als het er nog niet bij staat (bv. een ouder/gearchiveerd jaar) — zo blijft
    // zichtbaar wat er nu echt geconfigureerd staat, ook al is dat een mismatch met de klas.
    await _schoolYearReady;
    if (m.schoolYear) {
      const yearSel = document.getElementById('quiz-school-year');
      if (yearSel && ![...yearSel.options].some(o => o.value === m.schoolYear)) {
        const opt = document.createElement('option');
        opt.value = m.schoolYear; opt.textContent = m.schoolYear + ' (opgeslagen waarde)';
        yearSel.appendChild(opt);
      }
    }
    setVal('quiz-school-year', m.schoolYear || '');
    // Tijdvenster (datetime-local verwacht 'YYYY-MM-DDTHH:mm' in LOKALE tijd)
    const toLocalInput = (ms) => {
      if (!ms) return '';
      const d = new Date(Number(ms));
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    };
    setVal('quiz-access-from', toLocalInput(m.accessFrom));
    setVal('quiz-access-until', toLocalInput(m.accessUntil));

    // Klas selecteren (wacht tot de opties geladen zijn)
    await _classesReady;
    const clsSel = document.getElementById('quiz-target-class');
    if (clsSel && m.targetClass) {
      // Sprint 78: /api/classes sluit gearchiveerde klassen bewust uit — stond de gekoppelde
      // klas (bv. een klas van een vorig schooljaar) niet tussen de opties, dan zette
      // "clsSel.value = m.targetClass" hier voorheen STIL niets (de browser negeert een
      // waarde die geen enkele <option> heeft), en viel de dropdown terug op de eerste optie
      // zonder dat de leerkracht dat zag. Bewaarde hij dan zonder de klas zelf opnieuw te
      // kiezen, dan verving dat de koppeling ongemerkt door een verkeerde/lege klas — dit is
      // vermoedelijk hoe een toets/taak stilletjes aan de verkeerde (oude) klas kan blijven
      // hangen. We voegen de gekoppelde klas nu altijd zichtbaar toe als ze ontbreekt, met een
      // duidelijk label, zodat de leerkracht ziet wat er nu echt gekoppeld is en het bewust
      // kan aanpassen.
      const bestaatAl = [...clsSel.options].some(o => o.value === m.targetClass);
      if (!bestaatAl) {
        const info = m.targetClassInfo;
        const opt = document.createElement('option');
        opt.value = m.targetClass;
        opt.textContent = info
          ? `⚠️ ${info.name} (${info.schoolYear}${info.archived ? ', gearchiveerd' : ''}) — huidige koppeling`
          : '⚠️ (onbekende/verwijderde klas) — huidige koppeling';
        opt.dataset.schoolYear = info?.schoolYear || '';
        clsSel.appendChild(opt);
      }
      clsSel.value = m.targetClass;
    }
    // Sprint 51s: enkel de visuele lock toepassen (uitgeschakeld + hint) — NIET
    // syncSchoolYearWithClass(), want dat zou het net herstelde opgeslagen schooljaar
    // overschrijven. Wijzigt de leerkracht de klas zelf, dan synchroniseert het wél (de
    // 'change'-listener is al gekoppeld in _classesReady).
    applyClassYearLock();
    // Leerling-selectie herstellen
    window._selectedStudentIds = Array.isArray(data.studentIds) ? data.studentIds.slice() : [];
    _updateStudentsInfo();

    // Vragen herstellen. We hebben de vraagteksten/punten uit de snapshot; de bank wordt
    // apart geladen voor stap 2. We vullen _selected met de huidige selectie zodat de
    // wizard, preview en bevestiging meteen kloppen.
    _selected = {};
    _selectedOrder = [];
    _groupBreaks = new Set();
    // Sprint 76: data.questions staat al in de opgeslagen order_index-volgorde — daaruit
    // reconstrueren we zowel _selectedOrder als de groepsscheidingen (een scheiding zit
    // vóór het eerste item van elke nieuwe random_group-waarde, behalve de allereerste).
    let vorigeGroep = null;
    (data.questions || []).forEach(function (q, i) {
      _selected[q.id] = {
        id: q.id, text: q.text, subject: q.subject,
        max_points: q.points, points: q.points,
        question_type: q.question_type, choices_json: q.choices_json,
        difficulty: q.difficulty || 'gemiddeld',   // v137
        text_snapshot: q.text,
      };
      _selectedOrder.push(q.id);
      const groep = q.random_group || 0;
      if (i > 0 && groep !== vorigeGroep) _groupBreaks.add(q.id);
      vorigeGroep = groep;
    });
    // v134: pool (per groepnummer) terugzetten op de eerste vraag van elke groep.
    _poolPerStart = {};
    const poolOpgeslagen = (data.meta && data.meta.pool) || {};
    _poolMixPerStart = {}; _poolMixOpen = {};
    groepenLijst().forEach(g => {
      const w = poolOpgeslagen[g.nr];
      const n = Number(w && typeof w === 'object' ? w.n : w);
      if (n >= 1 && n < g.ids.length) {
        _poolPerStart[g.eersteId] = n;
        if (w && typeof w === 'object' && w.mix) { _poolMixPerStart[g.eersteId] = w.mix; _poolMixOpen[g.eersteId] = true; }
      }
    });
    renderSelectedList();
  } catch (e) {
    await pyAlert('Laden mislukt: ' + e.message, 'error');
  }
}
if (IS_EDIT) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadForEdit);
  else loadForEdit();
}

/* ── Sprint 43.4: leerling-selectie binnen de gekozen klas ─────────────────────
   Standaard doen ALLE leerlingen van de klas mee. Pas als de leerkracht iemand
   uitvinkt, houden we een expliciete lijst bij (window._selectedStudentIds).
   Leeg = geen beperking → iedereen van de klas mag. */
window._selectedStudentIds = [];
let _pickerRoster = [];

function _updateStudentsInfo() {
  const info = document.getElementById('quiz-students-info');
  const btn  = document.getElementById('quiz-students-btn');
  const classId = document.getElementById('quiz-target-class')?.value || '';
  if (!info || !btn) return;
  btn.disabled = !classId;
  if (!classId) { info.textContent = 'Kies eerst een klas'; window._selectedStudentIds = []; return; }
  const n = window._selectedStudentIds.length;
  info.textContent = n ? `${n} leerling${n === 1 ? '' : 'en'} geselecteerd` : 'Alle leerlingen van de klas';
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('quiz-target-class');
  if (sel) sel.addEventListener('change', () => { window._selectedStudentIds = []; _updateStudentsInfo(); });
  _updateStudentsInfo();
});

window.openStudentPicker = async function () {
  const classId = document.getElementById('quiz-target-class')?.value || '';
  if (!classId) return;
  try {
    const r = await fetch('/api/admin/students?classId=' + encodeURIComponent(classId));
    if (!r.ok) { await pyAlert('Kon de klaslijst niet laden.', 'warn'); return; }
    _pickerRoster = await r.json();
  } catch (e) { await pyAlert('Kon de klaslijst niet laden.', 'warn'); return; }

  if (!_pickerRoster.length) { await pyAlert('Deze klas heeft nog geen leerlingen.', 'warn'); return; }

  // Niets gekozen → standaard staat alles aan.
  const chosen = window._selectedStudentIds.length
    ? new Set(window._selectedStudentIds)
    : new Set(_pickerRoster.map(s => s.id));

  const old = document.getElementById('py-modal-overlay');
  if (old) old.remove();

  // Sprint 50 (bug 5): de picker moet ook met ~100 leerlingen werkbaar blijven. Daarom:
  // een zoekveld, een teller, knoppen die op de ZICHTBARE (gefilterde) selectie werken,
  // en een rasterweergave met meerdere kolommen (auto-fill) i.p.v. één lange kolom.
  const many = _pickerRoster.length;
  const overlay = document.createElement('div');
  overlay.id = 'py-modal-overlay';
  overlay.innerHTML =
    '<div id="py-modal-box" style="max-width:680px;width:calc(100% - 40px);">' +
      '<div id="py-modal-title">Leerlingen voor deze toets/taak</div>' +
      '<div id="py-modal-body" style="margin-bottom:16px;">' +
        '<p class="muted" style="margin:0 0 10px;font-size:0.85rem;">Vink aan wie deze toets/taak mag maken. Standaard doet iedereen mee.</p>' +
        '<input id="sp-search" type="text" placeholder="🔎 Zoek een leerling…" autocomplete="off" ' +
          'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:0.9rem;margin-bottom:8px;background:var(--surface);color:var(--text);"/>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-muted small" id="sp-all">Alles aan</button>' +
          '<button type="button" class="btn btn-muted small" id="sp-none">Alles uit</button>' +
          '<span class="muted" id="sp-hint" style="font-size:0.75rem;"></span>' +
          '<span class="muted" id="sp-count" style="margin-left:auto;font-size:0.8rem;font-weight:700;"></span>' +
        '</div>' +
        '<div id="sp-list" style="max-height:360px;overflow-y:auto;border:1.5px solid var(--border);border-radius:10px;padding:8px;' +
          'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px 10px;align-content:start;"></div>' +
        '<p class="muted" id="sp-empty" style="display:none;font-size:0.85rem;margin:10px 4px 0;">Geen leerling gevonden voor deze zoekterm.</p>' +
      '</div>' +
      '<div id="py-modal-actions">' +
        '<button id="sp-cancel" class="btn btn-muted small">Annuleren</button>' +
        '<button id="sp-save" class="btn btn-primary small">Opslaan</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const esc2 = (s) => (window.escapeHtml ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  let _filter = '';

  function zichtbareRoster() {
    if (!_filter) return _pickerRoster;
    const f = _filter.toLowerCase();
    return _pickerRoster.filter(s => String(s.name || '').toLowerCase().indexOf(f) !== -1);
  }

  function updateCount() {
    const cnt = document.getElementById('sp-count');
    if (cnt) cnt.textContent = chosen.size + ' van ' + many + ' geselecteerd';
    const hint = document.getElementById('sp-hint');
    if (hint) hint.textContent = _filter ? '(knoppen werken op de zoekresultaten)' : '';
  }

  function paint() {
    const zichtbaar = zichtbareRoster();
    const list = document.getElementById('sp-list');
    const leeg = document.getElementById('sp-empty');
    list.style.display = zichtbaar.length ? 'grid' : 'none';
    if (leeg) leeg.style.display = zichtbaar.length ? 'none' : 'block';
    list.innerHTML = zichtbaar.map(s =>
      '<label style="display:flex;align-items:center;gap:8px;padding:6px 6px;cursor:pointer;border-radius:8px;min-width:0;">' +
        '<input type="checkbox" class="sp-cb" value="' + esc2(s.id) + '"' + (chosen.has(s.id) ? ' checked' : '') +
          ' style="width:16px;height:16px;flex-shrink:0;"/>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc2(s.name) + '</span>' +
      '</label>').join('');
    list.querySelectorAll('.sp-cb').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) chosen.add(cb.value); else chosen.delete(cb.value);
      updateCount();
    }));
    updateCount();
  }
  paint();

  const searchEl = document.getElementById('sp-search');
  if (searchEl) searchEl.addEventListener('input', () => { _filter = searchEl.value.trim(); paint(); });

  // "Alles aan/uit" werkt op de ZICHTBARE (gefilterde) leerlingen, zodat je snel een
  // subgroep kan selecteren (bv. zoek "6A" → alles aan) zonder de rest te verstoren.
  document.getElementById('sp-all').addEventListener('click', () => { zichtbareRoster().forEach(s => chosen.add(s.id)); paint(); });
  document.getElementById('sp-none').addEventListener('click', () => { zichtbareRoster().forEach(s => chosen.delete(s.id)); paint(); });
  document.getElementById('sp-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('sp-save').addEventListener('click', () => {
    // Iedereen aangevinkt → geen beperking bewaren (dan telt automatisch de hele klas).
    window._selectedStudentIds = (chosen.size === _pickerRoster.length) ? [] : Array.from(chosen);
    overlay.remove();
    _updateStudentsInfo();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  if (searchEl) searchEl.focus();
};

// v145: interval (s) van het schermbeeld in het live-overzicht; leeg = standaard 30, 0 = uit, 1–4 → 5, max 300.
function liveBeeldSec() {
  const raw = document.getElementById('quiz-live-screenshot-sec')?.value;
  if (raw === undefined || raw === '' || raw === null) return 30;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return n <= 0 ? 0 : Math.max(5, Math.min(300, n));
}
