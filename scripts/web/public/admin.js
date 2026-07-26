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
    if (btn.dataset.tab === 'schools')  loadSchools();
    if (btn.dataset.tab === 'classes')  { loadSchoolYears().then(loadClasses); }
    if (btn.dataset.tab === 'students') { loadClassFilter(); loadStudents(); }
  });
});

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(Number(ts)).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Sprint 55: identiteit + zoekvelden + groepering ──────────────────────────
let MIJ = { role: 'admin', magSysteem: true };
fetch('/api/me').then(r => r.ok ? r.json() : null).then(me => { if (me) MIJ = me; }).catch(() => {});

// Plaatst (eenmalig) een zoekveld vlak boven de tabel van een tbody; filtert client-side.
function zorgZoekveld(tbodyId, placeholder, onzoek) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const tabel = tbody.closest('table');
  const id = 'zoek-' + tbodyId;
  if (document.getElementById(id)) return;
  const veld = document.createElement('input');
  veld.id = id; veld.placeholder = '🔎 ' + placeholder;
  veld.style.cssText = 'width:100%;max-width:420px;margin:0 0 10px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:0.9rem;';
  veld.addEventListener('input', () => onzoek(veld.value.trim().toLowerCase()));
  tabel.parentNode.insertBefore(veld, tabel);
}
function zoekwaarde(tbodyId) {
  return (document.getElementById('zoek-' + tbodyId)?.value || '').trim().toLowerCase();
}
function groepsRij(kolommen, tekst) {
  return `<tr><td colspan="${kolommen}" style="background:var(--blauw-l,#eff6ff);font-weight:800;padding:8px 10px;border-top:2px solid var(--border);">${tekst}</td></tr>`;
}

// ── Leerkrachten ──────────────────────────────────────────────────────────────
let _teachers = [];
let _teachersMeta = { mijnScholen: null, isSuperAdmin: false };
async function loadTeachers() {
  const r = await fetch('/api/admin/teachers');
  const d = await r.json();
  // Sprint 55: response is { mijnScholen, isSuperAdmin, teachers }
  _teachers = Array.isArray(d) ? d : (d.teachers || []);
  _teachersMeta = { mijnScholen: d.mijnScholen ?? null, isSuperAdmin: d.isSuperAdmin === true };
  zorgZoekveld('teachers-tbody', 'Zoek leerkracht (naam, gebruikersnaam, school)…', renderTeachers);
  renderTeachers(zoekwaarde('teachers-tbody'));
}

function rolKnop(t) {
  // Super-admin: volledige cyclus. Admin: enkel teacher↔admin, en van super-admins blijft
  // hij af (de server dwingt dit óók af — dit verbergt enkel wat toch geweigerd wordt).
  if (_teachersMeta.isSuperAdmin) {
    const label = t.role === 'teacher' ? '↑ Admin' : t.role === 'admin' ? '↑ Super-admin' : '↓ Leerkracht';
    return `<button class="btn btn-muted small" title="Rol wisselen" onclick="toggleRole('${escHtml(t.username)}','${t.role}')">${label}</button>`;
  }
  if (t.role === 'superadmin') return '';
  const nieuw = t.role === 'teacher' ? 'admin' : 'teacher';
  return `<button class="btn btn-muted small" onclick="zetRol('${escHtml(t.username)}','${nieuw}')">${t.role === 'teacher' ? '↑ Admin' : '↓ Leerkracht'}</button>`;
}

