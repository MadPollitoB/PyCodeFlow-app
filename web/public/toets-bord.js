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

  function el(tag, klasse, tekst) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  function infoTekst(l) {
    if (l.status === 'grijs') return '✓ ingediend';
    if (l.status === 'geel') return '✋ hand op' + (l.totaal ? ' · vraag ' + l.vraag + '/' + l.totaal : '');
    if (l.status === 'rood') return '⚠ tab verlaten' + (l.weg ? ' (nu weg)' : '') + (l.wisselCount > 1 ? ' · ' + l.wisselCount + '×' : '');
    if (l.status === 'blauw') return '⚡ verbinding weg';
    return l.totaal ? 'vraag ' + l.vraag + '/' + l.totaal : '';
  }

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
    document.title = 'Klasbord — ' + (state.naam || state.code);
    document.getElementById('bord-pauze').style.display = state.gepauzeerd ? '' : 'none';

    const lijst = state.leerlingen || [];
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
  document.getElementById('bord-sluit').addEventListener('click', () => window.close());
  if (!code) render({ fout: 'Geen toetscode in de link.' });
})();
