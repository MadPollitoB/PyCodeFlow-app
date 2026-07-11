// PyCodeFlow — geextraheerd uit quiz-bank.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

'use strict';

// 23o: apiFetch wrapper met CSRF token
let _csrfToken = null;
async function getCSRFToken() {
  if (_csrfToken) return _csrfToken;
  try { const r = await fetch('/api/csrf-token'); if (r.ok) { const d = await r.json(); _csrfToken = d.token; } } catch (e) { console.warn('[quiz-bank] fout:', e.message); }
  return _csrfToken || '';
}
async function apiFetch(url, options = {}) {
  const token = await getCSRFToken();
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}), ...(options.headers || {}) },
  });
}



let _questions = [];
let _choices   = [];   // huidige antwoordopties
let _previewOpen = false;

// ── Tab navigatie ──────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const idx = ['browse','add','csv'].indexOf(name);
  document.querySelectorAll('.tab-nav button')[idx].classList.add('active');
  if (name === 'browse') loadQuestions();
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Voor gebruik in onclick="..." attributen: ook apostrofs escapen
function escAttr(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Data laden ─────────────────────────────────────────────────────────────────
async function loadSubjects() {
  try {
    const r = await fetch('/api/quiz/bank/subjects');
    const subjects = await r.json();
    const sel = document.getElementById('filter-subject');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Alle onderwerpen</option>' +
      subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (cur) sel.value = cur;
    document.getElementById('subjects-list').innerHTML =
      subjects.map(s => `<option value="${esc(s)}"></option>`).join('');
  } catch(e) { console.error('[quiz-bank] loadSubjects:', e); }
}

async function loadQuestions() {
  const subject    = document.getElementById('filter-subject').value;
  const difficulty = document.getElementById('filter-difficulty').value;
  const archived   = document.getElementById('show-archived').checked;
  const params = new URLSearchParams();
  if (subject)    params.set('subject', subject);
  if (difficulty) params.set('difficulty', difficulty);
  if (archived)   params.set('archived', 'true');
  try {
    const r = await fetch('/api/quiz/bank?' + params);
    _questions = await r.json();
  } catch(e) {
    _questions = [];
    document.getElementById('q-grid').innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;">⚠️ Kon vragen niet laden. Herlaad de pagina.</div>';
    return;
  }
  // 33d: filter op tag (client-side, deelstring-match, hoofdletterongevoelig)
  const tagFilter = (document.getElementById('filter-tag')?.value || '').trim().toLowerCase();
  let shown = _questions;
  if (tagFilter) {
    shown = _questions.filter(q => (q.tags || '').toLowerCase().includes(tagFilter));
  }
  renderQuestions(shown);
  document.getElementById('q-count').textContent = `${shown.length} vragen`;
  const byDiff = { makkelijk:0, gemiddeld:0, moeilijk:0 };
  shown.forEach(q => byDiff[q.difficulty] = (byDiff[q.difficulty]||0)+1);
  document.getElementById('stats-bar').innerHTML =
    `<div class="stat-chip">Totaal: <strong>${shown.length}</strong></div>` +
    Object.entries(byDiff).map(([d,n]) => n > 0
      ? `<div class="stat-chip">${d}: <strong>${n}</strong></div>` : '').join('');
}

function renderQuestions(qs) {
  const el = document.getElementById('q-grid');
  if (!qs.length) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Geen vragen gevonden.</div>';
    return;
  }
  const typeLabel = { code:'🐍 Code', open:'✏️ Open', single:'◉ Single', multiple:'☑ Keuze' };
  el.innerHTML = qs.map((q, idx) => {
    // 24b: render vraagstelling als Markdown zodat code-snippets als blok verschijnen
    const renderedText = window.marked
      ? (window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(q.text, { breaks: true, gfm: true }), { ADD_ATTR: ['style','target'] }) : window.marked.parse(q.text, { breaks: true, gfm: true }))
      : esc(q.text).replace(/\n/g, '<br>');
    return `
    <div class="q-card ${q.archived ? 'archived-card' : ''}" data-qid="${q.id}">
      <div class="q-meta">
        ${q.subject ? `<span class="badge">${esc(q.subject)}</span>` : ''}
        <span class="diff-badge diff-${q.difficulty}">${q.difficulty}</span>
        <span class="badge" style="background:#f0f9ff;color:#0369a1;font-size:0.72rem;">
          ${typeLabel[q.question_type] || 'Code'}
        </span>
        <span class="muted" style="font-size:0.78rem;margin-left:auto;">${q.max_points} pt</span>
        ${q.archived ? '<span class="badge" style="background:#fee2e2;color:#991b1b;font-size:0.72rem;">Gearchiveerd</span>' : ''}
      </div>
      <div class="q-text md-preview" style="max-height:140px;overflow:auto;">${renderedText}</div>
      ${q.tags ? `<div class="q-tags">${q.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `<span class="tag-chip">🏷 ${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="q-actions">
        <button class="btn btn-muted small q-btn-edit">✏️ Bewerken</button>
        ${!q.archived
          ? '<button class="btn btn-muted small q-btn-delete">🗑 Verwijderen</button>'
          : '<button class="btn btn-muted small q-btn-restore">↩ Herstellen</button>' +
            '<button class="btn btn-danger small q-btn-destroy">🗑 Definitief verwijderen</button>'
        }
      </div>
    </div>`;
  }).join('');
  // Event delegation: knoppen op q-cards via data-qid op de parent card
  document.getElementById('q-grid').addEventListener('click', function(e) {
    const card = e.target.closest('[data-qid]');
    if (!card) return;
    const id = card.dataset.qid;
    const q  = _questions.find(x => x.id === id);
    if (!q) return;
    if (e.target.closest('.q-btn-edit'))    { editQuestion(id); return; }
    if (e.target.closest('.q-btn-delete'))  { verwijderOfArchiveer(id, q.text.slice(0,40)); return; }
    if (e.target.closest('.q-btn-restore')) { unarchiveQuestion(id); return; }
    if (e.target.closest('.q-btn-destroy')) { deleteQuestion(id, q.text.slice(0,40)); return; }
  });
}

