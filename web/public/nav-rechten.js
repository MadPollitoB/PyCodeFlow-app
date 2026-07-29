// Sprint 55 + 62 — gedeelde topbalk-logica op alle leerkrachtpagina's:
//   • 55: verberg Beheer/Systeem-links naargelang de rol (server dwingt het écht af);
//   • 62: toon WIE er is ingelogd (naam + rol) en WELKE school actief is, met een
//         wisselknop wanneer de leerkracht aan meerdere scholen hangt.
// Faalt stil: bij twijfel liever niets tonen dan een pagina laten stuklopen.
(async function () {
  let me;
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return;
    me = await r.json();
  } catch (e) { return; }

  // ── 55: navigatie-items verbergen ──
  document.querySelectorAll('a[href="/admin.html"], a[href="admin.html"]').forEach(a => {
    if (me.magBeheer === false) a.remove();
  });
  document.querySelectorAll('a[href="/monitoring.html"], a[href="monitoring.html"]').forEach(a => {
    if (me.magSysteem === false) a.remove();
  });
  if (me.magSysteem === false) { const b = document.getElementById('autocheck-badge'); if (b) b.remove(); }

  // ── 62: identiteit in de topbalk ──
  const acties = document.querySelector('.top-actions');
  if (!acties || document.getElementById('wie-ben-ik')) return;

  const ROL = {
    superadmin: { label: '★ Super-admin', kleur: 'background:#7c3aed;color:#fff;',
                  titel: 'Platformbeheerder: ziet en beheert alle scholen' },
    admin:      { label: 'Admin',         kleur: 'background:#1d4ed8;color:#fff;',
                  titel: 'Schoolbeheerder: beheert zijn eigen school(scholen)' },
    teacher:    { label: 'Leerkracht',    kleur: 'background:#e2e8f0;color:#334155;',
                  titel: 'Leerkracht: eigen klassen, toetsen en taken' },
  };
  const rol = ROL[me.role] || ROL.teacher;
  const naam = me.displayName || me.username || 'onbekend';
  const meerdere = (me.scholen || []).length > 1;
  const esc = t => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };

  // Actieve school = waar nieuwe klassen/toetsen/vragen in terechtkomen. Voor een
  // super-admin belangrijk om te zien: hij LEEST alles, maar SCHRIJFT in één school.
  const schoolDeel = me.activeSchoolName
    ? `<span title="Actieve school — hierin komen nieuwe klassen, toetsen en vragen terecht${meerdere ? '. Klik om te wisselen.' : ''}" ${meerdere ? 'id="school-wissel" style="cursor:pointer;text-decoration:underline dotted;"' : ''}>🏛 ${esc(me.activeSchoolName)}${meerdere ? ' ⇄' : ''}</span>`
    : ((me.scholen && me.scholen.length)
        ? `<span id="school-wissel" style="cursor:pointer;text-decoration:underline dotted;" title="Kies een actieve school">🏛 geen school gekozen ⇄</span>`
        : `<span class="muted" title="Je bent aan geen enkele school gekoppeld — vraag de platformbeheerder om je te koppelen">🏛 geen school</span>`);

  const doos = document.createElement('span');
  doos.id = 'wie-ben-ik';
  doos.style.cssText = 'display:flex;align-items:center;gap:8px;margin-right:12px;font-size:0.85rem;flex-wrap:wrap;';
  doos.innerHTML = `
    <span style="opacity:0.75;">Ingelogd als</span>
    <strong>${esc(naam)}</strong>
    <span class="badge" style="${rol.kleur}" title="${esc(rol.titel)}">${rol.label}</span>
    <span style="opacity:0.4;">|</span>
    ${schoolDeel}`;
  acties.insertBefore(doos, acties.firstChild);

  // ── Schoolwissel ──
  const wissel = document.getElementById('school-wissel');
  if (!wissel) return;
  wissel.addEventListener('click', function () {
    const opties = me.scholen || [];
    const oud = document.getElementById('py-modal-overlay');
    if (oud) oud.remove();
    const overlay = document.createElement('div');
    overlay.id = 'py-modal-overlay';
    overlay.innerHTML = `
      <div id="py-modal-box" style="max-width:420px;">
        <div id="py-modal-title">Actieve school kiezen</div>
        <div id="py-modal-body">
          <p class="muted" style="margin:0 0 10px;font-size:0.85rem;">
            Je werkt telkens in één school: nieuwe klassen, toetsen en vragen komen daarin
            terecht, en je overzichten worden erop gefilterd.
          </p>
          <select id="ws-keuze" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;">
            ${opties.map(s => `<option value="${esc(s.id)}"${s.id === me.activeSchoolId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div id="py-modal-actions">
          <button id="ws-cancel" class="btn btn-muted small">Annuleren</button>
          <button id="ws-ok" class="btn btn-primary small">Wisselen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const sluit = function () { overlay.remove(); };
    document.getElementById('ws-cancel').addEventListener('click', sluit);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) sluit(); });
    document.getElementById('ws-ok').addEventListener('click', async function () {
      const id = document.getElementById('ws-keuze').value;
      try {
        const fetcher = window.apiFetch || fetch;
        const r = await fetcher('/api/teacher-login/school', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId: id }),
        });
        const d = await r.json().catch(function () { return {}; });
        if (r.ok && d.ok) location.reload();
        else await (window.pyAlert || alert)('Wisselen mislukt: ' + (d.error || r.status));
      } catch (e) { await (window.pyAlert || alert)('Wisselen mislukt.'); }
    });
  });
})();
