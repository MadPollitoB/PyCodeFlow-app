// PyCodeFlow — geextraheerd uit quiz-review.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

const params = new URLSearchParams(location.search);
const sessionCode = params.get('code') || prompt('Toetscode:');
let _questions = [];
let _students = [];      // unieke leerlingen
let _answers = [];       // alle antwoorden
let _scores = {};        // { answerId: { score, comment } }
let _currentStudent = null;
let _currentQIdx = 0;
let _templates = [];
let _simWarnings = [];
let _editMode = false;   // "Aanpassen & testen" modus
let _reviewMode = false; // 37d: staat nakijken open voor leerlingen?
let _resultsReleased = false; // sprint 51-fix: staan resultaten open, ook opnieuw te sluiten
let _originalCode = '';
// Sprint 51-ai (v4): welke answerId(+partId)-combinaties al feedback kregen — gebruikt om
// het feedback-knopje te verbergen bij items die al een verdict hebben.
let _aiFeedbackGegeven = new Set();
let _aiFeedbackContext = null; // { answerId, partId, questionId } van de popup die net open staat


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

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function init() {
  // Laad meta
  const qr = await fetch(`/api/quiz/${sessionCode}`);
  const { session, questions, meta } = await qr.json();
  _questions = questions || [];
  _reviewMode = meta?.review_mode === true;
  _resultsReleased = meta?.results_released === true;
  updateReviewModeBtn();
  updateReleaseBtn();
  document.getElementById('review-title').textContent =
    (session?.name || 'Toets') + ' — Verbeteren';

  // Laad alle antwoorden
  const ar = await fetch(`/api/quiz/${sessionCode}/answers`);
  _answers = await ar.json();

  // Sprint 51-ai (v4): bestaande feedback-entries — bepaalt welke feedback-knopjes al
  // verborgen moeten zijn (item kreeg al een verdict).
  try {
    const fr = await fetch(`/api/quiz/${sessionCode}/ai-grade/feedback`);
    const { feedback } = await fr.json();
    _aiFeedbackGegeven = new Set((feedback || []).map(f => f.answer_id + '::' + (f.part_id || '')));
  } catch { _aiFeedbackGegeven = new Set(); }

  // Unieke leerlingen
  const seen = new Set();
  _students = _answers.filter(a => {
    if (seen.has(a.student_id)) return false;
    seen.add(a.student_id); return true;
  }).map(a => ({ id: a.student_id, name: a.student_name, class: a.student_class }));

  renderStudentList();

  // Statistieken
  const total = _students.length;
  const scored = _students.filter(s =>
    _answers.filter(a => a.student_id === s.id).every(a => a.score !== null)
  ).length;
  document.getElementById('stats-mini').innerHTML =
    `<div class="chip">👤 ${total} leerlingen</div>
     <div class="chip">✏️ ${scored}/${total} volledig verbeterd</div>
     <div class="chip">❓ ${_questions.length} vragen</div>`;

  // Gelijkenis
  loadSimilarityWarnings();

  // Templates
  const tr = await fetch('/api/quiz/comment-templates');
  _templates = await tr.json();

  // Editor
  await ensureEditor('quiz', '', false, true, {});
}

function renderStudentList() {
  document.getElementById('student-list').innerHTML = _students.map(s => {
    const studentAnswers = _answers.filter(a => a.student_id === s.id);
    const scored = studentAnswers.filter(a => a.score !== null).length;
    const total = _questions.length;
    const totalScore = studentAnswers.reduce((sum, a) => sum + (a.score || 0), 0);
    const maxScore = _questions.reduce((sum, q) => sum + (q.points || 0), 0);
    const isActive = _currentStudent?.id === s.id;
    // Sprint 51o: leerlingen die nooit gestart zijn (aangevuld bij het stoppen/deadline)
    // krijgen een duidelijke "niet deelgenomen"-badge i.p.v. een misleidende score.
    const nietDeelgenomen = studentAnswers.length > 0 && studentAnswers.every(a => a.submitted_by === 'geen_deelname');
    // Sprint 51-fix: gewettigd afwezig krijgt een eigen, blauwe indicator — voorheen zag je
    // in de lijst geen enkel onderscheid met een leerling die gewoon niet kwam opdagen.
    const gewettigdAfwezig = studentAnswers.some(a => a.student_status === 'gewettigd');
    const scoreChip = gewettigdAfwezig
      ? `<span style="color:#1e40af;">🔵 gewettigd afwezig</span>`
      : nietDeelgenomen
        ? `<span style="color:var(--error-fg,#b91c1c);">❌ niet deelgenomen</span>`
        : `${scored}/${total} ✓ ${scored === total ? `· ${totalScore}/${maxScore}pt` : ''}`;
    return `<div class="student-row ${isActive ? 'active' : ''}" onclick="selectStudent('${s.id}')">
      <div><strong>${esc(s.name)}</strong></div>
      <div style="font-size:0.78rem;color:${isActive?'rgba(255,255,255,0.7)':'var(--muted)'};">${esc(s.class || '')}</div>
      <div class="score-chip">${scoreChip}</div>
    </div>`;
  }).join('');
}

function selectStudent(studentId) {
  _currentStudent = _students.find(s => s.id === studentId);
  _currentQIdx = 0;
  _editMode = false;
  renderStudentList();
  renderReviewPanel();
}

// 33b: kleine SVG-staafgrafiek van de score per vraag (score vs. max, geen dependency).
// Groen = volledig, oranje = deels, rood = nul, grijs = nog niet beoordeeld.
function renderProgressChart(studentAnswers) {
  if (!_questions.length) return '';
  const W = 40, GAP = 10, H = 90, pad = 4;
  const bars = _questions.map((q, i) => {
    const ans = studentAnswers.find(a => a.question_id === q.id);
    const scored = ans?.score !== null && ans?.score !== undefined;
    const max = q.points || 1;
    const val = scored ? ans.score : 0;
    const ratio = scored ? Math.max(0, Math.min(1, val / max)) : 0;
    const barH = scored ? Math.max(2, ratio * (H - 20)) : 3;
    const x = i * (W + GAP) + pad;
    const y = H - barH - 16;
    let color = '#cbd5e1'; // grijs = niet beoordeeld
    if (scored) {
      if (ratio >= 0.999) color = 'var(--success-fg, #16a34a)';
      else if (ratio > 0) color = '#f59e0b';
      else color = 'var(--error-fg, #dc2626)';
    }
    const label = scored ? `${val}/${max}` : '?';
    return `<rect x="${x}" y="${y}" width="${W}" height="${barH}" rx="3" fill="${color}"></rect>` +
      `<text x="${x + W/2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--muted,#64748b)">V${i+1}</text>` +
      `<text x="${x + W/2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="var(--text,#334155)">${label}</text>`;
  }).join('');
  const totalW = _questions.length * (W + GAP) + pad;
  return `<div class="progress-chart" style="margin:14px 0;overflow-x:auto;">
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:4px;">📊 Score per vraag</div>
    <svg width="${totalW}" height="${H}" role="img" aria-label="Score per vraag">${bars}</svg>
  </div>`;
}