// ── Vraag bewerken ─────────────────────────────────────────────────────────────
function editQuestion(id) {
  const q = _questions.find(x => x.id === id);
  if (!q) return;
  document.getElementById('edit-id').value = id;
  document.getElementById('q-text').value = q.text;
  document.getElementById('q-subject').value = q.subject || '';
  document.getElementById('q-difficulty').value = q.difficulty;
  document.getElementById('q-points').value = q.max_points;
  document.getElementById('q-tags').value = q.tags || '';
  document.getElementById('form-title').textContent = 'Vraag bewerken';
  const typeRadio = document.querySelector(`[name=q-type][value="${q.question_type||'code'}"]`);
  if (typeRadio) { typeRadio.checked = true; onTypeChange(q.question_type||'code'); }
  try { _choices = JSON.parse(q.choices_json || '[]'); } catch { _choices = []; }
  if (_choices.length === 0 && ['single','multiple'].includes(q.question_type)) {
    _choices = [
      { id: crypto.randomUUID(), text:'', isCode:false, correct:false },
      { id: crypto.randomUUID(), text:'', isCode:false, correct:false },
    ];
  }
  renderChoices();
  // Reset preview als die open stond
  if (_previewOpen) toggleMarkdownPreview();
  switchTab('add');
}

function cancelEdit() {
  document.getElementById('edit-id').value = '';
  document.getElementById('q-text').value = '';
  document.getElementById('q-subject').value = '';
  document.getElementById('q-difficulty').value = 'gemiddeld';
  document.getElementById('q-points').value = '4';
  document.getElementById('q-tags').value = '';
  document.getElementById('form-title').textContent = 'Nieuwe vraag toevoegen';
  const codeRadio = document.querySelector('[name=q-type][value=code]');
  if (codeRadio) { codeRadio.checked = true; onTypeChange('code'); }
  _choices = [];
  document.getElementById('choices-panel').style.display = 'none';
  if (_previewOpen) toggleMarkdownPreview();
  switchTab('browse');
}

// ── 25a/25b/25c/25d: Editor toolbar, split-view, kaders, tabel ───────────────

