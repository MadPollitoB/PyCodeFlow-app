// PyCodeFlow — geextraheerd uit quiz-student.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

// ── Quiz student logica ──────────────────────────────────────────────────────
const socket = io();
let _state = null;        // volledige quiz state van server
let _currentIdx = 0;      // huidige vraag index (in persoonlijke volgorde)
let _afgesloten = false;  // Sprint 70: toets automatisch of door de leerkracht afgesloten
let _answers = {};        // { questionId: { code, runCount, firstVisitAt, firstRunAt } }
let _visited = new Set(); // bezochte vraag IDs
let _timerInterval = null;

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
    const label = v.beoordeeld ? `${v.score}/${max}` : '?';
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
    const scoreTekst = o.beoordeeld ? `${o.score}/${o.punten}` : `? / ${o.punten}`;
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

function renderVraagKaart(v) {
  const scoreTekst = v.beoordeeld
    ? `<strong>${v.score}</strong> / ${v.punten}`
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
          ${totaal} <span style="font-size:1rem;font-weight:400;color:var(--muted);">/ ${maxTotaal} punten (${pct}%)</span>
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
  document.querySelector('.start-card button').disabled = true;
}

// Sprint 46: laadstatus + time-out zodat het startscherm nooit stil blijft hangen
// als quiz_start faalt (lege naam, dubbele verbinding, config weg, netwerk, …).
let _startTimeout = null;
function _showStartError(msg) {
  const info = document.getElementById('start-info');
  if (info) { info.textContent = msg; info.style.color = '#991b1b'; info.style.fontWeight = '700'; }
  const btn = document.querySelector('.start-card button');
  if (btn) { btn.disabled = false; btn.textContent = '🚀 START TOETS'; }
}
function _clearStartTimeout() { if (_startTimeout) { clearTimeout(_startTimeout); _startTimeout = null; } }

// ── Sprint 69: spelregels tonen VÓÓR de timer loopt ─────────────────────────
// De popup verschijnt altijd, ook zonder bijzondere instellingen: zo weet de leerling
// precies wanneer zijn tijd begint te lopen en wat de regels zijn. De tekst hangt af van
// de instellingen, die we vooraf ophalen (quiz_state komt pas ná het starten).
let _startInfo = null;
async function haalStartInfo() {
  try {
    const r = await fetch('/api/quiz/' + encodeURIComponent(urlCode) + '/startinfo');
    if (r.ok) _startInfo = await r.json();
  } catch (e) { /* stil: de popup toont dan de algemene tekst */ }
  // Startscherm bijwerken: de vaste regel over terugbladeren klopt niet altijd meer.
  const uitleg = document.getElementById('start-regels');
  if (uitleg && _startInfo) {
    uitleg.textContent = _startInfo.noBack
      ? 'Let op: je kan niet terugkeren naar een vorige vraag.'
      : 'Je kan op elk moment opslaan en terugkeren naar vorige vragen.';
  }
}
haalStartInfo();

async function startQuiz() {
  const soort = _startInfo?.type === 'taak' ? 'taak' : 'toets';
  const regels = [];
  if (_startInfo?.noBack) {
    regels.push('⚠️ <strong>Je krijgt één kans per vraag.</strong> Ga je naar de volgende vraag, dan kan je <strong>niet meer terug</strong>.');
  } else {
    regels.push('Je kan tussen de vragen heen en weer bladeren en je antwoorden aanpassen.');
  }
  if (_startInfo && !_startInfo.noTimer && _startInfo.timerSeconds) {
    regels.push(`Je hebt <strong>${Math.round(_startInfo.timerSeconds / 60)} minuten</strong>. De tijd start zodra je op Starten klikt en loopt door, ook als je de pagina sluit.`);
  }
  if (_startInfo?.questionCount) {
    regels.push(`Deze ${soort} bevat <strong>${_startInfo.questionCount} vragen</strong>.`);
  }
  regels.push('Je antwoorden worden automatisch bewaard.');

  const bevestigd = await window.pyConfirm({
    title: (_startInfo?.noBack ? '⚠️ Let op — ' : '') + soort.charAt(0).toUpperCase() + soort.slice(1) + ' starten',
    body: '<ul style="text-align:left;margin:0;padding-left:18px;">'
        + regels.map(r => '<li style="margin-bottom:6px;">' + r + '</li>').join('')
        + '</ul>',
    confirmLabel: 'Starten',
    cancelLabel: 'Nog even wachten',
  });
  if (!bevestigd) return;
  _doeStart();
}

