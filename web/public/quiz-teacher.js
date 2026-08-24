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

  // Sprint 50 (bug 2): in bewerkmodus sturen we een PUT naar de bestaande code i.p.v. een
  // nieuwe toets aan te maken. Preview bestaat niet in bewerkmodus. We gebruiken de globale
  // apiFetch (voegt het CSRF-token toe) — een PUT vereist dat, een POST /api/quiz niet.
  const doFetch = window.apiFetch || fetch;
  try {
    const payload = { name, questions, randomize, timerSeconds, noTimer, minRunsPerQ,
                      hideQuestionOnScreen, schoolYear, targetClass,
                      accessFrom, accessUntil, autoSubmitLate, noBack,
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
    if (clsSel && m.targetClass) clsSel.value = m.targetClass;
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
    (data.questions || []).forEach(function (q) {
      _selected[q.id] = {
        id: q.id, text: q.text, subject: q.subject,
        max_points: q.points, points: q.points,
        question_type: q.question_type, choices_json: q.choices_json,
        text_snapshot: q.text,
      };
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