// 25b: Preprocessing: :::type ... ::: → gekleurde kaders
function preprocessMarkdown(text) {
  return text.replace(/:::(\w+)\n([\s\S]*?):::/g, function(_, type, content) {
    const map = { tip:'info-tip', opgelet:'info-opgelet', kader:'info-kader-blauw', hint:'info-hint' };
    const cls = map[type] || 'info-kader-blauw';
    return `<div class="info-kader ${cls}">${content.trim()}</div>`;
  });
}

function renderMarkdown(text) {
  if (!window.marked) return text.replace(/\n/g,'<br>');
  const preprocessed = preprocessMarkdown(text);
  var html = window.marked.parse(preprocessed, { breaks: true, gfm: true });
  // 28c: XSS-beveiliging
  return window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_ATTR: ['style', 'target'] }) : html;
}

// 25d: Editor modus (localStorage)
let _editorMode = localStorage.getItem('pycodeflow_editor_mode') || 'edit';
function setEditorMode(mode) {
  if (mode === 'split' && window.innerWidth < 900) {
    pyAlert('Split-view is niet beschikbaar op een smal scherm. Vergroot het venster.', 'info');
    return;
  }
  _editorMode = mode;
  localStorage.setItem('pycodeflow_editor_mode', mode);
  const wrap = document.getElementById('q-editor-wrap');
  wrap.className = 'q-editor-wrap' + (mode === 'split' ? ' split' : mode === 'preview' ? ' preview-only' : '');
  ['edit','split','preview'].forEach(m => {
    const btn = document.getElementById('view-' + m);
    if (btn) btn.className = 'etb-view-btn' + (m === mode ? ' active' : '');
  });
  if (mode !== 'edit') updateLivePreview();
}

function updateLivePreview() {
  const preview = document.getElementById('q-live-preview');
  if (preview) preview.innerHTML = renderMarkdown(document.getElementById('q-text').value);
}

let _previewDebounce = null;
function onEditorInput() {
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(updateLivePreview, 100);
}

// Init editor modus op paginalaad
document.addEventListener('DOMContentLoaded', function() {
  setEditorMode(_editorMode);
});

// 25a: Toolbar hulpfuncties
function getTextarea() { return document.getElementById('q-text'); }

function insertMd(before, after) {
  const ta = getTextarea();
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.substring(start, end) || 'tekst';
  const newText = before + sel + after;
  ta.setRangeText(newText, start, end, 'select');
  ta.focus();
  ta.selectionStart = start + before.length;
  ta.selectionEnd   = start + before.length + sel.length;
  onEditorInput();
}

function insertMdLine(prefix) {
  const ta = getTextarea();
  const start = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
  ta.setRangeText(prefix, lineStart, lineStart, 'end');
  ta.focus();
  onEditorInput();
}

function insertMdBlock(open, close) {
  const ta = getTextarea();
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.substring(start, end) || 'print("Hallo")';
  const newText = open + '\n' + sel + '\n' + close;
  ta.setRangeText(newText, start, end, 'end');
  ta.focus();
  onEditorInput();
}

// 25a: Kleur
function toggleColorPopup() {
  const p = document.getElementById('color-popup');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}
function insertColor(hex) {
  document.getElementById('color-popup').style.display = 'none';
  insertMd('<span style="color:' + hex + '">', '</span>');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('#color-btn') && !e.target.closest('#color-popup')) {
    const p = document.getElementById('color-popup');
    if (p) p.style.display = 'none';
  }
});

// 25b: Info-kaders
function insertKader(type) {
  const ta = getTextarea();
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.substring(start, end) || 'Schrijf hier jouw tekst...';
  const block = ':::' + type + '\n' + sel + '\n:::';
  ta.setRangeText(block, start, end, 'end');
  ta.focus();
  onEditorInput();
}

