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
let _originalCode = '';


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
  updateReviewModeBtn();
  document.getElementById('review-title').textContent =
    (session?.name || 'Toets') + ' — Verbeteren';

  // Laad alle antwoorden
  const ar = await fetch(`/api/quiz/${sessionCode}/answers`);
  _answers = await ar.json();

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
    const scoreChip = nietDeelgenomen
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
    let partAnswers = {};
    try { partAnswers = JSON.parse(ans?.part_answers || '{}'); } catch { partAnswers = {}; }
    const parts = parseAnswerPartsReview(q.answer_parts);
    const openParts = parts.filter(p => p.type === 'open');
    answerHtml = openParts.map(p => `
      <div class="card" style="padding:14px;margin-bottom:10px;">
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">✏️ ${esc(p.label)}</div>
        <div style="font-size:0.93rem;line-height:1.6;white-space:pre-wrap;padding:10px;
          background:var(--surface-soft);border-radius:8px;min-height:44px;">
          ${partAnswers[p.id] ? esc(partAnswers[p.id]) : '<span style="color:var(--muted);font-style:italic;">(geen antwoord)</span>'}
        </div>
        ${p.modelAnswer ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--muted);">
          ✅ Modelantwoord: <span style="color:inherit;">${esc(p.modelAnswer)}</span></div>` : ''}
      </div>`).join('');
  }

  document.getElementById('q-detail').innerHTML = `
    ${simHtml}
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
      const totaal = Object.values(partScores).reduce((s, v) => s + (v || 0), 0);
      return `<div class="card" style="padding:12px;margin-bottom:14px;">
        <div style="font-size:0.82rem;color:var(--muted);margin-bottom:8px;">Score per onderdeel</div>
        ${parts.map((p, pi) => {
          const label = p.type === 'code' ? '🐍 Code' : esc(p.label || ('Onderdeel ' + (pi + 1)));
          const s = partScores[p.id] !== undefined ? partScores[p.id] : '';
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="flex:1;font-size:0.88rem;">${label}</span>
            <input type="number" class="part-score-input" data-part-id="${p.id}" value="${s}" min="0" max="${p.points}" placeholder="—" style="width:70px;"/>
            <span class="muted" style="font-size:0.82rem;">/ ${p.points}</span>
          </div>`;
        }).join('')}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.88rem;font-weight:700;">
          Totaal: ${totaal} / ${q.points}
        </div>
        <button class="btn btn-soft small" style="margin-top:8px;" onclick="savePartScores('${ans?.id||''}', ${idx})">💾 Onderdeelscores opslaan</button>
      </div>
      <div class="card" style="padding:12px;margin-bottom:14px;">
        <label style="font-size:0.82rem;color:var(--muted);display:block;margin-bottom:4px;">Algemene opmerking</label>
        <textarea id="comment-input" placeholder="Opmerking...">${esc(comment)}</textarea>
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
async function savePartScores(answerId, qIdx) {
  if (!answerId) { if (window.pyToast) pyToast('Nog geen antwoord om te scoren.', 'warn'); return; }
  const comment = document.getElementById('comment-input')?.value ?? undefined;
  const inputs = document.querySelectorAll('.part-score-input');
  let partScores = {};
  for (const el of inputs) {
    const partId = el.dataset.partId;
    const val = el.value;
    await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/answers/${answerId}/part-score`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ partId, score: val !== '' ? parseInt(val, 10) : null, teacherComment: comment }),
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

async function releaseResults() {
  if (!await pyConfirm({ title: 'Resultaten vrijgeven', body: 'Leerlingen kunnen dan hun score en commentaar bekijken.', confirmLabel: 'Vrijgeven' })) return;
  await (window.apiFetch||fetch)(`/api/quiz/${sessionCode}/release`, { method:'POST' });
  pyToast('Resultaten vrijgegeven. Leerlingen kunnen ze bekijken via de sessiecode.', 'success', 5000);
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

init();
