// PyCodeFlow — geextraheerd uit quiz-student.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

// ── Quiz student logica ──────────────────────────────────────────────────────
const socket = io();
let _state = null;        // volledige quiz state van server
let _stemFlowchartWidget = null;   // Sprint 63: weergave-widget bij de vraagstelling
let _answerFlowchartWidget = null; // Sprint 63: bewerkbare widget bij antwoordtype 'stroomdiagram'
let _currentIdx = 0;      // huidige vraag index (in persoonlijke volgorde)
let _bevestigdeVragen = new Set();   // v143: bewust bevestigde vragen (1 kans per vraag) — blijven dicht, ook na heropenen
let _afgesloten = false;  // Sprint 70: toets automatisch of door de leerkracht afgesloten
let _answers = {};        // { questionId: { code, runCount, firstVisitAt, firstRunAt } }
let _visited = new Set(); // bezochte vraag IDs
let _timerInterval = null;

// ── Sprint 83: anti-spiek (enkel bij een toets) ──────────────────────────────
let _fullscreenRequired = true;   // v113: per toets/taak instelbaar (standaard aan)
let _copyPasteBlocked = true;     // v113
let _isToets = false;           // state.type === 'toets' (ná join, zie quiz_state)
let _tabSwitchEnabled = false;  // leerkracht zette "auto-indienen bij tabwissel" aan
let _tabSwitchThreshold = 0;
// Sprint 92: _tabWisselDebounce (600ms) is vervangen door de respijtperiode hieronder —
// _tabWisselTimer zelf is nu de enige nodige "is er al iets aan de gang?"-grendel, dus een
// aparte, kortere debounce is niet meer nodig.

// ── Sprint 37d: nakijk-modus ─────────────────────────────────────────────────
// Het token blijft BEWUST in het geheugen (geen localStorage), zodat inzage op
// elk toestel werkt en er niets achterblijft op een gedeelde computer.
let _reviewToken = null;
const _reviewCode = new URLSearchParams(location.search).get('code') || '';
const _isReviewEntry = new URLSearchParams(location.search).get('nakijken') === '1';

function showReviewLoginError(msg) {
  const el = document.getElementById('review-login-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function reviewLogin() {
  const naam = document.getElementById('review-naam')?.value.trim() || '';
  const klas = document.getElementById('review-klas')?.value.trim() || '';
  const btn = document.getElementById('review-login-btn');
  document.getElementById('review-login-error')?.classList.add('hidden');
  if (!naam || !klas) return showReviewLoginError('Vul je naam en klas in.');
  if (!_reviewCode) return showReviewLoginError('Geen toetscode in de link.');

  if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
  try {
    const r = await fetch(`/api/quiz/${_reviewCode}/review-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam, klas }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Inloggen mislukt.');
    _reviewToken = data.token;
    document.getElementById('review-login-screen').style.display = 'none';
    document.getElementById('review-screen').style.display = 'block';
    await loadMyResult(data.naam);
  } catch (e) {
    showReviewLoginError(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Bekijk mijn toets'; }
  }
}

// Bij ?nakijken=1 tonen we meteen het nakijk-loginscherm i.p.v. de toetsflow.
// Sprint 51-fix: een leerling die al via zijn EIGEN account is ingelogd (student-thuis.html
// → "Toets openen"-knop) hoeft zich hier niet nogmaals met naam+klas te identificeren — die
// pagina zet het token vooraf in sessionStorage (NIET de URL, om lekken via browser-
// geschiedenis/serverlogs te vermijden) en we lezen het hier meteen uit, eenmalig (direct
// verwijderd na gebruik — een pagina-ververs valt netjes terug op het naam+klas-formulier).
if (_isReviewEntry) {
  document.addEventListener('DOMContentLoaded', async () => {
    const start = document.getElementById('start-screen');
    if (start) start.style.display = 'none';

    let vooraf = null;
    try {
      const ruw = sessionStorage.getItem('pycf_review_token');
      if (ruw) {
        const parsed = JSON.parse(ruw);
        if (parsed?.code === _reviewCode && parsed?.token) vooraf = parsed;
      }
    } catch { /* geen geldig token, val terug op het formulier */ }
    sessionStorage.removeItem('pycf_review_token'); // eenmalig gebruik

    if (vooraf) {
      _reviewToken = vooraf.token;
      const scherm = document.getElementById('review-screen');
      if (scherm) scherm.style.display = 'block';
      await loadMyResult(vooraf.naam || '');
      return;
    }

    const rl = document.getElementById('review-login-screen');
    if (rl) rl.style.display = 'flex';
  });
}

// ── Sprint 37a: nakijk-scherm ────────────────────────────────────────────────

async function loadMyResult(naam) {
  const paneel = document.getElementById('review-screen');
  paneel.innerHTML = '<div class="loading-row"><span class="spinner"></span>Je resultaten laden…</div>';
  try {
    const r = await fetch(`/api/quiz/${_reviewCode}/my-result`, {
      headers: { 'X-Review-Token': _reviewToken },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Kon je resultaten niet laden.');
    renderMyResult(naam, data);
    // Sprint 51-fix (v2): de code-editor-hosts staan nu wél in de DOM (net gezet via
    // renderMyResult's innerHTML=) — pas NU kan Monaco er echt in gemount worden.
    await mountReviewCodeEditors();
  } catch (e) {
    paneel.innerHTML =
      `<div style="background:#fee2e2;color:#991b1b;border-radius:10px;padding:14px;">
         ${escHtml(e.message)}
       </div>`;
  }
}

// Kleine SVG-staafgrafiek: score per vraag t.o.v. het maximum.
// Groen = volledig, oranje = deels, rood = nul, grijs = nog niet beoordeeld.
function renderReviewChart(vragen) {
  if (!vragen.length) return '';
  const W = 34, GAP = 8, H = 90;
  const staven = vragen.map((v, i) => {
    const max = v.punten || 1;
    const ratio = v.beoordeeld ? Math.max(0, Math.min(1, (v.score || 0) / max)) : 0;
    const hoogte = v.beoordeeld ? Math.max(2, ratio * (H - 26)) : 3;
    const x = i * (W + GAP) + 2;
    const y = H - hoogte - 16;
    let kleur = '#cbd5e1';
    if (v.beoordeeld) {
      if (ratio >= 0.999) kleur = '#16a34a';
      else if (ratio > 0) kleur = '#f59e0b';
      else kleur = '#dc2626';
    }
    const label = v.beoordeeld ? `${fmtP(v.score)}/${fmtP(max)}` : '?';
    return `<rect x="${x}" y="${y}" width="${W}" height="${hoogte}" rx="3" fill="${kleur}"></rect>` +
      `<text x="${x + W/2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#64748b">V${v.nummer}</text>` +
      `<text x="${x + W/2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="#334155">${label}</text>`;
  }).join('');
  const breedte = vragen.length * (W + GAP) + 4;
  return `<div style="overflow-x:auto;margin:12px 0 4px;">
    <svg width="${breedte}" height="${H}" role="img" aria-label="Score per vraag">${staven}</svg>
  </div>`;
}

// ── Sprint 51-fix (v2): echte, readonly Monaco-editors in het nakijk-scherm ─────────────
// Zowel "Jouw antwoord" als "Juiste antwoord" bij een code-vraag/-onderdeel krijgen nu een
// echte code-editor (regelnummers, Python-syntaxkleuren) i.p.v. een platte <pre>-tekstblok.
// Bewust een EIGEN, lichte mount-helper (net als in quiz-bank.js) i.p.v. de gedeelde
// ensureEditor()/editorStore uit app.js: die ondersteunt maar 1 instance per "owner"-naam
// en stuurt bij wijzigingen socket-updates naar een live sessie — hier kunnen er meerdere
// (readonly) editors tegelijk op het scherm staan, zonder enige sessie om mee te syncen.
let _reviewMonacoQueue = [];  // { hostId, code } — gevuld tijdens het bouwen van de HTML,
                               // pas gemount NADAT die HTML echt in de DOM staat.

async function ensureReviewMonacoTheme(monaco) {
  if (window._pycfReviewThemeReady) { monaco.editor.setTheme('pycodeflow-dark'); return; }
  monaco.editor.defineTheme('pycodeflow-dark', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': '#1e1e1e',
      'editorLineNumber.foreground': '#9fb3c8',
      'editorLineNumber.activeForeground': '#ffffff',
      'editor.lineHighlightBackground': '#23272e',
      'editor.lineHighlightBorder': '#23272e',
    },
  });
  window._pycfReviewThemeReady = true;
  monaco.editor.setTheme('pycodeflow-dark');
}

async function mountReviewCodeEditors() {
  if (!_reviewMonacoQueue.length || !window.loadMonaco) return;
  const monaco = await window.loadMonaco();
  await ensureReviewMonacoTheme(monaco);
  const wachtrij = _reviewMonacoQueue;
  _reviewMonacoQueue = [];
  wachtrij.forEach(({ hostId, code }) => {
    const host = document.getElementById(hostId);
    if (!host) return;
    monaco.editor.create(host, {
      value: code || '', language: 'python', theme: 'pycodeflow-dark', readOnly: true,
      automaticLayout: true, minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on',
      scrollBeyondLastLine: false, wordWrap: 'on', renderLineHighlight: 'none',
      domReadOnly: true, contextmenu: false,
    });
  });
}

// Bouwt de HTML voor één code-editor-host en zet 'm op de mount-wachtrij. hoogtePx houdt
// lege/korte antwoorden compact (een leeg leerlingantwoord hoeft geen even hoge editor als
// een 7-regelige modeloplossing).
function codeEditorHost(idPrefix, code) {
  const id = idPrefix + '-' + Math.random().toString(36).slice(2, 9);
  const regels = Math.max(3, Math.min(14, (code || '').split('\n').length + 1));
  _reviewMonacoQueue.push({ hostId: id, code: code || '' });
  return `<div id="${id}" class="monaco-editor-host" style="height:${regels * 19 + 16}px;border-radius:8px;margin-top:6px;"></div>`;
}


// Sprint 51-fix (v2): keuzelijst tonen — twee VARIANTEN. `modus='jouw'` markeert enkel wat
// de leerling koos (geen groen/rood, ZELFS niet als er niets gekozen is — dan blijft de
// volledige lijst gewoon ongemarkeerd zichtbaar, in plaats van een tekst als "niet ingevuld"
// die de opties verbergt). `modus='juist'` toont dezelfde lijst met de correcte optie(s)
// groen — een antwoordsleutel, los van wat de leerling koos.
function renderKeuzeLijst(opties, modus) {
  return `<ul style="list-style:none;padding:0;margin:6px 0 0;">` +
    (opties || []).map(opt => {
      let bg = 'var(--surface-soft)', mark = '○', vet = false, label = '';
      if (modus === 'jouw') {
        if (opt.gekozen) { bg = '#e0e7ff'; mark = '●'; vet = true; label = 'jouw keuze'; }
      } else {
        if (opt.correct === true) { bg = '#dcfce7'; mark = '✓'; vet = true; label = 'juist'; }
      }
      return `<li style="padding:5px 9px;border-radius:7px;margin-bottom:3px;background:${bg};
                 ${vet ? 'font-weight:600;' : ''}font-size:0.88rem;">
        ${mark} ${escHtml(opt.text)}
        ${label ? `<span class="muted" style="font-size:0.76rem;font-weight:400;"> — ${label}</span>` : ''}
      </li>`;
    }).join('') + `</ul>`;
}

// Sprint 51-fix (v2): "Jouw antwoord" — toont UITSLUITEND wat de leerling zelf invulde/koos,
// zonder correct/fout-oordeel. Bij niets ingevuld: het veld zelf blijft zichtbaar en leeg
// (een lege editor / een lege tekstbox / de keuzelijst zonder markering) in plaats van een
// vervangende tekst als "niet ingevuld" — zo is altijd duidelijk WAT er te zien zou zijn,
// en dat er bewust niets werd ingevuld, niet dat er iets fout ging bij het tonen.
function renderJouwAntwoord(o, idPrefix) {
  if (o.opties) return renderKeuzeLijst(o.opties, 'jouw');
  if (o.type === 'code') return codeEditorHost(idPrefix + '-jouw', o.eigenAntwoord || '');
  return `<div style="background:var(--surface-soft);border-radius:8px;padding:8px 10px;
    margin-top:6px;font-size:0.88rem;white-space:pre-wrap;min-height:20px;">
    ${o.eigenAntwoord && o.eigenAntwoord.trim() ? escHtml(o.eigenAntwoord) : '<span class="muted" style="font-style:italic;">(niets ingevuld)</span>'}</div>`;
}

// Sprint 51-fix (v2): "Juiste antwoord" — een aparte sectie, los van wat de leerling
// invulde. Keuzevragen: dezelfde lijst-stijl maar met het/de juiste antwoord(en) groen (een
// echte antwoordsleutel). Code: een echte, syntax-gekleurde Monaco-editor met de modelcode
// (niet langer een platte tekstblok). Open: het modelantwoord als tekst. Ontbreekt er geen
// modelantwoord/geen enkele optie is "correct" gemarkeerd, dan blijft deze sectie leeg.
function renderJuisteAntwoord(o, idPrefix) {
  if (o.opties) {
    if (!o.opties.some(opt => opt.correct === true)) return '';
    return renderKeuzeLijst(o.opties, 'juist');
  }
  if (o.type === 'code') {
    if (!o.modelAnswer || !o.modelAnswer.trim()) return '';
    return codeEditorHost(idPrefix + '-model', o.modelAnswer);
  }
  if (!o.modelAnswer || !o.modelAnswer.trim()) return '';
  return `<div class="md-preview" style="background:#f0fdf4;border:1px solid #bbf7d0;
    border-radius:8px;padding:8px 10px;margin-top:6px;font-size:0.88rem;">${renderMarkdown(o.modelAnswer)}</div>`;
}

// Sprint 51-fix: composite-vragen tonen nu al hun onderdelen (open/code/single/multiple)
// met per-onderdeel score, elk met de "Jouw antwoord" / "Juiste antwoord"-tweedeling.
function renderCompositeAntwoord(onderdelen, vraagId) {
  return (onderdelen || []).map(o => {
    const scoreTekst = o.beoordeeld ? `${fmtP(o.score)}/${fmtP(o.punten)}` : `? / ${fmtP(o.punten)}`;
    const titel = o.type === 'code' ? '🐍 Code' : escHtml(o.label || 'Onderdeel');
    const idPrefix = 'rv-' + vraagId + '-' + o.id;
    const juisteHtml = renderJuisteAntwoord(o, idPrefix);
    // Sprint 51-fix: commentaar per onderdeel — bestond voorheen niet in deze weergave
    // (er was ook geen opslagplek voor, zie db/database.js part_comments).
    const onderdeelCommentaarHtml = o.commentaar ? `
      <div style="margin-top:8px;">
        <div style="font-size:0.76rem;color:var(--muted);margin-bottom:3px;">💬 Commentaar van je leerkracht:</div>
        <div class="md-preview" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 10px;font-size:0.85rem;">
          ${renderMarkdown(o.commentaar)}
        </div>
      </div>` : '';
    return `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:8px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.85rem;">
        <strong>${titel}</strong><span class="muted">${scoreTekst}</span>
      </div>
      <div style="font-size:0.78rem;color:var(--muted);margin-top:6px;">Jouw antwoord:</div>
      ${renderJouwAntwoord(o, idPrefix)}
      ${juisteHtml ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:8px;">✅ Juiste antwoord:</div>${juisteHtml}` : ''}
      ${onderdeelCommentaarHtml}
    </div>`;
  }).join('');
}

// v133: korte uitleg bij een meerkeuzevraag met meerdere juiste antwoorden: "2 van 3 juist, 1 gemist".
function meerkeuzeUitleg(v) {
  if (v.type !== 'multiple' || !v.beoordeeld) return '';
  const opties = v.opties || [];
  const totaalJuist = opties.filter(o => o.correct === true).length;
  if (!totaalJuist) return '';
  const juist = opties.filter(o => o.correct === true && o.gekozen).length;
  const fout = opties.filter(o => o.correct !== true && o.gekozen).length;
  const gemist = totaalJuist - juist;
  const delen = [`${juist} van ${totaalJuist} juist`];
  if (gemist) delen.push(`${gemist} gemist`);
  if (fout) delen.push(`${fout} fout aangeduid`);
  return `<div class="muted" style="font-size:0.82rem;margin-top:6px;">${delen.join(' · ')}</div>`;
}

function renderVraagKaart(v) {
  const scoreTekst = v.beoordeeld
    ? `<strong>${fmtP(v.score)}</strong> / ${fmtP(v.punten)}`
    : `<span class="muted">nog niet beoordeeld</span>`;
  const idPrefix = 'rv-' + v.vraagId;

  let jouwHtml, juisteHtml;
  if (v.type === 'multiple' || v.type === 'single') {
    jouwHtml = renderKeuzeLijst(v.opties, 'jouw');
    juisteHtml = (v.opties || []).some(o => o.correct === true) ? renderKeuzeLijst(v.opties, 'juist') : '';
  } else if (v.type === 'code') {
    jouwHtml = codeEditorHost(idPrefix + '-jouw', v.eigenCode || '');
    juisteHtml = (v.modelAnswer && v.modelAnswer.trim()) ? codeEditorHost(idPrefix + '-model', v.modelAnswer) : '';
  } else if (v.type !== 'composite') {
    jouwHtml = `<div style="background:var(--surface-soft);border-radius:8px;padding:10px 12px;
      margin-top:6px;font-size:0.9rem;white-space:pre-wrap;min-height:20px;">
      ${v.eigenCode && v.eigenCode.trim() ? escHtml(v.eigenCode) : '<span class="muted" style="font-style:italic;">(niets ingevuld)</span>'}</div>`;
    juisteHtml = (v.modelAnswer && v.modelAnswer.trim())
      ? `<div class="md-preview" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
          padding:10px 12px;margin-top:6px;">${renderMarkdown(v.modelAnswer)}</div>` : '';
  }

  // 37c: commentaar van de leerkracht bij deze vraag (indien ingevuld), via Markdown.
  const commentaarHtml = v.commentaar ? `
    <div style="margin-top:10px;">
      <div style="font-size:0.85rem;color:var(--muted);margin-bottom:4px;">💬 Commentaar van je leerkracht:</div>
      <div class="md-preview" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;">
        ${renderMarkdown(v.commentaar)}
      </div>
    </div>` : '';

  return `<div style="background:var(--surface);border:1px solid var(--border);
      border-radius:12px;padding:14px 16px;margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
      <strong>Vraag ${v.nummer}${v.onderwerp ? ` · <span class="muted" style="font-weight:normal;">${escHtml(v.onderwerp)}</span>` : ''}</strong>
      <span>${scoreTekst}</span>
    </div>
    <div class="md-preview" style="margin-top:8px;">${renderMarkdown(v.tekst)}</div>
    ${v.type === 'composite' ? `
      <div style="margin-top:10px;font-size:0.85rem;color:var(--muted);">Onderdelen:</div>
      ${renderCompositeAntwoord(v.onderdelen, v.vraagId)}
    ` : `
      <div style="font-size:0.85rem;color:var(--muted);margin-top:10px;">Jouw antwoord:</div>
      ${jouwHtml}
      ${meerkeuzeUitleg(v)}
      ${juisteHtml ? `<div style="font-size:0.85rem;color:var(--muted);margin-top:10px;">✅ Juiste antwoord:</div>${juisteHtml}` : ''}
    `}
    ${commentaarHtml}
  </div>`;
}

