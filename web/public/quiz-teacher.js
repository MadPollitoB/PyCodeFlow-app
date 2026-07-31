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

if (QUIZ_TYPE) {
  const meta = QUIZ_TYPE_META[QUIZ_TYPE];
  document.title = 'PyCodeFlow — ' + meta.title;
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('type-badge', meta.badge);
  setText('page-h1', meta.title);
  setText('page-sub', meta.sub);
  setText('name-label', meta.nameLabel);
  setText('preview-noun', meta.previewNoun);
  const nameInput = document.getElementById('quiz-name');
  if (nameInput) nameInput.placeholder = meta.namePlaceholder;
  const createBtn = document.getElementById('create-btn');
  if (createBtn) createBtn.textContent = '✅ ' + meta.createLabel;
  const timerRadio = document.querySelector('[name=quiz-timer-type][value="' + meta.defaultTimer + '"]');
  if (timerRadio) {
    timerRadio.checked = true;
    const timerInput = document.getElementById('quiz-timer-min');
    if (timerInput) timerInput.disabled = meta.defaultTimer === 'notimer';
  }
  const root = document.getElementById('wizard-root');
  if (root) root.style.display = 'block';
}

let _bank = [];
let _selected = {}; // { id: { ...question, points: override } }

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadBank() {
  const r = await fetch('/api/quiz/bank');
  _bank = await r.json();
  // Subjects
  const subjects = [...new Set(_bank.map(q => q.subject).filter(Boolean))].sort();
  const sel = document.getElementById('sel-subject');
  sel.innerHTML = '<option value="">Alle onderwerpen</option>' +
    subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  filterBank();
}