function renderTeachers(zoek = '') {
  const tbody = document.getElementById('teachers-tbody');
  const past = t => !zoek
    || (t.username || '').toLowerCase().includes(zoek)
    || (t.display_name || '').toLowerCase().includes(zoek)
    || (t.schools || []).some(sc => (sc.name || '').toLowerCase().includes(zoek));

  // Groepeer per school: een leerkracht met 2 scholen staat in beide groepen (dat is
  // net het punt van groeperen); zonder school → groep "Zonder school".
  const groepen = new Map();
  for (const t of _teachers.filter(past)) {
    const scholen = (t.schools || []).filter(sc =>
      _teachersMeta.mijnScholen === null || _teachersMeta.mijnScholen.includes(sc.id));
    if (!scholen.length) {
      if (!groepen.has('__geen')) groepen.set('__geen', { naam: '🏛 Zonder school', rijen: [] });
      groepen.get('__geen').rijen.push(t);
    } else {
      for (const sc of scholen) {
        if (!groepen.has(sc.id)) groepen.set(sc.id, { naam: '🏛 ' + escHtml(sc.name), rijen: [] });
        groepen.get(sc.id).rijen.push(t);
      }
    }
  }
  const delen = [];
  for (const [, g] of [...groepen.entries()].sort((a, b) => a[1].naam.localeCompare(b[1].naam))) {
    delen.push(groepsRij(6, g.naam + ` <span class="muted" style="font-weight:400;">(${g.rijen.length})</span>`));
    for (const t of g.rijen) {
      const scholen = (t.schools || []).length
        ? t.schools.map(sc => `<span class="badge" style="${sc.active ? '' : 'text-decoration:line-through;opacity:0.6;'}">${escHtml(sc.name)}</span>`).join(' ')
        : '<span class="muted" style="font-size:0.8rem;">—</span>';
      delen.push(`
      <tr>
        <td><strong>${escHtml(t.username)}</strong></td>
        <td>${escHtml(t.display_name || '—')}</td>
        <td><span class="${t.role === 'teacher' ? 'badge-teacher' : 'badge-admin'}"${t.role === 'superadmin' ? ' style="background:#7c3aed;color:#fff;" title="Hosting-beheerder"' : ''}>${t.role === 'superadmin' ? '★ Super-admin' : t.role === 'admin' ? 'Admin' : 'Leerkracht'}</span></td>
        <td style="max-width:220px;">${scholen}</td>
        <td>${fmtDate(t.last_login)}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          ${_teachersMeta.isSuperAdmin ? `<button class="btn btn-muted small" onclick="manageSchools('${t.id}')">🏛 Scholen</button>` : ''}
          <button class="btn btn-muted small" onclick="resetPwd('${escHtml(t.username)}')">🔑 Wachtwoord</button>
          ${rolKnop(t)}
          ${t.role === 'superadmin' && !_teachersMeta.isSuperAdmin ? '' : `<button class="btn btn-danger small" onclick="deleteTeacher('${escHtml(t.username)}')">Verwijderen</button>`}
        </td>
      </tr>`);
    }
  }
  tbody.innerHTML = delen.join('') || `<tr><td colspan="6" class="muted" style="padding:14px;">Geen leerkrachten gevonden${zoek ? ' voor deze zoekopdracht' : ''}.</td></tr>`;
}

async function zetRol(username, role) {
  const res = await apiFetch(`/api/admin/teachers/${encodeURIComponent(username)}/role`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) await pyAlert('Rolwijziging geweigerd: ' + (d.error || res.status), 'error');
  loadTeachers();
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
  // 48c4: cyclus leerkracht → admin → super-admin → leerkracht. De server bewaakt wie de
  // superadmin-rol mag toekennen (enkel een super-admin, met admin-bootstrap).
  const newRole = currentRole === 'teacher' ? 'admin' : currentRole === 'admin' ? 'superadmin' : 'teacher';
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

  _allClasses = classes;
  _jaarReadonly = jaarReadonly;
  zorgZoekveld('classes-tbody', 'Zoek klas (naam, schooljaar, school)…', renderClasses);
  renderClasses(zoekwaarde('classes-tbody'));
}

