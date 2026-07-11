// PyCodeFlow — geextraheerd uit quiz-archive.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

let _classes = [];

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(ts){ return ts ? new Date(Number(ts)).toLocaleDateString('nl-BE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'; }
function pct(score, max){ return max > 0 ? Math.round(score / max * 100) : 0; }

function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
}

async function init() {
  // Schooljaren laden
  const yr = await fetch('/api/quiz/archive/years').then(r => r.json()).catch(() => []);
  ['filter-year', 'student-search-year'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    yr.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      sel.appendChild(opt);
    });
  });

  // Klassen laden
  _classes = await fetch('/api/classes').then(r => r.json()).catch(() => []);
  const clsSel = document.getElementById('filter-class');
  if (clsSel) {
    _classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      clsSel.appendChild(opt);
    });
  }

  // Schooljaar default
  const nyEl = document.getElementById('new-school-year');
  if (nyEl) {
    const now = new Date();
    const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    nyEl.value = (y + 1) + '-' + (y + 2);
  }

  loadArchive();
}

async function loadArchive() {
  const year = document.getElementById('filter-year').value;
  const classId = document.getElementById('filter-class').value;
  const archived = document.getElementById('filter-archived').value;

  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (classId) params.set('classId', classId);
  if (archived) params.set('archived', archived);

  const quizzes = await fetch('/api/quiz/archive?' + params).then(r => r.json()).catch(() => []);
  document.getElementById('archive-count').textContent = `${quizzes.length} toets${quizzes.length !== 1 ? 'en' : ''}`;
  renderArchive(quizzes);
}