// 25c: Tabel-modal
let _tabelData = [];
function openTabelModal() {
  document.getElementById('tabel-modal').style.display = 'flex';
  renderTabelGrid();
}
function closeTabelModal() {
  document.getElementById('tabel-modal').style.display = 'none';
}
function renderTabelGrid() {
  const rows = Math.max(1, Math.min(10, parseInt(document.getElementById('tbl-rows').value) || 3));
  const cols = Math.max(1, Math.min(8,  parseInt(document.getElementById('tbl-cols').value) || 3));
  _tabelData = Array.from({length: rows + 1}, () => Array(cols).fill(''));
  // Koptekst defaults
  for (let c = 0; c < cols; c++) _tabelData[0][c] = 'Kolom ' + (c + 1);
  const wrap = document.getElementById('tabel-grid-wrap');
  let html = '<div class="tabel-grid-input" style="grid-template-columns:repeat(' + cols + ',1fr);">';
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isHead = r === 0;
      html += '<input class="tabel-cell-input" style="' + (isHead ? 'font-weight:700;background:#eff6ff;' : '') + '"'
        + ' placeholder="' + (isHead ? 'Kop ' + (c+1) : 'Cel') + '"'
        + ' data-r="' + r + '" data-c="' + c + '"'
        + ' oninput="_tabelData[this.dataset.r][this.dataset.c]=this.value"/>';
    }
  }
  html += '</div>';
  wrap.innerHTML = html;
}
function insertTabel() {
  const rows = parseInt(document.getElementById('tbl-rows').value) || 3;
  const cols = parseInt(document.getElementById('tbl-cols').value) || 3;
  // Lees actuele waarden
  document.querySelectorAll('.tabel-cell-input').forEach(function(inp) {
    _tabelData[inp.dataset.r][inp.dataset.c] = inp.value;
  });
  const header = '| ' + _tabelData[0].map(function(h){ return h || 'Kolom'; }).join(' | ') + ' |';
  const sep    = '|' + Array(cols).fill('---|').join('');
  const body   = _tabelData.slice(1).map(function(row) {
    return '| ' + row.map(function(c){ return c || ' '; }).join(' | ') + ' |';
  }).join('\n');
  const tabelMd = header + '\n' + sep + '\n' + body + '\n';
  const ta = getTextarea();
  const pos = ta.selectionStart;
  ta.setRangeText('\n' + tabelMd + '\n', pos, pos, 'end');
  ta.focus();
  onEditorInput();
  closeTabelModal();
}

// ── 22e: Vraagtype & keuze-opties ──────────────────────────────────────────────
function onTypeChange(type) {
  const panel = document.getElementById('choices-panel');
  const hint  = document.getElementById('choices-hint');
  panel.style.display = ['single','multiple'].includes(type) ? 'block' : 'none';
  hint.textContent = type === 'single'
    ? 'selecteer exact 1 juist antwoord'
    : 'selecteer alle juiste antwoorden';
  if (['single','multiple'].includes(type)) {
    if (_choices.length === 0) {
      _choices = [
        { id: crypto.randomUUID(), text:'', isCode:false, correct:false },
        { id: crypto.randomUUID(), text:'', isCode:false, correct:false },
      ];
    }
    // 24d: altijd opnieuw renderen bij type-wissel zodat radio↔checkbox correct wisselt
    renderChoices();
  }
}

function addChoice() {
  if (_choices.length >= 8) { pyAlert('Maximaal 8 opties.', "warn"); return; }
  _choices.push({ id: crypto.randomUUID(), text:'', isCode:false, correct:false });
  renderChoices();
}

function removeChoice(id) {
  if (_choices.length <= 2) { pyAlert('Minimaal 2 opties vereist.', "warn"); return; }
  _choices = _choices.filter(ch => ch.id !== id);
  renderChoices();
}

function toggleChoiceCode(idx) {
  _choices[idx].isCode = !_choices[idx].isCode;
  renderChoices();
  // Focus de net-getoggle input
  const inputs = document.getElementById('choices-list').querySelectorAll('.choice-text-input,.choice-code-input');
  if (inputs[idx]) inputs[idx].focus();
}

function setChoiceText(idx, val) { _choices[idx].text = val; }

function setChoiceCorrectSingle(idx) {
  _choices.forEach((c, i) => c.correct = (i === idx));
  // Geen volledige re-render nodig — radio state klopt al
}

function setChoiceCorrectMulti(idx, val) { _choices[idx].correct = val; }

