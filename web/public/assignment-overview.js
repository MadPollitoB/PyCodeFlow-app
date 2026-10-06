/* Sprint 43.7 — Toets-/taak-overzicht als eigen pagina (zelfde opbouw als de vragenbank).
   Deze pagina staat los van het sessie-overzicht: eigen titel, eigen kaartenraster, eigen filters.
   Het type (toets|taak) wordt afgeleid uit de bestandsnaam, zodat één script beide pagina's bedient. */
(function () {
  'use strict';

  var TYPE = location.pathname.indexOf('taak-overzicht') !== -1 ? 'taak' : 'toets';
  var LABEL = TYPE === 'taak' ? 'taak' : 'toets';
  var LABEL_MV = TYPE === 'taak' ? 'taken' : 'toetsen';

  var items = [];                                   // alles van dit type (incl. concepten en archief)
  var filter = { klas: '', jaar: '', q: '' };
  var TABS = [
    { id: 'actief',        label: 'Actief' },
    { id: 'te_verbeteren', label: 'Te verbeteren' },
    { id: 'afgerond',      label: 'Afgerond' },
    { id: 'archief',       label: 'Archief' },
    { id: 'concept',       label: 'Concepten', rechts: true }   // helemaal rechts, met meegroeiende ruimte ervoor
  ];
  var BADGE = {
    actief:        { bg: '#dfe9fb', fg: '#1e3a8a', t: 'Open' },
    gepland:       { bg: '#ece6fb', fg: '#4c2f9e', t: 'Nog niet open' },
    te_verbeteren: { bg: '#fcebc2', fg: '#6b4200', t: 'Te verbeteren' },
    afgerond:      { bg: '#d5f0de', fg: '#14602f', t: 'Afgerond' },
    archief:       { bg: '#e8e6e0', fg: '#4b5160', t: 'Archief' },
    concept:       { bg: '#fef3c7', fg: '#92400e', t: 'Concept' }
  };
  var PAGE = 50;                                    // zoveel rijen per tab, daarna "Toon meer"
  var tab = 'actief';                               // hoofdtabblad
  var tonen = {};                                   // per tab: aantal getoonde rijen
  var open = {};                                    // code → rij uitgeklapt
  var groepDicht = {};                              // archief-groep → ingeklapt
  try { var _h = (location.hash || '').replace('#', ''); if (TABS.some(function (t) { return t.id === _h; })) tab = _h; } catch (e) { /* hash optioneel */ }

  function esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function fmt(ms) { return new Date(ms).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

  function statusBadge(a) {
    var b = BADGE[a.status === 'actief' && !a.gestart ? 'gepland' : a.status] || BADGE.afgerond;
    return '<span class="ov-badge" style="background:' + b.bg + ';color:' + b.fg + ';">' + b.t + '</span>';
  }

  // Sprint 51e: extra badges voor vrijgave-status, zodat je niet nodeloos opnieuw vrijgeeft.
  function releaseBadges(a) {
    var out = '';
    if (a.resultsReleased) out += '<span class="ov-badge" style="background:#dcfce7;color:#166534;" title="Scores en feedback zijn vrijgegeven aan de leerlingen">scores vrijgegeven</span>';
    if (a.reviewMode)      out += '<span class="ov-badge" style="background:#e0e7ff;color:#3730a3;" title="Leerlingen kunnen hun volledige toets nakijken">nazicht open</span>';
    return out;
  }

  function matches(a) {
    if (filter.klas && a.className !== filter.klas) return false;
    if (filter.jaar && a.schoolYear !== filter.jaar) return false;
    if (filter.q) {
      var hay = ((a.name || '') + ' ' + (a.code || '') + ' ' + (a.className || '')).toLowerCase();
      if (hay.indexOf(filter.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function renderTabs() {
    var host = document.getElementById('ov-tabs');
    if (!host) return;
    var teller = {};
    items.filter(matches).forEach(function (a) { teller[a.status] = (teller[a.status] || 0) + 1; });
    host.innerHTML = TABS.map(function (t) {
      return '<button type="button" class="ov-tab' + (t.rechts ? ' ov-tab-right' : '') + (tab === t.id ? ' on' : '') + '" data-tab="' + t.id + '">' +
        esc(t.label) + ' <span class="ov-count">' + (teller[t.id] || 0) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.ov-tab'), function (b) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); try { history.replaceState(null, '', '#' + tab); } catch (e) { /* ok */ } renderTabs(); renderList(); });
    });
  }

  function renderFilters() {
    var host = document.getElementById('filter-bar');
    if (!host) return;
    var classes = [], years = [];
    items.forEach(function (a) {
      if (a.className && classes.indexOf(a.className) === -1) classes.push(a.className);
      if (a.schoolYear && years.indexOf(a.schoolYear) === -1) years.push(a.schoolYear);
    });
    classes.sort(); years.sort().reverse();
    function opt(v, l, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>'; }
    host.innerHTML =
      '<input id="f-q" placeholder="Zoek op naam, code of klas…" value="' + esc(filter.q) + '"/>' +
      '<select id="f-klas"><option value="">Alle klassen</option>' + classes.map(function (c) { return opt(c, c, filter.klas === c); }).join('') + '</select>' +
      (years.length > 1 ? '<select id="f-jaar"><option value="">Alle schooljaren</option>' + years.map(function (y) { return opt(y, y, filter.jaar === y); }).join('') + '</select>' : '') +
      '<button type="button" class="btn btn-muted small" id="ov-expand">Alles uitklappen</button>';
    function bind(id, key, ev) {
      var e = document.getElementById(id); if (!e) return;
      e.addEventListener(ev || 'change', function () { filter[key] = e.value; renderTabs(); renderList(); });
    }
    bind('f-klas', 'klas'); bind('f-jaar', 'jaar'); bind('f-q', 'q', 'input');
    var ex = document.getElementById('ov-expand');
    if (ex) ex.addEventListener('click', function () {
      var zichtbaar = items.filter(function (a) { return a.status === tab && matches(a); });
      var alleOpen = zichtbaar.length && zichtbaar.every(function (a) { return open[a.code]; });
      zichtbaar.forEach(function (a) { open[a.code] = !alleOpen; });
      renderList();
    });
  }

  // Knop-definities: id (komt van de server, lib/overzicht-status.js) → HTML
  function knop(id, a, hoofd) {
    var c = a.code, n = esc(a.name || a.code), cls = hoofd ? 'btn btn-primary small' : 'btn btn-soft small';
    var js = function (fn) { return 'onclick="' + fn + '"'; };
    var q = "'" + c + "'", qn = "'" + n.replace(/'/g, "\\'") + "'";
    switch (id) {
      case 'live':       return '<a class="' + cls + '" href="/teacher-grid.html?code=' + c + '" target="_blank">Live</a>';
      case 'klasbord':   return '<a class="' + cls + '" href="/toets-bord.html?code=' + c + '" target="_blank" title="Klasbord voor op de beamer">Klasbord</a>';
      case 'voortgang':  return '<button class="' + cls + '" ' + js('toggleQuizRoster(' + q + ')') + '>Voortgang</button>';
      case 'stoppen':    return '<button class="btn btn-muted small" ' + js('stopQuiz(' + q + ',' + qn + ')') + ' title="Iedereen meteen laten inleveren en de ' + LABEL + ' sluiten">Stoppen</button>';
      case 'bewerken':   return '<a class="' + cls + '" href="/quiz-teacher.html?type=' + TYPE + '&edit=' + c + '">Bewerken</a>';
      case 'verbeteren': return '<a class="' + cls + '" href="/quiz-review.html?code=' + c + '">Verbeteren</a>';
      case 'scores':     return '<a class="' + cls + '" href="/quiz-review.html?code=' + c + '">Scores</a>';
      case 'heropenen':  return '<button class="btn btn-muted small" ' + js('heropenToetsVoorLeerlingen(' + q + ',' + qn + ')') + '>' + (TYPE === 'taak' ? 'Taak' : 'Toets') + ' heropenen</button>';
      case 'dupliceren': return '<button class="btn btn-muted small" ' + js('duplicateQuiz(' + q + ')') + '>Dupliceren</button>';
      case 'sjabloon':   return '<button class="btn btn-muted small" ' + js('saveAsTemplate(' + q + ')') + '>Bewaar als sjabloon</button>';
      case 'archiveren': return '<button class="btn btn-muted small" ' + js('archiveerToets(' + q + ',true)') + '>Archiveren</button>';
      case 'uit_archief':return '<button class="btn btn-muted small" ' + js('archiveerToets(' + q + ',false)') + '>Uit archief halen</button>';
      case 'verwijderen':return '<button class="btn btn-danger small" ' + js('deleteQuiz(' + q + ')') + '>Verwijderen</button>';
      case 'activeren':  return '<button class="' + cls + '" ' + js('activateQuiz(' + q + ')') + ' title="Maak hier een echte ' + LABEL + ' van">Activeren</button>';
      case 'doorlopen':  return '<button class="btn btn-soft small" ' + js('openPreviewRun(' + q + ')') + ' title="Doorloop dit concept zelf als leerling">Doorlopen</button>';
    }
    return '';
  }

  function voortgangBalk(a) {
    if (a.status !== 'te_verbeteren' && !(a.status === 'afgerond' && a.ingediend)) return '';
    var pct = a.ingediend ? Math.round(100 * a.verbeterd / a.ingediend) : 100;
    return '<div class="ov-prog" title="' + a.verbeterd + ' van ' + a.ingediend + ' ingediende leerlingen volledig verbeterd">' +
      '<div class="ov-prog-bar"><div style="width:' + pct + '%"></div></div><span>' + a.verbeterd + '/' + a.ingediend + ' verbeterd</span></div>';
  }

  function card(a) {
    var k = a.knoppen || { primary: 'scores', more: [] };
    var start = a.accessFrom || a.createdAt;
    var meta = '<span>Code <strong>' + esc(a.code) + '</strong></span>' +
      (a.className ? '<span>' + esc(a.className) + '</span>' : '') +
      (a.schoolYear ? '<span>' + esc(a.schoolYear) + '</span>' : '') +
      (start ? '<span>' + (a.accessFrom ? 'Start ' : 'Aangemaakt ') + fmt(start) + '</span>' : '') +
      (a.accessUntil ? '<span>Deadline ' + fmt(a.accessUntil) + '</span>' : '');
    var isOpen = !!open[a.code];
    var meer = k.more.map(function (id) { return knop(id, a, false); }).join('');
    return '<div class="ov-row' + (isOpen ? ' open' : '') + '" data-code="' + esc(a.code) + '">' +
      '<div class="ov-main">' +
        '<div class="ov-info">' +
          '<div class="ov-title"><strong>' + esc(a.name || a.code) + '</strong>' + statusBadge(a) + releaseBadges(a) +
            (a.status === 'actief' && a.onlineCount ? '<span class="ov-badge" style="background:#dcfce7;color:#166534;">' + a.onlineCount + ' online</span>' : '') +
            '<span id="ai-grade-badge-' + esc(a.code) + '"></span></div>' +
          '<div class="ov-meta">' + meta + '</div>' + voortgangBalk(a) +
        '</div>' +
        '<div class="ov-acts">' + knop(k.primary, a, true) +
          (meer ? '<button type="button" class="ov-chev" data-toggle="' + esc(a.code) + '" aria-expanded="' + isOpen + '" title="Meer acties">&#9662;</button>' : '') +
        '</div>' +
      '</div>' +
      (meer ? '<div class="ov-more"' + (isOpen ? '' : ' hidden') + '>' + meer + '</div>' : '') +
      '<div id="roster-' + esc(a.code) + '" class="a-roster" style="display:none;"></div>' +
    '</div>';
  }

  function sorteer(arr) {
    var t = tab;
    return arr.slice().sort(function (x, y) {
      if (t === 'actief') return (x.accessFrom || x.createdAt || 0) - (y.accessFrom || y.createdAt || 0) || (y.createdAt || 0) - (x.createdAt || 0);
      if (t === 'archief') return (y.archivedAt || 0) - (x.archivedAt || 0);
      return (y.stoppedAt || y.createdAt || 0) - (x.stoppedAt || x.createdAt || 0);
    });
  }

  function renderList() {
    var el = document.getElementById('assignment-list');
    if (!el) return;
    var lijst = sorteer(items.filter(function (a) { return a.status === tab && matches(a); }));
    var leeg = {
      actief: 'Geen actieve ' + LABEL_MV + '.', te_verbeteren: 'Niets te verbeteren. Goed bezig!',
      afgerond: 'Nog geen afgeronde ' + LABEL_MV + '.', archief: 'Het archief is leeg.', concept: 'Geen concepten.'
    }[tab];
    if (!lijst.length) {
      el.innerHTML = '<p class="empty-state">' + (items.length ? leeg : 'Nog geen ' + LABEL_MV + '. Klik op "+ Nieuwe ' + LABEL + '".') + '</p>';
      return;
    }
    if (tab === 'archief') {
      // Gegroepeerd per schooljaar · klas, ingeklapt-beheersbaar bij heel veel items.
      var groepen = {}, volgorde = [];
      lijst.forEach(function (a) {
        var g = (a.schoolYear || 'Onbekend schooljaar') + ' · ' + (a.className || 'Geen klas');
        if (!groepen[g]) { groepen[g] = []; volgorde.push(g); }
        groepen[g].push(a);
      });
      volgorde.sort().reverse();
      var typ = filter.q || filter.klas || filter.jaar;
      el.innerHTML = volgorde.map(function (g) {
        var dicht = groepDicht[g] === undefined ? !typ && volgorde.length > 3 : groepDicht[g];
        return '<div class="ov-group"><button type="button" class="ov-group-head" data-group="' + esc(g) + '">' +
          '<span>' + (dicht ? '&#9656;' : '&#9662;') + ' ' + esc(g) + '</span><span class="ov-count">' + groepen[g].length + '</span></button>' +
          (dicht ? '' : '<div class="ov-list">' + groepen[g].map(card).join('') + '</div>') + '</div>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('.ov-group-head'), function (b) {
        b.addEventListener('click', function () {
          var g = b.getAttribute('data-group');
          var nu = groepDicht[g] === undefined ? !typ && volgorde.length > 3 : groepDicht[g];
          groepDicht[g] = !nu; renderList();
        });
      });
    } else {
      var n = tonen[tab] || PAGE;
      el.innerHTML = '<div class="ov-list">' + lijst.slice(0, n).map(card).join('') + '</div>' +
        (lijst.length > n ? '<div style="text-align:center;margin-top:12px;"><button type="button" class="btn btn-muted small" id="ov-meer">Toon meer (' + (lijst.length - n) + ' resterend)</button></div>' : '');
      var m = document.getElementById('ov-meer');
      if (m) m.addEventListener('click', function () { tonen[tab] = n + PAGE; renderList(); });
    }
    Array.prototype.forEach.call(el.querySelectorAll('.ov-chev'), function (b) {
      b.addEventListener('click', function () {
        var code = b.getAttribute('data-toggle');
        open[code] = !open[code];
        var row = b.closest('.ov-row'), more = row && row.querySelector('.ov-more');
        if (row) row.classList.toggle('open', !!open[code]);
        if (more) more.hidden = !open[code];
        b.setAttribute('aria-expanded', String(!!open[code]));
      });
    });
    pollAiGradeJobs();
  }

  // v102: archiveren / uit archief halen (uit archief → Afgerond, niet direct heropenen).
  window.archiveerToets = async function (code, archiveren) {
    try {
      var r = await window.apiFetch('/api/quiz/' + encodeURIComponent(code) + (archiveren ? '/archive' : '/unarchive'), { method: 'PUT' });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || r.status);
      if (window.pyToast) pyToast(archiveren ? 'Gearchiveerd.' : 'Uit het archief gehaald, staat nu bij Afgerond.', 'success');
      await window.reloadAssignments();
    } catch (e) { if (window.pyAlert) pyAlert('Mislukt: ' + e.message, 'error'); }
  };

  // Sprint 95: "↻ Toets heropenen" — haalt de roster (klas + gasten) op, laat de
  // leerkracht een nieuw tijdstip + specifieke leerlingen kiezen, en stuurt dat naar de
  // nieuwe bulk-endpoint. Werkt bewust ook als de toets/taak zelf gestopt is of de
  // deadline al verstreek — dat is precies waarvoor deze knop verschijnt.
  window.heropenToetsVoorLeerlingen = async function (code, naam) {
    var box = null;
    try {
      var r = await fetch('/api/quiz-sessions/' + code + '/roster');
      var d = await r.json();
      if (!r.ok) { if (window.pyAlert) pyAlert('Kon de leerlingenlijst niet laden.', 'error'); return; }
      var lijst = (d.students || []).concat(d.extras || []).map(function (s) {
        return { id: s.id || null, name: s.name };
      });
      if (!lijst.length) { if (window.pyAlert) pyAlert('Geen leerlingen gevonden om te heropenen.', 'info'); return; }
      var keuze = window.pyHeropenPicker
        ? await window.pyHeropenPicker({ naam: naam, studenten: lijst })
        : null;
      if (!keuze) return;
      var fetcher = window.apiFetch || fetch;
      var resp = await fetcher('/api/quiz-sessions/' + code + '/reopen-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: keuze.until, students: keuze.studenten }),
      });
      var data = await resp.json().catch(function () { return {}; });
      if (!resp.ok) throw new Error(data.error || resp.status);
      if (window.pyToast) pyToast(data.count + ' leerling' + (data.count === 1 ? '' : 'en') + ' heropend tot ' +
        new Date(keuze.until).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) + '.', 'success');
      if (window.reloadAssignments) window.reloadAssignments();
    } catch (e) {
      if (window.pyAlert) pyAlert('Heropenen mislukt: ' + e.message, 'error');
    }
  };

  window.reloadAssignments = async function () {
    var el = document.getElementById('assignment-list');
    try {
      var r = await fetch('/api/quiz-sessions?bank=1');
      if (!r.ok) { el.innerHTML = '<p class="empty-state">Kon niet laden.</p>'; return; }
      var all = await r.json();
      items = all.filter(function (a) { return a.quizType === TYPE; });
      if (window.cacheAssignments) window.cacheAssignments(all);
      renderTabs(); renderFilters(); renderList();
    } catch (e) {
      if (el) el.innerHTML = '<p class="empty-state">Kon niet laden.</p>';
    }
  };

  // Sprint 51-fix: toont een kleine badge op elke toets-/taakkaart met een lopende (of
  // recent afgeronde) AI-verbeter-taak — zodat je dat ook op dit overzicht ziet, niet enkel
  // op de verbeterpagina zelf. Blijft pollen zolang er minstens één taak nog loopt; stopt
  // vanzelf zodra alles klaar/leeg is.
  var _aiGradeOverviewTimer = null;
  function pollAiGradeJobs() {
    fetch('/api/ai-grade/active').then(function (r) { return r.json(); }).then(function (data) {
      var jobs = (data && data.jobs) || [];
      var nogActief = false;
      jobs.forEach(function (job) {
        var el = document.getElementById('ai-grade-badge-' + job.code);
        if (!el) return; // deze toets staat niet op dit overzicht (bv. het andere type)
        if (job.status === 'running') nogActief = true;
        var tekst = job.status === 'running'
          ? '🤖 AI verbeteren: ' + (job.voltooid || 0) + '/' + (job.totaal || 0)
          : job.status === 'done'
            ? '✅ AI verbeteren klaar'
            : '⚠️ AI verbeteren gestopt';
        var kleur = job.status === 'error' ? 'background:#fee2e2;color:#991b1b;' : 'background:#ede9fe;color:#5b21b6;';
        el.innerHTML = '<a class="badge" href="/quiz-review.html?code=' + job.code + '" style="' + kleur + 'text-decoration:none;">' + tekst + '</a>';
      });
      if (nogActief && !_aiGradeOverviewTimer) {
        _aiGradeOverviewTimer = setInterval(pollAiGradeJobs, 3000);
      } else if (!nogActief && _aiGradeOverviewTimer) {
        clearInterval(_aiGradeOverviewTimer);
        _aiGradeOverviewTimer = null;
      }
    }).catch(function () { /* volgende keer opnieuw proberen bij reload */ });
  }

  // Sprint 43.9: preview zelf doorlopen (opent de leerling-weergave in een nieuw tabblad).
  // Previews zijn vrijgesteld van de leerling-selectie, dus 'Leerkracht Test' mag starten.
  window.openPreviewRun = function (code) {
    var url = '/quiz-student.html?code=' + encodeURIComponent(code) +
              '&name=' + encodeURIComponent('Leerkracht Test') +
              '&class=' + encodeURIComponent('Preview');
    window.open(url, '_blank');
  };

  // Sprint 51c: bewaar deze toets/taak als herbruikbaar sjabloon in de bibliotheek.
  window.saveAsTemplate = async function (code) {
    var item = items.filter(function (a) { return a.code === code; })[0];
    var suggested = item ? (item.name || 'Sjabloon') : 'Sjabloon';
    var name = window.pyPrompt
      ? await window.pyPrompt({ title: 'Bewaar als sjabloon', body: 'Naam van het sjabloon:', defaultValue: suggested, confirmLabel: 'Bewaren' })
      : prompt('Naam van het sjabloon:', suggested);
    if (name === null) return;
    try {
      var r = await window.apiFetch('/api/library/templates/from-session/' + code, {
        method: 'POST', body: JSON.stringify({ name: name || suggested }),
      });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok && d.ok) {
        if (window.pyToast) window.pyToast('Sjabloon bewaard. Standaard privé — deel het via de Bibliotheek.', 'success');
      } else if (window.pyAlert) window.pyAlert(d.error || 'Bewaren mislukt.', 'error');
    } catch (e) { if (window.pyAlert) window.pyAlert('Bewaren mislukt.', 'error'); }
  };

  document.addEventListener('DOMContentLoaded', window.reloadAssignments);
  if (document.readyState !== 'loading') window.reloadAssignments();
})();


// ── Sprint 69: leerkracht stopt de toets/taak ───────────────────────────────
// Twee effecten tegelijk, dus expliciet bevestigen: iedereen die bezig is wordt
// ingeleverd met wat hij op dat moment heeft, én niemand kan nadien nog starten.
window.stopQuiz = async function (code, naam) {
  var ok = await window.pyConfirm({
    title: '⏹ Stoppen en inleveren',
    body: '<p><strong>' + naam + '</strong> nu stoppen?</p>' +
          '<ul style="text-align:left;margin:8px 0 0;padding-left:18px;">' +
          '<li>Iedereen die bezig is, levert meteen in met wat hij heeft.</li>' +
          '<li>Ook leerlingen die hun browser gesloten hebben worden ingeleverd.</li>' +
          '<li>Niemand kan nadien nog starten.</li></ul>' +
          '<p style="margin-top:8px;">Dit kan je niet ongedaan maken.</p>',
    confirmLabel: 'Stoppen en inleveren',
    cancelLabel: 'Annuleren',
    danger: true,
  });
  if (!ok) return;
  var r = await window.apiFetch('/api/quiz/' + encodeURIComponent(code) + '/stop', { method: 'POST' });
  var d = await r.json().catch(function () { return {}; });
  if (r.ok && d.ok) {
    await window.pyAlert(d.ingediend + ' deelname(s) ingeleverd. De ' + LABEL + ' is gesloten.', 'success');
    // Sprint 51e: het overzicht meteen verversen (vroeger werd het onbestaande
    // loadAssignments() aangeroepen → geen refresh, de kaart leek nog "Open").
    if (typeof window.reloadAssignments === 'function') await window.reloadAssignments();
    else location.reload();
  } else {
    await window.pyAlert('Stoppen mislukt: ' + (d.error || r.status), 'error');
  }
};