function renderReviewPanel() {
  if (!_currentStudent) return;
  const studentAnswers = _answers.filter(a => a.student_id === _currentStudent.id);
  const totalScore = studentAnswers.reduce((sum, a) => sum + (a.score || 0), 0);
  const maxScore = _questions.reduce((sum, q) => sum + (q.points || 0), 0);
  const genComment = studentAnswers[0]?.general_comment || '';

  document.getElementById('review-panel').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <h3 style="margin:0;">${esc(_currentStudent.name)}</h3>
      <span class="muted">${esc(_currentStudent.class || '')}</span>
      <span style="margin-left:auto;font-weight:700;">Totaal: ${totalScore}/${maxScore} pt</span>
      <button class="btn btn-muted small" onclick="exportStudent('${_currentStudent.id}',false)">🖨️ PDF</button>
      <button class="btn btn-muted small" onclick="exportStudent('${_currentStudent.id}',true)">🖨️ PDF + scores</button>
    </div>
    <div class="q-tabs" id="q-tabs">
      ${_questions.map((q, i) => {
        const ans = studentAnswers.find(a => a.question_id === q.id);
        const isScored = ans?.score !== null && ans?.score !== undefined;
        return `<div class="q-tab ${isScored ? 'scored' : ''} ${i === _currentQIdx ? 'active' : ''}"
          onclick="selectQuestion(${i})">V${i+1} ${isScored ? ans.score+'/'+q.points : '?/'+q.points}</div>`;
      }).join('')}
    </div>
    ${renderProgressChart(studentAnswers)}
    <div id="q-detail"></div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <strong>Algemeen commentaar</strong>
      <textarea id="general-comment" rows="3" style="width:100%;margin-top:8px;padding:8px;
        border:1.5px solid var(--border);border-radius:8px;font-size:0.88rem;"
        placeholder="Algemeen commentaar voor de leerling...">${esc(genComment)}</textarea>
      <button class="btn btn-muted small" style="margin-top:6px;"
        onclick="saveGeneralComment()">💾 Commentaar opslaan</button>
    </div>`;

  selectQuestion(_currentQIdx);
}

async function selectQuestion(idx) {
  _currentQIdx = idx;
  _editMode = false;
  const q = _questions[idx];
  const studentAnswers = _answers.filter(a => a.student_id === _currentStudent.id);
  const ans = studentAnswers.find(a => a.question_id === q.id);

  // Update tab styling
  document.querySelectorAll('.q-tab').forEach((t, i) => {
    t.className = 'q-tab' + (studentAnswers.find(a=>a.question_id===_questions[i]?.id)?.score !== null &&
      studentAnswers.find(a=>a.question_id===_questions[i]?.id)?.score !== undefined ? ' scored' : '')
      + (i === idx ? ' active' : '');
  });

  // Laad run history
  let history = [];
  if (ans) {
    const hr = await fetch(`/api/quiz/${sessionCode}/run-history/${_currentStudent.id}/${q.id}`);
    history = await hr.json();
  }

  // Gelijkenis waarschuwing voor deze vraag+leerling
  const simWarn = _simWarnings.filter(w =>
    w.questionId === q.id &&
    (w.student1.id === _currentStudent.id || w.student2.id === _currentStudent.id)
  );

  const simHtml = simWarn.map(w => {
    const other = w.student1.id === _currentStudent.id ? w.student2.name : w.student1.name;
    return `<div class="similarity-warning">⚠️ Verdachte gelijkenis met <strong>${esc(other)}</strong> — ${w.similarity}% overeenkomst</div>`;
  }).join('');

  const code = ans?.code || '';
  const score = ans?.score !== null && ans?.score !== undefined ? ans.score : '';
  const comment = ans?.teacher_comment || '';
  const qType = q.question_type || 'code';
  const isAutoScored = ans?.auto_scored;
  // Sprint 51s: duidelijke banner wanneer deze score automatisch op 0 gezet is bij het
  // stoppen — zodat het onderscheid met een leerkracht-gegeven 0 helder blijft.
  // Sprint 51-fix: een gewettigd-afwezige leerling kreeg hier voorheen dezelfde, generieke
  // "niet deelgenomen"-melding als iemand die gewoon spijbelde — geen onderscheid. Nu een
  // eigen, duidelijk blauw bericht (analoog aan het leerling-eigen resultatenscherm).
  const autoZeroHtml = ans?.student_status === 'gewettigd'
    ? `<div class="similarity-warning" style="background:#eff6ff;border-color:#93c5fd;color:#1e40af;">🔵 Deze leerling was gewettigd afwezig — geen score, telt niet mee in het klasgemiddelde.</div>`
    : ans?.submitted_by === 'geen_deelname'
      ? `<div class="similarity-warning" style="background:#fef3c7;border-color:#fde68a;">⚪ Deze leerling heeft niet deelgenomen — score automatisch op 0 gezet bij het stoppen.</div>`
      : ans?.submitted_by === 'niet_beantwoord'
        ? `<div class="similarity-warning" style="background:#fef3c7;border-color:#fde68a;">⚪ Deze vraag werd niet beantwoord — score automatisch op 0 gezet bij het stoppen.</div>`
        : '';
  // Sprint 51-ai: kleine, leerkracht-only banner zodat je meteen ziet welke scores door de
  // AI gezet zijn en steekproefsgewijs kan controleren — de leerling ziet dit nooit (zie
  // db/database.js: ai_graded wordt uitsluitend hier, in het leerkracht-endpoint, meegestuurd).
  // Sprint 51-ai (v4): feedback-knopje ernaast — verdwijnt zodra er al feedback gegeven is
  // voor dit specifieke antwoord (voorkomt herhaalde feedback op hetzelfde item).
  // Sprint 51-fix: bij een samengestelde vraag stond deze badge nooit bovenaan — enkel per
  // onderdeel (want ai_graded op vraagniveau wordt voor zo'n vraag nooit gezet, dat gebeurt
  // per onderdeel via part_ai_graded). Toon 'm hier ook als MINSTENS één onderdeel
  // AI-beoordeeld is — zonder feedback-knop, want die staat al bij elk onderdeel apart.
  const aiFeedbackKey = ans?.id + '::';
  let compositeHeeftAiOnderdeel = false;
  if (qType === 'composite') {
    let vroegePartAiFlags = {};
    try { vroegePartAiFlags = JSON.parse(ans?.part_ai_graded || '{}'); } catch { vroegePartAiFlags = {}; }
    compositeHeeftAiOnderdeel = Object.values(vroegePartAiFlags).some(v => v === true);
  }
  const aiGradedHtml = ans?.ai_graded === true
    ? `<div class="similarity-warning" style="background:#ede9fe;border-color:#ddd6fe;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span>🤖 Deze score/commentaar is door de lokale AI gegenereerd. Controleer gerust en pas aan indien nodig.</span>
        ${_aiFeedbackGegeven.has(aiFeedbackKey) ? '<span class="muted" style="font-size:0.78rem;white-space:nowrap;">✓ feedback gegeven</span>'
          : `<button class="btn btn-muted small" style="white-space:nowrap;" onclick="openAiFeedbackModal('${esc(ans.id)}', null, '${esc(q.id)}')">📝 Feedback</button>`}
      </div>`
    : compositeHeeftAiOnderdeel
      ? `<div class="similarity-warning" style="background:#ede9fe;border-color:#ddd6fe;">🤖 Eén of meer onderdelen van deze vraag zijn door de lokale AI beoordeeld — zie de badges hieronder per onderdeel.</div>`
      : '';

  // Bouw antwoordweergave per vraagtype
  let answerHtml = '';
  if (qType === 'open') {
    answerHtml = `<div class="card" style="padding:14px;margin-bottom:14px;">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">✏️ Open antwoord:</div>
      <div style="font-size:0.93rem;line-height:1.7;white-space:pre-wrap;padding:10px;
        background:var(--surface-soft);border-radius:8px;min-height:60px;">
        ${ans?.code ? esc(ans.code) : '<span style="color:var(--muted);font-style:italic;">(geen antwoord)</span>'}
      </div></div>`;
  } else if (qType === 'single' || qType === 'multiple') {
    try {
      const choices = JSON.parse(q.choices_json || '[]');
      const selected = JSON.parse(ans?.selected_choices || '[]');
      const choiceRows = choices.map(ch => {
        const wasSelected = selected.includes(ch.id);
        const isCorrect   = ch.correct === true;
        let icon='○', bg='var(--surface-soft)', border='var(--border)', color='inherit';
        if (wasSelected && isCorrect)    { icon='✅'; bg='#d1fae5'; border='#6ee7b7'; }
        else if (wasSelected && !isCorrect){ icon='❌'; bg='#fee2e2'; border='#fca5a5'; }
        else if (!wasSelected && isCorrect){ icon='☑'; bg='#fef3c7'; border='#d97706'; color='#92400e'; }
        // 23b: isCode-opties tonen als code-blok
        const textHtml = ch.isCode
          ? `<pre style="background:#1e1e1e;color:#d4d4d4;padding:6px 10px;border-radius:6px;
               font-family:Consolas,monospace;font-size:0.82rem;margin:0;overflow-x:auto;white-space:pre-wrap;">${esc(ch.text)}</pre>`
          : `<span style="font-size:0.93rem;line-height:1.5;">${esc(ch.text)}</span>`;
        return `<div style="padding:10px 12px;border:1.5px solid ${border};border-radius:8px;
          background:${bg};color:${color};display:flex;gap:10px;align-items:flex-start;margin-bottom:6px;">
          <span style="font-size:1.1rem;flex-shrink:0;margin-top:${ch.isCode?'6px':'0'};">${icon}</span>
          <div style="flex:1;min-width:0;">${textHtml}</div>
        </div>`;
      }).join('');
      answerHtml = `<div class="card" style="padding:14px;margin-bottom:14px;">
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px;">
          ${qType==='single'?'◉ Single choice':'☑ Meerkeuze'}
          ${isAutoScored ? ' · <span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:700;">🤖 Auto-gescoord</span>' : ''}
        </div>
        ${choiceRows}
        <div style="margin-top:8px;font-size:0.78rem;color:var(--muted);">
          ✅ Correct gekozen &nbsp; ❌ Fout gekozen &nbsp; ☑ Correct maar niet gekozen
        </div>
      </div>`;
    } catch { answerHtml = '<p class="muted">Keuzes konden niet worden geladen.</p>'; }
  } else if (qType === 'composite') {
    // Sprint 51j: samengestelde vraag — per onderdeel het label, het leerlingantwoord en
    // (indien aanwezig) het modelantwoord. Het code-onderdeel wordt hieronder in het gewone,
    // uitvoerbare code-paneel getoond (dezelfde editor als bij een normale code-vraag).
    // Sprint 51y: single/multiple-onderdelen tonen de gekozen optie(s), met welke correct was.
    let partAnswers = {};
    try { partAnswers = JSON.parse(ans?.part_answers || '{}'); } catch { partAnswers = {}; }
    const parts = parseAnswerPartsReview(q.answer_parts);
    const toonbareParts = parts.filter(p => p.type !== 'code');
    answerHtml = toonbareParts.map(p => {
      if (p.type === 'single' || p.type === 'multiple') {
        const gekozen = Array.isArray(partAnswers[p.id]) ? partAnswers[p.id] : [];
        const opties = (p.choices || []).map(c => {
          const icon = c.correct ? '✅' : (gekozen.includes(c.id) ? '❌' : '⚪');
          const isGekozen = gekozen.includes(c.id);
          return `<div style="padding:4px 0;${isGekozen ? 'font-weight:600;' : ''}">${icon} ${esc(c.text)}${isGekozen ? ' <span class="muted" style="font-weight:normal;">(gekozen)</span>' : ''}</div>`;
        }).join('');
        return `
        <div class="card" style="padding:14px;margin-bottom:10px;">
          <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">${p.type === 'single' ? '◉' : '☑'} ${esc(p.label)}</div>
          ${gekozen.length ? opties : '<p class="muted" style="font-style:italic;margin:4px 0;">(geen antwoord)</p>'}
        </div>`;
      }
      return `
      <div class="card" style="padding:14px;margin-bottom:10px;">
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">✏️ ${esc(p.label)}</div>
        <div style="font-size:0.93rem;line-height:1.6;white-space:pre-wrap;padding:10px;
          background:var(--surface-soft);border-radius:8px;min-height:44px;">
          ${partAnswers[p.id] ? esc(partAnswers[p.id]) : '<span style="color:var(--muted);font-style:italic;">(geen antwoord)</span>'}
        </div>
        ${p.modelAnswer ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--muted);">
          ✅ Modelantwoord: <span style="color:inherit;">${esc(p.modelAnswer)}</span></div>` : ''}
      </div>`;
    }).join('');
  }

  document.getElementById('q-detail').innerHTML = `
    ${simHtml}
    ${autoZeroHtml}
    ${aiGradedHtml}
    <div style="background:var(--surface-soft);border-radius:10px;padding:12px 14px;margin-bottom:12px;">
      <strong>Vraag ${idx+1}:</strong><div class="md-preview" style="margin:4px 0 8px;">${renderMarkdown(q.text_snapshot || q.text || '')}</div>
      <span class="muted" style="font-size:0.82rem;">
        ${esc(q.subject || '')} · Max ${q.points} punten
        ${ans ? ` · Ingediend ${new Date(Number(ans.submitted_at||ans.saved_at)).toLocaleTimeString('nl-BE',{hour:'2-digit',minute:'2-digit'})}
          ${ans.auto_submitted ? '(timer)' : '(handmatig)'}
          ${qType==='code'?` · ${ans.run_count} run${ans.run_count!==1?'s':''}`:''}` : ' · Niet beantwoord'}
      </span>
    </div>
    ${answerHtml}
    ${(() => {
      if (qType === 'code') return true;
      if (qType === 'composite') {
        const parts = parseAnswerPartsReview(q.answer_parts);
        return parts.some(p => p.type === 'code');
      }
      return false;
    })() ? `<div class="editor-shell card" style="margin-bottom:12px;">
      <div class="editor-toolbar">
        <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-soft small" onclick="runReviewCode()">▶ Uitvoeren</button>
        <button id="edit-toggle-btn" class="btn btn-muted small" onclick="toggleEditMode()">✏️ Aanpassen & testen</button>
        <button id="restore-btn" class="btn btn-muted small" style="display:none;" onclick="restoreCode()">↩ Herstel origineel</button>
      </div>
      <div id="review-code-panel" class="editor-frame-wrap">
        <div class="editor-frame">
          <div id="quiz-line-numbers" class="custom-gutter"></div>
          <div id="quiz-editor" class="monaco-editor-host"></div>
        </div>
      </div>
    </div>` : ''}
    <div class="card" style="padding:12px;min-height:60px;margin-bottom:14px;">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:4px;">Output:</div>
      <div id="review-output" class="output-panel output-dark"
        style="min-height:50px;max-height:180px;overflow-y:auto;white-space:pre-wrap;
          font-family:Consolas,monospace;font-size:0.88rem;"></div>
    </div>
    ${history.length > 0 && qType === 'code' ? `
    <details style="margin-bottom:12px;">
      <summary style="cursor:pointer;font-size:0.85rem;color:var(--muted);">
        📜 Run history (${history.length} runs)
      </summary>
      <div class="run-history-list">
        ${history.map((h, i) => `
          <div class="run-history-item" onclick="loadHistoryRun('${escJs(h.code)}')">
            Run ${i+1} — ${new Date(Number(h.ran_at)).toLocaleTimeString('nl-BE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
          </div>`).join('')}
      </div>
    </details>` : ''}
    ${qType === 'composite' ? (() => {
      const parts = parseAnswerPartsReview(q.answer_parts);
      let partScores = {};
      try { partScores = JSON.parse(ans?.part_scores || '{}'); } catch { partScores = {}; }
      let partComments = {};
      try { partComments = JSON.parse(ans?.part_comments || '{}'); } catch { partComments = {}; }
      let partAiFlags = {};
      try { partAiFlags = JSON.parse(ans?.part_ai_graded || '{}'); } catch { partAiFlags = {}; }
      const totaal = Object.values(partScores).reduce((s, v) => s + (v || 0), 0);
      return `<div class="card" style="padding:12px;margin-bottom:14px;">
        <div style="font-size:0.82rem;color:var(--muted);margin-bottom:8px;">Score per onderdeel</div>
        ${parts.map((p, pi) => {
          const label = p.type === 'code' ? '🐍 Code' : esc(p.label || ('Onderdeel ' + (pi + 1)));
          const s = partScores[p.id] !== undefined ? partScores[p.id] : '';
          // Sprint 51-fix: per-onderdeel commentaar EN AI-badge — bestond voorheen niet;
          // het AI-commentaar per onderdeel overschreef per ongeluk de ene, gedeelde
          // "Algemene opmerking" van de hele vraag (zie db/database.js).
          const partFeedbackKey = ans?.id + '::' + p.id;
          const aiBadge = partAiFlags[p.id] === true
            ? `<span class="badge" style="background:#ede9fe;color:#5b21b6;font-size:0.72rem;margin-left:6px;" title="Door de lokale AI beoordeeld — controleer gerust en pas aan indien nodig.">🤖 AI</span>
               ${_aiFeedbackGegeven.has(partFeedbackKey) ? '<span class="muted" style="font-size:0.72rem;margin-left:4px;">✓ feedback</span>'
                 : `<button class="btn btn-muted small" style="font-size:0.7rem;padding:2px 8px;margin-left:4px;" onclick="openAiFeedbackModal('${esc(ans?.id||'')}', '${esc(p.id)}', '${esc(p.id)}')">📝</button>`}`
            : '';
          return `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
              <span style="flex:1;font-size:0.88rem;">${label}${aiBadge}</span>
              <input type="number" class="part-score-input" data-part-id="${p.id}" value="${s}" min="0" max="${p.points}" placeholder="—" style="width:70px;"/>
              <span class="muted" style="font-size:0.82rem;">/ ${p.points}</span>
            </div>
            <textarea class="part-comment-input" data-part-id="${p.id}" placeholder="Opmerking bij dit onderdeel…"
              style="width:100%;min-height:44px;font-size:0.85rem;">${esc(partComments[p.id] || '')}</textarea>
          </div>`;
        }).join('')}
        <div style="margin-top:4px;padding-top:8px;font-size:0.88rem;font-weight:700;">
          Totaal: ${totaal} / ${q.points}
        </div>
        <button class="btn btn-soft small" style="margin-top:8px;" onclick="savePartScores('${ans?.id||''}', ${idx})">💾 Onderdeelscores &amp; opmerkingen opslaan</button>
      </div>`;
    })() : `
    <div class="score-row">
      <div>
        <label style="font-size:0.82rem;color:var(--muted);display:block;margin-bottom:4px;">Score</label>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" id="score-input" value="${score}" min="0" max="${q.points}" placeholder="—"/>
          <span class="muted">/ ${q.points}</span>
        </div>
      </div>
      <div style="flex:1;">
        <label style="font-size:0.82rem;color:var(--muted);display:block;margin-bottom:4px;">Opmerking</label>
        <textarea id="comment-input" placeholder="Opmerking...">${esc(comment)}</textarea>
        ${_templates.length > 0 ? `<div class="template-chips">
          ${_templates.map(t => `<div class="template-chip" onclick="useTemplate('${escJs(t.text)}')">${esc(t.text.slice(0,30))}</div>`).join('')}
          <div class="template-chip" style="color:var(--muted);" onclick="addTemplate()">+ Eigen template</div>
        </div>` : `<div style="margin-top:4px;"><button class="btn btn-muted small" onclick="addTemplate()" style="font-size:0.78rem;">+ Commentaar template toevoegen</button></div>`}
      </div>
    </div>`}
    <details style="margin-top:10px;" ${q.model_answer ? 'open' : ''}>
      <summary style="cursor:pointer;font-size:0.85rem;color:var(--muted);">
        ✅ Modelantwoord ${q.model_answer ? '(ingevuld)' : '(nog leeg)'}
      </summary>
      <textarea id="model-input" placeholder="Modelantwoord / modelcode die leerlingen bij het nakijken zien…"
        style="font-family:monospace;font-size:0.85rem;width:100%;min-height:80px;margin-top:6px;">${esc(q.model_answer || '')}</textarea>
      <button class="btn btn-muted small" style="margin-top:6px;"
        onclick="saveModelAnswer('${esc(q.id)}')">💾 Modelantwoord opslaan</button>
    </details>
    ${qType === 'composite' ? '' : `<div style="margin-top:10px;display:flex;gap:8px;">
      <button class="btn btn-soft small" onclick="saveScore('${ans?.id||''}', ${idx}, '${q.id}')">💾 Opslaan</button>
      ${idx < _questions.length - 1 ? `<button class="btn btn-muted small" onclick="saveAndNext('${ans?.id||''}',${idx}, '${q.id}')">💾 Opslaan & volgende →</button>` : ''}
    </div>`}`;

  // Laad code in editor (code-vragen, en composite-vragen met een code-onderdeel)
  _originalCode = code;
  if (qType === 'code') {
    // Sprint 51c: #q-detail (en dus #quiz-editor) is zonet opnieuw opgebouwd. We (her)mounten
    // de Monaco-editor op de verse host mét de leerlingcode; ensureEditor gooit een eventuele
    // losgekoppelde instance weg en bouwt opnieuw. Vroeger deed setEditorValue niets omdat de
    // editor nooit gemount was → de code bleef onzichtbaar.
    await ensureEditor('quiz', code || '// Geen antwoord ingediend', false, true);
    setQuizEditorReadOnly(true);
  } else if (qType === 'composite') {
    // Sprint 51j: het code-onderdeel (indien aanwezig) gebruikt dezelfde, altijd uitvoerbare
    // editor. De code staat in part_answers[codePart.id], niet in de 'code'-kolom van ans.
    const parts = parseAnswerPartsReview(q.answer_parts);
    const codePart = parts.find(p => p.type === 'code');
    if (codePart) {
      let partAnswers = {};
      try { partAnswers = JSON.parse(ans?.part_answers || '{}'); } catch { partAnswers = {}; }
      const codeVal = partAnswers[codePart.id] || '';
      _originalCode = codeVal;
      await ensureEditor('quiz', codeVal || '// Geen antwoord ingediend', false, true);
      setQuizEditorReadOnly(true);
    }
  }
  const out = document.getElementById('review-output');
  if (out) out.textContent = '';
}

// Sprint 51j: parseert answer_parts veilig (JSON-string of array) — lokale helper voor de
// verbeterpagina, los van de gelijknamige helper op het leerlingscherm.
function parseAnswerPartsReview(raw) {
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
}

async function saveModelAnswer(questionId) {
  const val = document.getElementById('model-input')?.value || '';
  try {
    const r = await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/question/${questionId}/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelAnswer: val }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Mislukt');
    // Werk de lokale kopie bij zodat de badge klopt zonder herladen.
    const q = _questions.find(x => x.id === questionId);
    if (q) q.model_answer = val;
    pyToast('Modelantwoord opgeslagen.', 'success');
  } catch (e) {
    pyAlert('Kon modelantwoord niet opslaan: ' + e.message, 'error');
  }
}

function toggleEditMode() {
  _editMode = !_editMode;
  setQuizEditorReadOnly(!_editMode);
  document.getElementById('edit-toggle-btn').textContent = _editMode ? '🔒 Alleen lezen' : '✏️ Aanpassen & testen';
  document.getElementById('restore-btn').style.display = _editMode ? 'block' : 'none';
}

function restoreCode() {
  if (window.setEditorValue) window.setEditorValue('quiz', _originalCode || '', true);
  _editMode = false;
  setQuizEditorReadOnly(true);
  document.getElementById('edit-toggle-btn').textContent = '✏️ Aanpassen & testen';
  document.getElementById('restore-btn').style.display = 'none';
}

const _socket = io();
_socket.on('free_run_output', ({ output }) => {
  const p = document.getElementById('review-output');
  if (p) { p.textContent += output; p.scrollTop = p.scrollHeight; }
});
_socket.on('free_run_end', () => {});
_socket.on('free_input_request', () => {
  const val = prompt('Invoer vereist:');
  if (val !== null) _socket.emit('free_runtime_input', { value: val });
});

// Sprint 43.11: app.js houdt de Monaco-instanties in een interne editorStore (niet globaal).
// Read-only zetten gaat via de geëxporteerde updateEditorConfig. We geven assist:false mee,
// exact zoals de review-editor is aangemaakt (ensureEditor('quiz','',false,true)), zodat we
// de codehulp-instelling niet per ongeluk omzetten.
function setQuizEditorReadOnly(ro) {
  if (window.updateEditorConfig) {
    try { window.updateEditorConfig('quiz', { assist: false, readOnly: !!ro }); } catch (e) { /* niet kritiek */ }
  }
}

function runReviewCode() {
  const code = (window.getEditorValue && window.getEditorValue('quiz')) || '';
  document.getElementById('review-output').textContent = '';
  _socket.emit('free_run_request', { codeText: code });
}

function loadHistoryRun(code) {
  if (window.setEditorValue) window.setEditorValue('quiz', code, true);
  _editMode = true;
  setQuizEditorReadOnly(false);
  document.getElementById('edit-toggle-btn').textContent = '🔒 Alleen lezen';
  document.getElementById('restore-btn').style.display = 'block';
}

function escJs(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n'); }

async function saveScore(answerId, qIdx, questionId) {
  const score = document.getElementById('score-input').value;
  const comment = document.getElementById('comment-input').value;
  const scoreWaarde = score !== '' ? parseInt(score) : null;

  if (!answerId) {
    // Sprint 51q (bugfix): de leerling bekeek/beantwoordde deze vraag nooit, dus er bestaat
    // geen quiz_answers-rij (geen answerId) om naar te PUTten — voorheen deed de functie
    // hier stil niets ("Opslaan" leek niet te werken). Gebruik het upsert-endpoint dat de
    // rij aanmaakt op basis van de leerling + vraag.
    if (!_currentStudent?.id || !questionId) return;
    const r = await (window.apiFetch||fetch)(
      `/api/quiz/${sessionCode}/students/${_currentStudent.id}/questions/${questionId}/score`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ score: scoreWaarde, teacherComment: comment }),
    });
    const data = await r.json().catch(() => ({}));
    if (data.answerId) {
      // Nieuwe lokale rij toevoegen zodat een volgende wijziging via het normale pad kan.
      _answers.push({
        id: data.answerId, student_id: _currentStudent.id, question_id: questionId,
        score: scoreWaarde, teacher_comment: comment, code: '', selected_choices: '[]',
        student_name: _currentStudent.name, student_class: _currentStudent.class,
      });
    }
  } else {
    await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/answers/${answerId}/score`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ score: scoreWaarde, teacherComment: comment }),
    });
    // Update lokale data
    const ans = _answers.find(a => a.id === answerId);
    if (ans) { ans.score = scoreWaarde; ans.teacher_comment = comment; }
  }
  renderStudentList();
  // Update tab
  document.querySelectorAll('.q-tab')[qIdx]?.classList.add('scored');
  if (window.pyToast) pyToast('Score opgeslagen.', 'success');
}