function renderMyResult(naam, data) {
  const { vragen, totaal, maxTotaal, beantwoord, algemeenCommentaar } = data;
  const pct = maxTotaal > 0 ? Math.round((totaal / maxTotaal) * 100) : 0;
  const allesBeoordeeld = vragen.every(v => v.beoordeeld);

  const algemeenHtml = algemeenCommentaar ? `
    <div class="md-preview" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;
        padding:12px 14px;margin-top:12px;">
      <div style="font-size:0.85rem;color:var(--muted);margin-bottom:4px;">💬 Algemeen commentaar:</div>
      ${renderMarkdown(algemeenCommentaar)}
    </div>` : '';

  document.getElementById('review-screen').innerHTML = `
    <div style="max-width:760px;margin:0 auto;">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
                  padding:18px 20px;margin-bottom:16px;">
        <h2 style="margin:0 0 4px;">👁 Jouw toets</h2>
        <p class="muted" style="margin:0 0 10px;">${escHtml(naam)} · ${beantwoord}/${vragen.length} vragen ingevuld</p>
        <div style="font-size:1.6rem;font-weight:700;">
          ${fmtP(totaal)} <span style="font-size:1rem;font-weight:400;color:var(--muted);">/ ${fmtP(maxTotaal)} punten (${pct}%)</span>
        </div>
        ${allesBeoordeeld ? '' :
          '<p class="muted" style="font-size:0.84rem;margin:8px 0 0;">⏳ Niet alle vragen zijn al verbeterd. De score kan nog wijzigen.</p>'}
        ${renderReviewChart(vragen)}
        ${algemeenHtml}
      </div>
      ${vragen.map(renderVraagKaart).join('')}
      <p class="muted" style="text-align:center;font-size:0.8rem;margin:18px 0;">
        Vragen over je score? Spreek je leerkracht aan.
      </p>
    </div>`;
}
let _studentId = null;
let _sessionCode = null;
let _totalSeconds = 0;
let _startedAt = null;
let _runCount = {};       // { questionId: aantal }
let _noTimer = false;     // geen tijdslimiet bij taak
let _editorReady = false;
let _currentQuestionId = null;
let _runHistory = {};     // { questionId: [code, ...] }

// URL params
const params = new URLSearchParams(location.search);
const urlCode = params.get('code') || '';
const urlName = params.get('name') || localStorage.getItem('studentName') || '';
const urlClass = params.get('class') || localStorage.getItem('pycodeflow_student_class') || '';

// Sprint 51-fix: zelfde probleem als bij de vrije editor (zie app.js) — Safari/iOS kan een
// WebSocket-verbinding sluiten bij tab-wissel/schermvergrendeling, en de server-kant
// "run_end"/"quiz_state"-updates die daarna verstuurd worden (bv. na de CPU-tijdslimiet van
// een oneindige lus) komen dan nooit aan. Bij een HERverbinding vragen we de huidige staat
// gewoon opnieuw op via quiz_start — dat endpoint geeft de laatst opgeslagen voortgang
// terug (hetzelfde als bij een gewone pagina-ververs tijdens de toets), dus er gaat niets
// verloren; enkel actief ná een écht gestarte toets, nooit op het nakijkscherm.
let _quizHadDisconnected = false;
socket.on('disconnect', () => { _quizHadDisconnected = true; });
socket.on('connect', () => {
  if (!_quizHadDisconnected || _isReviewEntry) return;
  _quizHadDisconnected = false;
  if (_state) socket.emit('quiz_start', { code: urlCode, name: urlName, className: urlClass });
});

// Vul startscherm
document.getElementById('start-student-name').textContent = urlName || '(naam ontbreekt)';
document.getElementById('start-student-class').textContent = urlClass || '(geen klas)';
if (!urlName) {
  document.getElementById('start-session-name').textContent = 'Naam ontbreekt';
}

// Sprint 46: laadstatus + time-out zodat het startscherm nooit stil blijft hangen
// als quiz_start faalt (lege naam, dubbele verbinding, config weg, netwerk, …).
let _startTimeout = null;
function _showStartError(msg) {
  const info = document.getElementById('start-info');
  if (info) { info.textContent = msg; info.style.color = '#991b1b'; info.style.fontWeight = '700'; }
  _startBezig = false;
  updateStartKnop();
}
function _clearStartTimeout() { if (_startTimeout) { clearTimeout(_startTimeout); _startTimeout = null; } }

// ── Sprint 69: spelregels tonen VÓÓR de timer loopt ─────────────────────────
// De popup verschijnt altijd, ook zonder bijzondere instellingen: zo weet de leerling
// precies wanneer zijn tijd begint te lopen en wat de regels zijn. De tekst hangt af van
// de instellingen, die we vooraf ophalen (quiz_state komt pas ná het starten).
let _startInfo = null;
async function haalStartInfo() {
  try {
    const r = await fetch('/api/quiz/' + encodeURIComponent(urlCode) + '/startinfo' + (urlName ? '?name=' + encodeURIComponent(urlName) : ''));
    if (r.ok) _startInfo = await r.json();
  } catch (e) { /* stil: de popup toont dan de algemene tekst */ }
  renderStartRegels();
}
haalStartInfo();

// ── v148: spelregels + verplicht akkoord op het startscherm zelf ───────────────────────────
// Voorheen stonden de regels pas in een popup na de klik, en het vinkje enkel bij een toets.
let _startBezig = false;
function startSoort() { return _startInfo?.type === 'taak' ? 'taak' : 'toets'; }
function updateStartKnop() {
  const knop = document.getElementById('start-knop'), vink = document.getElementById('start-akkoord');
  const lab = document.getElementById('start-akkoord-label'), hint = document.getElementById('start-hint');
  if (!knop) return;
  const ok = !!(vink && vink.checked) && !!urlName && !_startBezig && !(_startInfo && _startInfo.stopped);
  knop.disabled = !ok;
  if (!_startBezig) knop.textContent = '🚀 START ' + startSoort().toUpperCase();
  if (lab) lab.classList.toggle('aan', !!(vink && vink.checked));
  if (hint) hint.textContent = (vink && vink.checked) ? 'Jouw tijd start zodra je klikt.' : 'Vink eerst het vakje aan om te kunnen starten.';
}
// Beschikbare tijd vanaf nu: de kortste van de duur en de tijd tot de deadline (zelfde regel als de teller).
function startTijdTekst() {
  const i = _startInfo; if (!i) return null;
  const nu = Date.now();
  const totDl = i.accessUntil ? Math.max(0, Math.floor((Number(i.accessUntil) - nu) / 1000)) : null;
  const duur = (!i.noTimer && i.timerSeconds) ? Number(i.timerSeconds) : null;
  const fmt = (sec) => { const m = Math.max(1, Math.round(sec / 60)); return m >= 120 ? `${Math.floor(m / 60)} u ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : `${m} minuten`; };
  if (duur != null) {
    const nuTijd = totDl != null ? Math.min(duur, totDl) : duur;
    return `<b>Tijd:</b> nog <b>${fmt(nuTijd)}</b>${totDl != null && totDl < duur ? ` (deadline ${formatIndienOp(i.accessUntil)})` : ''}. De tijd start zodra je klikt.`;
  }
  if (totDl != null) return `<b>Deadline:</b> je werk wordt automatisch ingediend op <b>${formatIndienOp(i.accessUntil)}</b> (nog ${fmt(totDl)}). Er is geen timer.`;
  return '<b>Tijd:</b> er is geen tijdslimiet.';
}
function renderStartRegels() {
  const i = _startInfo, soort = startSoort();
  const badge = document.getElementById('start-type-badge');
  if (badge) { badge.textContent = soort.toUpperCase(); badge.classList.toggle('taak', soort === 'taak'); }
  const ico = document.getElementById('start-ico'); if (ico) ico.textContent = soort === 'taak' ? '📋' : '📝';
  document.title = 'PyCodeFlow — ' + (soort === 'taak' ? 'Taak' : 'Toets');
  const naam = document.getElementById('start-session-name');
  if (naam && urlName) naam.textContent = (i && i.name) || (soort === 'taak' ? 'Taak' : 'Toets');
  const lijst = document.getElementById('start-regels-lijst'); if (!lijst) return;
  if (!i) { lijst.innerHTML = '<div class="regel let"><div class="i">⚠️</div><div>De regels konden niet geladen worden. Ververs de pagina.</div></div>'; return; }
  const r = [];   // [klasse, icoon, html]
  r.push(['let', '⏱', (i.heropendTot && Number(i.heropendTot) > Date.now())
    ? `<b>Heropend door je leerkracht:</b> je kan verder werken tot <b>${formatIndienOp(i.heropendTot)}</b>. Je vorige antwoorden staan nog klaar.`
    : startTijdTekst()]);
  const volledig = i.fullscreenRequired !== false && fullscreenMogelijk();
  if (i.tabSwitchEnabled) {
    const sec = typeof i.tabSwitchGraceSeconds === 'number' ? i.tabSwitchGraceSeconds : 5;
    const wat = volledig ? 'Volledig scherm is verplicht. ' : '';
    r.push(['streng', '🖥️', `<b>${wat}Verlaat je het volledig scherm of wissel je van tabblad of venster</b>, dan ${sec > 0 ? `heb je <b>${sec} seconden</b> om terug te keren, anders wordt` : 'wordt'} je ${soort} <b>automatisch ingediend</b>${sec > 0 ? '' : ' (je krijgt geen respijt)'}.`]);
  } else if (volledig) {
    r.push(['streng', '🖥️', `<b>Volledig scherm is verplicht.</b> Je kan dat scherm enkel verlaten door in te dienen.`]);
  }
  if (i.copyPasteBlocked !== false) r.push(['streng', '🚫', '<b>Kopiëren, knippen en plakken is niet toegestaan.</b> Pogingen worden gelogd.']);
  r.push(['let', '↩', i.noBack ? '<b>Eén kans per vraag:</b> ga je naar de volgende vraag, dan kan je niet meer terug.' : 'Je kan tussen de vragen heen en weer bladeren en je antwoorden aanpassen.']);
  const info = [];
  if (i.questionCount) info.push(`<b>${i.questionCount} vragen</b>${i.randomize === false ? '' : ', in een willekeurige volgorde'}`);
  if (i.heeftCodevragen && i.minRunsPerQ > 0) info.push(`bij codevragen moet je je code minstens <b>${i.minRunsPerQ} keer uitvoeren</b>`);
  if (i.heeftMeerkeuze && i.mcScoring === 'gedeeld') info.push('bij meerkeuze met meerdere juiste antwoorden <b>kost een fout aangeduid antwoord punten</b>');
  if (info.length) r.push(['info', '📋', info.join('; ').replace(/^./, c => c) + '.']);
  if (i.heeftCursus) r.push(['info', '📚', 'De <b>cursus</b> kan je zelf openen in de ' + soort + ' (cursus-paneel), omdat die bij de vragen gelinkt is.']);
  r.push(['info', '👁', '<b>Wat je leerkracht ziet:</b> je voortgang, je antwoorden, tabwissels en gelogde pogingen' + (i.liveScreenshotSec > 0 ? `, en om de ${i.liveScreenshotSec} seconden een klein schermbeeld van deze ${soort}pagina (nooit van andere programma's)` : '') + '. Je antwoorden worden automatisch bewaard.']);
  lijst.innerHTML = r.map(([k, ic, t]) => `<div class="regel ${k}"><div class="i">${ic}</div><div>${t}</div></div>`).join('');
  document.getElementById('start-fraude')?.classList.toggle('hidden', !(i.tabSwitchEnabled || volledig));
  updateStartKnop();
}
document.getElementById('start-akkoord')?.addEventListener('change', updateStartKnop);
setInterval(() => { if (_startInfo && document.getElementById('start-screen')?.style.display !== 'none' && !_startBezig) { const l = document.getElementById('start-regels-lijst'); if (l && l.firstElementChild && !document.getElementById('start-akkoord')?.matches(':focus')) renderStartRegels(); } }, 30000);
updateStartKnop();

// ── v122: anti-fraude ───────────────────────────────────────────────────────
// Logboek: elke poging gaat (met een korte rem per type) naar de server, zodat de leerkracht
// achteraf per leerling ziet wat er gebeurde. Werkt ook vóór de start.
const _incidentLaatst = {};
function meldIncident(type, detail, opties) {
  try {
    const nu = Date.now();
    if (!(opties && opties.geenRem)) {
      if (_incidentLaatst[type] && nu - _incidentLaatst[type] < 1500) return;
      _incidentLaatst[type] = nu;
    }
    socket.emit('quiz_incident', { code: urlCode, name: urlName, type, detail: detail || '' });
  } catch (e) { /* loggen mag de toets nooit storen */ }
}

// Tweede scherm: window.screen.isExtended (Chrome/Edge). Een gespiegeld scherm of een browser
// zonder deze eigenschap (Firefox/Safari) kunnen we niet zien — dan gaat de toets gewoon open.
function tweedeSchermActief() {
  try { return window.screen && window.screen.isExtended === true; } catch (e) { return false; }
}

// Klembord leegmaken (enkel het laatste item; de geschiedenis van het toestel blijft buiten bereik).
function wisKlembord() {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText('').catch(() => {});
  } catch (e) { /* geen toestemming of geen focus: stil negeren */ }
}

let _tweedeSchermBewaakt = false;
let _tweedeSchermGemeld = false;
function toonTweedeSchermOverlay(tonen) {
  let el = document.getElementById('tweede-scherm-overlay');
  if (!el) {
    if (!tonen) return;
    el = document.createElement('div');
    el.id = 'tweede-scherm-overlay';
    el.setAttribute('role', 'alertdialog');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0f172a;color:#fff;display:none;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;';
    el.innerHTML = '<h2 style="margin:0;font-size:1.5rem;">🖥️ Tweede scherm gedetecteerd</h2>' +
      '<p style="max-width:520px;margin:0;font-size:1.05rem;">Koppel het tweede scherm los. Je toets blijft verborgen tot dat gebeurd is. Dit is gelogd.</p>';
    document.body.appendChild(el);
  }
  el.style.display = tonen ? 'flex' : 'none';
}
function controleerTweedeScherm() {
  if (!_fullscreenRequired || _afgesloten || !_state) return;
  if (tweedeSchermActief()) {
    toonTweedeSchermOverlay(true);
    if (!_tweedeSchermGemeld) { _tweedeSchermGemeld = true; meldIncident('tweede_scherm'); }
  } else {
    _tweedeSchermGemeld = false;
    toonTweedeSchermOverlay(false);
  }
}
function zetTweedeSchermBewakingAan() {
  if (_tweedeSchermBewaakt) return;
  _tweedeSchermBewaakt = true;
  try { window.screen.addEventListener('change', controleerTweedeScherm); } catch (e) { /* niet ondersteund */ }
  setInterval(controleerTweedeScherm, 1500);
  controleerTweedeScherm();
}

async function startQuiz() {
  const soort = _startInfo?.type === 'taak' ? 'taak' : 'toets';
  // v122: met een tweede scherm gaat de toets/taak niet open (en dat wordt gelogd).
  if (_startInfo?.fullscreenRequired !== false && tweedeSchermActief()) {
    meldIncident('tweede_scherm_start');
    await window.pyAlert(`Er is een tweede scherm aangesloten. Koppel het los en probeer opnieuw: de ${soort} gaat niet open zolang er een tweede scherm is. Dit is gelogd.`, 'warn');
    return;
  }
  // v148: de regels en het verplichte akkoord staan op het startscherm zelf; de knop is pas actief na het vinkje.
  if (!document.getElementById('start-akkoord')?.checked) { updateStartKnop(); return; }
  meldIncident('startbevestiging', JSON.stringify({ vinkje: true, soort }));   // gelogd, bij toets én taak
  _doeStart();
}

function _doeStart() {
  _startBezig = true;
  const btn = document.getElementById('start-knop');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Bezig met laden…'; }
  const info = document.getElementById('start-info');
  if (info) { info.textContent = 'Bezig met laden…'; info.style.color = ''; info.style.fontWeight = ''; }
  _clearStartTimeout();
  _startTimeout = setTimeout(function() {
    _showStartError('De toets laadt niet. Ververs de pagina of controleer met je leerkracht dat de toets openstaat.');
  }, 10000);
  // Sprint 83: fullscreen ALTIJD bij een toets — moet gebeuren binnen dezelfde
  // gebruikersactie (de klik die de bevestiging sloot), anders weigert de browser het.
  if (_startInfo?.fullscreenRequired !== false) vraagVolledigScherm();
  socket.emit('quiz_start', { code: urlCode, name: urlName, className: urlClass });
}

// ── v143: vergrendelscherm bij terugkeer ────────────────────────────────────────
// Een webpagina kan een leerling niet terughalen uit een ander tabblad of programma. Wat wél kan:
// zodra hij terugkomt, blijft de toets verborgen tot hij bewust op "Doorgaan" klikt (en terug in volledig
// scherm gaat). De afwezigheid wordt gemeten en gelogd.
let _terugkeerAan = false;
let _wegSinds = null;
function formatWegDuur(sec) {
  if (sec < 60) return sec + ' s';
  return Math.floor(sec / 60) + ' min ' + String(sec % 60).padStart(2, '0') + ' s';
}
function toonTerugkeerOverlay(sec) {
  const el = document.getElementById('terugkeer-overlay');
  if (!el) return;
  const t = document.getElementById('terugkeer-duur');
  if (t) t.textContent = formatWegDuur(sec);
  el.classList.add('visible');
}
function sluitTerugkeerOverlay() {
  const el = document.getElementById('terugkeer-overlay');
  if (el) el.classList.remove('visible');
  if (_fullscreenRequired) vraagVolledigScherm();
}
let _diagnose = null;
let _terugkeerTijd = 0;     // v144: tijdstip van de laatste terugkeer (voor "wijziging kort na terugkeer")
let _wegDiag = null;
function zetTerugkeerVergrendelingAan() {
  if (_terugkeerAan) return;
  _terugkeerAan = true;
  // v144: wat gebeurde er vlak vóór het weggaan? (systeemtoetsen, muisrand, gebeurtenis) — zie tabdiagnose.js
  try { if (window.TabDiagnose) _diagnose = window.TabDiagnose.maakDiagnose(window); } catch (e) { _diagnose = null; }
  const weg = (gebeurtenis) => {
    if (_afgesloten || !_state) return;
    if (_wegSinds) return;
    _wegSinds = Date.now();
    _wegDiag = null;
    try { _wegDiag = _diagnose ? _diagnose.snapshot(gebeurtenis) : null; } catch (e) { _wegDiag = null; }
    // Meteen melden: wordt de leerling bij deze wissel automatisch ingediend, dan komt er geen terugkeer meer.
    meldIncident('weg_van_toets', JSON.stringify(Object.assign({ q: _currentQuestionId || null, fase: 'weg' }, _wegDiag || {})), { geenRem: true });
  };
  const terug = () => {
    if (_afgesloten || !_state || !_wegSinds) return;
    const sec = Math.round((Date.now() - _wegSinds) / 1000);
    _wegSinds = null;
    if (sec < 1) return;
    _terugkeerTijd = Date.now();
    toonTerugkeerOverlay(sec);
    meldIncident('weg_van_toets', JSON.stringify(Object.assign({ q: _currentQuestionId || null, fase: 'terug', secs: sec }, _wegDiag || {})), { geenRem: true });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) weg('visibilitychange'); else terug(); });
  window.addEventListener('blur', () => {
    // een klik in het cursus-zijpaneel (iframe) haalt de focus ook weg van het venster
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.tagName === 'IFRAME') return;
      if (!document.hasFocus()) weg('blur');
    }, 0);
  });
  window.addEventListener('focus', terug);
}


