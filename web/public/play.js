'use strict';
// v151 — gast speelt mee met een pincode en een naam; een token op dit toestel voorkomt dat iemand anders onder zijn naam binnenkomt.
(function () {
  const $ = (id) => document.getElementById(id);
  const SLEUTEL = 'pyblitz_gast';
  let sessie = null;      // { token, naam, gameId }
  let ui = null, socket = null;

  const bewaar = (o) => { try { sessionStorage.setItem(SLEUTEL, JSON.stringify(o)); } catch { /* privé-modus */ } };
  const lees = () => { try { return JSON.parse(sessionStorage.getItem(SLEUTEL) || 'null'); } catch { return null; } };
  const wis = () => { try { sessionStorage.removeItem(SLEUTEL); } catch { /* niets */ } };
  function fout(t) { const e = $('pb-fout'); e.hidden = !t; e.textContent = t || ''; }

  function toonJoin(boodschap) {
    if (ui) { ui.stop(); ui = null; }
    $('pb-spel').hidden = true; $('pb-join').hidden = false; fout(boodschap || '');
  }
  function verbind() {
    if (!socket) {
      socket = io({ reconnectionDelay: 300, reconnectionDelayMax: 2000 });
      socket.on('connect', meld);
      socket.on('pyblitz_state', (st) => { if (!st) return; zorgVoorUi(); ui.toon(st); });
      socket.on('pyblitz_closed', (d) => { wis(); sessie = null; toonJoin(d && d.reden === 'inactief' ? 'Het spel is gestopt door inactiviteit.' : 'Het spel is afgelopen. Bedankt voor het meespelen!'); });
    } else if (socket.connected) meld();
  }
  function meld() {
    if (!sessie) return;
    socket.emit('pyblitz_guest_connect', { token: sessie.token }, (r) => {
      if (!r || !r.ok) { wis(); sessie = null; toonJoin('Je deelname is afgelopen. Vul de code opnieuw in.'); }
    });
  }
  function zorgVoorUi() {
    $('pb-join').hidden = true; $('pb-spel').hidden = false;
    if (ui) return;
    ui = window.PyBlitzUI.maak($('pb-root'), {
      host: false, token: sessie && sessie.token,
      acties: {
        antwoord: (i) => new Promise((res) => socket.emit('pyblitz_answer', { gameId: sessie.gameId, keuze: i }, (r) => res(r || { ok: false }))),
        verlaat: () => { socket.emit('pyblitz_guest_leave', { token: sessie.token }, () => {}); wis(); sessie = null; toonJoin(''); },
      },
    });
  }

  $('pb-form').addEventListener('submit', async (e) => {
    e.preventDefault(); fout('');
    const pin = $('pb-pin').value.replace(/\D/g, ''); const naam = $('pb-naam').value;
    try {
      const r = await fetch('/api/pyblitz/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, naam }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return fout(d.error || 'Meedoen mislukt.');
      sessie = { token: d.token, naam: d.naam, gameId: d.gameId }; bewaar(sessie);
      zorgVoorUi(); verbind();
    } catch { fout('Geen verbinding. Probeer opnieuw.'); }
  });

  const pinUitUrl = new URLSearchParams(location.search).get('pin');
  if (pinUitUrl) $('pb-pin').value = pinUitUrl.replace(/\D/g, '').slice(0, 8);
  sessie = lees();
  if (sessie && sessie.token) { zorgVoorUi(); verbind(); } else $('pb-naam').focus();
})();
