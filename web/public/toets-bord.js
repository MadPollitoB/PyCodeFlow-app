// PyCodeFlow — klasbord (v2026.2.51.99)
// Toont bij een toets of taak alle leerlingen als tegels:
//   groen = bezig · geel = hand op (met volgnummer) · rood = tab verlaten · blauw = verbinding weg
//   grijs = ingediend. Een klik op een tegel zet hand/rood terug (en dus de tegel weer groen).
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').trim().toUpperCase();
  const grid = document.getElementById('bord-grid');
  const legenda = document.getElementById('bord-legenda');
  const melding = document.getElementById('bord-melding');
  const verbinding = document.getElementById('bord-verbinding');

  const LABELS = {
    groen: { naam: 'bezig', kleur: '#16a34a' },
    geel:  { naam: 'hand op', kleur: '#facc15' },
    rood:  { naam: 'tab verlaten', kleur: '#dc2626' },
    blauw: { naam: 'verbinding weg', kleur: '#2563eb' },
    grijs: { naam: 'ingediend', kleur: '#475569' },
  };

  let huidigeCode = code;

  function el(tag, klasse, tekst) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  // v137: geen "vraag x/y" meer (gaf zenuwen) — wel de resterende tijd per leerling.
  let klokVerschil = 0;   // servertijd − lokale tijd
  function tijdTekst(l) {
    if (!l.eindAt) return '';
    const sec = Math.max(0, Math.round((l.eindAt - (Date.now() + klokVerschil)) / 1000));
    const u = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return '⏱ ' + (u ? u + ':' + mm + ':' + ss : m + ':' + ss);
  }
  function infoTekst(l) {
    if (l.status === 'grijs') return '✓ ingediend';
    const t = tijdTekst(l);
    if (l.status === 'geel') return '✋ hand op' + (t ? ' · ' + t : '');
    if (l.status === 'rood') return '⚠ tab verlaten' + (l.weg ? ' (nu weg)' : '') + (l.wisselCount > 1 ? ' · ' + l.wisselCount + '×' : '') + (t ? ' · ' + t : '');
    if (l.status === 'blauw') return '⚡ verbinding weg' + (t ? ' · ' + t : '');
    return t;
  }
  let laatsteLijst = [];
  setInterval(() => {   // elke seconde enkel de tijdstekst bijwerken
    laatsteLijst.forEach(l => {
      const t = grid.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(l.id) : l.id) + '"] .tegel-info');
      if (t) t.textContent = infoTekst(l);
    });
  }, 1000);

  function render(state) {
    if (!state) return;
    if (state.fout) {
      melding.textContent = state.fout; melding.style.display = '';
      grid.replaceChildren(el('div', 'bord-leeg', 'Geen bord beschikbaar.'));
      return;
    }
    melding.style.display = 'none';
    document.getElementById('bord-naam').textContent = state.naam || 'Klasbord';
    document.getElementById('bord-code').textContent = 'Code: ' + state.code + (state.type === 'taak' ? ' · taak' : ' · toets');
    huidigeCode = state.code;
    const groot = document.getElementById('bord-code-groot');
    if (groot && !groot.hidden) groot.querySelector('.bord-code-tekst').textContent = state.code;
    document.title = 'Klasbord — ' + (state.naam || state.code);
    document.getElementById('bord-pauze').style.display = state.gepauzeerd ? '' : 'none';

    if (state.nu) klokVerschil = state.nu - Date.now();
    const lijst = state.leerlingen || [];
    laatsteLijst = lijst;
    const tel = { groen: 0, geel: 0, rood: 0, blauw: 0, grijs: 0 };
    lijst.forEach(l => { tel[l.status] = (tel[l.status] || 0) + 1; });
    legenda.replaceChildren(...Object.keys(LABELS).map(k => {
      const s = el('span');
      const stip = el('i', 'bord-stip'); stip.style.background = LABELS[k].kleur;
      s.append(stip, document.createTextNode(tel[k] + ' ' + LABELS[k].naam));
      return s;
    }));

    if (!lijst.length) {
      grid.style.removeProperty('--kol');
      grid.replaceChildren(el('div', 'bord-leeg', 'Nog geen leerlingen verbonden.'));
      return;
    }
    const kol = state.kolommen || 5;
    grid.style.setProperty('--kol', kol);
    // minstens 5 rijen (5×5-raster): met weinig leerlingen worden de tegels zo geen torens
    grid.style.setProperty('--rij', Math.max(Math.min(kol, 5), Math.ceil(lijst.length / kol)));
    grid.replaceChildren(...lijst.map(l => {
      const t = el('button', 'tegel st-' + l.status);
      t.type = 'button';
      t.dataset.id = l.id;
      t.setAttribute('aria-label', l.name + ': ' + LABELS[l.status].naam + (l.handNummer ? ' (hand ' + l.handNummer + ')' : ''));
      t.title = (l.status === 'groen' || l.status === 'grijs') ? l.name : l.name + ' — klik om weer op groen te zetten';
      t.append(el('div', 'tegel-naam', l.name), el('div', 'tegel-info', infoTekst(l)));
      if (l.status === 'geel' && l.handNummer) t.append(el('div', 'tegel-nr', String(l.handNummer)));
      t.addEventListener('click', () => {
        if (l.status === 'geel' || l.status === 'rood') socket.emit('quiz_bord_reset', { code, studentId: l.id });
      });
      return t;
    }));
  }

  const socket = io({ reconnection: true, reconnectionDelay: 1500 });
  socket.on('connect', () => { verbinding.style.display = 'none'; socket.emit('quiz_bord_join', { code }); });
  socket.on('disconnect', () => { verbinding.style.display = ''; });
  socket.on('quiz_bord_state', render);

  document.getElementById('bord-volledig').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  // v137: klik op de code → groot op het scherm (handig bij de start van de toets)
  const grootEl = document.getElementById('bord-code-groot');
  const toonGroot = () => { grootEl.querySelector('.bord-code-tekst').textContent = huidigeCode; grootEl.hidden = false; };
  const verbergGroot = () => { grootEl.hidden = true; };
  document.getElementById('bord-code').addEventListener('click', toonGroot);
  grootEl.addEventListener('click', verbergGroot);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') verbergGroot(); });
  document.getElementById('bord-sluit').addEventListener('click', () => window.close());
  if (!code) render({ fout: 'Geen toetscode in de link.' });
})();