// ── v144: extra fraudesignalen ───────────────────────────────────────────────────
// Alles hieronder logt enkel (nooit blokkeren of de leerling storen); de leerkracht beoordeelt achteraf.
const GROTE_INVOER_MIN = 60;       // tekens in één wijziging zonder plakpoging
const NA_TERUGKEER_MIN = 40;       // tekens, binnen 20 s na terugkeer
const WEINIG_TOETSEN_MIN = 150;    // toegevoegde tekens in één vraag vooraleer "weinig toetsaanslagen" telt
let _vraagBasis = { qid: null, len: 0, keys: 0 };
let _vorigeEditorTekst = null;

function antwoordLengte() {
  let n = (getCurrentCode() || '').length;
  const ta = document.getElementById('quiz-open-answer');
  if (ta && ta.offsetParent !== null) n += (ta.value || '').length;
  return n;
}
function startVraagBewaking(qid) {
  _vraagBasis = { qid, len: 0, keys: 0 };
  _vorigeEditorTekst = null;
  // pas nadat de editor zijn inhoud kreeg
  setTimeout(() => {
    if (_currentQuestionId !== qid) return;
    _vraagBasis.len = antwoordLengte();
    _vorigeEditorTekst = getCurrentCode() || '';
  }, 400);
}
// Het stuk tekst dat erbij kwam (gemeenschappelijk begin en einde weglaten).
function ingevoegdStuk(oud, nieuw) {
  let i = 0;
  const max = Math.min(oud.length, nieuw.length);
  while (i < max && oud[i] === nieuw[i]) i++;
  let j = 0;
  while (j < max - i && oud[oud.length - 1 - j] === nieuw[nieuw.length - 1 - j]) j++;
  return nieuw.slice(i, nieuw.length - j);
}
function verwerkInvoerWijziging(oud, nieuw) {
  if (!_state || _afgesloten || oud == null) return;
  const delta = nieuw.length - oud.length;
  if (delta < NA_TERUGKEER_MIN) return;
  if (Date.now() - _laatstePlakPoging < 2000) return;       // al gelogd als plakpoging
  const stuk = ingevoegdStuk(oud, nieuw);
  const basis = { q: _currentQuestionId || null, delta, tekst: stuk.slice(0, 300) };
  if (_terugkeerTijd && Date.now() - _terugkeerTijd < 20000) {
    meldIncident('wijziging_na_terugkeer', JSON.stringify(Object.assign({ secs: Math.round((Date.now() - _terugkeerTijd) / 1000) }, basis)), { geenRem: true });
  }
  if (delta >= GROTE_INVOER_MIN) meldIncident('grote_invoer', JSON.stringify(basis), { geenRem: true });
}
function controleerWeinigToetsen() {
  try {
    if (!_state || _afgesloten || !_vraagBasis.qid || _vraagBasis.qid !== _currentQuestionId) return;
    const delta = antwoordLengte() - _vraagBasis.len;
    if (delta >= WEINIG_TOETSEN_MIN && _vraagBasis.keys * 8 < delta) {
      meldIncident('weinig_toetsen', JSON.stringify({ q: _currentQuestionId, len: delta, keys: _vraagBasis.keys }), { geenRem: true });
    }
    _vraagBasis.len = antwoordLengte();   // enkel het nieuwe stuk telt voor de volgende controle
    _vraagBasis.keys = 0;
  } catch (e) { /* loggen mag nooit storen */ }
}

const SNELTOETS_REGELS = [
  [(e) => e.key === 'PrintScreen', 'PrintScreen'],
  [(e) => e.key === 'F12', 'F12'],
  [(e, k) => (e.ctrlKey || e.metaKey) && e.shiftKey && k === 'i', 'Ctrl+Shift+I'],
  [(e, k) => (e.ctrlKey || e.metaKey) && e.shiftKey && k === 'j', 'Ctrl+Shift+J'],
  [(e, k) => (e.ctrlKey || e.metaKey) && e.shiftKey && k === 'c', 'Ctrl+Shift+C'],
  [(e, k) => (e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'u', 'Ctrl+U'],
  [(e, k) => (e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'p', 'Ctrl+P'],
  [(e, k) => (e.ctrlKey || e.metaKey) && !e.shiftKey && k === 's', 'Ctrl+S'],
];
let _extraBewakingAan = false;
function zetExtraFraudeBewakingAan() {
  if (_extraBewakingAan) return;
  _extraBewakingAan = true;
  // typen tellen (enkel aantallen, nooit welke toets)
  document.addEventListener('keydown', (e) => {
    if (!_state || _afgesloten) return;
    const k = (e.key || '').toLowerCase();
    if (e.key && (e.key.length === 1 || k === 'enter' || k === 'backspace' || k === 'delete' || k === 'tab') && !(e.ctrlKey || e.metaKey)) _vraagBasis.keys++;
    for (const [test, naam] of SNELTOETS_REGELS) {
      if (test(e, k)) {
        if (/^Ctrl\+[PSU]$/.test(naam)) e.preventDefault();
        meldIncident('sneltoets', JSON.stringify({ q: _currentQuestionId || null, toets: naam }), { geenRem: true });
        break;
      }
    }
  }, true);
  // gewone tekstvelden (open antwoord, samengestelde onderdelen)
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'TEXTAREA' || (t.closest && t.closest('.monaco-editor'))) return;
    const oud = t._pcfVorige;
    t._pcfVorige = t.value;
    if (oud != null) verwerkInvoerWijziging(oud, t.value);
  }, true);
  // venster plots veel kleiner (split-screen, verkleind venster naast een ander programma)
  let basisW = window.innerWidth, basisH = window.innerHeight, gemeld = false;
  window.addEventListener('resize', () => {
    if (!_state || _afgesloten) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (w * h > basisW * basisH) { basisW = w; basisH = h; gemeld = false; return; }
    if (!gemeld && w * h < basisW * basisH * 0.7) {
      gemeld = true;
      meldIncident('venster_kleiner', JSON.stringify({ q: _currentQuestionId || null, w, h, basisW, basisH }), { geenRem: true });
    } else if (w * h >= basisW * basisH * 0.9) gemeld = false;
  });
}


// ── v145: schermafbeelding voor het live-overzicht van de leerkracht ──────────────
// De server zegt "aan" zolang de leerkracht het live-overzicht open heeft en "uit" zodra het sluit.
// Er wordt enkel een klein JPEG-beeld (~320 px breed) van DEZE toetspagina gemaakt, nooit van iets anders.
let _beeldTimer = null;
let _beeldBezig = false;
let _h2cLaden = null;
const BEELD_BREEDTE = 320;
function laadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(true);
  if (_h2cLaden) return _h2cLaden;
  _h2cLaden = new Promise((res) => {
    // De Monaco-lader (AMD) staat al op de pagina: zonder dit zou html2canvas zich als AMD-module
    // aanmelden i.p.v. als window.html2canvas. Daarom 'define' even wegzetten tijdens het laden.
    const oudDefine = window.define;
    const herstel = () => { try { window.define = oudDefine; } catch (e) { /* niets */ } };
    try { window.define = undefined; } catch (e) { /* niets */ }
    const sc = document.createElement('script');
    sc.src = '/vendor/html2canvas/html2canvas.min.js';
    sc.onload = () => { herstel(); res(!!window.html2canvas); };
    sc.onerror = () => { herstel(); res(false); };
    document.head.appendChild(sc);
  });
  return _h2cLaden;
}
// Terugval als de beeldbibliotheek niet laadt of faalt: een eenvoudig "scherm" met vraag en begin van de code.
function maakTerugvalBeeld() {
  const cv = document.createElement('canvas');
  cv.width = BEELD_BREEDTE; cv.height = 200;
  const g = cv.getContext('2d');
  g.fillStyle = '#0f172a'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#93c5fd'; g.font = 'bold 12px sans-serif';
  const totaal = (_state && _state.questions && _state.questions.length) || '?';
  g.fillText(`Vraag ${_currentIdx + 1} van ${totaal}`, 8, 16);
  g.fillStyle = '#e2e8f0'; g.font = '10px monospace';
  const tekst = (getCurrentCode() || (document.getElementById('quiz-open-answer') || {}).value || '').split('\n').slice(0, 14);
  tekst.forEach((r, i) => g.fillText(r.slice(0, 52), 8, 34 + i * 12));
  return cv;
}
async function maakLiveBeeld() {
  if (_beeldBezig || !_state || _afgesloten || document.hidden) return;
  _beeldBezig = true;
  try {
    let cv = null;
    if (await laadHtml2canvas()) {
      try {
        cv = await window.html2canvas(document.body, {
          scale: BEELD_BREEDTE / Math.max(320, window.innerWidth),
          width: window.innerWidth, height: window.innerHeight,
          x: window.scrollX, y: window.scrollY, scrollX: 0, scrollY: 0,
          logging: false, useCORS: false, backgroundColor: '#ffffff',
          ignoreElements: (el) => el && el.tagName === 'IFRAME',
        });
      } catch (e) { cv = null; }
    }
    if (!cv) cv = maakTerugvalBeeld();
    let img = cv.toDataURL('image/jpeg', 0.5);
    if (img.length > 140000) img = cv.toDataURL('image/jpeg', 0.3);
    if (img.length <= 150000) socket.emit('quiz_screenshot', { img });
  } catch (e) { /* een beeld mag de toets nooit storen */ }
  finally { _beeldBezig = false; }
}
function stopLiveBeeld() { clearInterval(_beeldTimer); _beeldTimer = null; }
socket.on('quiz_screenshot_aan', ({ intervalSec } = {}) => {
  stopLiveBeeld();
  const sec = Math.max(5, Math.min(300, Number(intervalSec) || 30));
  setTimeout(maakLiveBeeld, 1500);
  _beeldTimer = setInterval(maakLiveBeeld, sec * 1000);
});
socket.on('quiz_screenshot_uit', stopLiveBeeld);

// ── v143: dezelfde toets in twee tabbladen ───────────────────────────────────────
// De server weigert een tweede verbinding al; dit merkt het vóór het starten, op onze eigen site.
function zetDubbelTabbladBewakingAan() {
  try {
    if (typeof BroadcastChannel === 'undefined' || !urlCode || !urlName) return;
    const kanaal = new BroadcastChannel('pcf-toets-' + String(urlCode).toUpperCase() + '-' + String(urlName).trim().toLowerCase());
    kanaal.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'hallo' && _state && !_afgesloten) kanaal.postMessage({ type: 'bezet' });
      if (m.type === 'bezet' && !_state && !_dubbelGemeld) {
        _dubbelGemeld = true;
        const el = document.getElementById('dubbel-overlay');
        if (el) el.classList.add('visible');
        meldIncident('dubbel_tabblad', JSON.stringify({ fase: 'voor_start' }));
      }
    };
    kanaal.postMessage({ type: 'hallo' });
  } catch (e) { /* niet ondersteund: de server blijft dit controleren */ }
}
let _dubbelGemeld = false;
zetDubbelTabbladBewakingAan();

// ── Sprint 83: anti-spiek — volledig scherm, tabwissel-detectie, cursus-paneel ──
function fullscreenMogelijk() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
}

// v113: zolang volledig scherm verplicht is, blokkeert een scherm alles tot de leerling
// terugkeert (de klik op de knop is de vereiste gebruikersactie). Indienen sluit het scherm
// zelf (_afgesloten + exitFullscreen), dus dat is de enige uitweg. Een browser laat Esc altijd
// toe; daarom blokkeren we hier de inhoud i.p.v. Esc zelf.
let _fsVergrendelingAan = false;
function updateFullscreenVergrendeling() {
  const el = document.getElementById('fullscreen-overlay');
  if (!el) return;
  const blokkeer = _fullscreenRequired && fullscreenMogelijk() && !_afgesloten && !document.fullscreenElement && !document.webkitFullscreenElement;
  if (blokkeer && !el.classList.contains('visible') && _state) meldIncident('fullscreen_uit');  // v122
  el.classList.toggle('visible', blokkeer);
}
function zetFullscreenVergrendelingAan() {
  if (_fsVergrendelingAan) return;
  _fsVergrendelingAan = true;
  document.addEventListener('fullscreenchange', updateFullscreenVergrendeling);
  document.addEventListener('webkitfullscreenchange', updateFullscreenVergrendeling);
}

// v113: kopiëren/plakken/knippen/slepen en het rechtsklikmenu uit, ook in de code-editor
// (capture-fase, vóór de editor het event te zien krijgt).
let _kopieerBlokAan = false;

// v144: wat probeerde de leerling te plakken/kopiëren? Het geblokkeerde stuk tekst wordt (max. 500 tekens)
// samen met de vraag en de lengte in het logboek gezet; dezelfde poging binnen 3 s telt één keer.
const _blokkadeLaatst = {};
let _laatstePlakPoging = 0;
function huidigeSelectieTekst(e) {
  try {
    const t = e && e.target;
    if (t && typeof t.value === 'string' && Number.isFinite(t.selectionStart) && t.selectionEnd > t.selectionStart) {
      return t.value.slice(t.selectionStart, t.selectionEnd);
    }
    return (window.getSelection && window.getSelection().toString()) || '';
  } catch (err) { return ''; }
}
function meldBlokkade(type, tekst, via) {
  if (!_state || _afgesloten) return;
  const t = String(tekst == null ? '' : tekst);
  if (type === 'plakken' || type === 'slepen') _laatstePlakPoging = Date.now();
  const sleutel = type + '|' + (_currentQuestionId || '') + '|' + t.slice(0, 80);
  const nu = Date.now();
  if (_blokkadeLaatst[sleutel] && nu - _blokkadeLaatst[sleutel] < 3000) return;
  _blokkadeLaatst[sleutel] = nu;
  const d = { q: _currentQuestionId || null, len: t.length };
  if (t) d.tekst = t.slice(0, 500);
  if (via) d.via = via;
  meldIncident(type, JSON.stringify(d), { geenRem: true });
}