function _doeStart() {
  const btn = document.querySelector('.start-card button');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Bezig met laden…'; }
  const info = document.getElementById('start-info');
  if (info) { info.textContent = 'Bezig met laden…'; info.style.color = ''; info.style.fontWeight = ''; }
  _clearStartTimeout();
  _startTimeout = setTimeout(function() {
    _showStartError('De toets laadt niet. Ververs de pagina of controleer met je leerkracht dat de toets openstaat.');
  }, 10000);
  socket.emit('quiz_start', { code: urlCode, name: urlName, className: urlClass });
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

  if (state.submitted) { showDoneScreen(state.studentName, Object.keys(_answers).length); return; }
  if (state.paused) document.getElementById('pause-overlay').classList.add('visible');

  // Verberg timer bij taken zonder tijdslimiet
  const timerEl = document.getElementById('quiz-timer');
  if (_noTimer && timerEl) {
    timerEl.textContent = '∞';
    timerEl.title = 'Geen tijdslimiet';
    timerEl.style.opacity = '0.5';
  }

  // Initialiseer editor
  await initQuizEditor(state.config || {});
  renderNav();
  goToQuestion(0);
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
  showDoneScreen(urlName, Object.keys(_answers).length);

  const reden = (data && data.reden) || (data && data.reason) || '';
  const tekst =
    reden === 'timer'    ? 'Je tijd is om. Je toets is automatisch ingeleverd met alles wat je tot nu toe hebt gemaakt.'
  : reden === 'deadline' ? 'De deadline is bereikt. Je werk is automatisch ingeleverd.'
  : reden === 'gestopt'  ? 'Je leerkracht heeft de toets afgesloten. Je werk is ingeleverd zoals het op dit moment was.'
  :                        'De toets is afgesloten. Je werk is ingeleverd.';
  window.pyAlert(tekst + ' Je kan niets meer aanpassen.', 'warn');
});

socket.on('quiz_paused', ({ paused }) => {
  document.getElementById('pause-overlay').classList.toggle('visible', paused);
});