async function saveAndNext(answerId, qIdx, questionId) {
  await saveScore(answerId, qIdx, questionId);
  if (qIdx < _questions.length - 1) selectQuestion(qIdx + 1);
}

// Sprint 51j: alle onderdeel-scores van een composite-vraag in één keer opslaan (één
// PUT-call per onderdeel naar het part-score endpoint; de server herberekent het totaal).
// Sprint 51-fix: elk onderdeel stuurt nu zijn EIGEN commentaar-veld mee (part-comment-input),
// niet langer de ene, gedeelde "Algemene opmerking" van de hele vraag — die wordt apart
// opgeslagen via de "Algemene opmerking opslaan"-knop (saveScore).
async function savePartScores(answerId, qIdx) {
  if (!answerId) { if (window.pyToast) pyToast('Nog geen antwoord om te scoren.', 'warn'); return; }
  const scoreInputs = document.querySelectorAll('.part-score-input');
  let partScores = {};
  for (const el of scoreInputs) {
    const partId = el.dataset.partId;
    const val = el.value;
    const commentEl = document.querySelector(`.part-comment-input[data-part-id="${partId}"]`);
    const partComment = commentEl ? commentEl.value : undefined;
    await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/answers/${answerId}/part-score`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ partId, score: val !== '' ? parseInt(val, 10) : null, teacherComment: partComment }),
    });
    partScores[partId] = val !== '' ? parseInt(val, 10) : undefined;
  }
  // Lokale data + totaal bijwerken zonder alles opnieuw te laden.
  const ans = _answers.find(a => a.id === answerId);
  if (ans) {
    let bestaande = {};
    try { bestaande = JSON.parse(ans.part_scores || '{}'); } catch { bestaande = {}; }
    for (const [pid, v] of Object.entries(partScores)) {
      if (v === undefined) delete bestaande[pid]; else bestaande[pid] = v;
    }
    ans.part_scores = JSON.stringify(bestaande);
    ans.score = Object.keys(bestaande).length ? Object.values(bestaande).reduce((s, v) => s + (v || 0), 0) : null;
    if (comment !== undefined) ans.teacher_comment = comment;
  }
  renderStudentList();
  document.querySelectorAll('.q-tab')[qIdx]?.classList.add('scored');
  selectQuestion(qIdx);   // herteken zodat het nieuwe totaal meteen zichtbaar is
  if (window.pyToast) pyToast('Onderdeelscores opgeslagen.', 'success');
}

async function saveGeneralComment() {
  const comment = document.getElementById('general-comment')?.value || '';
  try {
    const r = await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/general-comment/${_currentStudent.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ comment }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (window.pyToast) pyToast('Algemene commentaar opgeslagen.', 'success');
  } catch (e) {
    if (window.pyToast) pyToast('Opslaan van de commentaar is mislukt.', 'error');
  }
}

function useTemplate(text) {
  const el = document.getElementById('comment-input');
  if (el) el.value = text;
}

async function addTemplate() {
  const text = prompt('Nieuw commentaar template (max 500 tekens):');
  if (!text?.trim()) return;
  await fetch('/api/quiz/comment-templates', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text: text.trim() }),
  });
  const r = await fetch('/api/quiz/comment-templates');
  _templates = await r.json();
  if (_currentStudent) selectQuestion(_currentQIdx);
}

async function loadSimilarityWarnings() {
  try {
    const r = await fetch(`/api/quiz/${sessionCode}/similarity`);
    _simWarnings = await r.json();
    if (_simWarnings.length > 0) {
      document.getElementById('similarity-warnings').innerHTML =
        `<div class="similarity-warning" style="margin-bottom:12px;">
          ⚠️ ${_simWarnings.length} verdachte gelijkenis${_simWarnings.length!==1?'en':''} gedetecteerd.
          Zie per leerling bij de specifieke vraag.
        </div>`;
    }
  } catch (e) { console.warn('[quiz-review] fout:', e.message); }
}

// Sprint 51-fix: was voorheen enkel "aan" te zetten — een leerkracht kon vrijgave nooit
// meer intrekken, waardoor een toets voor altijd in de "Mijn resultaten"-lijst van elke
// leerling bleef staan, ook als dat achteraf niet meer gewenst was. Nu een echte toggle,
// analoog aan de bestaande "Nakijken"-knop.
function updateReleaseBtn() {
  const btn = document.getElementById('release-btn');
  if (!btn) return;
  btn.textContent = _resultsReleased ? '🔒 Vrijgave intrekken' : '🔓 Vrijgeven';
  btn.classList.toggle('btn-soft', _resultsReleased);
  btn.classList.toggle('btn-muted', !_resultsReleased);
  btn.title = _resultsReleased
    ? 'Leerlingen zien nu hun score en commentaar. Klik om dit weer te sluiten.'
    : 'Leerlingen kunnen dan hun score en commentaar bekijken.';
}

async function releaseResults() {
  const aanzetten = !_resultsReleased;
  if (aanzetten) {
    if (!await pyConfirm({ title: 'Resultaten vrijgeven', body: 'Leerlingen kunnen dan hun score en commentaar bekijken.', confirmLabel: 'Vrijgeven' })) return;
  } else {
    if (!await pyConfirm({ title: 'Vrijgave intrekken', body: 'Leerlingen zien dit resultaat dan niet langer in hun lijst (tenzij "Nakijken" apart aanstaat).', confirmLabel: 'Intrekken' })) return;
  }
  try {
    const r = await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: aanzetten }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Mislukt');
    _resultsReleased = aanzetten;
    updateReleaseBtn();
    pyToast(aanzetten ? 'Resultaten vrijgegeven. Leerlingen kunnen ze bekijken via de sessiecode.' : 'Vrijgave ingetrokken.', 'success', 5000);
  } catch (e) {
    if (window.pyAlert) pyAlert('Fout: ' + e.message, 'error');
  }
}

// 37d: nakijk-modus. Zolang die aan staat, kunnen leerlingen met hun naam + klas
// hun eigen toets read-only inkijken — op elk toestel.
function updateReviewModeBtn() {
  const btn = document.getElementById('review-mode-btn');
  if (!btn) return;
  btn.textContent = _reviewMode ? '👁 Nakijken: aan' : '👁 Nakijken: uit';
  btn.classList.toggle('btn-soft', _reviewMode);
  btn.classList.toggle('btn-muted', !_reviewMode);
  btn.title = _reviewMode
    ? 'Leerlingen kunnen hun eigen toets inkijken. Klik om te sluiten.'
    : 'Leerlingen kunnen hun toets niet inkijken. Klik om open te stellen.';
}

async function toggleReviewMode() {
  const aanzetten = !_reviewMode;
  if (aanzetten) {
    const ok = await pyConfirm({
      title: 'Nakijk-modus openstellen',
      body: 'Leerlingen kunnen dan met hun naam en klas hun eigen toets inkijken — ook thuis, op elk toestel. Ze zien enkel hun eigen antwoorden.',
      confirmLabel: 'Openstellen',
    });
    if (!ok) return;
  }
  try {
    const r = await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/review-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: aanzetten }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Mislukt');
    _reviewMode = aanzetten;
    updateReviewModeBtn();
    pyToast(aanzetten
      ? `Nakijken opengesteld. Leerlingen gebruiken toetscode ${sessionCode}.`
      : 'Nakijken gesloten.', 'success', 5000);
  } catch (e) {
    pyAlert('Kon nakijk-modus niet wijzigen: ' + e.message, 'error');
  }
}

// ── Sprint 51d: export via een PyCodeFlow-modal met MEERKEUZE ────────────────
// Vroeger: een browser-prompt() gevolgd door window.open() — die combinatie werd door de
// popup-blocker geblokkeerd ("doet niets"). Nu: een eigen modal met checkboxes (meerdere
// tegelijk mogelijk) en een betrouwbare download via een tijdelijke <a download>.
function _triggerDownload(url) {
  // Een echte gebruikersklik + <a> met target=_blank download het bestand zonder popup te openen.
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

function exportStudent(studentId, scored) {
  _triggerDownload(`/api/quiz/${sessionCode}/pdf/answers/${studentId}?scored=${scored}`);
}

const EXPORT_OPTIES = [
  { id: '1', label: 'Vragenblad (PDF, om uit te delen)',            url: '/pdf/questions' },
  { id: '2', label: 'Alle antwoorden — 1 PDF, zónder scores',        url: '/pdf/answers?scored=false' },
  { id: '3', label: 'Alle antwoorden — 1 PDF, mét scores',           url: '/pdf/answers?scored=true' },
  { id: '4', label: 'ZIP — aparte PDF per leerling, zónder scores',  url: '/pdf/zip?scored=false' },
  { id: '5', label: 'ZIP — aparte PDF per leerling, mét scores  ★',  url: '/pdf/zip?scored=true' },
  { id: '6', label: 'Klasoverzicht (PDF, scoreblad)',                url: '/pdf/overview' },
  { id: '7', label: 'TXT-export (code per leerling, ZIP)',           url: '/export/zip' },
  { id: '8', label: 'Scores naar Excel (CSV, puntenlijst)',          url: '/export/csv' },
];

function exportAll() {
  const old = document.getElementById('py-modal-overlay');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'py-modal-overlay';
  overlay.innerHTML =
    '<div id="py-modal-box" style="max-width:520px;width:calc(100% - 40px);">' +
      '<div id="py-modal-title">Exporteren</div>' +
      '<div id="py-modal-body" style="margin-bottom:16px;">' +
        '<p class="muted" style="margin:0 0 10px;font-size:0.85rem;">Vink aan wat je wil downloaden. Je kan meerdere exports tegelijk kiezen.</p>' +
        '<div id="exp-list" style="display:flex;flex-direction:column;gap:2px;max-height:340px;overflow-y:auto;">' +
          EXPORT_OPTIES.map(o =>
            '<label style="display:flex;align-items:center;gap:9px;padding:7px 6px;cursor:pointer;border-radius:8px;">' +
              '<input type="checkbox" class="exp-cb" value="' + o.id + '"/>' +
              '<span style="font-size:0.9rem;">' + esc(o.label) + '</span>' +
            '</label>').join('') +
        '</div>' +
      '</div>' +
      '<div id="py-modal-actions">' +
        '<button id="exp-cancel" class="btn btn-muted small">Annuleren</button>' +
        '<button id="exp-go" class="btn btn-primary small">⬇ Download selectie</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const sluit = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) sluit(); });
  document.getElementById('exp-cancel').addEventListener('click', sluit);
  document.getElementById('exp-go').addEventListener('click', () => {
    const gekozen = Array.from(overlay.querySelectorAll('.exp-cb:checked')).map(cb => cb.value);
    if (!gekozen.length) { if (window.pyToast) pyToast('Kies eerst minstens één export.', 'warn'); return; }
    const base = '/api/quiz/' + sessionCode;
    // Meerdere downloads na elkaar, met een kleine tussenpauze zodat de browser ze allemaal start.
    gekozen.forEach((id, i) => {
      const opt = EXPORT_OPTIES.find(o => o.id === id);
      if (opt) setTimeout(() => _triggerDownload(base + opt.url), i * 400);
    });
    sluit();
    if (window.pyToast) pyToast(gekozen.length === 1 ? 'Download gestart.' : gekozen.length + ' downloads gestart.', 'success');
  });
}

// ── Sprint 51-ai: AI verbeteren (popup + doorlopende voortgang) ────────────────
// Sprint 51-fix: de polling-timer stopt NIET meer zodra de popup gesloten wordt — enkel
// het openen/sluiten van de POPUP zelf wisselt, de achtergrond-status-pil (buiten de
// popup) blijft gewoon bijgewerkt. Zo verlies je nooit het zicht op een lopende taak,
// ook niet als je de popup sluit om intussen zelf iets te verbeteren.
let _aiGradeProgressTimer = null;

async function openAiGradePopup() {
  const modal = document.getElementById('ai-grade-modal');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
  document.getElementById('ai-grade-check-msg').innerHTML = '<p class="muted">Bezig met controleren…</p>';
  document.getElementById('ai-grade-form').style.display = 'none';
  document.getElementById('ai-grade-progress').style.display = 'none';

  // Als er al een taak loopt (of recent klaarkwam) voor deze toets, toon meteen de
  // voortgang/log i.p.v. het formulier — zo blijft ook een afgeronde log zichtbaar bij
  // een klik op de pil, niet enkel tijdens het lopen.
  try {
    const progressR = await fetch(`/api/quiz/${sessionCode}/ai-grade/progress`);
    const progress = await progressR.json();
    if (progress.status === 'running' || progress.status === 'done' || progress.status === 'error') {
      document.getElementById('ai-grade-check-msg').innerHTML = '';
      toonAiGradeVoortgang();
      return;
    }
  } catch { /* negeren, val terug op normale flow */ }

  try {
    const checkR = await fetch(`/api/quiz/${sessionCode}/ai-grade/check`);
    const check = await checkR.json();
    if (!check.ok) {
      document.getElementById('ai-grade-check-msg').innerHTML =
        `<div class="similarity-warning" style="background:#fee2e2;border-color:#fecaca;">⚠️ ${esc(check.reason || 'Lokale AI niet beschikbaar.')}</div>`;
      return;
    }
    document.getElementById('ai-grade-check-msg').innerHTML =
      `<p class="muted" style="font-size:0.82rem;">Model: <code>${esc(check.model)}</code></p>`;

    const studentsR = await fetch(`/api/quiz/${sessionCode}/ai-grade/students`);
    const { students } = await studentsR.json();
    const lijst = document.getElementById('ai-grade-student-list');
    lijst.innerHTML = (students || []).map(s => `
      <label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.88rem;">
        <input type="checkbox" class="ai-grade-student-cb" value="${s.id}" ${s.aantalVragen === 0 ? 'disabled' : ''}>
        ${esc(s.name)} <span class="muted">(${s.aantalVragen} vraag/vragen)</span>
      </label>`).join('') || '<p class="muted">Geen leerlingen gevonden.</p>';

    document.getElementById('ai-grade-form').style.display = 'block';
  } catch (e) {
    document.getElementById('ai-grade-check-msg').innerHTML =
      `<div class="similarity-warning" style="background:#fee2e2;border-color:#fecaca;">⚠️ Kon niet controleren: ${esc(e.message)}</div>`;
  }
}

// Sprint 51-fix: sluit enkel het VENSTER — de achtergrond-polling (en dus de status-pil)
// blijft gewoon doorlopen, ongeacht of de popup open of dicht is.
function closeAiGradePopup() {
  const modal = document.getElementById('ai-grade-modal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
}

function toggleAiGradeStudentList() {
  const specifiek = document.querySelector('input[name="ai-grade-scope"]:checked')?.value === 'specifiek';
  document.getElementById('ai-grade-student-list').style.display = specifiek ? 'block' : 'none';
}

async function startAiGrade() {
  const specifiek = document.querySelector('input[name="ai-grade-scope"]:checked')?.value === 'specifiek';
  const overwriteExisting = document.getElementById('ai-grade-overwrite').checked;
  let studentIds = null;
  if (specifiek) {
    studentIds = Array.from(document.querySelectorAll('.ai-grade-student-cb:checked')).map(cb => cb.value);
    if (!studentIds.length) {
      if (window.pyToast) pyToast('Kies minstens één leerling, of kies "Hele klas".', 'warn');
      return;
    }
  }
  try {
    const r = await (window.apiFetch || fetch)(`/api/quiz/${sessionCode}/ai-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds, overwriteExisting }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      if (window.pyAlert) pyAlert(data.error || 'Kon niet starten.', 'error');
      return;
    }
    toonAiGradeVoortgang();
  } catch (e) {
    if (window.pyAlert) pyAlert('Fout: ' + e.message, 'error');
  }
}