// Ctrl+V / Shift+Insert: de toets zelf blokkeren geeft geen paste-event, dus ook geen tekst. Daarom wordt de
// focus heel even naar een onzichtbaar tekstveld verplaatst: de browser plakt daar, wij lezen de tekst
// en blokkeren. Komt er toch geen paste-event, dan wordt de poging zonder tekst gelogd.
let _plakProbe = null;
function sluitPlakProbe(tekstGelezen) {
  const pr = _plakProbe;
  if (!pr) return;
  _plakProbe = null;
  clearTimeout(pr.timer);
  try { pr.ta.remove(); } catch (err) { /* al weg */ }
  try { if (pr.prev && pr.prev.focus) pr.prev.focus(); } catch (err) { /* focus herstellen mag falen */ }
  if (!tekstGelezen) meldBlokkade('plakken', '', 'toets');
}
function startPlakProbe() {
  if (_plakProbe) return;
  const prev = document.activeElement;
  const ta = document.createElement('textarea');
  ta.setAttribute('aria-hidden', 'true');
  ta.tabIndex = -1;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  _plakProbe = { ta, prev, timer: setTimeout(() => sluitPlakProbe(false), 400) };
}

function zetKopieerBlokAan() {
  const kopieerKnop = document.getElementById('quiz-copy-code-btn');
  if (kopieerKnop) kopieerKnop.style.display = _copyPasteBlocked ? 'none' : '';
  if (_kopieerBlokAan) return;
  _kopieerBlokAan = true;
  const incidentVoor = { copy: 'kopieren', cut: 'knippen', paste: 'plakken', drop: 'slepen', dragstart: 'slepen' };
  const stop = (e) => {
    if (!_copyPasteBlocked) return;
    e.preventDefault(); e.stopPropagation();
    const type = incidentVoor[e.type];
    if (!type || !_state || _afgesloten) { if (e.type === 'paste') sluitPlakProbe(true); return; }
    let tekst = '';
    try {
      if (e.type === 'paste') tekst = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      else if (e.type === 'drop') tekst = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
      else tekst = huidigeSelectieTekst(e);
    } catch (err) { tekst = ''; }
    meldBlokkade(type, tekst);
    if (e.type === 'paste') sluitPlakProbe(true);
  };
  for (const ev of ['copy', 'cut', 'paste', 'drop', 'dragstart', 'contextmenu']) {
    document.addEventListener(ev, stop, true);
  }
  // v122: ook invoer via plakken/slepen die zonder paste-event binnenkomt (autocorrectie, IME, ...).
  document.addEventListener('beforeinput', (e) => {
    if (!_copyPasteBlocked) return;
    if (/^insertFrom(Paste|Drop|Yank)/.test(e.inputType || '')) {
      e.preventDefault(); e.stopPropagation();
      let tekst = '';
      try { tekst = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || e.data || ''; } catch (err) { /* geen tekst */ }
      meldBlokkade(/Drop/.test(e.inputType) ? 'slepen' : 'plakken', tekst);
    }
  }, true);
  // Het klembord leeg bij terugkeer in het venster.
  window.addEventListener('focus', () => { if (_copyPasteBlocked && _state && !_afgesloten) wisKlembord(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _copyPasteBlocked && _state && !_afgesloten) wisKlembord();
  });
  document.addEventListener('keydown', (e) => {
    if (!_copyPasteBlocked) return;
    const k = (e.key || '').toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const isPlak = (ctrl && k === 'v') || (e.shiftKey && k === 'insert');
    const isKopie = (ctrl && (k === 'c' || k === 'insert')) || false;
    const isKnip = (ctrl && k === 'x') || (e.shiftKey && k === 'delete');
    if (isPlak) {
      // geen preventDefault: het paste-event moet nog gebeuren (in het onzichtbare veld), daar blokkeren we het.
      e.stopPropagation();
      if (_state && !_afgesloten) startPlakProbe(); else e.preventDefault();
    } else if (isKopie || isKnip) {
      // het copy/cut-event volgt en wordt hierboven geblokkeerd (met de geselecteerde tekst).
      e.stopPropagation();
      if (!_state || _afgesloten) e.preventDefault();
    }
  }, true);
}

function vraagVolledigScherm() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!req) return;
  try { req.call(el).catch(() => { /* stil: browser kan weigeren zonder verse gebruikersactie */ }); }
  catch (e) { /* sommige browsers gooien synchroon i.p.v. een Promise te weigeren */ }
}

// Sprint 92: "je zou een soort timer op de waarschuwing moeten zetten — als de leerling
// binnen de 5 sec terugkeert gebeurt er niets, anders telt het pas als een wissel." Voorheen
// telde ELKE wissel/fullscreen-exit ONMIDDELLIJK mee (bij de standaard drempel van 1 dus
// meteen automatisch ingeleverd) — een klik ernaast, een per ongeluk ingedrukte toets, of een
// kort openspringend venster had al hetzelfde gevolg als bewust spieken. Nu krijgt de
// leerling eerst 5 seconden respijt: keert hij op tijd terug (tabblad weer zichtbaar, venster
// terug in beeld, volledig scherm hersteld), dan wordt er HELEMAAL NIETS gemeld aan de
// server — geen telling, geen enkel spoor. Pas als hij niet op tijd terugkeert, wordt de
// wissel alsnog (en pas dan) doorgegeven, exact zoals voorheen.
// Sprint 94: was een vaste 5000ms — nu instelbaar per toets (server.js/quiz_state levert
// tabSwitchGraceSeconds, standaard 5 als die er om een of andere reden niet zou zijn).
let _tabWisselRespijtMs = 5000;
let _tabWisselTimer = null;            // actieve aftel-setTimeout (null = geen respijt bezig)
let _tabWisselCountdownInterval = null;
let _tabWisselDeadline = 0;

function toonTabwisselOverlay(tonen) {
  const el = document.getElementById('tabwissel-overlay');
  if (el) el.classList.toggle('visible', tonen);
}

function updateTabwisselAftelling() {
  const el = document.getElementById('tabwissel-aftellen');
  if (!el) return;
  el.textContent = String(Math.max(0, Math.ceil((_tabWisselDeadline - Date.now()) / 1000)));
}

// Ruimt de lopende respijtperiode volledig op — zonder ooit iets aan de server te melden.
// Wordt aangeroepen zodra de leerling (op tijd) terugkeert.
function annuleerTabwisselRespijt() {
  if (!_tabWisselTimer) return;
  clearTimeout(_tabWisselTimer);
  _tabWisselTimer = null;
  clearInterval(_tabWisselCountdownInterval);
  _tabWisselCountdownInterval = null;
  toonTabwisselOverlay(false);
}

function meldMogelijkeWissel() {
  if (!_tabSwitchEnabled || _afgesloten || !_state) return;  // v114: toets én taak, enkel als auto-indienen aan staat
  // Een respijtperiode loopt al (meerdere gelijktijdige events — blur + visibilitychange +
  // fullscreenchange — voor dezelfde fysieke actie) → niet nogmaals starten.
  if (_tabWisselTimer) return;

  // Sprint 94: 0 sec ingesteld → geen respijt, meteen melden (overlay dan ook niet nodig).
  if (_tabWisselRespijtMs <= 0) {
    socket.emit('quiz_tab_switch', { code: _sessionCode || urlCode });
    return;
  }

  _tabWisselDeadline = Date.now() + _tabWisselRespijtMs;
  toonTabwisselOverlay(true); // enkel zichtbaar als de pagina zelf nog in beeld is
  updateTabwisselAftelling();
  _tabWisselCountdownInterval = setInterval(updateTabwisselAftelling, 250);

  _tabWisselTimer = setTimeout(() => {
    _tabWisselTimer = null;
    clearInterval(_tabWisselCountdownInterval);
    _tabWisselCountdownInterval = null;
    toonTabwisselOverlay(false);
    if (_afgesloten) return; // ondertussen al op een andere manier afgesloten
    // Niet op tijd teruggekeerd → nu pas telt dit écht mee, exact zoals voorheen.
    socket.emit('quiz_tab_switch', { code: _sessionCode || urlCode });
  }, _tabWisselRespijtMs);
}

function zetTabWisselDetectieAan() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) meldMogelijkeWissel(); else annuleerTabwisselRespijt();
  });
  window.addEventListener('blur', meldMogelijkeWissel);
  window.addEventListener('focus', annuleerTabwisselRespijt);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) meldMogelijkeWissel(); else annuleerTabwisselRespijt();
  });
}

// ── v99: klasbord — hand opsteken + tab-verlaten-signaal ─────────────────────
// De status leeft op de server: een herlaad laat een opgestoken hand dus staan
// (quiz_state geeft handUp mee). De knop is een wisselknop; de leerkracht kan de hand
// ook via het bord laten zakken (quiz_hand_lowered).
let _handUp = false;
function toonHandKnop() {
  const b = document.getElementById('hand-btn');
  if (!b) return;
  b.textContent = _handUp ? '✋ Hand omlaag' : '✋ Hand opsteken';
  b.classList.toggle('hand-op', _handUp);
  b.setAttribute('aria-pressed', _handUp ? 'true' : 'false');
}
function zetHandKnopOp(actief, handUp) {
  const b = document.getElementById('hand-btn');
  if (!b) return;
  _handUp = handUp === true;
  b.style.display = actief ? '' : 'none';
  toonHandKnop();
  if (b.dataset.gekoppeld === '1') return;
  b.dataset.gekoppeld = '1';
  b.addEventListener('click', () => {
    if (_afgesloten) return;
    const nieuw = !_handUp;
    b.disabled = true;
    socket.timeout(4000).emit('quiz_hand', { up: nieuw }, (err, res) => {
      b.disabled = false;
      if (err || !res || res.ok !== true) return; // niet gelukt → knop blijft zoals hij was
      _handUp = res.handUp === true;
      toonHandKnop();
    });
  });
}
socket.on('quiz_hand_lowered', () => { _handUp = false; toonHandKnop(); });

// Tab/venster verlaten → meteen een signaal voor het klasbord (rood), los van het
// anti-spiek-respijt en -auto-indienen hierboven.
let _bordFocusAan = false;
let _bordWeg = false;
function zetBordFocusSignaalAan() {
  if (_bordFocusAan) return;
  _bordFocusAan = true;
  const meld = (weg) => {
    if (_afgesloten || weg === _bordWeg) return;
    _bordWeg = weg;
    socket.emit('quiz_focus', { away: weg });
  };
  document.addEventListener('visibilitychange', () => meld(document.hidden));
  window.addEventListener('blur', () => {
    // een klik in het cursus-zijpaneel (iframe) haalt de focus ook weg van het venster,
    // maar de leerling is dan nog gewoon in de toets
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.tagName === 'IFRAME') return;
      if (!document.hasFocus()) meld(true);
    }, 0);
  });
  window.addEventListener('focus', () => meld(false));
  document.addEventListener('fullscreenchange', () => meld(!document.fullscreenElement));
}

// v132: cursus-links per vraag. De server stuurt [{title, url, vragen:[vraag-id's]}]; per vraag tonen
// we enkel de links die erbij horen. Geen link bij de vraag = geen knop en een gesloten paneel;
// meerdere links = tabs bovenaan het paneel.
let _cursusLinks = [];
let _cursusActieveUrl = '';
let _cursusGeladenUrl = '';
const CURSUS_GESLOTEN = '-46vw';

function setupCursusPaneel(links) {
  const btn = document.getElementById('cursus-toggle-btn');
  const panel = document.getElementById('cursus-panel');
  const closeBtn = document.getElementById('cursus-close-btn');
  if (!btn || !panel) return;
  _cursusLinks = Array.isArray(links) ? links : [];
  const toggle = () => { panel.style.right = panel.style.right === '0px' ? CURSUS_GESLOTEN : '0px'; };
  btn.onclick = toggle;
  if (closeBtn) closeBtn.onclick = () => { panel.style.right = CURSUS_GESLOTEN; };
  updateCursusVoorVraag(_currentQuestionId);
}

function updateCursusVoorVraag(qid) {
  const btn = document.getElementById('cursus-toggle-btn');
  const panel = document.getElementById('cursus-panel');
  const iframe = document.getElementById('cursus-iframe');
  const tabs = document.getElementById('cursus-tabs');
  if (!btn || !panel || !iframe) return;
  const lijst = _cursusLinks.filter(l => Array.isArray(l.vragen) && l.vragen.includes(qid));
  if (!lijst.length) {
    btn.style.display = 'none';
    panel.style.right = CURSUS_GESLOTEN;
    if (_cursusGeladenUrl) { iframe.src = 'about:blank'; _cursusGeladenUrl = ''; }
    _cursusActieveUrl = '';
    if (tabs) { tabs.style.display = 'none'; tabs.textContent = ''; }
    return;
  }
  btn.style.display = '';
  if (!lijst.some(l => l.url === _cursusActieveUrl)) _cursusActieveUrl = lijst[0].url;
  const toon = (url) => {
    _cursusActieveUrl = url;
    if (url !== _cursusGeladenUrl) { iframe.src = url; _cursusGeladenUrl = url; } // via DOM-property, niet via HTML-string
    renderTabs();
  };
  const renderTabs = () => {
    if (!tabs) return;
    tabs.textContent = '';
    if (lijst.length < 2) { tabs.style.display = 'none'; return; }
    tabs.style.display = 'flex';
    lijst.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cursus-linktab' + (l.url === _cursusActieveUrl ? ' actief' : '');
      b.textContent = l.title || 'Cursus';
      b.title = l.title || 'Cursus';
      b.setAttribute('aria-pressed', l.url === _cursusActieveUrl ? 'true' : 'false');
      b.onclick = () => toon(l.url);
      tabs.appendChild(b);
    });
  };
  toon(_cursusActieveUrl);
}

socket.on('quiz_state', async (state) => {
  _clearStartTimeout();
  _state = state;
  _studentId = state.studentId;
  _sessionCode = urlCode;
  _totalSeconds = state.timerSeconds;
  _noTimer = state.noTimer || false;
  _startedAt = state.startedAt || Date.now();
  _answers = { ...state.savedAnswers };

  // Herstel run counts
  for (const [qid, ans] of Object.entries(_answers)) {
    _runCount[qid] = ans.runCount || 0;
    if (ans.runCount > 0) _visited.add(qid);
  }
  Object.keys(_answers).forEach(id => _visited.add(id));

  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('quiz-screen').style.display = 'block';
  document.getElementById('qs-session-name').textContent = state.sessionName;

  if (state.submitted) {
    // Bugfix (sprint 72): telde voorheen Object.keys(_answers).length — dat telt
    // ELKE bezochte vraag mee (er komt al een antwoord-rij zodra je een vraag
    // opent, ook zonder iets in te vullen), niet enkel de effectief beantwoorde.
    // v105: na indienen stuurt de server geen vragen/antwoorden meer, enkel het aantal.
    const aantalBeantwoord = typeof state.answeredCount === 'number'
      ? state.answeredCount
      : (_state?.questions || []).filter(q => heeftAntwoord(q, _answers[q.id])).length;
    _state.totalQuestions = state.totalQuestions;
    markeerIngediend(true);
    showDoneScreen(state.studentName, aantalBeantwoord, state.totalQuestions);
    return;
  }
  markeerIngediend(false); // v105: wel (opnieuw) open, bv. na een heropening door de leerkracht
  if (state.paused) document.getElementById('pause-overlay').classList.add('visible');

  // Verberg timer bij taken zonder tijdslimiet
  const timerEl = document.getElementById('quiz-timer');
  toonGeenTeller(state.timerModus, state.indienOp);

  // Sprint 83: anti-spiek — pas ná een echte (geauthenticeerde) join, niet al bij de
  // publieke /startinfo. Enkel actief zolang de toets nog loopt (niet al ingediend —
  // de check hierboven op state.submitted heeft dan al return gedaan).
  _isToets = state.type === 'toets';
  _tabSwitchEnabled = state.tabSwitchEnabled === true;
  _tabSwitchThreshold = state.tabSwitchThreshold || 0;
  // Sprint 94: instelbaar respijt (in seconden vanaf de server) — in ms voor de timers hierboven.
  _tabWisselRespijtMs = (typeof state.tabSwitchGraceSeconds === 'number' ? state.tabSwitchGraceSeconds : 5) * 1000;
  _fullscreenRequired = state.fullscreenRequired !== false;
  _copyPasteBlocked = state.copyPasteBlocked !== false;
  if (_fullscreenRequired) vraagVolledigScherm();   // nogmaals proberen (bv. na een herlaad/reconnect)
  zetFullscreenVergrendelingAan();
  updateFullscreenVergrendeling();
  zetKopieerBlokAan();
  if (_copyPasteBlocked) wisKlembord();   // v122
  if (_fullscreenRequired) zetTweedeSchermBewakingAan();   // v122
  if (_tabSwitchEnabled) zetTabWisselDetectieAan();
  if (_isToets && (_fullscreenRequired || _tabSwitchEnabled)) zetTerugkeerVergrendelingAan();   // v143
  zetExtraFraudeBewakingAan();   // v144
  setupCursusPaneel(state.cursusLinks || []);
  // v99: klasbord — hand opsteken (toets altijd, taak met vinkje) + tab-verlaten-signaal (toets)
  zetHandKnopOp(state.klasbordActief === true, state.handUp === true);
  if (_isToets && state.klasbordActief === true) zetBordFocusSignaalAan();

  // Initialiseer editor
  await initQuizEditor(state.config || {});
  renderNav();
  // Sprint 91: hervat op de laatst gekende vraag i.p.v. altijd vraag 1 — voorheen sprong elke
  // (her)verbinding de leerling terug naar het begin, ook als hij al veel verder stond.
  const hervatIdx = Number.isInteger(state.currentQuestion)
    ? Math.max(0, Math.min(state.currentQuestion, (state.questions?.length || 1) - 1))
    : 0;
  _bevestigdeVragen = new Set(state.bevestigdeVragen || []);   // v143
  goToQuestion(hervatIdx, { hervat: true });
  // Sprint 91: alle antwoorden die nog op een bevestiging stonden te wachten (bv. omdat de
  // vorige socket wegviel vóór de ack aankwam) meteen opnieuw aanbieden aan deze — mogelijk
  // pas herstelde — verbinding.
  hervatAlleWachtendeOpslagen();
  startTimer();
});