socket.on('quiz_reset', () => {
  _answers = {}; _visited.clear(); _runCount = {}; _currentIdx = 0;
  document.getElementById('done-screen').classList.remove('visible');
  document.getElementById('submit-screen').classList.remove('visible');
  document.getElementById('start-screen').style.display = 'flex';
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('done-screen').style.display = 'none';
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
}

function updateOpenCount() {
  const ta = document.getElementById('quiz-open-answer');
  document.getElementById('open-char-count').textContent = ta.value.length;
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
function renderNav() {
  const questions = _state?.questions || [];
  const nav = document.getElementById('quiz-nav');
  nav.innerHTML = questions.map((q, i) => {
    const qid = q.id;
    let cls = 'qnav-btn';
    if (i === _currentIdx) cls += ' current';
    else if (_answers[qid]?.code) {
      cls += _runCount[qid] > 0 ? ' saved' : ' no-run';
    } else if (_visited.has(qid)) {
      cls += ' visited';
    }
    // Sprint 69: bij noBack zijn eerdere vragen niet meer bereikbaar.
    const geblokkeerd = _state?.noBack && i < _currentIdx;
    if (geblokkeerd) cls += ' locked';
    return `<button class="${cls}"${geblokkeerd
      ? ' disabled style="opacity:.45;cursor:not-allowed;" title="Afgerond — terugkeren kan niet bij deze toets"'
      : ` onclick="goToQuestion(${i})" title="Vraag ${i+1}"`}>${i+1}</button>`;
  }).join('');
  document.getElementById('qs-progress').textContent =
    `${_currentIdx+1}/${questions.length} · ${Object.keys(_answers).filter(k=>_answers[k]?.code).length} opgeslagen`;
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

function goToQuestion(idx) {
  const questions = _state?.questions || [];
  if (idx < 0 || idx >= questions.length) return;

  // Sprint 69: bij "1 kans per vraag" kan je enkel vooruit. De server bepaalt dit
  // (state.noBack); de knoppen zijn ook uitgeschakeld, dit is de harde grendel.
  if (_state?.noBack && idx < _currentIdx) return;

  // Sla huidige vraag op voor navigatie
  if (_currentQuestionId) {
    const code = getCurrentCode();
    saveCurrentAnswer(code);
  }

  _currentIdx = idx;
  const q = questions[idx];
  _currentQuestionId = q.id;

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
    const typeLabel = {code:'🐍 Code',open:'✏️ Open vraag',single:'◉ Single choice',multiple:'☑ Meerkeuze',composite:'🧩 Samengestelde vraag'}[qType] || '';
    document.getElementById('q-header').textContent =
      `Vraag ${idx+1} van ${questions.length} · ${q.subject || ''} · ${q.points} punten · ${typeLabel}`;
    // Sprint 19f: Markdown rendering
    const qTextEl = document.getElementById('q-text');
    const rawText = q.text_snapshot || q.text || '';
    if (window.marked) {
      qTextEl.innerHTML = renderMarkdown(rawText);
    } else {
      qTextEl.textContent = rawText;
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
              ${(p.choices || []).map(c => `
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
  } else {
    // single / multiple
    try {
      const choices = JSON.parse(q.choices_json || '[]');
      const selected = savedAns?.selectedChoices || [];
      renderChoices(choices, qType, selected);
    } catch { renderChoices([], qType, []); }
  }

  // Navigatieknoppen
  document.getElementById('quiz-prev-btn').disabled = idx === 0;
  document.getElementById('quiz-next-btn').textContent =
    idx === questions.length - 1 ? 'Laatste vraag' : 'Volgende →';

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

function saveCurrentAnswer(code) {
  if (!_currentQuestionId) return;
  // Sprint 70: na een geforceerde inlevering mag er niets meer bijkomen. De ene
  // opslag die de afsluiting zelf doet, gebeurt vóór deze vlag wordt gezet.
  if (_afgesloten) return;
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  const ans = getCurrentAnswer();
  _answers[_currentQuestionId].code = ans.code;
  _answers[_currentQuestionId].selectedChoices = ans.selectedChoices;
  _answers[_currentQuestionId].runCount = _runCount[_currentQuestionId] || 0;
  if (ans.partAnswers) _answers[_currentQuestionId].partAnswers = ans.partAnswers;

  socket.emit('quiz_save_answer', {
    questionId: _currentQuestionId,
    code: ans.code,
    selectedChoices: ans.selectedChoices,
    runCount: _runCount[_currentQuestionId] || 0,
    firstVisitAt: _answers[_currentQuestionId]?.firstVisitAt || null,
    firstRunAt: _answers[_currentQuestionId]?.firstRunAt || null,
    currentQuestion: _currentIdx,
    partAnswers: ans.partAnswers || undefined,
  });
}

// ── Code uitvoeren ──────────────────────────────────────────────────────────
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
  socket.emit('quiz_run_request', { codeText: code });
  renderNav();
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
socket.on('free_input_request', () => {
  document.getElementById('quiz-wait-input').style.display = 'block';
  document.getElementById('quiz-input-wrap').style.display = 'block';
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
    const hasCode = ans?.code?.trim();
    const hasChoices = (ans?.selectedChoices || []).length > 0;
    const hasRun = (ans?.runCount || 0) > 0;
    const hasAnswer = qType === 'code' ? hasCode : qType === 'open' ? hasCode : hasChoices;
    let icon, msg;
    if (qType === 'code') {
      if (hasCode && hasRun) { icon = '✅'; msg = `Vraag ${i+1} — opgeslagen (${ans.runCount} run${ans.runCount !== 1?'s':''})`; }
      else if (hasCode && !hasRun) { icon = '⚠️'; msg = `Vraag ${i+1} — opgeslagen maar nooit uitgevoerd`; }
      else if (!hasCode && _visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen code`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    } else if (qType === 'open') {
      if (hasCode) { icon = '✅'; msg = `Vraag ${i+1} — antwoord opgeslagen`; }
      else if (_visited.has(q.id)) { icon = '⚠️'; msg = `Vraag ${i+1} — bezocht maar geen antwoord`; }
      else { icon = '⚠️'; msg = `Vraag ${i+1} — nog niet bezocht`; }
    } else {
      if (hasChoices) { icon = '✅'; msg = `Vraag ${i+1} — keuze opgeslagen`; }
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

function submitAll() {
  saveCurrentAnswer(getCurrentCode());
  socket.emit('quiz_submit_all', { answers: _answers });
  showDoneScreen(urlName, Object.keys(_answers).filter(k => _answers[k]?.code).length);
}

function showDoneScreen(name, count) {
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('submit-screen').classList.remove('visible');
  document.getElementById('done-screen').style.display = 'block';
  document.getElementById('done-screen').classList.add('visible');
  document.getElementById('done-info').textContent =
    `${name} · ${count} van ${_state?.questions?.length || '?'} vragen beantwoord`;
}

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
  const code = prompt('Voer de toetscode in:');
  if (code) location.href = `/quiz-student.html?code=${code.trim().toUpperCase()}&name=${encodeURIComponent(urlName)}&class=${encodeURIComponent(urlClass)}`;
}