function renderChoices() {
  const type = document.querySelector('[name=q-type]:checked')?.value || 'single';
  const list = document.getElementById('choices-list');
  list.className = 'choices-panel-inner';
  list.innerHTML = _choices.map((ch, i) => {
    // 24c: grid layout — selector | body | remove
    const selectorHtml = type === 'single'
      ? `<input type="radio" name="correct-choice" class="choice-selector"
           ${ch.correct ? 'checked' : ''} title="Markeer als juist antwoord"
           onchange="setChoiceCorrectSingle(${i})" />`
      : `<input type="checkbox" class="choice-selector"
           ${ch.correct ? 'checked' : ''} title="Markeer als juist antwoord"
           onchange="setChoiceCorrectMulti(${i}, this.checked)" />`;

    const inputHtml = ch.isCode
      ? `<textarea class="choice-code-input" rows="3"
           placeholder="# Python code hier..." onkeydown="event.stopPropagation()"
           oninput="setChoiceText(${i}, this.value)">${esc(ch.text)}</textarea>`
      : `<input type="text" class="choice-text-input" value="${esc(ch.text)}"
           placeholder="Optie ${i+1}..." oninput="setChoiceText(${i}, this.value)"
           onkeydown="event.stopPropagation()" />`;

    return `
      <div class="choice-row ${ch.correct ? 'correct-row' : ''}">
        ${selectorHtml}
        <div class="choice-body">
          ${inputHtml}
          <div class="choice-actions-row">
            <button type="button" class="choice-toggle-code ${ch.isCode ? 'active' : ''}"
              onclick="toggleChoiceCode(${i})">
              &lt;/&gt; ${ch.isCode ? 'Naar tekst' : 'Naar code'}
            </button>
            ${ch.correct ? '<span style="font-size:0.75rem;color:var(--primary);font-weight:700;">✓ Correct antwoord</span>' : ''}
          </div>
        </div>
        <button type="button" class="choice-remove" onclick="removeChoice('${ch.id}')" title="Optie verwijderen">✕</button>
      </div>`;
  }).join('');
}

// ── Opslaan ────────────────────────────────────────────────────────────────────
async function saveQuestion() {
  const id   = document.getElementById('edit-id').value;
  const type = document.querySelector('[name=q-type]:checked')?.value || 'code';
  const text = document.getElementById('q-text').value.trim();

  if (!text) return void await pyAlert('Vul een vraagstelling in.', "warn");
  if (['single','multiple'].includes(type)) {
    const filled = _choices.filter(ch => ch.text.trim());
    if (filled.length < 2) return void await pyAlert('Vul minstens 2 opties in.', "warn");
    if (!_choices.some(ch => ch.correct)) return void await pyAlert('Selecteer minstens 1 juist antwoord.', "warn");
  }

  const body = {
    text,
    subject:      document.getElementById('q-subject').value.trim(),
    difficulty:   document.getElementById('q-difficulty').value,
    tags:         document.getElementById('q-tags').value.trim(),
    maxPoints:    parseInt(document.getElementById('q-points').value) || 4,
    questionType: type,
    choices:      ['single','multiple'].includes(type) ? _choices : [],
  };

  try {
    const url    = id ? `/api/quiz/bank/${id}` : '/api/quiz/bank';
    const method = id ? 'PUT' : 'POST';
    const r    = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await r.json();
    if (data.ok || data.id) { cancelEdit(); loadSubjects(); loadQuestions(); }
    else await pyAlert('Fout bij opslaan: ' + data.error, "error");
  } catch(e) { await pyAlert('Netwerkfout: ' + e.message, "error"); }
}

// ── 22f / 23.1: Verwijderen of archiveren ────────────────────────────────────
// Probeert eerst definitief te verwijderen.
// Als de server meldt dat de vraag in gebruik is in een toets → archiveer.
async function verwijderOfArchiveer(id, preview) {
  if (!await pyConfirm({ title: 'Vraag verwijderen', body: `"${preview}..."\n\nAls de vraag nog in een toets staat wordt ze gearchiveerd.`, confirmLabel: 'Verwijderen', danger: true })) return;
  try {
    const r    = await apiFetch(`/api/quiz/bank/${id}`, { method:'DELETE' });
    const data = await r.json();
    if (data.ok) {
      // Definitief verwijderd
      loadQuestions();
    } else {
      // In gebruik in een toets — archiveer in plaats van verwijderen
      const archiveer = await pyConfirm({ title: 'Vraag archiveren', body: 'Deze vraag is gekoppeld aan een toets en kan niet definitief verwijderd worden.\n\nWil je ze archiveren? Ze blijft beschikbaar in bestaande toetsen maar verschijnt niet meer in de vragenbank.', confirmLabel: 'Archiveren' });
      if (archiveer) {
        await apiFetch(`/api/quiz/bank/${id}/archive`, { method:'PUT' });
        loadQuestions();
      }
    }
  } catch(e) { await pyAlert('Netwerkfout: ' + e.message, "error"); }
}