let _allClasses = [], _jaarReadonly = false;
function renderClasses(zoek = '') {
  const jaarReadonly = _jaarReadonly;
  const past = c => !zoek
    || (c.name || '').toLowerCase().includes(zoek)
    || (c.school_year || '').toLowerCase().includes(zoek)
    || (c.school_name || '').toLowerCase().includes(zoek);
  const lijst = _allClasses.filter(past);

  // Sprint 55: groepeer per school (school-loos → "Zonder school").
  const groepen = new Map();
  for (const c of lijst) {
    const sleutel = c.school_id || '__geen';
    if (!groepen.has(sleutel)) groepen.set(sleutel, { naam: c.school_name ? '🏛 ' + escHtml(c.school_name) : '🏛 Zonder school', rijen: [] });
    groepen.get(sleutel).rijen.push(c);
  }
  const delen = [];
  for (const [, g] of [...groepen.entries()].sort((a, b) => a[1].naam.localeCompare(b[1].naam))) {
    delen.push(groepsRij(6, g.naam + ` <span class="muted" style="font-weight:400;">(${g.rijen.length})</span>`));
    delen.push(g.rijen.map(c => {
    const readonly = jaarReadonly || c.archived;
    return `
    <tr style="${c.archived ? 'opacity:0.5;' : ''}">
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${escHtml(c.school_year)}</td>
      <td>${c.student_count ?? 0}</td>
      <td>${c.archived ? '<span class="badge">Gearchiveerd</span>' : '<span class="status-active">Actief</span>'}</td>
      <td>${startCodeCell(c, readonly)}</td>
      <td style="display:flex;gap:6px;">
        ${readonly ? '<span class="muted" style="font-size:0.8rem;">🔒 alleen-lezen</span>' : `
          ${!c.archived ? `<button class="btn btn-muted small" onclick="archiveClass('${c.id}')">Archiveren</button>` : ''}
          <button class="btn btn-danger small" onclick="deleteClass('${c.id}','${escHtml(c.name)}')">Verwijderen</button>`}
      </td>
    </tr>`;
    }).join(''));
  }
  const tbody = document.getElementById('classes-tbody');
  tbody.innerHTML = delen.join('') || `<tr><td colspan="6" class="muted" style="padding:14px;">Geen klassen gevonden${zoek ? ' voor deze zoekopdracht' : ''}.</td></tr>`;
}

