// Sprint 56 — "Mijn klassen": lesgereedschap voor de klasleerkracht.
// Startcode tonen/openen/sluiten/roteren + wachtende leerlingen aanvaarden, blokkeren,
// deblokkeren, wachtwoordreset klaarzetten en leerlingen toevoegen — telkens ENKEL voor
// klassen waaraan deze leerkracht gekoppeld is (de server dwingt dat ook af).
'use strict';

let KLASSEN = [];

function esc(x) {
  const d = document.createElement('div'); d.textContent = x == null ? '' : String(x); return d.innerHTML;
}
const STATUS_LABEL = { active: 'aanvaard', pending: 'wacht op aanvaarding', blocked: 'geblokkeerd' };

async function laadKlassen() {
  const doel = document.getElementById('klassen');
  try {
    const r = await fetch('/api/mijn-klassen');
    if (!r.ok) throw new Error('Server antwoordde ' + r.status);
    KLASSEN = await r.json();
  } catch (e) {
    doel.innerHTML = `<div class="card"><p>⚠️ Kon je klassen niet laden: ${esc(e.message)} — herlaad de pagina.</p></div>`;
    return;
  }
  if (!KLASSEN.length) {
    doel.innerHTML = `<div class="card"><p><strong>Je bent nog aan geen enkele klas gekoppeld.</strong></p>
      <p class="muted">Vraag je beheerder om je aan je klassen te koppelen (Beheer → Klassen → 🏛). Klassen die je zelf aanmaakt worden automatisch aan jou gekoppeld.</p></div>`;
    return;
  }
  doel.innerHTML = KLASSEN.map(kaart).join('');
}

function kaart(k) {
  const wachtend = k.students.filter(s => s.status === 'pending');
  const rest = k.students.filter(s => s.status !== 'pending');
  return `
  <div class="klas-kaart">
    <div class="klas-kop">
      <h2>${esc(k.name)}</h2>
      <span class="badge">${esc(k.schoolYear)}</span>
      <span class="badge">${k.students.length} leerling${k.students.length === 1 ? '' : 'en'}</span>
      <div class="startcode-blok">
        ${k.startCode
          ? `<span class="startcode" title="Klik voor bord-formaat" onclick="toonGroot('${esc(k.startCode)}','${esc(k.name)}')">${esc(k.startCode)}</span>
             <span class="badge" style="${k.startCodeActive ? 'background:#dcfce7;color:#166534;' : 'background:#e2e8f0;color:#475569;'}">${k.startCodeActive ? '🟢 open' : '⚪ dicht'}</span>
             <button class="btn btn-muted small" onclick="zetOpen('${k.id}', ${k.startCodeActive ? 'false' : 'true'})">${k.startCodeActive ? 'Sluiten' : 'Openen'}</button>
             <button class="btn btn-muted small" title="Nieuwe code — de oude werkt daarna niet meer" onclick="nieuweCode('${k.id}')">↻</button>`
          : `<button class="btn btn-soft small" onclick="nieuweCode('${k.id}')">Genereer startcode</button>`}
      </div>
    </div>

    ${wachtend.length ? `
    <div class="wacht-blok">
      <h3>⏳ ${wachtend.length} leerling${wachtend.length === 1 ? '' : 'en'} wacht${wachtend.length === 1 ? '' : 'en'} op je goedkeuring</h3>
      ${wachtend.map(s => leerlingRij(s, k.id)).join('')}
    </div>` : ''}

    ${rest.map(s => leerlingRij(s, k.id)).join('')}

    <div class="voegtoe">
      <input id="nieuw-${k.id}" placeholder="Naam van een nieuwe leerling…" onkeydown="if(event.key==='Enter')voegToe('${k.id}')"/>
      <button class="btn btn-muted small" onclick="voegToe('${k.id}')">+ Leerling toevoegen</button>
    </div>
  </div>`;
}