async function unarchiveQuestion(id) {
  try {
    await apiFetch(`/api/quiz/bank/${id}/unarchive`, { method:'PUT' });
    loadQuestions();
  } catch(e) { await pyAlert('Fout: ' + e.message, "error"); }
}

async function deleteQuestion(id, preview) {
  if (!await pyConfirm({ title: 'Definitief verwijderen', body: `"${preview}..."\n\nDit kan niet ongedaan worden.`, confirmLabel: 'Verwijderen', danger: true })) return;
  try {
    const r    = await apiFetch(`/api/quiz/bank/${id}`, { method:'DELETE' });
    const data = await r.json();
    if (!data.ok) await pyAlert('Kan niet verwijderen: ' + data.error, "error");
    else loadQuestions();
  } catch(e) { await pyAlert('Netwerkfout: ' + e.message, "error"); }
}

// ── CSV import ─────────────────────────────────────────────────────────────────
async function importCSV() {
  const csv = document.getElementById('csv-input').value.trim();
  if (!csv) return void await pyAlert('Voer CSV-data in.', "warn");
  try {
    const r    = await fetch('/api/quiz/bank/import-csv', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ csv }),
    });
    const data = await r.json();
    const el   = document.getElementById('import-result');
    el.style.display = 'block';
    if (data.ok) {
      el.className = 'import-ok';
      el.innerHTML = `✅ <strong>${data.added}</strong> toegevoegd · <strong>${data.skipped}</strong> overgeslagen${data.errors.length ? '<br>⚠️ ' + data.errors.join(', ') : ''}`;
      loadSubjects(); loadQuestions();
    } else {
      el.className = 'import-err';
      el.textContent = '❌ ' + data.error;
    }
  } catch(e) { await pyAlert('Netwerkfout: ' + e.message, "error"); }
}

// ── Window-exports (sprint 26/29p2: MOET vóór init staan) ──────────────────────
// Zo werken de knoppen altijd, ook als loadSubjects/loadQuestions een fout gooit.
window.switchTab         = switchTab;
window.addChoice         = addChoice;
window.removeChoice      = removeChoice;
window.toggleChoiceCode  = toggleChoiceCode;
window.setChoiceText     = setChoiceText;
window.setChoiceCorrectSingle = setChoiceCorrectSingle;
window.setChoiceCorrectMulti  = setChoiceCorrectMulti;
window.onTypeChange      = onTypeChange;
window.saveQuestion      = saveQuestion;
window.cancelEdit        = cancelEdit;
window.importCSV         = importCSV;
window.verwijderOfArchiveer = verwijderOfArchiveer;
window.unarchiveQuestion = unarchiveQuestion;
window.deleteQuestion    = deleteQuestion;
window.insertMd          = insertMd;
window.insertMdLine      = insertMdLine;
window.insertMdBlock     = insertMdBlock;
window.toggleColorPopup  = toggleColorPopup;
window.insertColor       = insertColor;
window.insertKader       = insertKader;
window.openTabelModal    = openTabelModal;
window.closeTabelModal   = closeTabelModal;
window.renderTabelGrid   = renderTabelGrid;
window.insertTabel       = insertTabel;
window.setEditorMode     = setEditorMode;
window.onEditorInput     = onEditorInput;

// ── Init ───────────────────────────────────────────────────────────────────────
// Elk in eigen try/catch zodat een fout in de ene de andere niet blokkeert.
try { loadSubjects(); }  catch (e) { console.error('[quiz-bank] loadSubjects fout:', e); }
try { loadQuestions(); } catch (e) { console.error('[quiz-bank] loadQuestions fout:', e); }
