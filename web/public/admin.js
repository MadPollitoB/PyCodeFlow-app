// PyCodeFlow — geextraheerd uit admin.html (sprint 32a)
// Inline scripts naar apart bestand voor onderhoudbaarheid + CSP (30b).

// 23o: apiFetch wrapper met CSRF token (zelfde als app.js)
let _csrfToken = null;
async function getCSRFToken() {
  if (_csrfToken) return _csrfToken;
  try { const r = await fetch('/api/csrf-token'); if (r.ok) { const d = await r.json(); _csrfToken = d.token; } } catch (e) { console.warn('[admin] fout:', e.message); }
  return _csrfToken || '';
}
async function apiFetch(url, options = {}) {
  const token = await getCSRFToken();
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}), ...(options.headers || {}) },
  });
}

// ── Tab navigatie ─────────────────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'teachers') loadTeachers();
    if (btn.dataset.tab === 'classes')  { loadSchoolYears().then(loadClasses); }
    if (btn.dataset.tab === 'students') { loadClassFilter(); loadStudents(); }
  });
});

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(Number(ts)).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Leerkrachten ──────────────────────────────────────────────────────────────
let _teachers = [];
async function loadTeachers() {
  const r = await fetch('/api/admin/teachers');
  _teachers = await r.json();
  const tbody = document.getElementById('teachers-tbody');
  tbody.innerHTML = _teachers.map(t => `
    <tr>
      <td><strong>${escHtml(t.username)}</strong></td>
      <td>${escHtml(t.display_name || '—')}</td>
      <td><span class="${t.role === 'admin' ? 'badge-admin' : 'badge-teacher'}">${t.role === 'admin' ? 'Admin' : 'Leerkracht'}</span></td>
      <td>${fmtDate(t.last_login)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-muted small" onclick="resetPwd('${escHtml(t.username)}')">🔑 Wachtwoord</button>
        <button class="btn btn-muted small" onclick="toggleRole('${escHtml(t.username)}','${t.role}')">${t.role === 'admin' ? '↓ Leerkracht' : '↑ Admin'}</button>
        <button class="btn btn-danger small" onclick="deleteTeacher('${escHtml(t.username)}')">Verwijderen</button>
      </td>
    </tr>`).join('');
}

async function addTeacher() {
  const u = document.getElementById('new-teacher-username').value.trim();
  const p = document.getElementById('new-teacher-password').value;
  const d = document.getElementById('new-teacher-display').value.trim();
  const r = document.getElementById('new-teacher-role').value;
  if (!u || !p) return await pyAlert('Gebruikersnaam en wachtwoord zijn verplicht.', "warn");
  if (p.length < 8) return await pyAlert('Wachtwoord moet minimaal 8 tekens bevatten.', "warn");
  const res = await apiFetch('/api/admin/teachers', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username:u, password:p, displayName:d, role:r }) });
  const data = await res.json();
  if (data.ok) { loadTeachers(); ['new-teacher-username','new-teacher-password','new-teacher-display'].forEach(id => document.getElementById(id).value = ''); }
  else await pyAlert('Fout: ' + (data.error || 'onbekend'), "error");
}

async function resetPwd(username) {
  const pwd = prompt(`Nieuw wachtwoord voor ${username} (min. 8 tekens):`);
  if (!pwd || pwd.length < 8) return;
  const res = await apiFetch(`/api/admin/teachers/${encodeURIComponent(username)}/password`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pwd }) });
  const data = await res.json();
  data.ok ? pyToast('Wachtwoord bijgewerkt.', 'success') : await pyAlert('Fout: ' + data.error, "error");
}

async function toggleRole(username, currentRole) {
  const newRole = currentRole === 'admin' ? 'teacher' : 'admin';
  if (!await pyConfirm({ title: 'Rol wijzigen', body: `Rol van ${username} wijzigen naar ${newRole}?`, confirmLabel: 'Wijzigen' })) return;
  await apiFetch(`/api/admin/teachers/${encodeURIComponent(username)}/role`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: newRole }) });
  loadTeachers();
}

async function deleteTeacher(username) {
  if (!await pyConfirm({ title: 'Leerkracht verwijderen', body: `Leerkracht "${username}" verwijderen? Dit kan niet ongedaan worden.`, confirmLabel: 'Verwijderen', danger: true })) return;
  await apiFetch(`/api/admin/teachers/${encodeURIComponent(username)}`, { method:'DELETE' });
  loadTeachers();
}