socket.on('quiz_timer_update', ({ remaining, total }) => {
  updateTimerDisplay(remaining, total);
});

socket.on('quiz_warning', ({ message }) => {
  const b = document.getElementById('warning-banner');
  b.textContent = message;
  b.classList.add('visible');
  setTimeout(() => b.classList.remove('visible'), 30000);
});

// Sprint 70: de leerling moet WETEN dat het systeem (of de leerkracht) heeft afgesloten,
// en dat hij niets meer kan wijzigen. Vroeger sprong hij zonder uitleg naar het
// eindscherm, wat aanvoelde als een fout.
socket.on('quiz_force_submit', (data) => {
  const code = getCurrentCode();
  if (_currentQuestionId) saveCurrentAnswer(code);
  _afgesloten = true;                       // blokkeert verder bewerken en opslaan
  if (typeof updateFullscreenVergrendeling === 'function') updateFullscreenVergrendeling();
  // Bugfix (sprint 72): zelfde telfout als hierboven — enkel effectief beantwoorde
  // vragen meetellen, niet elke bezochte vraag.
  const aantalBeantwoord = (_state?.questions || []).filter(q => heeftAntwoord(q, _answers[q.id])).length;
  showDoneScreen(urlName, aantalBeantwoord);

  const reden = (data && data.reden) || (data && data.reason) || '';
  const tekst =
    reden === 'timer'      ? 'Je tijd is om. Je toets is automatisch ingeleverd met alles wat je tot nu toe hebt gemaakt.'
  : reden === 'deadline'   ? 'De deadline is bereikt. Je werk is automatisch ingeleverd.'
  : reden === 'gestopt'    ? 'Je leerkracht heeft de toets afgesloten. Je werk is ingeleverd zoals het op dit moment was.'
  : reden === 'tab_switch' ? 'Je hebt van tabblad/venster gewisseld of het volledig scherm verlaten tijdens de toets. Je werk is automatisch ingeleverd zoals het op dat moment was.'
  :                          'De toets is afgesloten. Je werk is ingeleverd.';
  window.pyAlert(tekst + ' Je kan niets meer aanpassen.', 'warn');
});

socket.on('quiz_paused', ({ paused }) => {
  document.getElementById('pause-overlay').classList.toggle('visible', paused);
});

socket.on('quiz_reset', () => {
  _answers = {}; _visited.clear(); _runCount = {}; _currentIdx = 0;
  // Sprint 91: geen lopende herprobeer-ketens meenemen naar een teruggezette toets/taak.
  for (const k of Object.keys(_pendingSaves)) delete _pendingSaves[k];
  updateSaveStatusUI();
  document.getElementById('done-screen').classList.remove('visible');
  document.getElementById('submit-screen').classList.remove('visible');
  document.getElementById('start-screen').style.display = 'flex';
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('done-screen').style.display = 'none';
});

// Sprint 79: leerkracht heeft een per ongeluk ingediende toets/taak terug opengezet.
// De reeds ingevulde antwoorden blijven staan (server-side niet gewist) — een simpele
// herlaad haalt de bijgewerkte (niet-ingediende) status + alle bestaande antwoorden
// gewoon terug op via dezelfde weg als een normale (her)verbinding.
socket.on('quiz_reopened', () => {
  window.pyAlert('Je leerkracht heeft je toets/taak terug opengezet — je kan verdergaan.', 'info')
    .then(() => location.reload());
});

// v121: de leerkracht draaide de heropening terug — de oorspronkelijke ingediende versie staat weer.
socket.on('quiz_heropening_teruggedraaid', () => {
  _afgesloten = true;
  window.pyAlert('Je leerkracht heeft de heropening gesloten. Je oorspronkelijke ingediende versie blijft behouden.', 'info')
    .then(() => location.reload());
});

socket.on('quiz_results_released', () => {
  // Leerkracht heeft resultaten vrijgegeven — leerling kan scores bekijken
});

// Sprint 19j: toegangsvenster verlopen
socket.on('quiz_access_expired', ({ deadlineStr, autoSubmitLate }) => {
  _clearStartTimeout();
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('submit-screen').classList.remove('visible');
  document.getElementById('done-screen').style.display = 'none';
  const lateScreen = document.getElementById('late-screen');
  lateScreen.style.display = 'block';
  document.getElementById('late-info').innerHTML =
    `Deadline was: <strong>${deadlineStr}</strong><br/>` +
    (autoSubmitLate ? 'Je antwoorden worden als leeg ingediend.' : 'Neem contact op met je leerkracht.');
});

socket.on('error_message', async (msg) => {
  _clearStartTimeout();
  const text = typeof msg === 'string' ? msg : msg.message || 'Fout';
  // Als we nog op het startscherm staan: toon de fout daar zichtbaar i.p.v. stil te blijven hangen.
  const startScreen = document.getElementById('start-screen');
  if (startScreen && startScreen.style.display !== 'none') {
    _showStartError(text);
  }
  await pyAlert(text, "error");
});

// Sprint 19d: herinnering van leerkracht
socket.on('quiz_reminder', async ({ message }) => {
  const banner = document.getElementById('warning-banner');
  if (banner) {
    banner.textContent = message;
    banner.style.background = '#fee2e2';
    banner.style.color = '#991b1b';
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 30000);
  } else {
    await pyAlert(message, "warn");
  }
});

// ── Editor initialisatie ────────────────────────────────────────────────────
async function initQuizEditor(config) {
  if (_editorReady) return;
  // Gebruik bestaande ensureEditor functie uit app.js
  await ensureEditor('quiz', '', false, false, config);
  _editorReady = true;

  // Run knop
  document.getElementById('quiz-run-btn').onclick = runCode;

  // Kopieer knop
  document.getElementById('quiz-copy-code-btn').onclick = () => {
    navigator.clipboard?.writeText(getCurrentCode() || '');
  };

  // Input handling
  document.getElementById('quiz-input-field').addEventListener('keyup', e => {
    if (e.key === 'Enter') sendInput();
  });
}

function getCurrentCode() {
  // Sprint 43.11: editorStore is een const BINNEN de IIFE van app.js en dus niet globaal.
  // app.js exporteert wel window.getEditorValue / window.setEditorValue — die gebruiken we.
  return (window.getEditorValue && window.getEditorValue('quiz')) || '';
}

function setEditorCode(code) {
  if (window.setEditorValue) {
    // resetView = true: cursor en scroll naar het begin bij het wisselen van vraag.
    window.setEditorValue('quiz', code || '', true);
  }
}

// ── Sprint 43.12: Code/Output-tabs (zelfde gedrag als klassessie en vrij oefenen) ──
// app.js exporteert setTab(owner, tab); die toont/verbergt #quiz-code-panel en
// #quiz-output-panel en zet de juiste tab-knop actief. Bij 'code' herberekent hij
// ook de Monaco-layout, wat nodig is omdat het paneel verborgen kan zijn geweest.
function showQuizTab(tab) {
  if (window.setTab) window.setTab('quiz', tab);
}

function bindQuizTabs() {
  document.querySelectorAll('[data-owner="quiz"][data-tab]').forEach(btn => {
    btn.addEventListener('click', () => showQuizTab(btn.dataset.tab));
  });
}
document.addEventListener('DOMContentLoaded', bindQuizTabs);

// ── Vraagtype helpers ────────────────────────────────────────────────────────
let _currentChoices = [];       // choices van huidige vraag
let _selectedChoices = [];      // geselecteerde choice IDs

function showQuestionPanel(type, hasCodePart) {
  const isComposite = type === 'composite';
  document.getElementById('panel-composite-open').style.display = isComposite ? '' : 'none';
  document.getElementById('panel-code').style.display   = (type === 'code' || (isComposite && hasCodePart)) ? '' : 'none';
  document.getElementById('panel-open').style.display   = type === 'open' ? '' : 'none';
  document.getElementById('panel-choice').style.display = ['single','multiple'].includes(type) ? '' : 'none';
  document.getElementById('panel-flowchart').style.display = type === 'stroomdiagram' ? '' : 'none';
  document.getElementById('quiz-run-btn').style.display = (type === 'code' || (isComposite && hasCodePart)) ? '' : 'none';
}

function renderChoices(choices, type, selected = []) {
  _currentChoices = choices;
  _selectedChoices = [...selected];
  const hint = document.getElementById('choice-hint');
  hint.textContent = type === 'single'
    ? '◉ Kies het juiste antwoord:'
    : '☑ Selecteer alle juiste antwoorden:';
  const list = document.getElementById('quiz-choices-list');
  list.innerHTML = choices.map((ch, i) => {
    // 23b: isCode-opties renderen als code-blok
    const textHtml = ch.isCode
      ? `<pre style="background:#1e1e1e;color:#d4d4d4;padding:8px 12px;border-radius:6px;
           font-family:Consolas,monospace;font-size:0.85rem;margin:0;overflow-x:auto;white-space:pre-wrap;">${escHtml(ch.text)}</pre>`
      : `<span style="font-size:0.95rem;line-height:1.5;">${escHtml(ch.text)}</span>`;
    const isSelected = _selectedChoices.includes(ch.id);
    return `
    <label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;
      border:2px solid var(--border);border-radius:10px;cursor:pointer;
      ${isSelected ? 'border-color:var(--primary);background:#eff6ff;' : ''}">
      <input type="${type === 'single' ? 'radio' : 'checkbox'}"
        name="quiz-choice" value="${ch.id}"
        ${isSelected ? 'checked' : ''}
        onchange="onChoiceChange(this, '${type}')"
        style="margin-top:${ch.isCode ? '10px' : '2px'};width:16px;height:16px;flex-shrink:0;"/>
      <div style="flex:1;min-width:0;">${textHtml}</div>
    </label>`;
  }).join('');
}

function onChoiceChange(input, type) {
  if (type === 'single') {
    _selectedChoices = [input.value];
    // Herrender om alle borders bij te werken
    renderChoices(_currentChoices, type, _selectedChoices);
  } else {
    if (input.checked) {
      if (!_selectedChoices.includes(input.value)) _selectedChoices.push(input.value);
    } else {
      _selectedChoices = _selectedChoices.filter(id => id !== input.value);
    }
    renderChoices(_currentChoices, type, _selectedChoices);
  }
  // v148: een aangeklikte keuze meteen bewaren (bevestigd + herproberen), niet pas bij het verlaten van de vraag.
  saveCurrentAnswer();
}

function updateOpenCount() {
  const ta = document.getElementById('quiz-open-answer');
  document.getElementById('open-char-count').textContent = ta.value.length;
  // Sprint 92: tussentijdse autosave van het open antwoord, niet enkel bij het verlaten
  // van de vraag.
  scheduleAnswerAutosave();
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getCurrentAnswer() {
  // Geeft het antwoord terug afhankelijk van het vraagtype
  const q = _state?.questions?.[_currentIdx];
  const type = q?.question_type || 'code';
  if (type === 'code') {
    return { code: getCurrentCode(), selectedChoices: [] };
  } else if (type === 'open') {
    return { code: document.getElementById('quiz-open-answer')?.value || '', selectedChoices: [] };
  } else if (type === 'composite') {
    // Sprint 51j: partAnswers = {partId: waarde}. Het code-onderdeel (indien aanwezig) staat
    // ook gespiegeld in 'code', zodat runnen/opslaan via het bestaande pad blijft werken.
    const parts = parseAnswerParts(q.answer_parts);
    const codePart = parts.find(p => p.type === 'code');
    const partAnswers = { ..._answers[q.id]?.partAnswers };
    document.querySelectorAll('.composite-part-input').forEach(el => {
      partAnswers[el.dataset.partId] = el.value;
    });
    if (codePart) partAnswers[codePart.id] = getCurrentCode();
    return { code: codePart ? getCurrentCode() : '', selectedChoices: [], partAnswers };
  } else if (type === 'stroomdiagram') {
    // Sprint 63: het antwoord is de JSON-toestand van de widget, niet 'code'.
    return { code: '', selectedChoices: [], answerFlowchartJson: _answerFlowchartWidget ? _answerFlowchartWidget.getData() : '' };
  } else {
    return { code: '', selectedChoices: _selectedChoices };
  }
}

// Sprint 51j: parseert answer_parts (JSON-string of array) veilig naar een array.
function parseAnswerParts(raw) {
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
}

// Eén open-onderdeel van een samengestelde vraag opslaan (lokaal; de volledige opslag
// naar de server gebeurt via saveCurrentAnswer, net als bij de andere types).
function saveCompositePartAnswer(partId, value) {
  if (!_currentQuestionId) return;
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  if (!_answers[_currentQuestionId].partAnswers) _answers[_currentQuestionId].partAnswers = {};
  _answers[_currentQuestionId].partAnswers[partId] = value;
  // Sprint 92: ook dit tekstveld autosavet nu tussentijds (zie scheduleAnswerAutosave hieronder)
  // i.p.v. enkel bij het verlaten van de vraag.
  scheduleAnswerAutosave();
}

// Sprint 51y: single/multiple-choice-onderdeel binnen een samengestelde vraag — de waarde
// blijft ALTIJD een array van gekozen choice-id's (ook bij single, met max 1 element), zodat
// de server dezelfde computeAutoScore()-logica kan hergebruiken als bij een gewone keuzevraag.
function saveCompositeChoiceAnswer(partId, choiceId, isMultiple) {
  if (!_currentQuestionId) return;
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  if (!_answers[_currentQuestionId].partAnswers) _answers[_currentQuestionId].partAnswers = {};
  const huidig = _answers[_currentQuestionId].partAnswers[partId];
  let gekozen = Array.isArray(huidig) ? huidig.slice() : [];
  if (isMultiple) {
    const idx = gekozen.indexOf(choiceId);
    if (idx >= 0) gekozen.splice(idx, 1); else gekozen.push(choiceId);
  } else {
    gekozen = [choiceId]; // single: altijd exact 1 keuze, radiogedrag vervangt de vorige
  }
  _answers[_currentQuestionId].partAnswers[partId] = gekozen;
  saveCurrentAnswer();
}

// ── Navigatie ───────────────────────────────────────────────────────────────
// Sprint 71: één centrale, vraagtype-bewuste "is dit beantwoord?"-check — voorheen
// stond deze logica dubbel (renderNav + openSubmitScreen), telkens onvolledig (geen
// van beide hield rekening met samengestelde vragen of stroomdiagram-antwoorden), met
// als gevolg dat een correct beantwoorde vraag toch als "bezocht maar geen keuze"
// werd getoond, en de navigatiepil daarboven niet meekleurde.
function heeftAntwoord(q, ans) {
  if (!ans) return false;
  const qType = q.question_type || 'code';
  if (qType === 'code' || qType === 'open') return !!(ans.code && ans.code.trim());
  if (qType === 'composite') {
    const pa = ans.partAnswers || {};
    return Object.values(pa).some(v => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim()));
  }
  if (qType === 'stroomdiagram') {
    if (!ans.answerFlowchartJson) return false;
    try { const d = JSON.parse(ans.answerFlowchartJson); return Array.isArray(d.blocks) && d.blocks.length > 0; } catch { return false; }
  }
  return (ans.selectedChoices || []).length > 0; // single / multiple
}

function renderNav() {
  const questions = _state?.questions || [];
  const nav = document.getElementById('quiz-nav');
  nav.innerHTML = questions.map((q, i) => {
    const qid = q.id;
    const ans = _answers[qid];
    // Sprint 71: nog maar 2 fases — geel (bezocht, niets ingevuld) of groen (iets
    // ingevuld) — en enkel als gekleurde RAND, nooit als volledig gevulde knop (was
    // voorheen wél zo bij "saved"/"no-run": verwarrend, zag eruit als een aparte,
    // 3de status i.p.v. gewoon "beantwoord"). De huidige vraag krijgt daar bovenop,
    // los van die kleur, gewoon een dikke lichtblauwe rand (.current, ongewijzigd).
    let cls = 'qnav-btn';
    if (heeftAntwoord(q, ans)) cls += ' answered';
    else if (_visited.has(qid)) cls += ' visited';
    if (i === _currentIdx) cls += ' current';
    // Sprint 69: bij noBack zijn eerdere vragen niet meer bereikbaar.
    // Sprint 89 (bugfix): dit blokkeerde voorheen ENKEL de vraagnummers vóór de huidige
    // vraag (i < _currentIdx) — een leerling kon dus via deze nummerbalk gewoon een stuk
    // VOORUIT springen (bv. van vraag 2 rechtstreeks naar vraag 6), zonder de bevestiging
    // die "Volgende" wél toont, en met als gevolg dat de overgeslagen vragen (3, 4, 5)
    // daarna óók voorgoed onbereikbaar werden — een leerling kon zo per ongeluk vragen
    // permanent verliezen. "Terugbladeren niet toegestaan" is bedoeld als een strikt
    // sequentiële, één-voor-één voortgang: bij noBack is de nummerbalk dus enkel nog een
    // voortgangsindicator, en mag ENKEL de huidige vraag nog aangeklikt worden (wat toch al
    // niets doet) — elke andere vraag (voor óf na de huidige) gaat voortaan alleen nog via
    // de "Volgende"-knop (die de bevestiging al toont).
    const geblokkeerd = _state?.noBack && i !== _currentIdx;
    if (geblokkeerd) cls += ' locked';
    return `<button class="${cls}"${geblokkeerd
      ? ' disabled style="opacity:.45;cursor:not-allowed;" title="Bij deze toets/taak kan je enkel via de \'Volgende\'-knop naar een andere vraag."'
      : ` onclick="goToQuestion(${i})" title="Vraag ${i+1}"`}>${i+1}</button>`;
  }).join('');
  document.getElementById('qs-progress').textContent =
    `${_currentIdx+1}/${questions.length} · ${questions.filter(q => heeftAntwoord(q, _answers[q.id])).length} opgeslagen`;
}