function filterBank() {
  const subj = document.getElementById('sel-subject').value;
  const diff = document.getElementById('sel-difficulty').value;
  const filtered = _bank.filter(q =>
    (!subj || q.subject === subj) && (!diff || q.difficulty === diff) && !q.archived
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
          <span class="muted" style="font-size:0.78rem;">${q.max_points} pt</span>
        </div>
        <div style="font-size:0.9rem;line-height:1.5;">${esc(q.text.slice(0, 120))}${q.text.length > 120 ? '...' : ''}</div>
      </div>
    </div>`).join('');
}

function toggleSelect(id) {
  const q = _bank.find(x => x.id === id);
  if (!q) return;
  if (_selected[id]) delete _selected[id];
  else _selected[id] = { ...q, points: q.max_points };
  filterBank();
  renderSelectedList();
}

function renderSelectedList() {
  const ids = Object.keys(_selected);
  const total = ids.reduce((s, id) => s + (_selected[id].points || 0), 0);
  document.getElementById('sel-count').textContent = `${ids.length} geselecteerd · ${total} punten`;
  document.getElementById('sel-list').innerHTML = ids.map((id, i) => {
    const q = _selected[id];
    return `<div class="sel-row">
      <span style="font-weight:700;min-width:24px;">${i+1}.</span>
      <span style="flex:1;font-size:0.88rem;">${esc(q.text.slice(0, 60))}...</span>
      <input type="number" class="pts" value="${q.points}" min="1" max="100"
        onchange="_selected['${id}'].points=parseInt(this.value)||1; renderSelectedList()"/>
      <span class="muted" style="font-size:0.78rem;">pt</span>
      <button style="background:none;border:none;cursor:pointer;color:var(--muted);" title="Vraag uit selectie verwijderen" aria-label="Vraag uit selectie verwijderen" onclick="toggleSelect('${id}')">✕</button>
    </div>`;
  }).join('');
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

function buildPreview() {
  var ids = Object.keys(_selected);
  var random = document.querySelector('[name=quiz-order]:checked')?.value === 'random';
  _previewOrder = ids.slice();
  if (random) {
    for (var i = _previewOrder.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = _previewOrder[i]; _previewOrder[i] = _previewOrder[j]; _previewOrder[j] = tmp;
    }
    document.getElementById('shuffle-btn').style.display = '';
  } else {
    document.getElementById('shuffle-btn').style.display = 'none';
  }
  _previewActive = 0;
  renderPreviewNav();
  renderPreviewQuestion(0);
}

function shufflePreview() {
  for (var i = _previewOrder.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = _previewOrder[i]; _previewOrder[i] = _previewOrder[j]; _previewOrder[j] = tmp;
  }
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
      '<span class="muted" style="font-size:0.82rem;">Vraag ' + (idx+1) + ' van ' + _previewOrder.length + ' · ' + q.points + ' punten</span>' +
    '</div>' +
    '<div class="md-preview" style="padding:0;border:none;background:none;">' + renderedText + '</div>' +
    answerHtml +
    '<div style="margin-top:20px;display:flex;gap:8px;">' + prevBtn + nextBtn + '</div>';
}

function renderConfirm() {
  const ids = Object.keys(_selected);
  const total = ids.reduce((s, id) => s + (_selected[id].points || 0), 0);
  const timerType = document.querySelector('[name=quiz-timer-type]:checked')?.value;
  const noTimer = timerType === 'notimer';
  const mins = parseInt(document.getElementById('quiz-timer-min').value) || 45;
  const random = document.querySelector('[name=quiz-order]:checked')?.value === 'random';
  const isPreview = document.getElementById('quiz-is-preview').checked;
  const schoolYear = document.getElementById('quiz-school-year').value.trim();
  const targetClassEl = document.getElementById('quiz-target-class');
  const targetClassName = targetClassEl.options[targetClassEl.selectedIndex]?.text || '—';
  const meta = QUIZ_TYPE_META[QUIZ_TYPE] || QUIZ_TYPE_META.toets;
  document.getElementById('confirm-panel').innerHTML = `
    <h3 style="margin:0 0 16px;">${meta.confirmTitle}</h3>
    ${isPreview ? '<div style="background:#fef3c7;color:#92400e;padding:10px;border-radius:8px;margin-bottom:14px;font-weight:700;">⚠️ PREVIEW MODE — antwoorden worden niet opgeslagen</div>' : ''}
    <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:var(--muted);width:140px;">Naam</td><td><strong>${esc(document.getElementById('quiz-name').value)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:var(--muted);">Timer</td><td><strong>${noTimer ? '∞ Geen tijdslimiet' : mins + ' minuten'}</strong></td></tr>
      <tr><td style="padding:6px 0;color:var(--muted);">Volgorde</td><td><strong>${random ? '🔀 Random per leerling' : '📋 Vast voor iedereen'}</strong></td></tr>
      <tr><td style="padding:6px 0;color:var(--muted);">Vragen</td><td><strong>${ids.length} vragen · ${total} punten</strong></td></tr>
      ${schoolYear ? `<tr><td style="padding:6px 0;color:var(--muted);">Schooljaar</td><td><strong>${esc(schoolYear)}</strong></td></tr>` : ''}
      <tr><td style="padding:6px 0;color:var(--muted);">Klas</td><td><strong>${esc(targetClassName)}</strong></td></tr>
    </table>
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
      ${ids.map((id, i) => {
        const q = _selected[id];
        return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.88rem;">
          <strong>${i+1}.</strong> ${esc(q.text.slice(0,90))}${q.text.length > 90 ? '…' : ''} <span class="muted">(${q.points}pt)</span>
        </div>`;
      }).join('')}
    </div>`;
}

async function createQuiz() {
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

  if (accessFrom && accessUntil && accessFrom >= accessUntil) {
    await pyAlert('Deadline moet na de startdatum liggen.', "warn"); return;
  }
  // Sprint 43.3: einddatum + uur is verplicht voor toets én taak (preview uitgezonderd).
  if (!isTeacherPreview && !accessUntil) {
    await pyAlert('Een einddatum en uur (deadline) is verplicht voor een toets én een taak.', 'warn');
    accessUntilEl?.focus();
    return;
  }

  const questions = Object.values(_selected).map(q => ({
    id: q.id, text: q.text, subject: q.subject, points: q.points, max_points: q.max_points,
  }));

  // 22h: loading state
  createBtn.disabled    = true;
  backBtn.disabled      = true;
  createBtn.textContent = '⏳ Bezig…';
  statusEl.style.display = 'inline';

  try {
    const r = await fetch('/api/quiz', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, questions, randomize, timerSeconds, noTimer, minRunsPerQ,
                             hideQuestionOnScreen, isTeacherPreview, schoolYear, targetClass,
                             accessFrom, accessUntil, autoSubmitLate, noBack,
                             // Sprint 43.14: type komt van de link (?type=), staat al vast bij
                             // het openen van dit scherm — niet meer afgeleid uit de timerkeuze.
                             type: QUIZ_TYPE,
                             // Sprint 43.4: enkel meesturen als de leerkracht een selectie maakte
                             studentIds: (window._selectedStudentIds && window._selectedStudentIds.length)
                                         ? window._selectedStudentIds : undefined }),
    });
    const data = await r.json();
    if (data.ok) {
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
    } else {
      await pyAlert('Fout bij aanmaken: ' + (data.error || 'Onbekende fout'), "error");
    }
  } catch(e) {
    await pyAlert('Netwerkfout: ' + e.message, "error");
  } finally {
    createBtn.disabled    = false;
    backBtn.disabled      = false;
    createBtn.textContent = '✅ ' + meta.createLabel;
    statusEl.style.display = 'none';
  }
}

function toggleTimer(val) {
  const timerInput = document.getElementById('quiz-timer-min');
  if (timerInput) timerInput.disabled = val === 'notimer';
}

// Schooljaar standaard
(function() {
  const el = document.getElementById('quiz-school-year');
  if (!el) return;
  const now = new Date();
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  el.value = y + '-' + (y + 1);
})();

// Klassen laden
(async function() {
  try {
    const r = await fetch('/api/classes');
    const classes = await r.json();
    const sel = document.getElementById('quiz-target-class');
    if (!sel) return;
    classes.forEach(function(cl) {
      const opt = document.createElement('option');
      opt.value = cl.id; opt.textContent = cl.name;
      sel.appendChild(opt);
    });
  } catch (e) { console.warn('[quiz-teacher] fout:', e.message); }
})();

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
  const overlay = document.createElement('div');
  overlay.id = 'py-modal-overlay';
  overlay.innerHTML =
    '<div id="py-modal-box" style="max-width:520px;">' +
      '<div id="py-modal-title">Leerlingen voor deze toets/taak</div>' +
      '<div id="py-modal-body">' +
        '<p class="muted" style="margin:0 0 8px;font-size:0.85rem;">Vink aan wie deze toets/taak mag maken. Standaard doet iedereen mee.</p>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
          '<button type="button" class="btn btn-muted small" id="sp-all">Alles aan</button>' +
          '<button type="button" class="btn btn-muted small" id="sp-none">Alles uit</button>' +
          '<span class="muted" id="sp-count" style="margin-left:auto;font-size:0.8rem;"></span>' +
        '</div>' +
        '<div id="sp-list" style="max-height:320px;overflow-y:auto;border:1.5px solid var(--border);border-radius:10px;padding:8px;"></div>' +
      '</div>' +
      '<div id="py-modal-actions">' +
        '<button id="sp-cancel" class="btn btn-muted small">Annuleren</button>' +
        '<button id="sp-save" class="btn btn-primary small">Opslaan</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  function paint() {
    document.getElementById('sp-list').innerHTML = _pickerRoster.map(s =>
      '<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;">' +
        '<input type="checkbox" class="sp-cb" value="' + s.id + '"' + (chosen.has(s.id) ? ' checked' : '') + '/>' +
        '<span>' + (window.escapeHtml ? escapeHtml(s.name) : s.name) + '</span>' +
      '</label>').join('');
    document.getElementById('sp-count').textContent = chosen.size + ' van ' + _pickerRoster.length;
    document.querySelectorAll('.sp-cb').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) chosen.add(cb.value); else chosen.delete(cb.value);
      document.getElementById('sp-count').textContent = chosen.size + ' van ' + _pickerRoster.length;
    }));
  }
  paint();

  document.getElementById('sp-all').addEventListener('click', () => { _pickerRoster.forEach(s => chosen.add(s.id)); paint(); });
  document.getElementById('sp-none').addEventListener('click', () => { chosen.clear(); paint(); });
  document.getElementById('sp-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('sp-save').addEventListener('click', () => {
    // Iedereen aangevinkt → geen beperking bewaren (dan telt automatisch de hele klas).
    window._selectedStudentIds = (chosen.size === _pickerRoster.length) ? [] : Array.from(chosen);
    overlay.remove();
    _updateStudentsInfo();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};