function leerlingRij(s, klasId) {
  return `
  <div class="ll-rij">
    <span class="ll-naam">${esc(s.name)}${s.mustChangePassword ? ' <span class="badge" style="background:#fef3c7;color:#92400e;" title="Wachtwoordreset staat klaar">reset</span>' : ''}</span>
    <span class="ll-mail">${s.email ? esc(s.email) : '<em>geen account</em>'}</span>
    <span class="status-${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span>
    <span class="ll-acties">
      ${s.status !== 'active' ? `<button class="btn btn-success small" onclick="zetStatus('${s.id}','active')">✓ Aanvaarden</button>` : ''}
      ${s.status !== 'blocked' ? `<button class="btn btn-muted small" onclick="blokkeer('${s.id}','${esc(s.name)}')">✕ Blokkeren</button>` : ''}
      ${s.email ? `<button class="btn btn-muted small" title="Reset klaarzetten — de leerling kiest zelf een nieuw wachtwoord via de klascode" onclick="resetWw('${s.id}','${esc(s.name)}')">🔑 Reset</button>` : ''}
    </span>
  </div>`;
}

// ── Startcode ───────────────────────────────────────────────────────────────
function toonGroot(code, klas) {
  document.getElementById('modal-code').textContent = code;
  document.getElementById('modal-uitleg').textContent = `Klascode voor ${klas} — registreren via ${location.origin}/student-register.html`;
  document.getElementById('code-modal').style.display = 'flex';
}

async function nieuweCode(klasId) {
  const r = await window.apiFetch(`/api/admin/classes/${klasId}/start-code`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.ok) laadKlassen(); else foutmelding(d, r);
}

async function zetOpen(klasId, actief) {
  const r = await window.apiFetch(`/api/admin/classes/${klasId}/start-code/active`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: actief }) });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.ok) laadKlassen(); else foutmelding(d, r);
}

// ── Leerlingen ──────────────────────────────────────────────────────────────
async function zetStatus(id, status) {
  const r = await window.apiFetch(`/api/admin/students/${id}/status`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.ok) laadKlassen(); else foutmelding(d, r);
}

async function blokkeer(id, naam) {
  // Blokkeren geldt voor het HELE account: de leerling kan dan nergens meer inloggen,
  // ook niet bij een andere leerkracht. Dat moet expliciet zijn.
  const ok = await window.pyConfirm({
    title: 'Leerling blokkeren',
    body: `"${naam}" blokkeren? Dit geldt voor het volledige account: de leerling kan dan nergens meer inloggen of deelnemen — ook niet bij een andere leerkracht of in een andere klas.`,
    confirmLabel: 'Blokkeren',
  });
  if (ok) zetStatus(id, 'blocked');
}

async function resetWw(id, naam) {
  const ok = await window.pyConfirm({
    title: 'Wachtwoord resetten',
    body: `Reset klaarzetten voor "${naam}"? De leerling kiest daarna zelf een nieuw wachtwoord via de klascode (jij bewaart nooit een wachtwoord).`,
    confirmLabel: 'Reset klaarzetten',
  });
  if (!ok) return;
  const r = await window.apiFetch(`/api/admin/students/${id}/reset-password`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.ok) {
    await window.pyAlert('Reset staat klaar. Geef de leerling de klascode; die herstelt via "Wachtwoord vergeten".', 'success');
    laadKlassen();
  } else foutmelding(d, r);
}

async function voegToe(klasId) {
  const veld = document.getElementById('nieuw-' + klasId);
  const naam = (veld.value || '').trim();
  if (!naam) return;
  const r = await window.apiFetch('/api/admin/students', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: naam, classId: klasId, source: 'manual', status: 'active' }) });
  const d = await r.json().catch(() => ({}));
  if (r.ok && (d.ok || d.id)) { veld.value = ''; laadKlassen(); } else foutmelding(d, r);
}

async function foutmelding(d, r) {
  await window.pyAlert('Actie mislukt: ' + (d.error || ('serverfout ' + r.status)), 'error');
}

laadKlassen();