// Sprint 51-fix (kritieke bugfix): preprocessMarkdown/renderMarkdown stonden hiervoor per
// ongeluk GENEST binnen goToQuestion()'s if-blok — een blok-scoped function declaration is
// dan ENKEL zichtbaar binnen dat specifieke blok, niet elders in het bestand. Dat werkte
// toevallig voor de gewone toetsflow (die renderMarkdown binnen diezelfde functie aanroept),
// maar liet het nakijk-scherm (renderVraagKaart/renderMyResult, hieronder, top-level
// gedefinieerd) crashen met "renderMarkdown is not defined" zodra een leerling zijn toets
// probeerde te bekijken — bevestigd met een browsertest. Nu correct op het top-niveau.
// 25e: preprocessing voor info-kaders (:::tip/opgelet/kader/hint)
function preprocessMarkdown(text) {
  return text.replace(/:::(\w+)\n([\s\S]*?):::/g, function(_, type, content) {
    var map = { tip:'info-tip', opgelet:'info-opgelet', kader:'info-kader-blauw', hint:'info-hint' };
    var cls = map[type] || 'info-kader-blauw';
    return '<div class="info-kader ' + cls + '">' + content.trim() + '</div>';
  });
}
function renderMarkdown(text) {
  if (!window.marked) return text.replace(/\n/g,'<br>');
  var html = window.marked.parse(preprocessMarkdown(text), { breaks: true, gfm: true });
  // 28c: XSS-beveiliging — sanitize met DOMPurify (style toegestaan voor kleuren)
  return window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_ATTR: ['style', 'target'] }) : html;
}

// Sprint 63: onzichtbare "AI-val" — weeft de door de leerkracht opgestelde (of door de
// AI-opsmuk-knop voorgestelde) tekst als volledig onzichtbaar element in de vraagtekst.
// Bedoeld voor leerlingen die de vraag kopiëren en in een AI-chatbot plakken: kopiëren
// pakt de tekst-INHOUD van het scherm, niet enkel wat met het oog zichtbaar is, dus deze
// tekst gaat gewoon mee — een chatbot die de verstopte "instructie" volgt, laat daardoor
// een herkenbaar spoor na in het teruggegeven antwoord. font-size:0 (i.p.v. bv.
// display:none) is bewust: sommige kopieermethodes negeren display:none-elementen wél.
function renderHiddenAiTrap(valTekst) {
  var tekst = (valTekst || '').trim();
  if (!tekst) return '';
  var veilig = window.DOMPurify ? window.DOMPurify.sanitize(tekst, { ALLOWED_TAGS: [] }) : tekst;
  return '<span style="font-size:0;line-height:0;color:transparent;user-select:text;" aria-hidden="true">'
    + veilig + '</span>';
}

let _navigatieBezig = false; // Sprint 91: voorkomt een tweede, overlappende navigatiepoging
                              // terwijl de eerste nog op een opslagbevestiging wacht.

async function goToQuestion(idx, opties = {}) {
  const questions = _state?.questions || [];
  if (idx < 0 || idx >= questions.length) return;

  // Sprint 69: bij "1 kans per vraag" kan je enkel vooruit. De server bepaalt dit
  // (state.noBack); de knoppen zijn ook uitgeschakeld, dit is de harde grendel.
  // Sprint 89 (bugfix): naast terugspringen (idx < _currentIdx) blokkeren we nu ook
  // VOORUIT-springen van meer dan 1 vraag tegelijk (idx > _currentIdx + 1) — dat was het
  // eigenlijke gat waardoor de vraagnummerbalk bovenaan nog gebruikt kon worden om vragen
  // over te slaan (en dus, door de terugspring-blokkade hierboven, definitief te verliezen).
  // De enige toegestane stap is exact +1, en die loopt altijd via de "Volgende"-knop
  // (navigate()), die zijn eigen bevestigingsvenster al toont.
  // v143: bij het hervatten (opstart of na heropenen) mag de leerling meteen op de juiste vraag landen,
  // bv. vraag 8 nadat 1 t.e.m. 7 bewust bevestigd waren. Bewust bevestigde vragen blijven dicht.
  if (!opties.hervat && _state?.noBack && (idx < _currentIdx || idx > _currentIdx + 1)) return;
  if (!opties.hervat && _state?.noBack && _bevestigdeVragen.has(questions[idx].id)) return;
  if (_navigatieBezig) return;

  // 🔴 Sprint 91 (kritieke bugfix): hier verliet de leerling voorheen de vraag ONMIDDELLIJK,
  // zonder ooit te wachten tot de server de opslag ervan bevestigde — bij een
  // verbindingsprobleem kon dat antwoord dan stilzwijgend verloren gaan, vooral fataal bij
  // "Terugbladeren niet toegestaan" (eens voorbij, nooit meer bereikbaar). Nu wachten we hier
  // expliciet op een bevestigde opslag (met automatisch herproberen, zie saveCurrentAnswer())
  // vóór we ook maar naar de volgende vraag overstappen.
  if (_currentQuestionId) {
    controleerWeinigToetsen();   // v144
    const code = getCurrentCode();
    _navigatieBezig = true;
    // v143: bij 1 kans per vraag is vooruitgaan een bewuste bevestiging van de vraag die je verlaat.
    const bevestigVraag = _state?.noBack === true && !opties.hervat && idx > _currentIdx;
    const bevestigdId = _currentQuestionId;
    const bevestigd = await saveCurrentAnswer(code, { bevestig: bevestigVraag });
    _navigatieBezig = false;
    if (bevestigd && bevestigVraag && bevestigdId) _bevestigdeVragen.add(bevestigdId);
    if (!bevestigd) return; // blijft op de huidige vraag staan — de opslag probeert intussen op de achtergrond door
  }

  _currentIdx = idx;
  const q = questions[idx];
  _currentQuestionId = q.id;
  startVraagBewaking(q.id);   // v144
  updateCursusVoorVraag(q.id);   // v132: cursus-links horen per vraag

  // Markeer als bezocht
  if (!_visited.has(q.id)) {
    _visited.add(q.id);
    if (!_answers[q.id]) {
      _answers[q.id] = { firstVisitAt: Date.now(), runCount: 0, code: '' };
    } else if (!_answers[q.id].firstVisitAt) {
      _answers[q.id].firstVisitAt = Date.now();
    }
  }

  // Toon vraagstelling
  const questionEl = document.getElementById('quiz-question');
  const qType = q.question_type || 'code';
  if (!_state?.hideQuestionOnScreen) {
    questionEl.style.display = 'block';
    const typeLabel = {code:'🐍 Code',open:'✏️ Open vraag',single:'◉ Single choice',multiple:'☑ Meerkeuze',composite:'🧩 Samengestelde vraag',stroomdiagram:'🔀 Stroomdiagram'}[qType] || '';
    document.getElementById('q-header').textContent =
      `Vraag ${idx+1} van ${questions.length} · ${q.subject || ''} · ${fmtP(q.points)} punten · ${typeLabel}`;
    // Sprint 19f: Markdown rendering
    const qTextEl = document.getElementById('q-text');
    const rawText = q.text_snapshot || q.text || '';
    if (window.marked) {
      qTextEl.innerHTML = renderMarkdown(rawText) + renderHiddenAiTrap(q.hidden_ai_trap);
    } else {
      qTextEl.textContent = rawText;
    }
    // Sprint 63: stroomdiagram BIJ de vraagstelling — weergave-alleen, los van het
    // vraagtype van deze vraag.
    const stemWrap = document.getElementById('q-flowchart-stem');
    if (_stemFlowchartWidget) { _stemFlowchartWidget.destroy(); _stemFlowchartWidget = null; }
    if (q.flowchart_json) {
      stemWrap.style.display = 'block';
      _stemFlowchartWidget = FlowchartWidget.mount(stemWrap, { editable: false, data: q.flowchart_json });
    } else {
      stemWrap.style.display = 'none';
      stemWrap.innerHTML = '';
    }
  } else {
    questionEl.style.display = 'none';
  }

  // Toon correct panel per vraagtype
  const partsForType = qType === 'composite' ? parseAnswerParts(q.answer_parts) : [];
  const codePart = partsForType.find(p => p.type === 'code') || null;
  showQuestionPanel(qType, !!codePart);

  // Herstel antwoord
  const savedAns = _answers[q.id];
  if (qType === 'code') {
    setEditorCode(savedAns?.code || '');
    const out = document.getElementById('quiz-output-panel');
    if (out) out.textContent = '';
    // 43.12: nieuwe vraag start altijd op de Code-tab (niet op de output van de vorige vraag).
    showQuizTab('code');
  } else if (qType === 'open') {
    const ta = document.getElementById('quiz-open-answer');
    if (ta) { ta.value = savedAns?.code || ''; updateOpenCount(); }
  } else if (qType === 'composite') {
    // Sprint 51j: samengestelde vraag — per onderdeel een passend invoerveld; het eventuele
    // code-onderdeel gebruikt het gewone (altijd uitvoerbare) code-paneel hierboven.
    // Sprint 51y: uitgebreid met single/multiple-choice-onderdelen (radio's/checkboxes).
    const partAnswers = savedAns?.partAnswers || {};
    const wrap = document.getElementById('composite-open-parts');
    if (wrap) {
      wrap.innerHTML = partsForType.filter(p => p.type !== 'code').map(p => {
        if (p.type === 'single' || p.type === 'multiple') {
          const gekozen = Array.isArray(partAnswers[p.id]) ? partAnswers[p.id] : [];
          const inputType = p.type === 'single' ? 'radio' : 'checkbox';
          const groupName = 'composite-choice-' + p.id;
          return `<div>
            <label style="font-size:0.85rem;color:var(--muted);display:block;margin-bottom:6px;">${escHtml(p.label || 'Antwoord')}</label>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${window.pySchud(p.choices || [], [_sessionCode || urlCode, urlName, q.id, p.id].join('|')).map(c => `
                <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;">
                  <input type="${inputType}" name="${groupName}" value="${escHtml(c.id)}" ${gekozen.includes(c.id) ? 'checked' : ''}
                    onchange="saveCompositeChoiceAnswer('${p.id}', '${c.id}', ${p.type === 'multiple'})"/>
                  <span>${escHtml(c.text)}</span>
                </label>`).join('')}
            </div>
          </div>`;
        }
        return `
        <div>
          <label style="font-size:0.85rem;color:var(--muted);display:block;margin-bottom:6px;">${escHtml(p.label || 'Antwoord')}</label>
          <textarea class="composite-part-input" data-part-id="${p.id}" rows="3" maxlength="2000"
            style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:10px;
              font-size:0.95rem;font-family:inherit;resize:vertical;box-sizing:border-box;"
            placeholder="Jouw antwoord..."
            onkeydown="event.stopPropagation()"
            oninput="saveCompositePartAnswer('${p.id}', this.value)">${escHtml(partAnswers[p.id] || '')}</textarea>
        </div>`;
      }).join('');
    }
    if (codePart) {
      setEditorCode(partAnswers[codePart.id] || '');
      const out = document.getElementById('quiz-output-panel');
      if (out) out.textContent = '';
      showQuizTab('code');
    }
  } else if (qType === 'stroomdiagram') {
    // Sprint 63: bewerkbaar antwoord-stroomdiagram, met autosave (debounced) via
    // dezelfde quiz_save_answer-route als de andere antwoordtypes.
    if (_answerFlowchartWidget) { _answerFlowchartWidget.destroy(); _answerFlowchartWidget = null; }
    const host = document.getElementById('quiz-flowchart-answer');
    _answerFlowchartWidget = FlowchartWidget.mount(host, {
      editable: true,
      data: savedAns?.answerFlowchartJson || '',
      onChange: () => scheduleFlowchartAnswerSave(),
    });
  } else {
    // single / multiple
    try {
      const choices = JSON.parse(q.choices_json || '[]');
      const selected = savedAns?.selectedChoices || [];
      // Sprint 98: opties in een vaste, per leerling willekeurige volgorde
      renderChoices(window.pySchud(choices, [_sessionCode || urlCode, urlName, q.id].join('|')), qType, selected);
    } catch { renderChoices([], qType, []); }
  }

  // Navigatieknoppen — Bugfix: stonden voorheen enkel UITGESCHAKELD (Vorige) of kregen
  // een tekstwissel naar "Laatste vraag" (Volgende) i.p.v. gewoon te verdwijnen. Nu
  // volledig verborgen wanneer ze toch niets kunnen doen.
  document.getElementById('quiz-prev-btn').style.display = idx === 0 ? 'none' : '';
  document.getElementById('quiz-next-btn').style.display = idx === questions.length - 1 ? 'none' : '';
  // Sprint 79: "Indienen" stond voorheen altijd zichtbaar (bij elke vraag) — dat gaf een
  // leerling de kans om per ongeluk vroegtijdig in te dienen vóór alle vragen bekeken zijn.
  // Nu enkel zichtbaar bij de laatste vraag.
  const submitBtn = document.getElementById('quiz-submit-btn');
  if (submitBtn) submitBtn.style.display = idx === questions.length - 1 ? '' : 'none';

  renderNav();
}

async function navigate(dir) {
  // Sprint 69: bij "1 kans per vraag" is vooruitgaan onomkeerbaar → expliciet bevestigen.
  if (_state?.noBack && dir > 0 && _currentIdx < (_state?.questions?.length || 0) - 1) {
    const ok = await window.pyConfirm({
      title: 'Naar de volgende vraag?',
      body: 'Je kan <strong>niet meer terugkeren</strong> naar deze vraag. Ben je klaar met je antwoord?',
      confirmLabel: 'Ja, volgende vraag',
      cancelLabel: 'Nog even blijven',
    });
    if (!ok) return;
  }
  goToQuestion(_currentIdx + dir);
}

// 🔴 Sprint 91 (kritieke bugfix): "na de toets met de nodige sessieverbindingsproblemen
// bleek dat voor bepaalde leerlingen niet alle antwoorden waren opgeslagen — dit moet ten
// alle tijde vermeden worden". saveCurrentAnswer() stuurde dit hiervoor blindelings weg met
// een kale socket.emit() — geen bevestiging, geen herprobeer, exact hetzelfde architecturale
// gat dat sprint 88 al dichtte voor de RUN-knop (quiz_run_request), maar dan voor de
// antwoorden zelf, wat oneindig erger is om te verliezen. Twee stille verlies-scenario's:
//  1) De client stuurt dit event terwijl de socket (na een korte wifi-hapering) een NIEUWE
//     socket.id kreeg maar zich nog niet herregistreerd had via 'quiz_start' — de server
//     kende deze verbinding dan simpelweg niet en deed stil niets.
//  2) Zelfs mét succesvolle verzending kon het pakket gewoon verloren gaan tijdens een
//     onderbreking — zonder ack was er geen enkele manier om dat te weten te komen.
// Nu: elke opslag wordt bevestigd door de server (ack, zie quiz_save_answer in server.js) en
// blijft bij het uitblijven daarvan AUTOMATISCH herproberen — zonder harde limiet, want beter
// een leerling die even moet wachten tot de verbinding herstelt, dan een stil verloren
// antwoord. Bij "Terugbladeren niet toegestaan" is dit extra kritiek: eens voorbij een vraag,
// is ze nooit meer bereikbaar — goToQuestion() wacht daarom expliciet op deze bevestiging
// vóór het overstapt naar de volgende vraag.
const _pendingSaves = {}; // { [questionId]: { payload, attempt, promise } }
const SAVE_ACK_TIMEOUT_MS = 3000;
const SAVE_WAARSCHUWING_VANAF_POGING = 3; // pas dan de leerling expliciet lastigvallen

function updateSaveStatusUI() {
  const el = document.getElementById('qs-save-status');
  if (!el) return;
  const bezig = Object.values(_pendingSaves);
  if (!bezig.length) { el.textContent = ''; el.style.color = ''; return; }
  const ergsteAttempt = Math.max(...bezig.map(p => p.attempt));
  if (ergsteAttempt >= SAVE_WAARSCHUWING_VANAF_POGING) {
    el.textContent = `⚠️ Antwoord nog niet bevestigd — bezig met opnieuw proberen (poging ${ergsteAttempt})...`;
    el.style.color = '#dc2626';
  } else {
    el.textContent = '🔄 Antwoord opslaan...';
    el.style.color = '';
  }
}

function saveCurrentAnswer(code, opt) {
  if (!_currentQuestionId) return Promise.resolve(true);
  // Sprint 70: na een geforceerde inlevering mag er niets meer bijkomen. De ene
  // opslag die de afsluiting zelf doet, gebeurt vóór deze vlag wordt gezet.
  if (_afgesloten) return Promise.resolve(true);
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  const ans = getCurrentAnswer();
  _answers[_currentQuestionId].code = ans.code;
  _answers[_currentQuestionId].selectedChoices = ans.selectedChoices;
  _answers[_currentQuestionId].runCount = _runCount[_currentQuestionId] || 0;
  if (ans.partAnswers) _answers[_currentQuestionId].partAnswers = ans.partAnswers;
  if (ans.answerFlowchartJson !== undefined) _answers[_currentQuestionId].answerFlowchartJson = ans.answerFlowchartJson;

  const payload = {
    questionId: _currentQuestionId,
    code: ans.code,
    selectedChoices: ans.selectedChoices,
    runCount: _runCount[_currentQuestionId] || 0,
    firstVisitAt: _answers[_currentQuestionId]?.firstVisitAt || null,
    firstRunAt: _answers[_currentQuestionId]?.firstRunAt || null,
    currentQuestion: _currentIdx,
    partAnswers: ans.partAnswers || undefined,
    answerFlowchartJson: ans.answerFlowchartJson !== undefined ? ans.answerFlowchartJson : undefined,
  };
  if (opt && opt.bevestig === true) payload.bevestigd = true;   // v143
  return reliableSaveAnswer(_currentQuestionId, payload);
}

