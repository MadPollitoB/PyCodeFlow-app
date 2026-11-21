'use strict';
// ════════════════════════════════════════════════════════════════════════════
// v151 — PyBlitz in de sessie: popup bij de leerling, spelmodus (beamer) bij de leerkracht.
// Gebruikt de bestaande websocket (window.__pcfSocket) — leerlingen zijn al ingelogd in de sessie.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  const socket = window.__pcfSocket;
  if (!socket || typeof socket.on !== 'function') return;
  const UI = window.PyBlitzUI; if (!UI) return;
  const { h } = UI;
  const isTeacher = !!document.getElementById('pyblitz-btn');

  // stijl
  if (!document.getElementById('pb-css')) {
    const l = document.createElement('link'); l.id = 'pb-css'; l.rel = 'stylesheet';
    l.href = '/pyblitz.css?v=' + (window.__pcfVersion || '2026.2.51.152'); document.head.appendChild(l);
  }

  let overlay = null, ui = null, gameId = null, laatsteSync = 0;

  function emit(ev, payload) {
    return new Promise((res) => {
      let klaar = false; const t = setTimeout(() => { if (!klaar) res({ ok: false, error: 'Geen antwoord van de server.' }); }, 6000);
      socket.emit(ev, payload || {}, (r) => { klaar = true; clearTimeout(t); res(r || { ok: true }); });
    });
  }

  function sluitOverlay() {
    if (ui) { ui.stop(); ui = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    gameId = null;
    document.documentElement.style.overflow = '';
  }
  function zorgVoorOverlay() {
    if (overlay) return;
    overlay = h('div', { class: 'pb-overlay' + (isTeacher ? ' pb-host' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': 'PyBlitz' });
    const root = h('div', { class: 'pb-root' }); overlay.appendChild(root);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    const acties = isTeacher ? {
      begin: () => emit('teacher_pyblitz_begin'),
      volgende: () => emit('teacher_pyblitz_volgende'),
      sluitvraag: () => emit('teacher_pyblitz_sluitvraag'),
      pauze: () => emit('teacher_pyblitz_pauze'),
      hervat: () => emit('teacher_pyblitz_hervat'),
      sluit: async () => {
        if (ui && ui._fase === 'final') return emit('teacher_pyblitz_sluit');
        const ok = typeof window.pyConfirm === 'function'
          ? await window.pyConfirm({ title: 'PyBlitz stoppen?', body: 'Bij alle leerlingen en gasten gaat het scherm dicht.', confirmLabel: 'Stoppen', danger: true })
          : true;
        return ok ? emit('teacher_pyblitz_sluit') : null;
      },
    } : {
      antwoord: (i) => emit('pyblitz_answer', { gameId, keuze: i }),
    };
    ui = UI.maak(root, { host: isTeacher, acties });
  }
  socket.on('pyblitz_state', (st) => {
    if (!st) return;
    gameId = st.gameId;
    zorgVoorOverlay();
    if (ui) { ui._fase = st.fase; ui.toon(st); }
  });
  socket.on('pyblitz_closed', () => sluitOverlay());

  // Een (her)verbonden pagina pakt een lopend spel weer op.
  function sync() {
    if (overlay || Date.now() - laatsteSync < 4000) return;
    laatsteSync = Date.now();
    socket.emit(isTeacher ? 'teacher_pyblitz_sync' : 'pyblitz_sync', {}, () => {});
  }
  socket.on(isTeacher ? 'teacher_session_data' : 'student_state', sync);
  socket.on('connect', () => { laatsteSync = 0; });

  // ── knop bij de leerkracht ───────────────────────────────────────────────
  if (isTeacher) {
    const btn = document.getElementById('pyblitz-btn');
    const wissel = document.getElementById('pyblitz-wissel-btn');
    const melding = (tekst) => {
      const m = h('div', { class: 'pb-toast', role: 'alert', text: tekst, style: 'position:fixed;z-index:10002' });
      document.body.appendChild(m); setTimeout(() => m.remove(), 4500);
    };
    async function toonLijst() {
      let sets = [];
      try { const r = await fetch('/api/pyblitz/sets', { credentials: 'same-origin' }); sets = (await r.json()).sets || []; }
      catch { return melding('Kon de PyBlitzes niet laden.'); }
      const sluit = () => keuze.remove();
      const keuze = h('div', { class: 'pb-keuze', onclick: (e) => { if (e.target === keuze) sluit(); } },
        h('div', { class: 'pb-keuze-doos', role: 'dialog', 'aria-label': 'Kies een PyBlitz' },
          h('h3', { text: '⚡ Kies een PyBlitz' }),
          sets.length ? sets.map(s => h('button', { type: 'button', class: 'pb-keuze-item', onclick: async () => {
            sluit(); const r = await emit('teacher_pyblitz_open', { setId: s.id }); if (!r.ok) melding(r.error || 'Starten mislukt.');
          } }, h('b', { text: s.name }), h('div', { class: 'pbl-meta', text: `${s.questionCount} vragen` + (s.lastPlayed ? ' · laatst gespeeld ' + new Date(s.lastPlayed).toLocaleDateString('nl-BE') : '') })))
            : h('p', { text: 'Je hebt nog geen PyBlitz. Maak er een in het menu "⚡ PyBlitz".' }),
          h('div', { class: 'pbl-rij' },
            h('a', { href: '/pyblitz.html', class: 'btn btn-soft', target: '_blank', rel: 'noopener', text: 'PyBlitz-bibliotheek' }),
            h('button', { type: 'button', class: 'btn btn-muted', onclick: sluit, text: 'Annuleren' }))));
      document.body.appendChild(keuze);
      const eerste = keuze.querySelector('button'); if (eerste) eerste.focus();
    }
    async function klik() {
      const s = await emit('teacher_pyblitz_status');
      if (!s.ok) return melding(s.error || 'Geen sessie geopend.');
      if (!s.mogelijk) return melding('PyBlitz kan enkel in klasmodus (gedeelde werkruimte), niet tijdens een toets, taak of individuele werkfase.');
      if (s.spel || s.koppeling) {
        const r = await emit('teacher_pyblitz_open', {});
        if (!r.ok) melding(r.error || 'Starten mislukt.');
        return;
      }
      toonLijst();
    }
    btn.addEventListener('click', klik);
    if (wissel) wissel.addEventListener('click', async () => {
      const s = await emit('teacher_pyblitz_status');
      if (!s.ok) return melding(s.error || 'Geen sessie geopend.');
      if (!s.mogelijk) return melding('PyBlitz kan enkel in klasmodus (gedeelde werkruimte).');
      if (s.spel) return melding('Er loopt al een PyBlitz. Sluit die eerst af.');
      toonLijst();
    });
    // toon welke PyBlitz gekoppeld is
    let laatsteVerversing = 0;
    const ververs = async () => {
      if (Date.now() - laatsteVerversing < 5000) return; laatsteVerversing = Date.now();
      const s = await emit('teacher_pyblitz_status');
      if (s && s.ok && s.koppeling) btn.title = 'Opent: ' + s.koppeling.setName;
    };
    socket.on('teacher_session_data', () => { ververs(); });
  }
})();
