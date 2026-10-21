// v124 — pagina "Toegang" voor leerkrachten: eigen netwerk en leerlingaccounts ontgrendelen.
(function () {
  'use strict';
  var data = null;
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var min = function (ms) { var m = Math.max(1, Math.ceil(ms / 60000)); return m + (m === 1 ? ' minuut' : ' minuten'); };
  var api = function (m, u, body) {
    var f = window.apiFetch || fetch;
    return f(u, { method: m, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  };

  function toonNetwerk() {
    var n = data.netwerk;
    document.getElementById('tg-ip').textContent = data.ip;
    var el = document.getElementById('tg-netwerk-tekst');
    if (n.geblokkeerdMs > 0) {
      el.innerHTML = '<span class="tg-status tg-blok">Geblokkeerd</span> nog ' + min(n.geblokkeerdMs) + ' — te veel mislukte pogingen vanaf dit netwerk.';
    } else if (n.geblokkeerdeAccounts > 0) {
      el.innerHTML = '<span class="tg-status tg-let">' + n.geblokkeerdeAccounts + ' account(s) geblokkeerd</span> — ontgrendel hieronder per leerling, of het hele netwerk.';
    } else if (n.fouten > 0) {
      el.innerHTML = '<span class="tg-status tg-ok">Niet geblokkeerd</span> (' + n.fouten + ' mislukte poging' + (n.fouten === 1 ? '' : 'en') + ' recent).';
    } else {
      el.innerHTML = '<span class="tg-status tg-ok">Alles vrij</span> — er zijn geen blokkades of mislukte pogingen.';
    }
  }

  function toonLijst() {
    var q = (document.getElementById('tg-zoek').value || '').trim().toLowerCase();
    var enkel = document.getElementById('tg-enkel-blok').checked;
    var rijen = data.leerlingen.filter(function (l) {
      if (enkel && !(l.geblokkeerdMs > 0 || l.fouten > 0)) return false;
      return !q || (l.name + ' ' + l.klas + ' ' + l.email).toLowerCase().indexOf(q) >= 0;
    });
    var el = document.getElementById('tg-lijst');
    if (!rijen.length) { el.innerHTML = '<p class="muted">Geen leerlingen gevonden.</p>'; return; }
    el.innerHTML = rijen.map(function (l) {
      var st = l.geblokkeerdMs > 0
        ? '<span class="tg-status tg-blok">geblokkeerd, nog ' + min(l.geblokkeerdMs) + '</span>'
        : (l.fouten > 0 ? '<span class="tg-status tg-let">' + l.fouten + ' mislukt</span>' : '');
      var knop = (l.geblokkeerdMs > 0 || l.fouten > 0)
        ? '<button class="btn btn-primary small" data-id="' + esc(l.id) + '">Ontgrendel</button>' : '';
      return '<div class="tg-rij"><span class="tg-naam">' + esc(l.name) + '</span><span class="tg-mail">' + esc(l.klas) + ' · ' + esc(l.email) + '</span>' +
        '<span class="tg-acties">' + st + knop + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('button[data-id]'), function (b) {
      b.addEventListener('click', function () { ontgrendelLeerling(b.getAttribute('data-id')); });
    });
  }

  function laad() {
    return api('GET', '/api/teacher/toegang').then(function (d) { data = d; toonNetwerk(); toonLijst(); })
      .catch(function (e) { if (window.pyAlert) pyAlert('Laden mislukt: ' + e.message, 'error'); });
  }
  function ontgrendelLeerling(id) {
    api('POST', '/api/teacher/toegang/leerling', { studentId: id })
      .then(function () { if (window.pyToast) pyToast('Leerling ontgrendeld.', 'success'); return laad(); })
      .catch(function (e) { if (window.pyAlert) pyAlert('Ontgrendelen mislukt: ' + e.message, 'error'); });
  }

  document.getElementById('tg-netwerk-knop').addEventListener('click', function () {
    api('POST', '/api/teacher/toegang/netwerk', {})
      .then(function () { if (window.pyToast) pyToast('Netwerk ontgrendeld.', 'success'); return laad(); })
      .catch(function (e) { if (window.pyAlert) pyAlert('Ontgrendelen mislukt: ' + e.message, 'error'); });
  });
  document.getElementById('tg-zoek').addEventListener('input', function () { if (data) toonLijst(); });
  document.getElementById('tg-enkel-blok').addEventListener('change', function () { if (data) toonLijst(); });
  laad();
  setInterval(laad, 15000);
})();