// Eén enkele, verlengbare herprobeer-keten per vraag: een nieuwe opslag-aanvraag voor een
// vraag die al aan het herproberen is, vervangt gewoon de payload van die lopende keten
// (altijd de MEEST RECENTE inhoud versturen) i.p.v. een tweede, overlappende keten te starten.
function reliableSaveAnswer(questionId, payload) {
  const bestaand = _pendingSaves[questionId];
  if (bestaand) { bestaand.payload = payload; return bestaand.promise; }
  const entry = { payload, attempt: 1, promise: null };
  entry.promise = new Promise((resolve) => { entry.resolve = resolve; });
  _pendingSaves[questionId] = entry;
  updateSaveStatusUI();
  attemptSaveAnswer(questionId);
  return entry.promise;
}

function attemptSaveAnswer(questionId) {
  const entry = _pendingSaves[questionId];
  if (!entry) return; // ondertussen al bevestigd (of vervangen) — niets meer te doen

  if (!socket.connected) {
    socket.once('connect', () => setTimeout(() => attemptSaveAnswer(questionId), 150));
    updateSaveStatusUI();
    return;
  }

  let beantwoord = false;
  const timer = setTimeout(() => {
    if (beantwoord) return;
    beantwoord = true;
    retrySaveAnswer(questionId, null);
  }, SAVE_ACK_TIMEOUT_MS);

  socket.emit('quiz_save_answer', entry.payload, (resp) => {
    if (beantwoord) return;
    beantwoord = true;
    clearTimeout(timer);
    if (resp && resp.ok === true) {
      delete _pendingSaves[questionId];
      updateSaveStatusUI();
      entry.resolve(true);
      return;
    }
    // 'already_submitted': de toets is server-side al afgerond — verder aandringen heeft
    // geen zin meer en zou de leerling nodeloos blokkeren.
    if (resp && resp.reason === 'already_submitted') {
      delete _pendingSaves[questionId];
      updateSaveStatusUI();
      entry.resolve(true);
      return;
    }
    retrySaveAnswer(questionId, resp || null);
  });
}

function retrySaveAnswer(questionId, resp) {
  const entry = _pendingSaves[questionId];
  if (!entry) return;
  entry.attempt++;
  updateSaveStatusUI();
  // Sprint 91 (net als sprint 89 bij RUN): vanaf de instelbare drempel melden we dit aan de
  // server, zodat de leerkracht via Systeembeheer ziet hoe vaak (en bij wie) dit voorkomt —
  // dit is het EXACTE scenario dat de melding van vandaag beschrijft.
  if ((entry.attempt === SAVE_WAARSCHUWING_VANAF_POGING || entry.attempt % 5 === 0) && socket.connected) {
    socket.emit('client_log_event', { type: 'save_ack_missing', name: urlName, code: urlCode, attempt: entry.attempt });
  }
  // Geen registratie (nieuwe socket.id na een herverbinding, nog niet herkend) → eerst de
  // sessie herstellen vóór een volgende poging, exact zoals bij de RUN-knop.
  if ((!resp || resp.reason === 'not_registered') && _state) {
    socket.emit('quiz_start', { code: urlCode, name: urlName, className: urlClass });
  }
  // Lichte backoff, met een plafond — geen harde bovengrens op het aantal pogingen: een
  // antwoord opgeven is nooit een optie, enkel geduldig blijven volhouden tot het lukt.
  const wachttijd = Math.min(500 * entry.attempt, 5000);
  setTimeout(() => attemptSaveAnswer(questionId), wachttijd);
}

// Sprint 91: bij elke (her)registratie (nieuwe of herstelde verbinding) alle nog niet
// bevestigde antwoorden meteen opnieuw aanbieden — dit dicht het gat voor een opslag die
// muurvast zat te wachten op exact deze herregistratie.
function hervatAlleWachtendeOpslagen() {
  for (const questionId of Object.keys(_pendingSaves)) attemptSaveAnswer(questionId);
}

// Sprint 63: de stroomdiagram-widget roept bij elke wijziging (blokje verschoven, tekst
// getypt, pijl toegevoegd, ...) onChange() aan — dat zou zonder debounce tientallen keren
// per seconde een opslag naar de server sturen tijdens het slepen. Zelfde 800ms-patroon
// als elders in de app voor "typ/sleep-gebonden" autosaves.
let _flowchartSaveTimer = null;
function scheduleFlowchartAnswerSave() {
  clearTimeout(_flowchartSaveTimer);
  _flowchartSaveTimer = setTimeout(() => saveCurrentAnswer(), 800);
}

// Sprint 92: "codelijnen tussenin zouden ook moeten worden opgeslagen, niet enkel met de
// run of volgende vraag/indienen". Zelfde 800ms-debounce als hierboven bij het stroomdiagram,
// nu ook voor de code-editor, het open-antwoordveld en de tekstvelden van een samengestelde
// vraag — elk van die drie riep voorheen ENKEL bij het verlaten van de vraag (goToQuestion)
// of bij indienen een opslag aan, dus getypte tussentijdse code kon bij een vastgelopen
// tabblad, crash of stroomonderbreking verloren gaan zonder dat de leerling dat merkte.
// Hergebruikt de reeds robuuste reliableSaveAnswer()-opslagketen uit sprint 91 (bevestiging +
// onbeperkt herproberen), dus een tussentijdse autosave geniet exact dezelfde garantie als
// een opslag bij navigatie.
let _autosaveTimer = null;
function scheduleAnswerAutosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => saveCurrentAnswer(), 800);
}

// Aangeroepen vanuit app.js (ensureEditor, 'quiz'-tak) bij elke wijziging in de Monaco-editor
// van de toets. Wordt NIET aangeroepen bij een programmatische wijziging (bv. bij het wisselen
// van vraag via setEditorCode()) — ensureEditor() onderdrukt dat zelf al via de bestaande
// '...ApplyingRemote'-vlag, vóór de per-owner-tak hieronder ooit bereikt wordt.
window.onQuizEditorChange = function () {
  if (!_currentQuestionId || _afgesloten) return;
  // v144: grote wijziging zonder plakpoging / kort na terugkeer
  try {
    const nu = getCurrentCode() || '';
    const oud = _vorigeEditorTekst;
    _vorigeEditorTekst = nu;
    if (oud != null) verwerkInvoerWijziging(oud, nu);
  } catch (e) { /* loggen mag nooit storen */ }
  scheduleAnswerAutosave();
};

// ── Code uitvoeren ──────────────────────────────────────────────────────────
function setQuizOutputStatus(html) {
  const panel = document.getElementById('quiz-output-panel');
  if (panel) panel.innerHTML = html;
  showQuizTab('output');
}

// Sprint 88 (bugfix): "te veel netwerkverbindingsonderbrekingen ... nu is het te dikwijls dat
// studenten op RUN klikken en er NIETS gebeurt". runCode() stuurde de run-aanvraag altijd
// blindelings weg, zonder ooit te controleren of de verbinding nog leeft, EN zonder ooit een
// antwoord van de server te verwachten. Bij een korte wifi-hapering (of vlak na een
// herverbinding, terwijl de server die nog aan het herkennen is) verdween die aanvraag dan
// spoorloos: geen foutmelding, geen run, niets zichtbaar — de leerling kon enkel gokken of
// nogmaals klikken hielp. sendRunRequest() hieronder controleert nu ALTIJD eerst of de
// verbinding er echt is, herstelt ze zo nodig (en herstelt ook de sessie via quiz_start),
// en wacht op een expliciete ack van de server (zie quiz_run_request in server.js) vóór het
// zeker weet dat de aanvraag effectief aangekomen is — met telkens een zichtbare melding in
// het uitvoervenster, naar analogie met de bestaande "je bent zoveelste in de wachtrij"-melding.
const RUN_ACK_TIMEOUT_MS = 2000;
const RUN_MAX_ATTEMPTS = 8;

function runCode() {
  const code = getCurrentCode();
  if (!code.trim()) return;
  document.getElementById('quiz-output-panel').textContent = '';
  showQuizTab('output');   // 43.12: toon meteen de uitvoer, zoals bij vrij oefenen

  // Track first run
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  if (!_answers[_currentQuestionId].firstRunAt) {
    _answers[_currentQuestionId].firstRunAt = Date.now();
  }
  _runCount[_currentQuestionId] = (_runCount[_currentQuestionId] || 0) + 1;
  _answers[_currentQuestionId].runCount = _runCount[_currentQuestionId];

  // Sla run history op
  socket.emit('quiz_run_completed', { questionId: _currentQuestionId, code });

  // Sprint 51n (bugfix): 'free_run_request' vereist ctx.role === 'free' op de server — een
  // leerling in een toets/taak heeft echter role 'quiz_student', dus die aanvraag werd stil
  // genegeerd (geen foutmelding, gewoon geen output). 'quiz_run_request' is de juiste,
  // parallelle server-handler voor deze context.
  sendRunRequest(code, 1);
  renderNav();
}

function sendRunRequest(code, attempt) {
  if (attempt > RUN_MAX_ATTEMPTS) {
    setQuizOutputStatus('⚠️ Kon geen verbinding maken met de server om je code uit te voeren. ' +
      'Controleer je internetverbinding en klik daarna opnieuw op RUN.');
    // Sprint 89: meld dit expliciet aan de server zodat de leerkracht (via Systeembeheer)
    // kan zien hoe vaak dit bij wie voorkomt — voorheen kwam dit nergens terecht buiten
    // dit ene scherm, dat de leerling meestal niet meer open heeft staan tegen dan.
    if (socket.connected) socket.emit('client_log_event', { type: 'run_failed_permanently', name: urlName, code: urlCode });
    return;
  }

  if (!socket.connected) {
    setQuizOutputStatus('<span class="queue-pulse">🔌</span> Verbinding herstellen...');
    // De client herverbindt zelf automatisch op de achtergrond (socket.io); zodra dat lukt,
    // proberen we het opnieuw. De bestaande 'connect'-listener hieronder stuurt op dat moment
    // ook zelf al 'quiz_start' opnieuw om de sessie te herstellen.
    socket.once('connect', () => setTimeout(() => sendRunRequest(code, attempt), 150));
    return;
  }

  sendRunWithAck(code, attempt);
}

function sendRunWithAck(code, attempt) {
  let answered = false;
  const timer = setTimeout(() => {
    if (answered) return;
    answered = true;
    retryRun(code, attempt);
  }, RUN_ACK_TIMEOUT_MS);

  socket.emit('quiz_run_request', { codeText: code }, (resp) => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    if (!resp || resp.ok !== true) retryRun(code, attempt);
    // resp.ok === true: de server heeft de aanvraag bevestigd in behandeling genomen — de
    // effectieve uitvoer (of een wachtrij-/rate-limit-melding) komt binnen via de bestaande
    // free_run_*-events hieronder, zoals voorheen.
  });
}

function retryRun(code, attempt) {
  setQuizOutputStatus(`<span class="queue-pulse">🔄</span> Verbinding wordt hersteld — ` +
    `even geduld (poging ${attempt}/${RUN_MAX_ATTEMPTS})...`);
  // Sprint 89: elke keer dat we hier belanden was er een RUN-aanvraag zonder tijdige
  // bevestiging — meld dit (rate-gelimiteerd server-side) zodat de leerkracht ook ziet
  // hoe vaak het bijna misging, niet enkel de gevallen die uiteindelijk volledig faalden.
  if (socket.connected) socket.emit('client_log_event', { type: 'run_ack_missing', name: urlName, code: urlCode, attempt });
  // De server herkende deze verbinding (nog) niet als deze leerling — meestal omdat een
  // herverbinding nog niet volledig verwerkt is. Stuur 'quiz_start' opnieuw om de sessie te
  // (her)registreren vóór de volgende poging.
  if (_state) socket.emit('quiz_start', { code: urlCode, name: urlName, className: urlClass });
  setTimeout(() => sendRunRequest(code, attempt + 1), 500);
}

// Hergebruik output events van app.js
// Sprint 51p (bugfix): de server stuurt bij elke stdout-chunk de VOLLEDIGE, al cumulatief
// opgebouwde output (student._outputAccum) — niet enkel het nieuwe stukje. Deze listener
// deed echter panel.textContent += output, waardoor de al-cumulatieve serverstring TELKENS
// weer bovenop de al-opgebouwde clientstring kwam: een kwadratisch groeiende herhaling
// (1 / 1,2 / 1,2,3 / 1,2,3,4 / ...). app.js doet dit bij vrij oefenen correct met '=' — hier
// hetzelfde: de output VERVANGT de inhoud, ze wordt niet toegevoegd.
socket.on('free_run_output', ({ output }) => {
  const panel = document.getElementById('quiz-output-panel');
  panel.textContent = output;
  panel.scrollTop = panel.scrollHeight;
});
socket.on('free_run_end', () => {
  document.getElementById('quiz-wait-input').style.display = 'none';
  document.getElementById('quiz-input-wrap').style.display = 'none';
});
// Sprint 88: quiz-student.js miste deze twee listeners die app.js voor 'vrij oefenen' wel al
// had — de server stuurde ze hier ook al langer, maar er was niets dat ze toonde. Resultaat:
// bij een drukke runner (wachtrij) of rate-limiting bleef het uitvoervenster leeg lijken —
// hetzelfde "ik klik op RUN en er gebeurt niets"-gevoel, maar dan door een normale, verwachte
// vertraging in plaats van een kapotte verbinding. Nu altijd zichtbaar, zoals bij vrij oefenen.
socket.on('free_run_queued', ({ position }) => {
  const estSec = (position || 1) * 8;
  setQuizOutputStatus(`<span class="queue-pulse">⏳</span> In wachtrij — positie <strong>${position}</strong> · geschatte wachttijd ~${estSec}s`);
});
socket.on('free_run_rate_limited', ({ message }) => {
  // Sprint 88: app.js heeft al een escapeHtml(), maar die zit in zijn eigen IIFE-closure en is
  // dus niet bereikbaar vanuit dit bestand — vandaar deze kleine, lokale variant.
  const safe = String(message || 'Wacht even voor je opnieuw runt.')
    .replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  setQuizOutputStatus(`<span class="queue-pulse">⏳</span> ${safe}`);
});
socket.on('free_input_request', () => {
  document.getElementById('quiz-wait-input').style.display = 'block';
  document.getElementById('quiz-input-wrap').style.display = 'flex';
  setTimeout(() => document.getElementById('quiz-input-field')?.focus(), 50);
});

function sendInput() {
  const val = document.getElementById('quiz-input-field').value;
  document.getElementById('quiz-input-field').value = '';
  document.getElementById('quiz-wait-input').style.display = 'none';
  document.getElementById('quiz-input-wrap').style.display = 'none';
  // Sprint 51n (bugfix): zelfde reden als bij runCode() — quiz-context gebruikt een eigen event.
  socket.emit('quiz_runtime_input', { value: val });
}