// Sprint 52b: startcode-cel — grote code + aan/uit + nieuwe code (voor op het bord).
function startCodeCell(c, readonly) {
  if (readonly) {
    return c.start_code
      ? `<code style="font-size:1rem;letter-spacing:1px;">${escHtml(c.start_code)}</code>`
      : '<span class="muted" style="font-size:0.8rem;">—</span>';
  }
  if (!c.start_code) {
    return `<button class="btn btn-soft small" onclick="rotateStartCode('${c.id}')">Genereer code</button>`;
  }
  const actief = c.start_code_active === true;
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <code style="font-size:1.15rem;font-weight:800;letter-spacing:2px;padding:2px 8px;border:1.5px solid var(--border);border-radius:8px;">${escHtml(c.start_code)}</code>
      <span class="badge" style="${actief ? 'background:#dcfce7;color:#166534;' : 'background:#e2e8f0;color:#475569;'}">${actief ? '🟢 open' : '⚪ dicht'}</span>
      <button class="btn btn-muted small" onclick="toggleStartCode('${c.id}', ${actief ? 'false' : 'true'})">${actief ? 'Sluiten' : 'Openen'}</button>
      <button class="btn btn-muted small" onclick="rotateStartCode('${c.id}')" title="Nieuwe code — de oude werkt dan niet meer">↻</button>
    </div>`;
}

async function rotateStartCode(classId) {
  const res = await apiFetch(`/api/admin/classes/${classId}/start-code`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (data.ok) loadSchoolYears().then(loadClasses);
  else await pyAlert('Fout: ' + (data.error || 'kon geen code maken'), 'error');
}

async function toggleStartCode(classId, active) {
  const res = await apiFetch(`/api/admin/classes/${classId}/start-code/active`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) loadSchoolYears().then(loadClasses);
  else await pyAlert('Fout: ' + (data.error || 'kon status niet wijzigen'), 'error');
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
    zorgZoekveld('students-tbody', 'Zoek leerling (naam, e-mail, klas, school)…', z => renderStudentTable(_allStudents, z));
    renderStudentTable(_allStudents, zoekwaarde('students-tbody'));
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

function renderStudentTable(students, zoek = '') {
  const tbody = document.getElementById('students-tbody');
  const past = s => !zoek
    || (s.name || '').toLowerCase().includes(zoek)
    || (s.email || '').toLowerCase().includes(zoek)
    || (s.class_name || '').toLowerCase().includes(zoek)
    || (s.school_name || '').toLowerCase().includes(zoek);
  const lijst = students.filter(past);
  if (!lijst.length) { tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:16px;">Geen leerlingen gevonden${zoek ? ' voor deze zoekopdracht' : ''}.</td></tr>`; return; }

  // Sprint 55: groepeer school → klas (beheeroverzicht levert één rij per lidmaatschap;
  // zonder klas → "Zonder klas", zonder school → "Zonder school").
  const scholen = new Map();
  for (const s of lijst) {
    const sSleutel = s.groep_school_id || s.school_id || '__geen';
    if (!scholen.has(sSleutel)) scholen.set(sSleutel, { naam: s.school_name ? '🏛 ' + escHtml(s.school_name) : '🏛 Zonder school', klassen: new Map() });
    const sch = scholen.get(sSleutel);
    const kSleutel = s.class_name || '__geen';
    if (!sch.klassen.has(kSleutel)) sch.klassen.set(kSleutel, { naam: s.class_name ? escHtml(s.class_name) + (s.school_year ? ' · ' + escHtml(s.school_year) : '') : 'Zonder klas', rijen: [] });
    sch.klassen.get(kSleutel).rijen.push(s);
  }
  const delen = [];
  for (const [, sch] of [...scholen.entries()].sort((a, b) => a[1].naam.localeCompare(b[1].naam))) {
    const totaal = [...sch.klassen.values()].reduce((n, k) => n + k.rijen.length, 0);
    delen.push(groepsRij(7, sch.naam + ` <span class="muted" style="font-weight:400;">(${totaal})</span>`));
    for (const [, k] of [...sch.klassen.entries()].sort((a, b) => a[1].naam.localeCompare(b[1].naam))) {
      delen.push(`<tr><td colspan="7" style="padding:5px 10px 5px 26px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);">👥 ${k.naam} <span style="font-weight:400;">(${k.rijen.length})</span></td></tr>`);
      delen.push(k.rijen.map(s => `
    <tr>
      <td><strong>${escHtml(s.name)}</strong>${s.must_change_password ? ' <span class="badge" title="Wachtwoordreset staat klaar" style="background:#fef3c7;color:#92400e;">reset</span>' : ''}</td>
      <td>${s.email ? escHtml(s.email) : '<span class="muted" style="font-size:0.8rem;">—</span>'}</td>
      <td>${escHtml(s.class_name || '—')}</td>
      <td><span class="status-${s.status}">${statusLabel[s.status] || s.status}</span></td>
      <td>${escHtml(sourceLabel[s.source] || s.source)}</td>
      <td>${fmtDate(s.last_seen)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        ${s.status !== 'active'   ? `<button class="btn btn-success small" onclick="setStudentStatus('${s.id}','active')" title="Leerling aanvaarden">✓ Aanvaarden</button>` : ''}
        ${s.status !== 'blocked'  ? `<button class="btn btn-muted small" onclick="setStudentStatus('${s.id}','blocked')" title="Leerling blokkeren — kan niet meer inloggen">✕ Blokkeren</button>` : ''}
        ${s.status === 'blocked'  ? `<button class="btn btn-muted small" onclick="setStudentStatus('${s.id}','active')" title="Blokkering opheffen">↩ Deblokkeren</button>` : ''}
        <button class="btn btn-muted small" title="Naam/e-mail bewerken" onclick='editStudentIdentity(${JSON.stringify({id:s.id,first:s.first_name||'',last:s.last_name||'',email:s.email||''})})'>✏️ Bewerken</button>
        ${s.email ? `<button class="btn btn-muted small" title="Wachtwoordreset klaarzetten (leerling herstelt zelf via klascode)" onclick="resetStudentPassword('${s.id}','${escHtml(s.name)}')">🔑 Reset</button>` : ''}
        <button class="btn btn-muted small" title="Notitie bewerken" onclick="editNote('${s.id}','${escHtml(s.notes||'')}')">🗒 Notitie</button>
        <button class="btn btn-danger small" title="Leerling verwijderen" onclick="deleteStudent('${s.id}','${escHtml(s.name)}')">🗑 Verwijderen</button>
      </td>
    </tr>`).join(''));
    }
  }
  tbody.innerHTML = delen.join('');
}