function _aiGradeStatusTekst(job) {
  const totaal = job.totaal || 0;
  const voltooid = job.voltooid || 0;
  if (job.status === 'running') {
    const leerlingDeel = job.huidigeLeerling ? ` — ${job.huidigeLeerling}` : '';
    return `🤖 Bezig… ${voltooid}/${totaal}${leerlingDeel}`;
  }
  if (job.status === 'done') {
    return `✅ AI verbeteren klaar — ${voltooid}/${totaal}${job.fouten?.length ? ` (${job.fouten.length} overgeslagen)` : ''}`;
  }
  return `⚠️ AI verbeteren gestopt: ${job.fout || 'onbekende fout'}`;
}

// Sprint 51-fix: wordt zowel bij het starten van een nieuwe taak aangeroepen als bij het
// laden van de pagina (init() hieronder) als blijkt dat er al een taak loopt — zo zie je de
// voortgang ook terug als je de popup ooit sloot of tussentijds wegnavigeerde en terugkwam.
function toonAiGradeVoortgang() {
  const form = document.getElementById('ai-grade-form');
  const progressEl = document.getElementById('ai-grade-progress');
  if (form) form.style.display = 'none';
  if (progressEl) progressEl.style.display = 'block';
  if (_aiGradeProgressTimer) return; // al aan het pollen, niet dubbel starten

  const pill = document.getElementById('ai-grade-status-pill');
  const poll = async () => {
    try {
      const r = await fetch(`/api/quiz/${sessionCode}/ai-grade/progress`);
      const job = await r.json();
      if (job.status === 'idle') { // nooit gestart, of al lang geleden opgeruimd
        clearInterval(_aiGradeProgressTimer);
        _aiGradeProgressTimer = null;
        return;
      }
      const totaal = job.totaal || 0;
      const voltooid = job.voltooid || 0;
      const pct = totaal > 0 ? Math.round((voltooid / totaal) * 100) : 0;
      const bar = document.getElementById('ai-grade-progress-bar');
      const tekstEl = document.getElementById('ai-grade-progress-text');
      if (bar) bar.style.width = pct + '%';
      if (tekstEl) tekstEl.textContent = _aiGradeStatusTekst(job);
      if (pill) { pill.style.display = 'block'; pill.classList.remove('hidden'); pill.textContent = _aiGradeStatusTekst(job); }

      // Sprint 51-fix: gedetailleerd log — nieuwste bovenaan (kolom is column-reverse).
      const logEl = document.getElementById('ai-grade-log');
      if (logEl && Array.isArray(job.log)) {
        logEl.innerHTML = job.log.slice(-100).map(regel => {
          const tijd = regel.tijd ? new Date(regel.tijd).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
          const onderdeelDeel = regel.onderdeel ? ` — ${esc(regel.onderdeel)}` : '';
          if (regel.fout) {
            return `<div style="color:#b91c1c;padding:2px 0;">⚠️ ${tijd} · ${esc(regel.student)} · ${esc(regel.vraag)}${onderdeelDeel} — fout: ${esc(regel.fout)}</div>`;
          }
          return `<div style="padding:2px 0;">✓ ${tijd} · ${esc(regel.student)} · ${esc(regel.vraag)}${onderdeelDeel} — ${regel.score}/${regel.maxPunten}</div>`;
        }).join('');
      }

      if (job.status !== 'running') {
        clearInterval(_aiGradeProgressTimer);
        _aiGradeProgressTimer = null;
        // Herlaad de antwoorden-data en de huidig geselecteerde leerling zodat nieuwe
        // AI-scores meteen zichtbaar zijn zonder de pagina te moeten verversen.
        init().then(() => { if (_currentStudent) renderReviewPanel(); });
        if (window.pyToast && job.status === 'done') pyToast('AI-verbeteren klaar.', 'success');
        // De pil blijft nog even staan (5 min, zie server) zodat een teruggekeerde
        // leerkracht ook de "klaar"-status ziet — daarna verdwijnt hij vanzelf bij een
        // volgende page-load (server geeft dan 'idle' terug).
      }
    } catch { /* volgende poll probeert opnieuw */ }
  };
  poll();
  _aiGradeProgressTimer = setInterval(poll, 1500);
}