// ── Indienen ────────────────────────────────────────────────────────────────
function openSubmitScreen() {
  saveCurrentAnswer(getCurrentCode());
  const questions = _state?.questions || [];
  const list = document.getElementById('submit-checklist');
  list.innerHTML = questions.map((q, i) => {
    const ans = _answers[q.id];
    const qType = q.question_type || 'code';
    const hasRun = (ans?.runCount || 0) > 0;
    // Sprint 71: hergebruikt nu dezelfde centrale, vraagtype-bewuste check als de
    // navigatiepilletjes bovenaan (zie heeftAntwoord) — voorheen had dit scherm zijn
    // eigen, onvolledige logica die composite/stroomdiagram-antwoorden niet herkende,
    // met als gevolg dat een correct beantwoorde vraag hier tóch als "bezocht maar
    // geen keuze" verscheen.
    const beantwoord = heeftAntwoord(q, ans);
    let icon, msg;
    if (qType === 'code') {
      if (beantwoord && hasRun) { icon = '✅'; msg = `Vraag ${i+1} — opgeslagen (${ans.runCount} run${ans.runCount !== 1?'s':''})`; }
      else if (beantwoord && !hasRun) { icon = '⚠️'; msg = `Vraag ${i+1} — opgeslagen maar nooit uitgevoerd`; }
      else if (_visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen code`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    } else if (qType === 'open') {
      if (beantwoord) { icon = '✅'; msg = `Vraag ${i+1} — antwoord opgeslagen`; }
      else if (_visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen antwoord`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    } else if (qType === 'composite') {
      if (beantwoord) { icon = '✅'; msg = `Vraag ${i+1} — antwoord opgeslagen`; }
      else if (_visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen antwoord`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    } else if (qType === 'stroomdiagram') {
      if (beantwoord) { icon = '✅'; msg = `Vraag ${i+1} — stroomdiagram opgeslagen`; }
      else if (_visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen stroomdiagram`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    } else {
      if (beantwoord) { icon = '✅'; msg = `Vraag ${i+1} — keuze opgeslagen`; }
      else if (_visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen keuze`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    }
    return `<li>${icon} ${msg}</li>`;
  }).join('');
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('submit-screen').classList.add('visible');
}

function closeSubmitScreen() {
  document.getElementById('submit-screen').classList.remove('visible');
  document.getElementById('quiz-screen').style.display = 'block';
}

// ── Sprint 90: zelfevaluatie-enquête ná het indienen (enkel bij een toets, enkel
// als de leerkracht dit voor DEZE toets heeft aangezet). Vaste, niet-configureerbare
// vragenlijst — bewust gedupliceerd t.o.v. lib/validation.js (ENQUETE_STEMMINGEN /
// ENQUETE_CATEGORIEEN / valideerZelfevaluatie), zoals ook heeftAntwoord()/
// heeftAntwoordServer() hier al apart onderhouden worden (geen gedeelde bundelaar
// tussen server en client in dit project). Bij wijzigingen: BEIDE plekken aanpassen.
const ZELFEVAL_STEMMINGEN = [
  { id: 'zeer_slecht', icoon: '💀', label: 'Heel slecht' },
  { id: 'slecht', icoon: '☹️', label: 'Slecht' },
  { id: 'neutraal', icoon: '😐', label: 'Neutraal' },
  { id: 'goed', icoon: '🙂', label: 'Goed' },
  { id: 'uitstekend', icoon: '⭐', label: 'Uitstekend' },
];
const ZELFEVAL_CATEGORIEEN = [
  { id: 'voorbereiding', titel: 'Voorbereiding', items: [
    { id: 'gelezen_1x', tekst: 'Ik heb de leerstof 1 keer gelezen.' },
    { id: 'gelezen_meermaals', tekst: 'Ik heb de leerstof meerdere keren gelezen.' },
    { id: 'grondig_geleerd', tekst: 'Ik heb de leerstof grondig geleerd.' },
    { id: 'nvt', tekst: 'Niet van toepassing.', exclusief: true },
  ] },
  { id: 'verwerking', titel: 'Verwerking van de leerstof', items: [
    { id: 'samenvatting', tekst: 'Ik heb een samenvatting gemaakt.' },
    { id: 'herhaald_3x', tekst: 'Ik heb de samenvatting minstens 3 keer herhaald.' },
    { id: 'begrippenlijst', tekst: 'Ik heb een begrippenlijst geleerd.' },
    { id: 'extra_uitleg', tekst: 'Ik heb extra uitleg gevraagd (aan de leerkracht of een klasgenoot).' },
    { id: 'ondervraagd', tekst: 'Iemand heeft mij ondervraagd.' },
    { id: 'nvt', tekst: 'Niet van toepassing.', exclusief: true },
  ] },
  { id: 'oefenen', titel: 'Oefenen', items: [
    { id: 'oefeningen_gemaakt', tekst: 'Ik heb oefeningen gemaakt.' },
    { id: 'oefeningen_herhaald', tekst: 'Ik heb oefeningen opnieuw gemaakt / herhaald.' },
    { id: 'extra_oefeningen', tekst: 'Ik heb extra oefeningen gemaakt (online of in het boek).' },
    { id: 'geen_oefeningen', tekst: 'Ik heb geen oefeningen gemaakt.' },
    { id: 'nvt', tekst: 'Niet van toepassing.', exclusief: true },
  ] },
  { id: 'planning', titel: 'Planning', items: [
    { id: 'op_tijd', tekst: 'Ik ben op tijd begonnen met leren (enkele dagen op voorhand).' },
    { id: 'laat', tekst: 'Ik ben laat begonnen (de dag ervoor).' },
    { id: 'zelfde_dag', tekst: 'Ik ben pas op de dag zelf begonnen.' },
    { id: 'nvt', tekst: 'Niet van toepassing.', exclusief: true },
  ] },
  { id: 'aandachtspunten', titel: 'Aandachtspunten', items: [
    { id: 'niet_voldoende', tekst: 'Ik heb niet (voldoende) geleerd.' },
    { id: 'verkeerde_leerstof', tekst: 'Ik heb de verkeerde leerstof geleerd.' },
    { id: 'vergeten', tekst: 'Ik was vergeten dat er een toets was.' },
    { id: 'gestrest', tekst: 'Ik was gestresseerd/nerveus tijdens de toets.' },
    { id: 'te_weinig_tijd', tekst: 'Ik had te weinig tijd om alles af te werken.' },
    { id: 'niet_goed_gevoeld', tekst: 'Ik voelde me niet goed (ziek, moe, ...).' },
    { id: 'vraagstelling_onduidelijk', tekst: 'Ik begreep bepaalde vragen niet goed.' },
    { id: 'afgeleid', tekst: 'Ik liet me afleiden tijdens het leren of tijdens de toets.' },
    // Sprint 96: exclusief + helemaal onderaan, zie de afhandeling in renderZelfevaluatieScherm().
    { id: 'geen_aandachtspunten', tekst: 'Ik had geen aandachtspunten — het verliep goed.', exclusief: true },
  ] },
];
let _zelfevalKeuzes = { stemming: null, antwoorden: {} };

function zelfevalIsVolledig() {
  if (!_zelfevalKeuzes.stemming) return false;
  return ZELFEVAL_CATEGORIEEN.every(c => (_zelfevalKeuzes.antwoorden[c.id] || []).length > 0);
}

function renderZelfevaluatieScherm() {
  _zelfevalKeuzes = { stemming: null, antwoorden: {} };
  for (const c of ZELFEVAL_CATEGORIEEN) _zelfevalKeuzes.antwoorden[c.id] = [];

  const stemmingenEl = document.getElementById('zelfeval-stemmingen');
  stemmingenEl.innerHTML = ZELFEVAL_STEMMINGEN.map(s =>
    `<button type="button" class="zelfeval-stemming-btn" data-stemming="${s.id}" title="${s.label}">${s.icoon}</button>`
  ).join('');
  stemmingenEl.querySelectorAll('.zelfeval-stemming-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _zelfevalKeuzes.stemming = btn.dataset.stemming;
      stemmingenEl.querySelectorAll('.zelfeval-stemming-btn').forEach(b => b.classList.toggle('gekozen', b === btn));
      bijwerkenZelfevalIndienKnop();
    });
  });

  const catEl = document.getElementById('zelfeval-categorieen');
  catEl.innerHTML = ZELFEVAL_CATEGORIEEN.map(c => `
    <div class="zelfeval-categorie">
      <h4>${c.titel}</h4>
      ${c.items.map(it => `
        <label class="zelfeval-item"${it.exclusief ? ' style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);font-style:italic;"' : ''}>
          <input type="checkbox" data-cat="${c.id}" data-item="${it.id}"/>
          <span>${it.tekst}</span>
        </label>
      `).join('')}
    </div>
  `).join('');
  catEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const cat = cb.dataset.cat, item = cb.dataset.item;
      const categorie = ZELFEVAL_CATEGORIEEN.find(c => c.id === cat);
      const itemDef = categorie?.items.find(it => it.id === item);
      let lijst = _zelfevalKeuzes.antwoorden[cat];
      if (cb.checked) {
        if (!lijst.includes(item)) lijst.push(item);
        // Sprint 96: "geen aandachtspunten" (exclusief) sluit alle andere vinkjes in
        // dezelfde categorie uit, en omgekeerd — nooit allebei tegelijk mogelijk.
        const andereIds = categorie.items
          .filter(it => (itemDef?.exclusief ? it.id !== item : it.exclusief))
          .map(it => it.id);
        if (andereIds.length) {
          lijst = _zelfevalKeuzes.antwoorden[cat] = lijst.filter(x => !andereIds.includes(x));
          catEl.querySelectorAll(`input[data-cat="${cat}"]`).forEach(andere => {
            if (andereIds.includes(andere.dataset.item)) andere.checked = false;
          });
        }
      } else {
        _zelfevalKeuzes.antwoorden[cat] = lijst.filter(x => x !== item);
      }
      bijwerkenZelfevalIndienKnop();
    });
  });
  bijwerkenZelfevalIndienKnop();
}

function bijwerkenZelfevalIndienKnop() {
  const btn = document.getElementById('zelfeval-indien-btn');
  if (btn) btn.disabled = !zelfevalIsVolledig();
}

// Sprint 90: vervangt de vroegere rechtstreekse onclick="submitAll()" op de
// indienbevestiging — enkel wanneer deze toets de enquête heeft aanstaan, wordt
// eerst de (verplichte) zelfevaluatie getoond; anders wordt meteen ingediend.
function naarIndienenOfZelfevaluatie() {
  if (_state?.selfEvalEnabled) {
    document.getElementById('submit-screen').classList.remove('visible');
    document.getElementById('zelfeval-screen').classList.add('visible');
    renderZelfevaluatieScherm();
  } else {
    submitAll();
  }
}

function closeZelfevaluatieScreen() {
  document.getElementById('zelfeval-screen').classList.remove('visible');
  document.getElementById('submit-screen').classList.add('visible');
}

function submitAll() {
  controleerWeinigToetsen();   // v144
  saveCurrentAnswer(getCurrentCode());
  _afgesloten = true; // Sprint 83: voorkomt een zinloze tabwissel-melding door exitFullscreen()
  updateFullscreenVergrendeling();
  // Sprint 90: de zelfevaluatie (indien van toepassing) gaat mee in DEZELFDE inzending
  // i.p.v. een apart round-trip — zo blijft het indienen atomair en is er geen aparte
  // auth-stap nodig. Een ontbrekende/ongeldige enquête mag de echte inzending nooit
  // blokkeren (zie server.js), maar de knop hier is hoe dan ook pas actief als alles
  // volledig is ingevuld.
  const payload = { answers: _answers };
  if (_state?.selfEvalEnabled && zelfevalIsVolledig()) {
    payload.zelfevaluatie = { stemming: _zelfevalKeuzes.stemming, antwoorden: _zelfevalKeuzes.antwoorden };
  }
  socket.emit('quiz_submit_all', payload);
  // Bugfix (sprint 72): dit telde nog met de oude, onvolledige check (enkel .code)
  // i.p.v. de centrale heeftAntwoord()-functie — exact dezelfde fout als eerder al
  // gevonden in renderNav()/openSubmitScreen(), hier over het hoofd gezien. Een
  // leerling die bv. 10 keuzevragen volledig invulde, zag hier dus "3 van 10"
  // staan (enkel de code-/open-vragen werden meegeteld), terwijl alles wel degelijk
  // correct werd ingediend en opgeslagen.
  const questions = _state?.questions || [];
  const aantalBeantwoord = questions.filter(q => heeftAntwoord(q, _answers[q.id])).length;
  showDoneScreen(urlName, aantalBeantwoord);
}

// ── v105: ingediend = definitief dicht (terug-knop, herladen, bfcache) ─────────────────────
// De server is de echte grendel (stuurt na indienen geen vragen meer). Dit is de bijhorende
// client-kant: onthoud 'ingediend' per toets+leerling, wis de vragen uit het scherm en uit het
// geheugen, en laat de terug-knop nooit naar een zichtbare vraag terugkeren.
function _ingediendSleutel() { return 'pycf_ingediend_' + (urlCode || '') + '_' + (urlName || '').toLowerCase(); }
function markeerIngediend(waar) {
  try { if (waar) sessionStorage.setItem(_ingediendSleutel(), '1'); else sessionStorage.removeItem(_ingediendSleutel()); } catch (e) { /* opslag optioneel */ }
}
function isIngediendOnthouden() {
  try { return sessionStorage.getItem(_ingediendSleutel()) === '1'; } catch (e) { return false; }
}
function wisVragenUitScherm() {
  try {
    const qs = document.getElementById('quiz-screen');
    if (qs) { qs.style.display = 'none'; qs.querySelectorAll('textarea, .monaco-editor, [id^="q-"], #question-text, #question-area').forEach(el => { if (el.tagName === 'TEXTAREA') el.value = ''; }); }
    document.querySelectorAll('.question-text, #question-text, #q-text, .qs-question').forEach(el => { el.textContent = ''; });
    if (_state) { _state.questions = []; }
    _answers = {};
    // Lokale kopieën van vragen/antwoorden (indien aanwezig) weg; naam en klas blijven bewust staan.
    try { Object.keys(localStorage).filter(k => /^(pycf_(draft|quiz|answers)|quiz_(draft|answers))/i.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ok */ }
  } catch (e) { /* nooit blokkeren */ }
}
function _houIngediendScherm() {
  const done = document.getElementById('done-screen');
  if (!done) return;
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('start-screen').style.display = 'none';
  done.style.display = 'block'; done.classList.add('visible');
}
// Terug-knop: een extra geschiedenisstap zodat "terug" op het eindscherm blijft.
let _doneGeschiedenis = false;
function _zetGeschiedenisGrendel() {
  if (_doneGeschiedenis) return;
  _doneGeschiedenis = true;
  try { history.pushState({ pycfDone: 1 }, '', location.href); } catch (e) { /* optioneel */ }
}
window.addEventListener('popstate', () => {
  if (isIngediendOnthouden()) {
    try { history.pushState({ pycfDone: 1 }, '', location.href); } catch (e) { /* optioneel */ }
    _houIngediendScherm();
  }
});
// Bevroren pagina (bfcache) terug in beeld: nooit een zichtbare vraag tonen. De server
// beslist opnieuw (herlaad); intussen meteen het eindscherm als we weten dat het ingediend is.
window.addEventListener('pageshow', (ev) => {
  if (isIngediendOnthouden()) _houIngediendScherm();
  if (ev.persisted) location.reload();
});
if (isIngediendOnthouden()) { document.addEventListener('DOMContentLoaded', _houIngediendScherm); }

function showDoneScreen(name, count) {
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('submit-screen').classList.remove('visible');
  document.getElementById('zelfeval-screen').classList.remove('visible'); // Sprint 90
  annuleerTabwisselRespijt(); // Sprint 92: nooit een respijt-overlay laten "hangen" op het eindscherm
  document.getElementById('done-screen').style.display = 'block';
  document.getElementById('done-screen').classList.add('visible');
  document.getElementById('done-info').textContent =
    `${name} · ${count} van ${_state?.totalQuestions || _state?.questions?.length || '?'} vragen beantwoord`;
  if (_state && !_state.totalQuestions) _state.totalQuestions = (_state.questions || []).length;
  wisVragenUitScherm();
  markeerIngediend(true);
  _zetGeschiedenisGrendel();
  // Sprint 83: geen reden meer om de leerling in volledig scherm vast te houden zodra
  // de toets/taak effectief ingediend is (ook bij automatisch indienen door tabwissel).
  if (document.fullscreenElement) { try { document.exitFullscreen().catch(() => {}); } catch (e) {} }
}

// Bugfix (kritiek, sprint 74): submitAll() toonde het "ingediend"-scherm voorheen
// meteen bij het VERSTUREN van quiz_submit_all, zonder ooit te luisteren naar het
// antwoord van de server — een mislukte opslag (bv. door een netwerkprobleem) bleef
// zo volledig onopgemerkt, ook voor de leerling zelf. Nu wordt, zodra de server
// effectief bevestigt, gecontroleerd of alles ook echt goed opgeslagen is.
socket.on('quiz_submitted_ok', (data) => {
  if (data?.mislukteVragen?.length) {
    const waarschuwing = document.createElement('div');
    waarschuwing.style.cssText = 'margin-top:14px;padding:12px 16px;background:#fef2f2;' +
      'border:1.5px solid #dc2626;border-radius:10px;color:#991b1b;font-weight:600;font-size:0.92rem;';
    waarschuwing.textContent = `⚠️ Let op: ${data.mislukteVragen.length} van je antwoorden kon(den) niet ` +
      'correct opgeslagen worden door een technisch probleem. Verwittig onmiddellijk je leerkracht.';
    document.getElementById('done-info')?.insertAdjacentElement('afterend', waarschuwing);
  }
});

// v146: toets/taak zonder teller: enkel een deadline ("wordt automatisch ingediend op …") of helemaal niets.
function formatIndienOp(ms) {
  return new Date(ms).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' om');
}
function toonGeenTeller(modus, indienOp) {
  const timerEl = document.getElementById('quiz-timer');
  if (!timerEl) return;
  if (!_noTimer) { timerEl.style.opacity = ''; return; }
  if (modus === 'deadline' && indienOp) {
    timerEl.textContent = '📤 ' + new Date(indienOp).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    timerEl.title = 'Wordt automatisch ingediend op ' + formatIndienOp(indienOp);
    timerEl.style.opacity = '1';
  } else {
    timerEl.textContent = '∞';
    timerEl.title = 'Geen tijdslimiet';
    timerEl.style.opacity = '0.5';
  }
}
// v146: de leerkracht paste de deadline aan tijdens de toets → nieuwe teller of nieuwe indientijd
socket.on('quiz_tijd_wijziging', ({ timerSeconds, modus, indienOp, startedAt } = {}) => {
  if (startedAt) _startedAt = startedAt;
  _totalSeconds = timerSeconds || null;
  _noTimer = !_totalSeconds;
  if (_noTimer) { if (_timerInterval) clearInterval(_timerInterval); toonGeenTeller(modus, indienOp); }
  else { const el = document.getElementById('quiz-timer'); if (el) el.style.opacity = ''; startTimer(); }
  const b = document.getElementById('warning-banner');
  if (b) {
    b.textContent = _noTimer
      ? (indienOp ? '⏰ De deadline is aangepast: nieuwe indientijd ' + formatIndienOp(indienOp) + '.' : '⏰ De deadline is aangepast.')
      : '⏰ De deadline is aangepast: je tijd is bijgewerkt.';
    b.classList.add('visible'); setTimeout(() => b.classList.remove('visible'), 15000);
  }
});

// ── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  if (_noTimer || !_totalSeconds) return; // Geen timer bij taak
  if (_timerInterval) clearInterval(_timerInterval);
  const endAt = (_startedAt || Date.now()) + _totalSeconds * 1000;
  _timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    updateTimerDisplay(remaining, _totalSeconds);
    if (remaining <= 0) clearInterval(_timerInterval);
  }, 1000);
}

function updateTimerDisplay(remaining, total) {
  const el = document.getElementById('quiz-timer');
  const m = Math.floor(remaining / 60).toString().padStart(2, '0');
  const s = (remaining % 60).toString().padStart(2, '0');
  el.textContent = `${m}:${s}`;
  el.className = 'quiz-timer';
  if (remaining <= total * 0.10) el.classList.add(remaining <= 60 ? 'danger' : 'warning');
}

// Sessie code opvragen als niet in URL
if (!urlCode) {
  (async () => { const code = await window.pyPrompt({ title: 'Toetscode', body: 'Voer de toetscode in:', confirmLabel: 'Openen' });
  if (code) location.href = `/quiz-student.html?code=${code.trim().toUpperCase()}&name=${encodeURIComponent(urlName)}&class=${encodeURIComponent(urlClass)}`;
  })();
}