async function editStudentIdentity(s) {
  const first = await pyPrompt({ title: 'Voornaam', body: 'Voornaam:', defaultValue: s.first, confirmLabel: 'Volgende' });
  if (first === null) return;
  const last = await pyPrompt({ title: 'Achternaam', body: 'Achternaam:', defaultValue: s.last, confirmLabel: 'Volgende' });
  if (last === null) return;
  const email = await pyPrompt({ title: 'E-mailadres', body: 'E-mailadres (mag leeg):', defaultValue: s.email, confirmLabel: 'Bewaren' });
  if (email === null) return;
  const res = await apiFetch(`/api/admin/students/${s.id}/identity`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: first, lastName: last, email }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) loadStudents();
  else await pyAlert('Fout: ' + (data.error || 'bewerken mislukt'), 'error');
}

async function resetStudentPassword(id, name) {
  if (!await pyConfirm({ title: 'Wachtwoord resetten', body: `Reset klaarzetten voor "${name}"? De leerling kiest daarna zelf een nieuw wachtwoord via de klascode (jij bewaart geen wachtwoord).`, confirmLabel: 'Reset klaarzetten' })) return;
  const res = await apiFetch(`/api/admin/students/${id}/reset-password`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (data.ok) { await pyAlert('Reset staat klaar. Geef de leerling de klascode; die herstelt via "Wachtwoord vergeten".', 'success'); loadStudents(); }
  else await pyAlert('Fout: ' + (data.error || 'reset mislukt'), 'error');
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

// ══════════════════════════════════════════════════════════════════════════════
// Sprint 48a1 — Scholen
// Eerste steen van het multi-tenant fundament. Additief: zolang er niets aan een
// school hangt, verandert dit niets aan de werking van de app.
// ══════════════════════════════════════════════════════════════════════════════

let _scholenCache = [];

async function loadSchools() {
  const el = document.getElementById('schools-list');
  if (!el) return;
  const ookInactief = document.getElementById('show-inactive-schools')?.checked;
  try {
    const r = await fetch('/api/admin/schools' + (ookInactief ? '?includeInactive=true' : ''));
    if (!r.ok) { el.innerHTML = '<p class="muted">Kon scholen niet laden.</p>'; return; }
    const scholen = await r.json();
    _scholenCache = scholen;
    if (!scholen.length) {
      el.innerHTML = ookInactief
        ? '<p class="muted">Nog geen scholen aangemaakt.</p>'
        : '<p class="muted">Geen actieve scholen. Vink hierboven aan om ook inactieve te tonen.</p>';
      return;
    }
    el.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Naam</th><th>Licentie</th><th>Contact</th><th>Status</th><th>Aangemaakt</th><th></th></tr></thead>
        <tbody>${scholen.map(s => `
          <tr style="${s.active ? '' : 'opacity:0.5;'}">
            <td><strong>${escHtml(s.name)}</strong>${s.logo_path ? `<br/><span class="muted" style="font-size:0.75rem;">${escHtml(s.logo_path)}</span>` : ''}</td>
            <td>${escHtml(s.license || '—')}</td>
            <td>${escHtml(s.contact || '—')}</td>
            <td>${s.active ? '<span class="status-active">Actief</span>' : '<span class="badge">Inactief</span>'}</td>
            <td>${fmtDate(s.created_at)}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-muted small" onclick="manageDomains('${s.id}')">📧 Domeinen</button>
              <button class="btn btn-muted small" onclick="editSchool('${s.id}')">Bewerken</button>
              <button class="btn btn-muted small" onclick="toggleSchool('${s.id}', ${!s.active})">${s.active ? 'Deactiveren' : 'Heractiveren'}</button>
              <button class="btn btn-danger small" onclick="deleteSchool('${s.id}')">Verwijderen</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = '<p class="muted">Kon scholen niet laden.</p>';
  }
}

async function addSchool() {
  const naam = document.getElementById('new-school-name').value.trim();
  if (!naam) return await pyAlert('Naam is verplicht.', 'warn');
  const res = await apiFetch('/api/admin/schools', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: naam,
      logoPath: document.getElementById('new-school-logo').value.trim(),
      license: document.getElementById('new-school-license').value.trim(),
      contact: document.getElementById('new-school-contact').value.trim(),
    }),
  });
  const data = await res.json();
  if (data.ok) {
    ['new-school-name', 'new-school-logo', 'new-school-license', 'new-school-contact']
      .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    loadSchools();
  } else {
    await pyAlert('Fout: ' + data.error, 'error');
  }
}

async function editSchool(id) {
  const school = _scholenCache.find(s => s.id === id);
  if (!school) return await pyAlert('School niet gevonden.', 'warn');

  const naam = await pyPrompt({ title: 'School bewerken', body: 'Naam:', defaultValue: school.name, confirmLabel: 'Volgende' });
  if (naam === null) return;
  if (!naam.trim()) return await pyAlert('Naam mag niet leeg zijn.', 'warn');
  const licentie = await pyPrompt({ title: 'School bewerken', body: 'Licentie:', defaultValue: school.license || '', confirmLabel: 'Volgende' });
  if (licentie === null) return;
  const contact = await pyPrompt({ title: 'School bewerken', body: 'Contact:', defaultValue: school.contact || '', confirmLabel: 'Opslaan' });
  if (contact === null) return;

  const res = await apiFetch(`/api/admin/schools/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: naam.trim(), license: licentie.trim(), contact: contact.trim() }),
  });
  const data = await res.json();
  if (data.ok) loadSchools();
  else await pyAlert('Fout: ' + (data.error || 'opslaan mislukt'), 'error');
}

// Deactiveren i.p.v. verwijderen: een school met geschiedenis wil je bewaren,
// maar niet meer aanbieden bij de schoolkeuze (48b).
async function toggleSchool(id, actief) {
  const res = await apiFetch(`/api/admin/schools/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: actief }),
  });
  const data = await res.json();
  if (data.ok) loadSchools();
  else await pyAlert('Fout: ' + (data.error || 'wijzigen mislukt'), 'error');
}

async function deleteSchool(id) {
  // Naam uit de cache i.p.v. uit de onclick: een school als "Sint-Jan's College"
  // zou de attribuut-quotes breken.
  const naam = _scholenCache.find(s => s.id === id)?.name || 'deze school';
  const ok = await pyConfirm({
    title: 'School verwijderen',
    body: `"${naam}" definitief verwijderen? Deactiveren is meestal de betere keuze — dan blijft de geschiedenis bestaan.`,
    confirmLabel: 'Verwijderen', danger: true,
  });
  if (!ok) return;
  const res = await apiFetch(`/api/admin/schools/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) loadSchools();
  else await pyAlert('Verwijderen mislukt.', 'error');
}

// ══════════════════════════════════════════════════════════════════════════════
// Sprint 48a2 — Leerkracht ↔ scholen koppelen
// Veel-op-veel: een leerkracht kan op meerdere scholen werken. Dit is wat straks
// het schoolkeuze-scherm bij het inloggen voedt (48b2).
// ══════════════════════════════════════════════════════════════════════════════

window.manageSchools = async function (teacherId) {
  const leerkracht = _teachers.find(t => t.id === teacherId);
  if (!leerkracht) return await pyAlert('Leerkracht niet gevonden.', 'warn');

  let alle = [];
  try {
    const r = await fetch('/api/admin/schools?includeInactive=true');
    alle = await r.json();
  } catch { return await pyAlert('Kon de scholen niet laden.', 'error'); }

  if (!alle.length) {
    return await pyAlert('Er zijn nog geen scholen. Maak er eerst een aan in de tab "Scholen".', 'warn');
  }

  const gekoppeld = new Set((leerkracht.schools || []).map(s => s.id));
  const origineel = new Set(gekoppeld);

  const oud = document.getElementById('py-modal-overlay');
  if (oud) oud.remove();
  const overlay = document.createElement('div');
  overlay.id = 'py-modal-overlay';
  overlay.innerHTML = `
    <div id="py-modal-box" style="max-width:460px;">
      <div id="py-modal-title">Scholen van ${escHtml(leerkracht.display_name || leerkracht.username)}</div>
      <div id="py-modal-body">
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem;">
          Vink aan op welke scholen deze leerkracht werkt. Bij meerdere scholen krijgt
          hij straks een keuzescherm na het inloggen.
        </p>
        <div id="ts-list" style="max-height:300px;overflow-y:auto;border:1.5px solid var(--border);border-radius:10px;padding:8px;"></div>
      </div>
      <div id="py-modal-actions">
        <button id="ts-cancel" class="btn btn-muted small">Annuleren</button>
        <button id="ts-save" class="btn btn-primary small">Opslaan</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('ts-list').innerHTML = alle.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;">
      <input type="checkbox" class="ts-cb" value="${s.id}"${gekoppeld.has(s.id) ? ' checked' : ''}/>
      <span style="${s.active ? '' : 'opacity:0.6;'}">${escHtml(s.name)}${s.active ? '' : ' <span class="badge">inactief</span>'}</span>
    </label>`).join('');

  document.querySelectorAll('.ts-cb').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) gekoppeld.add(cb.value); else gekoppeld.delete(cb.value);
  }));

  const sluit = () => overlay.remove();
  document.getElementById('ts-cancel').addEventListener('click', sluit);
  overlay.addEventListener('click', e => { if (e.target === overlay) sluit(); });

  document.getElementById('ts-save').addEventListener('click', async () => {
    // Enkel de verschillen wegschrijven — niet alles verwijderen en opnieuw aanmaken.
    // Dat scheelt verzoeken en houdt het audit-log leesbaar.
    const toevoegen = [...gekoppeld].filter(id => !origineel.has(id));
    const weghalen  = [...origineel].filter(id => !gekoppeld.has(id));
    try {
      for (const id of toevoegen) {
        await apiFetch(`/api/admin/teachers/${teacherId}/schools`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId: id }),
        });
      }
      for (const id of weghalen) {
        await apiFetch(`/api/admin/teachers/${teacherId}/schools/${id}`, { method: 'DELETE' });
      }
      sluit();
      loadTeachers();
    } catch (e) {
      await pyAlert('Opslaan mislukt: ' + e.message, 'error');
    }
  });
};