// ── Klassen ───────────────────────────────────────────────────────────────────
// Sprint 41: schooljaren in de selector laden (met markering voor gearchiveerde jaren).
async function loadSchoolYears() {
  const sel = document.getElementById('year-filter');
  if (!sel) return;
  try {
    const r = await fetch('/api/admin/school-years');
    const years = await r.json();
    const huidige = sel.value;
    sel.innerHTML = '<option value="">Alle jaren</option>' +
      years.map(y => `<option value="${escHtml(y.schoolYear)}">${escHtml(y.schoolYear)}${y.allArchived ? ' 🔒' : ''}</option>`).join('');
    if (huidige) sel.value = huidige;
    _yearInfo = {};
    years.forEach(y => { _yearInfo[y.schoolYear] = y; });
  } catch { /* stil: selector blijft "Alle jaren" */ }
}

let _yearInfo = {};

async function loadClasses() {
  const archived = document.getElementById('show-archived-classes')?.checked;
  const year = document.getElementById('year-filter')?.value || '';
  const params = new URLSearchParams();
  if (archived) params.set('archived', 'true');
  if (year) params.set('schoolYear', year);
  const r = await fetch(`/api/admin/classes${params.toString() ? '?' + params : ''}`);
  const classes = await r.json();

  // Sprint 41: een volledig gearchiveerd schooljaar is read-only.
  const jaarReadonly = year && _yearInfo[year]?.allArchived === true;
  const banner = document.getElementById('year-readonly-banner');
  if (banner) banner.style.display = jaarReadonly ? 'block' : 'none';

  const tbody = document.getElementById('classes-tbody');
  tbody.innerHTML = classes.map(c => {
    const readonly = jaarReadonly || c.archived;
    return `
    <tr style="${c.archived ? 'opacity:0.5;' : ''}">
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${escHtml(c.school_year)}</td>
      <td>${c.student_count ?? 0}</td>
      <td>${c.archived ? '<span class="badge">Gearchiveerd</span>' : '<span class="status-active">Actief</span>'}</td>
      <td style="display:flex;gap:6px;">
        ${readonly ? '<span class="muted" style="font-size:0.8rem;">🔒 alleen-lezen</span>' : `
          ${!c.archived ? `<button class="btn btn-muted small" onclick="archiveClass('${c.id}')">Archiveren</button>` : ''}
          <button class="btn btn-danger small" onclick="deleteClass('${c.id}','${escHtml(c.name)}')">Verwijderen</button>`}
      </td>
    </tr>`;
  }).join('');
}

async function addClass() {
  const name = document.getElementById('new-class-name').value.trim();
  const year = document.getElementById('new-class-year').value.trim();
  if (!name) return await pyAlert('Naam is verplicht.', "warn");
  const res = await apiFetch('/api/admin/classes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, schoolYear: year }) });
  const data = await res.json();
  if (data.ok) { document.getElementById('new-class-name').value = ''; loadSchoolYears().then(loadClasses); }
  else await pyAlert('Fout: ' + data.error, "error");
}

async function archiveClass(id) {
  if (!await pyConfirm({ title: 'Klas archiveren', body: 'De klas wordt verborgen maar data blijft bewaard. Herstelbaar via "Toon gearchiveerd".', confirmLabel: 'Archiveren' })) return;
  await apiFetch(`/api/admin/classes/${id}/archive`, { method:'PUT' });
  loadClasses();
}

async function deleteClass(id, name) {
  if (!await pyConfirm({ title: 'Klas verwijderen', body: `Klas "${name}" verwijderen? Enkel mogelijk als de klas leeg is.`, confirmLabel: 'Verwijderen', danger: true })) return;
  const res = await apiFetch(`/api/admin/classes/${id}`, { method:'DELETE' });
  const data = await res.json();
  if (!data.ok) await pyAlert('Kan klas niet verwijderen — verwijder eerst alle leerlingen.', "error");
  else loadClasses();
}

// ── Leerlingen ────────────────────────────────────────────────────────────────
let _allStudents = [];

async function loadClassFilter() {
  try {
    const r = await fetch('/api/classes');
    const classes = await r.json();
    // Filter dropdown
    const sel = document.getElementById('student-class-filter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Alle klassen</option>' + classes.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    if (cur) sel.value = cur;
    // Handmatig toevoegen dropdown
    const newSel = document.getElementById('new-student-class');
    if (newSel) {
      newSel.innerHTML = '<option value="">— Geen klas —</option>' + classes.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    }
  } catch(e) { console.error('[admin] loadClassFilter:', e); }
}

// 22c: handmatig leerling toevoegen
async function addStudentManual() {
  const name    = document.getElementById('new-student-name').value.trim();
  const classId = document.getElementById('new-student-class').value;
  if (!name) return await pyAlert('Naam is verplicht.', "warn");
  try {
    const r    = await fetch('/api/admin/students', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, classId: classId || null, source:'manual', status:'active' }),
    });
    const data = await r.json();
    if (data.ok || data.id) {
      document.getElementById('new-student-name').value = '';
      document.getElementById('new-student-class').value = '';
      await loadStudents();
    } else {
      await pyAlert('Fout bij toevoegen: ' + (data.error || 'onbekend'), "error");
    }
  } catch(e) { await pyAlert('Netwerkfout: ' + e.message, "error"); }
}