function renderArchive(quizzes) {
  const el = document.getElementById('archive-list');
  if (!quizzes.length) {
    el.innerHTML = '<p class="muted" style="padding:20px 0;">Geen toetsen gevonden.</p>';
    return;
  }
  el.innerHTML = quizzes.map(q => {
    const maxScore = q.max_score_per_student || 0;
    const avgPct = q.avg_score && maxScore ? pct(q.avg_score, maxScore) : null;
    const clsName = _classes.find(c => c.id === q.target_class)?.name || q.target_class || '';
    return `
    <div class="quiz-card ${q.archived ? 'archived' : ''}">
      <div class="quiz-meta-row">
        <strong style="font-size:1rem;">${esc(q.name || q.code)}</strong>
        ${q.no_timer ? '<span class="no-timer-badge">∞ Geen timer</span>' : ''}
        ${q.archived ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Gearchiveerd</span>' : ''}
        ${q.results_released ? '<span class="badge" style="background:#d1fae5;color:#065f46;">Vrijgegeven</span>' : ''}
        <span class="muted" style="font-size:0.82rem;margin-left:auto;">${fmtDate(q.created_at)}</span>
      </div>
      <div class="quiz-stats">
        <div class="quiz-stat">Schooljaar: <strong>${esc(q.school_year || '—')}</strong></div>
        ${clsName ? `<div class="quiz-stat">Klas: <strong>${esc(clsName)}</strong></div>` : ''}
        <div class="quiz-stat">Code: <strong>${q.code}</strong></div>
        <div class="quiz-stat">Leerlingen: <strong>${q.student_count || 0}</strong></div>
        <div class="quiz-stat">Vragen: <strong>${q.question_count || 0}</strong></div>
        ${!q.no_timer ? `<div class="quiz-stat">Timer: <strong>${Math.round((q.timer_seconds||2700)/60)} min</strong></div>` : ''}
        ${avgPct !== null ? `<div class="quiz-stat">Gemiddelde: <strong>${q.avg_score}/${maxScore} (${avgPct}%)</strong></div>` : ''}
      </div>
      ${avgPct !== null ? `
      <div class="bar-wrap" style="margin:6px 0;">
        <div class="bar-bg"><div class="bar" style="width:${avgPct}%;background:${avgPct>=60?'var(--primary)':'#f59e0b'};"></div></div>
        <span style="font-size:0.78rem;color:var(--muted);min-width:40px;">${avgPct}%</span>
      </div>` : ''}
      <div class="quiz-actions">
        <a class="btn btn-soft small" href="/quiz-review.html?code=${q.code}">✏️ Verbeteren</a>
        <button class="btn btn-muted small" onclick="toggleStats('${q.code}')">📊 Statistieken</button>
        <a class="btn btn-muted small" href="/api/quiz/${q.code}/pdf/overview" target="_blank">🖨️ PDF overzicht</a>
        <a class="btn btn-muted small" href="/api/quiz/${q.code}/pdf/questions" target="_blank">🖨️ Vragenblad</a>
        ${!q.archived
          ? `<button class="btn btn-muted small" onclick="archiveQuiz('${q.code}')">📦 Archiveren</button>`
          : `<button class="btn btn-muted small" onclick="unarchiveQuiz('${q.code}')">↩ Deblokkeren</button>`
        }
        <button class="btn btn-danger small" onclick="showDeleteConfirm('${q.code}','${esc(q.name||q.code)}')">🗑 Verwijderen</button>
      </div>
      <div class="stats-panel" id="stats-${q.code}"></div>
      <div class="confirm-delete" id="delete-${q.code}">
        <strong>⚠️ Definitief verwijderen — kan niet ongedaan worden gemaakt</strong><br/>
        <span class="muted" style="font-size:0.82rem;">
          Verwijdert alle antwoorden, scores en commentaren van ${q.student_count || 0} leerlingen.
          Vragen in de vragenbank blijven bewaard.
        </span><br/><br/>
        Typ de toetsnaam ter bevestiging:<br/>
        <input id="confirm-input-${q.code}" placeholder="${esc(q.name||q.code)}"
          style="padding:6px;border:1.5px solid #fca5a5;border-radius:8px;width:280px;margin-top:6px;"/>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button class="btn btn-muted small" onclick="hideDeleteConfirm('${q.code}')">Annuleren</button>
          <button class="btn btn-danger small" onclick="deleteQuiz('${q.code}','${esc(q.name||q.code)}')">Definitief verwijderen</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function toggleStats(code) {
  const panel = document.getElementById('stats-' + code);
  if (!panel) return;
  if (panel.classList.contains('visible')) {
    panel.classList.remove('visible'); return;
  }
  panel.innerHTML = '<p class="muted" style="font-size:0.85rem;">Statistieken laden...</p>';
  panel.classList.add('visible');
  const stats = await fetch('/api/quiz/' + code + '/stats/detailed').then(r => r.json()).catch(() => []);
  if (!stats.length) { panel.innerHTML = '<p class="muted">Geen statistieken beschikbaar.</p>'; return; }
  panel.innerHTML = '<strong style="font-size:0.88rem;">Per vraag:</strong><br/>' +
    stats.map((q, i) => {
      const s = q.stats;
      const p = s.avg_score !== null ? pct(s.avg_score, q.points) : null;
      return `<div style="margin-top:8px;font-size:0.85rem;">
        <strong>V${i+1}:</strong> ${esc(q.text_snapshot?.slice(0,50)||'')}...
        ${s.avg_score !== null ? `
        <div class="bar-wrap" style="margin:4px 0;">
          <div class="bar-bg"><div class="bar" style="width:${p}%;height:8px;background:${p>=60?'var(--primary)':'#f59e0b'};"></div></div>
          <span style="font-size:0.75rem;color:var(--muted);min-width:80px;">
            gem. ${s.avg_score}/${q.points} pt (${p}%) · ${s.avg_runs} runs
          </span>
        </div>` : '<span class="muted"> — niet verbeterd</span>'}
      </div>`;
    }).join('');
}

async function archiveQuiz(code) {
  if (!await pyConfirm({ title: 'Toets archiveren', body: 'Ze blijft beschikbaar onder "Gearchiveerd" en kan worden hersteld.', confirmLabel: 'Archiveren' })) return;
  await fetch('/api/quiz/' + code + '/archive', { method: 'PUT' });
  loadArchive();
}

async function unarchiveQuiz(code) {
  await fetch('/api/quiz/' + code + '/unarchive', { method: 'PUT' });
  loadArchive();
}

function showDeleteConfirm(code) {
  document.getElementById('delete-' + code)?.classList.add('visible');
}
function hideDeleteConfirm(code) {
  document.getElementById('delete-' + code)?.classList.remove('visible');
}

async function deleteQuiz(code, name) {
  const inputEl = document.getElementById('confirm-input-' + code);
  const typed = inputEl?.value?.trim() || '';
  if (typed.toLowerCase() !== name.toLowerCase()) {
    await pyAlert('Naam komt niet overeen. Typ exact: ' + name, "warn");
    return;
  }
  const r = await fetch('/api/quiz/' + code, {
    method: 'DELETE', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ confirmName: typed }),
  });
  const data = await r.json();
  if (data.ok) { pyToast('Toets definitief verwijderd.', 'success'); loadArchive(); }
  else await pyAlert('Fout: ' + data.error, "error");
}

async function searchStudent() {
  const name = document.getElementById('student-search-name').value.trim();
  const year = document.getElementById('student-search-year').value;
  if (!name) { await pyAlert('Voer een naam in.', "warn"); return; }

  const params = new URLSearchParams({ name });
  if (year) params.set('year', year);

  const results = await fetch('/api/quiz/archive/student?' + params).then(r => r.json()).catch(() => []);
  const el = document.getElementById('student-results');

  if (!results.length) {
    el.innerHTML = '<p class="muted">Geen resultaten gevonden voor "' + esc(name) + '".</p>';
    return;
  }

  const studentName = results[0].student_name;
  const studentClass = results[0].student_class;
  const totalScore = results.reduce((s, r) => s + (Number(r.total_score) || 0), 0);
  const totalMax   = results.reduce((s, r) => s + (Number(r.max_score)   || 0), 0);

  el.innerHTML = `
    <div class="card" style="padding:20px;">
      <h3 style="margin:0 0 6px;">${esc(studentName)}</h3>
      <p class="muted" style="margin:0 0 14px;">${esc(studentClass)} · ${results.length} toets${results.length!==1?'en':''} · Totaal: ${totalScore}/${totalMax} pt</p>
      <table class="student-history-table">
        <thead><tr>
          <th>Toets</th><th>Datum</th><th>Schooljaar</th><th>Score</th><th>%</th><th>Acties</th>
        </tr></thead>
        <tbody>
          ${results.map(r => {
            const p = r.max_score > 0 ? pct(r.total_score || 0, r.max_score) : '—';
            return `<tr>
              <td><strong>${esc(r.quiz_name)}</strong></td>
              <td>${fmtDate(r.created_at)}</td>
              <td>${esc(r.school_year)}</td>
              <td>${r.total_score !== null ? r.total_score + '/' + r.max_score : '—'}</td>
              <td>${typeof p === 'number' ? p + '%' : p}</td>
              <td>
                <a class="btn btn-muted small" href="/quiz-review.html?code=${r.session_code}" target="_blank">Bekijken</a>
                <a class="btn btn-muted small" href="/api/quiz/${r.session_code}/pdf/answers/${results[0]?.student_id||''}?scored=true" target="_blank">🖨️ PDF</a>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:2px solid var(--border);">
            <td colspan="3">Totaal</td>
            <td>${totalScore}/${totalMax}</td>
            <td>${totalMax > 0 ? pct(totalScore, totalMax) + '%' : '—'}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

async function exportStudentPDF() {
  const name = document.getElementById('student-search-name').value.trim();
  const year = document.getElementById('student-search-year').value;
  if (!name) { await pyAlert('Voer eerst een naam in en zoek.', "warn"); return; }
  const params = new URLSearchParams({ name });
  if (year) params.set('year', year);
  window.open('/api/quiz/archive/pdf/student?' + params, '_blank');
}

async function previewNewYear() {
  const active = await fetch('/api/quiz/archive?archived=false').then(r => r.json()).catch(() => []);
  const el = document.getElementById('new-year-preview');
  const newYear = document.getElementById('new-school-year').value;
  el.style.display = 'block';
  el.innerHTML = `<strong>Dit wordt gearchiveerd:</strong><br/>
    ${active.length} toets${active.length !== 1 ? 'en' : ''} worden gearchiveerd.<br/>
    ${active.map(q => `• ${esc(q.name || q.code)} (${esc(q.school_year)})`).join('<br/>')}
    <br/><br/>Nieuw schooljaar wordt: <strong>${esc(newYear)}</strong>`;
}

async function startNewYear() {
  const newYear = document.getElementById('new-school-year').value.trim();
  if (!newYear.match(/^[0-9]{4}-[0-9]{4}$/)) {
    await pyAlert('Ongeldig formaat. Gebruik bv. 2026-2027', "warn"); return;
  }
  if (!await pyConfirm({ title: 'Nieuw schooljaar starten', body: 'Alle actieve toetsen worden gearchiveerd. Dit kan niet ongedaan worden.', confirmLabel: 'Starten', danger: true })) return;
  const r = await fetch('/api/quiz/new-school-year', {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ newYear }),
  });
  const data = await r.json();
  if (data.ok) {
    pyToast(`Klaar! ${data.archived} toets${data.archived !== 1 ? 'en' : ''} gearchiveerd. Welkom in ${newYear}!`, 'success', 6000);
    loadArchive();
  } else {
    await pyAlert('Fout: ' + data.error, "error");
  }
}

init();
// Sprint 26: globale exports voor onclick bereikbaarheid
window.switchTab       = switchTab;
window.loadArchive     = loadArchive;
window.toggleStats     = toggleStats;
window.archiveQuiz     = archiveQuiz;
window.unarchiveQuiz   = unarchiveQuiz;
window.deleteQuiz      = deleteQuiz;
window.searchStudent   = searchStudent;
window.exportStudentPDF = exportStudentPDF;
window.previewNewYear  = previewNewYear;
window.startNewYear    = startNewYear;