// ══════════════════════════════════════════════════════════════════════════════
// Sprint 48a3 — E-maildomeinen per school
// De regels zitten in lib/validation.js (server) en zijn daar apart getest.
// Dit scherm legt ze uit en laat je ze meteen uitproberen.
// ══════════════════════════════════════════════════════════════════════════════

window.manageDomains = async function (schoolId) {
  const school = _scholenCache.find(s => s.id === schoolId);
  if (!school) return await pyAlert('School niet gevonden.', 'warn');

  const oud = document.getElementById('py-modal-overlay');
  if (oud) oud.remove();
  const overlay = document.createElement('div');
  overlay.id = 'py-modal-overlay';
  overlay.innerHTML = `
    <div id="py-modal-box" style="max-width:560px;">
      <div id="py-modal-title">E-maildomeinen — ${escHtml(school.name)}</div>
      <div id="py-modal-body">
        <div id="dom-list" style="margin-bottom:10px;"></div>

        <div style="display:flex;gap:6px;margin-bottom:12px;">
          <input id="dom-new" placeholder="athkiel.be of *.athkiel.be"
            style="flex:1;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;"/>
          <button class="btn btn-soft small" id="dom-add">+ Toevoegen</button>
        </div>

        <details style="margin-bottom:12px;">
          <summary style="cursor:pointer;font-size:0.85rem;font-weight:600;">Hoe vul je dit in?</summary>
          <table style="width:100%;font-size:0.8rem;margin-top:8px;border-collapse:collapse;">
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px;font-family:Consolas,monospace;"><strong>athkiel.be</strong></td>
              <td style="padding:6px;">enkel adressen die <strong>exact</strong> op @athkiel.be eindigen<br/>
                <span style="color:#166534;">✓ marie@athkiel.be</span><br/>
                <span style="color:#991b1b;">✗ marie@leerling.athkiel.be</span></td>
            </tr>
            <tr>
              <td style="padding:6px;font-family:Consolas,monospace;"><strong>*.athkiel.be</strong></td>
              <td style="padding:6px;">alle subdomeinen — maar <strong>niet</strong> athkiel.be zelf<br/>
                <span style="color:#166534;">✓ marie@leerling.athkiel.be</span><br/>
                <span style="color:#166534;">✓ marie@a.b.athkiel.be</span><br/>
                <span style="color:#991b1b;">✗ marie@athkiel.be</span></td>
            </tr>
          </table>
          <p class="muted" style="font-size:0.8rem;margin:8px 6px 0;">Wil je allebei? Voeg dan beide regels toe.</p>
        </details>

        <div style="background:var(--surface-soft);border:1px solid var(--border);border-radius:10px;padding:10px;">
          <div style="font-size:0.82rem;font-weight:600;margin-bottom:6px;">Test een adres</div>
          <div style="display:flex;gap:6px;">
            <input id="dom-test" placeholder="marie@leerling.athkiel.be"
              style="flex:1;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;"/>
            <button class="btn btn-muted small" id="dom-test-btn">Testen</button>
          </div>
          <div id="dom-test-uitslag" style="margin-top:8px;font-size:0.85rem;"></div>
        </div>
      </div>
      <div id="py-modal-actions">
        <button id="dom-close" class="btn btn-primary small">Sluiten</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  async function toonDomeinen() {
    const el = document.getElementById('dom-list');
    const r = await fetch(`/api/admin/schools/${schoolId}/domains`);
    const domeinen = await r.json();
    el.innerHTML = domeinen.length
      ? domeinen.map(d => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;">
            <span style="font-family:Consolas,monospace;flex:1;">${escHtml(d)}</span>
            <span class="muted" style="font-size:0.75rem;">${d.startsWith('*.') ? 'subdomeinen' : 'exact'}</span>
            <button class="btn btn-danger small" onclick="removeDomain('${schoolId}','${encodeURIComponent(d)}')">✕</button>
          </div>`).join('')
      : '<p class="muted" style="font-size:0.85rem;margin:0;">Nog geen domeinen. Zonder domein kan geen enkele leerling zich registreren.</p>';
  }
  window._herlaadDomeinen = toonDomeinen;
  await toonDomeinen();

  document.getElementById('dom-add').addEventListener('click', async () => {
    const invoer = document.getElementById('dom-new').value.trim();
    if (!invoer) return;
    const res = await apiFetch(`/api/admin/schools/${schoolId}/domains`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: invoer }),
    });
    const data = await res.json();
    if (data.ok) { document.getElementById('dom-new').value = ''; toonDomeinen(); }
    else await pyAlert(data.error, 'warn');
  });

  document.getElementById('dom-test-btn').addEventListener('click', async () => {
    const email = document.getElementById('dom-test').value.trim();
    const uit = document.getElementById('dom-test-uitslag');
    if (!email.includes('@')) { uit.innerHTML = '<span class="muted">Geef een volledig e-mailadres in.</span>'; return; }
    const res = await apiFetch(`/api/admin/schools/${schoolId}/domains/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const d = await res.json();
    if (d.error) { uit.innerHTML = `<span style="color:#991b1b;">${escHtml(d.error)}</span>`; return; }
    uit.innerHTML = d.toegelaten
      ? `<span style="color:#166534;font-weight:700;">✓ toegelaten</span> <span class="muted">via de regel <code>${escHtml(d.viaRegel)}</code></span>`
      : `<span style="color:#991b1b;font-weight:700;">✗ geweigerd</span> <span class="muted">— domein <code>${escHtml(d.domein)}</code> past bij geen enkele van de ${d.aantalRegels} regel(s)</span>`;
  });

  const sluit = () => { overlay.remove(); delete window._herlaadDomeinen; };
  document.getElementById('dom-close').addEventListener('click', sluit);
  overlay.addEventListener('click', e => { if (e.target === overlay) sluit(); });
};

window.removeDomain = async function (schoolId, domeinEnc) {
  const res = await apiFetch(`/api/admin/schools/${schoolId}/domains/${domeinEnc}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) { if (window._herlaadDomeinen) window._herlaadDomeinen(); }
  else await pyAlert(data.error || 'Verwijderen mislukt.', 'warn');
};