// Sprint 51-fix: bij het laden van de verbeterpagina meteen checken of er al een taak
// loopt voor DEZE toets — zodat de status-pil ook verschijnt als je de pagina net opende
// terwijl een eerder gestarte taak nog bezig is (of recent klaarkwam).
(async function _aiGradeCheckBijLaden() {
  try {
    const r = await fetch(`/api/quiz/${sessionCode}/ai-grade/progress`);
    const job = await r.json();
    if (job.status === 'running' || job.status === 'done' || job.status === 'error') {
      toonAiGradeVoortgang();
    }
  } catch { /* geen probleem, gewoon geen pil tonen */ }
})();

// ── Sprint 51-ai (v4): feedback-popup (goed/kon beter op een AI-score) ─────────
let _aiFeedbackVerdict = null;

function openAiFeedbackModal(answerId, partId, questionId) {
  _aiFeedbackContext = { answerId, partId: partId || null, questionId };
  _aiFeedbackVerdict = null;
  document.getElementById('ai-feedback-improvement-text').value = '';
  document.getElementById('ai-feedback-corrected-score').value = '';
  document.getElementById('ai-feedback-corrected-comment').value = '';
  document.getElementById('ai-feedback-improvement-wrap').style.display = 'none';
  document.getElementById('ai-feedback-btn-goed').classList.remove('btn-primary');
  document.getElementById('ai-feedback-btn-kon_beter').classList.remove('btn-primary');
  const modal = document.getElementById('ai-feedback-modal');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeAiFeedbackModal() {
  const modal = document.getElementById('ai-feedback-modal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
  _aiFeedbackContext = null;
}

function setAiFeedbackVerdict(verdict) {
  _aiFeedbackVerdict = verdict;
  document.getElementById('ai-feedback-btn-goed').classList.toggle('btn-primary', verdict === 'goed');
  document.getElementById('ai-feedback-btn-kon_beter').classList.toggle('btn-primary', verdict === 'kon_beter');
  document.getElementById('ai-feedback-improvement-wrap').style.display = verdict === 'kon_beter' ? 'block' : 'none';
}

async function submitAiFeedback() {
  if (!_aiFeedbackContext) return;
  if (!_aiFeedbackVerdict) {
    if (window.pyToast) pyToast('Kies eerst "Goed" of "Kon beter".', 'warn');
    return;
  }
  const improvementText = _aiFeedbackVerdict === 'kon_beter'
    ? document.getElementById('ai-feedback-improvement-text').value.trim() : null;
  // Sprint 51-ai (v5): optionele, expliciete correctie — enkel relevant bij "kon beter".
  const correctedScoreRaw = _aiFeedbackVerdict === 'kon_beter'
    ? document.getElementById('ai-feedback-corrected-score').value.trim() : '';
  const correctedCommentRaw = _aiFeedbackVerdict === 'kon_beter'
    ? document.getElementById('ai-feedback-corrected-comment').value.trim() : '';
  try {
    const r = await (window.apiFetch || fetch)(`/api/quiz/${sessionCode}/ai-grade/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answerId: _aiFeedbackContext.answerId, partId: _aiFeedbackContext.partId,
        questionId: _aiFeedbackContext.questionId, verdict: _aiFeedbackVerdict, improvementText,
        correctedScore: correctedScoreRaw !== '' ? Number(correctedScoreRaw) : null,
        correctedComment: correctedCommentRaw || null,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      if (window.pyAlert) pyAlert(data.error || 'Kon feedback niet opslaan.', 'error');
      return;
    }
    _aiFeedbackGegeven.add(_aiFeedbackContext.answerId + '::' + (_aiFeedbackContext.partId || ''));
    closeAiFeedbackModal();
    if (window.pyToast) pyToast('Bedankt voor je feedback!', 'success');
    if (_currentStudent) renderReviewPanel(); // ververst de badge/knop-weergave
  } catch (e) {
    if (window.pyAlert) pyAlert('Fout: ' + e.message, 'error');
  }
}

init();
