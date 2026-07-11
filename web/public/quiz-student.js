// PyCodeFlow — geextraheerd uit quiz-student.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

// ── Quiz student logica ──────────────────────────────────────────────────────
const socket = io();
let _state = null;        // volledige quiz state van server
let _currentIdx = 0;      // huidige vraag index (in persoonlijke volgorde)
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
if (_isReviewEntry) {
  document.addEventListener('DOMContentLoaded', () => {
    const start = document.getElementById('start-screen');
    if (start) start.style.display = 'none';
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

function renderVraagKaart(v) {
  const scoreTekst = v.beoordeeld
    ? `<strong>${v.score}</strong> / ${v.punten}`
    : `<span class="muted">nog niet beoordeeld</span>`;

  let antwoordHtml;
  if (v.type === 'multiple' || v.type === 'single') {
    // 37b: juiste antwoorden onthuld. Groen ✓ = juist, rood ✗ = fout gekozen.
    antwoordHtml = `<ul style="list-style:none;padding:0;margin:8px 0 0;">` +
      (v.opties || []).map(o => {
        const juist = o.correct === true;
        const foutGekozen = o.gekozen && !juist;
        let bg = 'var(--surface-soft)', mark = '○';
        if (juist) { bg = '#dcfce7'; mark = '✓'; }
        else if (foutGekozen) { bg = '#fee2e2'; mark = '✗'; }
        const labels = [];
        if (o.gekozen) labels.push('jouw keuze');
        if (juist) labels.push('juist');
        return `
        <li style="padding:6px 10px;border-radius:8px;margin-bottom:4px;background:${bg};
                   ${o.gekozen ? 'font-weight:600;' : ''}">
          ${mark} ${escHtml(o.text)}
          ${labels.length ? `<span class="muted" style="font-size:0.8rem;font-weight:400;"> — ${labels.join(', ')}</span>` : ''}
        </li>`;
      }).join('') + `</ul>`;
  } else if (v.eigenCode && v.eigenCode.trim()) {
    antwoordHtml = `<pre style="background:#1e1e1e;color:#d4d4d4;padding:10px 12px;border-radius:8px;
      overflow:auto;font-size:0.85rem;margin:8px 0 0;">${escHtml(v.eigenCode)}</pre>`;
  } else {
    antwoordHtml = `<p class="muted" style="margin:8px 0 0;">Je hebt deze vraag niet ingevuld.</p>`;
  }

  // 37b: modelantwoord/modelcode van de leerkracht (indien ingevuld), via Markdown.
  const modelHtml = v.modelAnswer ? `
    <div style="margin-top:10px;">
      <div style="font-size:0.85rem;color:var(--muted);margin-bottom:4px;">✅ Modelantwoord:</div>
      <div class="md-preview" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;">
        ${renderMarkdown(v.modelAnswer)}
      </div>
    </div>` : '';

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
    <div style="margin-top:10px;font-size:0.85rem;color:var(--muted);">Jouw antwoord:</div>
    ${antwoordHtml}
    ${modelHtml}
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

// Vul startscherm
document.getElementById('start-student-name').textContent = urlName || '(naam ontbreekt)';
document.getElementById('start-student-class').textContent = urlClass || '(geen klas)';
if (!urlName) {
  document.getElementById('start-session-name').textContent = 'Naam ontbreekt';
  document.querySelector('.start-card button').disabled = true;
}

function startQuiz() {
  socket.emit('quiz_start', { code: urlCode, name: urlName, className: urlClass });
}

socket.on('quiz_state', async (state) => {
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

socket.on('quiz_force_submit', () => {
  const code = getCurrentCode();
  if (_currentQuestionId) saveCurrentAnswer(code);
  showDoneScreen(urlName, Object.keys(_answers).length);
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
  await pyAlert(typeof msg === 'string' ? msg : msg.message || 'Fout', "error");
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
  return editorStore?.quiz?.getValue() || '';
}

function setEditorCode(code) {
  if (editorStore?.quiz) {
    const model = editorStore.quiz.getModel();
    model.setValue(code || '');
  }
}

// ── Vraagtype helpers ────────────────────────────────────────────────────────
let _currentChoices = [];       // choices van huidige vraag
let _selectedChoices = [];      // geselecteerde choice IDs

function showQuestionPanel(type) {
  document.getElementById('panel-code').style.display   = type === 'code' ? '' : 'none';
  document.getElementById('panel-open').style.display   = type === 'open' ? '' : 'none';
  document.getElementById('panel-choice').style.display = ['single','multiple'].includes(type) ? '' : 'none';
  document.getElementById('quiz-run-btn').style.display = type === 'code' ? '' : 'none';
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
  } else {
    return { code: '', selectedChoices: _selectedChoices };
  }
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
    return `<button class="${cls}" onclick="goToQuestion(${i})" title="Vraag ${i+1}">${i+1}</button>`;
  }).join('');
  document.getElementById('qs-progress').textContent =
    `${_currentIdx+1}/${questions.length} · ${Object.keys(_answers).filter(k=>_answers[k]?.code).length} opgeslagen`;
}

function goToQuestion(idx) {
  const questions = _state?.questions || [];
  if (idx < 0 || idx >= questions.length) return;

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
    const typeLabel = {code:'🐍 Code',open:'✏️ Open vraag',single:'◉ Single choice',multiple:'☑ Meerkeuze'}[qType] || '';
    document.getElementById('q-header').textContent =
      `Vraag ${idx+1} van ${questions.length} · ${q.subject || ''} · ${q.points} punten · ${typeLabel}`;
    // Sprint 19f: Markdown rendering
    
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
  showQuestionPanel(qType);

  // Herstel antwoord
  const savedAns = _answers[q.id];
  if (qType === 'code') {
    setEditorCode(savedAns?.code || '');
    const out = document.getElementById('quiz-output-panel');
    if (out) out.textContent = '';
  } else if (qType === 'open') {
    const ta = document.getElementById('quiz-open-answer');
    if (ta) { ta.value = savedAns?.code || ''; updateOpenCount(); }
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

function navigate(dir) {
  goToQuestion(_currentIdx + dir);
}

function saveCurrentAnswer(code) {
  if (!_currentQuestionId) return;
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  const ans = getCurrentAnswer();
  _answers[_currentQuestionId].code = ans.code;
  _answers[_currentQuestionId].selectedChoices = ans.selectedChoices;
  _answers[_currentQuestionId].runCount = _runCount[_currentQuestionId] || 0;

  socket.emit('quiz_save_answer', {
    questionId: _currentQuestionId,
    code: ans.code,
    selectedChoices: ans.selectedChoices,
    runCount: _runCount[_currentQuestionId] || 0,
    firstVisitAt: _answers[_currentQuestionId]?.firstVisitAt || null,
    firstRunAt: _answers[_currentQuestionId]?.firstRunAt || null,
    currentQuestion: _currentIdx,
  });
}

// ── Code uitvoeren ──────────────────────────────────────────────────────────
function runCode() {
  const code = getCurrentCode();
  if (!code.trim()) return;
  document.getElementById('quiz-output-panel').textContent = '';

  // Track first run
  if (!_answers[_currentQuestionId]) _answers[_currentQuestionId] = {};
  if (!_answers[_currentQuestionId].firstRunAt) {
    _answers[_currentQuestionId].firstRunAt = Date.now();
  }
  _runCount[_currentQuestionId] = (_runCount[_currentQuestionId] || 0) + 1;
  _answers[_currentQuestionId].runCount = _runCount[_currentQuestionId];

  // Sla run history op
  socket.emit('quiz_run_completed', { questionId: _currentQuestionId, code });

  // Gebruik bestaande run-logica via socket
  socket.emit('free_run_request', { codeText: code });
  renderNav();
}

// Hergebruik output events van app.js
socket.on('free_run_output', ({ output }) => {
  const panel = document.getElementById('quiz-output-panel');
  panel.textContent += output;
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
  socket.emit('free_runtime_input', { value: val });
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