// 22b: proper loading + error handling
async function loadStudents() {
  const classId    = document.getElementById('student-class-filter').value;
  const loadingEl  = document.getElementById('students-loading');
  const errorEl    = document.getElementById('students-error');
  const tbody      = document.getElementById('students-tbody');
  loadingEl.style.display = 'block';
  errorEl.style.display   = 'none';
  tbody.innerHTML = '';
  try {
    const r = await fetch(`/api/admin/students${classId ? '?classId=' + classId : ''}`);
    if (!r.ok) throw new Error(`Server antwoordde ${r.status}`);
    _allStudents = await r.json();
    renderStudentTable(_allStudents);
  } catch(e) {
    errorEl.textContent = '⚠️ Kon leerlingen niet laden: ' + e.message + ' — herlaad de pagina.';
    errorEl.style.display = 'block';
    tbody.innerHTML = '';
  } finally {
    loadingEl.style.display = 'none';
  }
}

function filterStudents() {
  const q = document.getElementById('student-search').value.toLowerCase();
  renderStudentTable(_allStudents.filter(s => s.name.toLowerCase().includes(q)));
}

const statusLabel = { active:'Actief', pending:'Afwachting', blocked:'Geblokkeerd' };
const sourceLabel = { manual:'Handmatig', csv:'CSV', google:'Google', smartschool:'Smartschool' };

function renderStudentTable(students) {
  const tbody = document.getElementById('students-tbody');
  if (!students.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted" style="padding:16px;">Geen leerlingen gevonden.</td></tr>'; return; }
  tbody.innerHTML = students.map(s => `
    <tr>
      <td><strong>${escHtml(s.name)}</strong></td>
      <td>${escHtml(s.class_name || '—')}</td>
      <td><span class="status-${s.status}">${statusLabel[s.status] || s.status}</span></td>
      <td>${escHtml(sourceLabel[s.source] || s.source)}</td>
      <td>${fmtDate(s.last_seen)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        ${s.status !== 'active'   ? `<button class="btn btn-success small" onclick="setStudentStatus('${s.id}','active')" title="Leerling aanvaarden">✓ Aanvaarden</button>` : ''}
        ${s.status !== 'blocked'  ? `<button class="btn btn-muted small" onclick="setStudentStatus('${s.id}','blocked')" title="Leerling blokkeren — kan niet meer inloggen">✕ Blokkeren</button>` : ''}
        ${s.status === 'blocked'  ? `<button class="btn btn-muted small" onclick="setStudentStatus('${s.id}','active')" title="Blokkering opheffen">↩ Deblokkeren</button>` : ''}
        <button class="btn btn-muted small" title="Notitie bewerken" onclick="editNote('${s.id}','${escHtml(s.notes||'')}')">🗒 Notitie</button>
        <button class="btn btn-danger small" title="Leerling verwijderen" onclick="deleteStudent('${s.id}','${escHtml(s.name)}')">🗑 Verwijderen</button>
      </td>
    </tr>`).join('');
}

async function setStudentStatus(id, status) {
  await apiFetch(`/api/admin/students/${id}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
  loadStudents();
}

async function editNote(id, currentNote) {
  const note = prompt('Notitie (max 500 tekens):', currentNote);
  if (note === null) return;
  await apiFetch(`/api/admin/students/${id}/notes`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notes: note }) });
  loadStudents();
}

async function deleteStudent(id, name) {
  if (!await pyConfirm({ title: 'Leerling verwijderen', body: `Leerling "${name}" definitief verwijderen?`, confirmLabel: 'Verwijderen', danger: true })) return;
  await apiFetch(`/api/admin/students/${id}`, { method:'DELETE' });
  loadStudents();
}

async function importCSV() {
  const csv = document.getElementById('csv-input').value.trim();
  if (!csv) return await pyAlert('Voer CSV-data in.', "warn");
  const res = await apiFetch('/api/admin/students/import-csv', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ csv }) });
  const data = await res.json();
  const el = document.getElementById('import-result');
  el.style.display = 'block';
  if (data.ok) {
    el.className = 'import-result ok';
    el.innerHTML = `✅ <strong>${data.added}</strong> toegevoegd · <strong>${data.skipped}</strong> overgeslagen · <strong>${data.classesCreated}</strong> klassen aangemaakt${data.errors.length ? '<br>⚠️ Fouten: ' + data.errors.join(', ') : ''}`;
    loadStudents(); loadClassFilter();
  } else {
    el.className = 'import-result err';
    el.textContent = '❌ ' + data.error;
  }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
loadTeachers();
