/* Sprint 43.7 — Toets-/taak-overzicht als eigen pagina (zelfde opbouw als de vragenbank).
   Deze pagina staat los van het sessie-overzicht: eigen titel, eigen kaartenraster, eigen filters.
   Het type (toets|taak) wordt afgeleid uit de bestandsnaam, zodat één script beide pagina's bedient. */
(function () {
  'use strict';

  var TYPE = location.pathname.indexOf('taak-overzicht') !== -1 ? 'taak' : 'toets';
  var LABEL = TYPE === 'taak' ? 'taak' : 'toets';
  var LABEL_MV = TYPE === 'taak' ? 'taken' : 'toetsen';

  var items = [];                                   // alles van dit type (incl. previews)
  var filter = { klas: '', status: '', jaar: '', q: '' };

  function esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }

  function statusBadge(a) {
    if (a.isPreview)                 return '<span class="badge" style="background:#fef3c7;color:#92400e;">👁 preview</span>';
    if (a.availability === 'closed') return '<span class="badge" style="background:#e2e8f0;color:#475569;">Gesloten</span>';
    if (a.availability === 'expired')return '<span class="badge" style="background:#fee2e2;color:#991b1b;">⛔ Venster voorbij</span>';
    if (a.availability === 'pending')return '<span class="badge" style="background:#dbeafe;color:#1e40af;">⏳ Nog niet open</span>';
    return '<span class="badge" style="background:#dcfce7;color:#166534;">🟢 Open</span>';
  }

  function group(a) {
    if (a.isPreview) return 'preview';
    if (a.availability === 'closed' || a.availability === 'expired') return 'done';
    return 'active';
  }

  function matches(a) {
    if (filter.klas && a.className !== filter.klas) return false;
    if (filter.jaar && a.schoolYear !== filter.jaar) return false;
    if (filter.status === 'preview' && !a.isPreview) return false;
    if (filter.status === 'active' && group(a) !== 'active') return false;
    if (filter.status === 'done' && group(a) !== 'done') return false;
    if (filter.q) {
      var hay = ((a.name || '') + ' ' + (a.code || '')).toLowerCase();
      if (hay.indexOf(filter.q.toLowerCase()) === -1) return false;
    }
    return true;
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
      '<select id="f-klas"><option value="">Alle klassen</option>' + classes.map(function (c) { return opt(c, c, filter.klas === c); }).join('') + '</select>' +
      '<select id="f-status">' + opt('', 'Alle statussen', !filter.status) + opt('active', 'Actief', filter.status === 'active') +
        opt('preview', 'Preview', filter.status === 'preview') + opt('done', 'Afgerond', filter.status === 'done') + '</select>' +
      (years.length > 1 ? '<select id="f-jaar"><option value="">Alle schooljaren</option>' + years.map(function (y) { return opt(y, y, filter.jaar === y); }).join('') + '</select>' : '') +
      '<input id="f-q" placeholder="Zoek op naam of code…" value="' + esc(filter.q) + '"/>';
    function bind(id, key, ev) {
      var e = document.getElementById(id); if (!e) return;
      e.addEventListener(ev || 'change', function () { filter[key] = e.value; renderList(); });
    }
    bind('f-klas', 'klas'); bind('f-status', 'status'); bind('f-jaar', 'jaar'); bind('f-q', 'q', 'input');
  }

  function renderStats() {
    var host = document.getElementById('stats-bar');
    if (!host) return;
    var act = 0, prev = 0, done = 0;
    items.forEach(function (a) { var g = group(a); if (g === 'active') act++; else if (g === 'preview') prev++; else done++; });
    host.innerHTML =
      '<span class="stat-chip">Totaal: <strong>' + items.length + '</strong></span>' +
      '<span class="stat-chip">Actief: <strong>' + act + '</strong></span>' +
      '<span class="stat-chip">Preview: <strong>' + prev + '</strong></span>' +
      '<span class="stat-chip">Afgerond: <strong>' + done + '</strong></span>';
  }

  function card(a) {
    var cls = 'a-card' + (a.isPreview ? ' preview-card' : '');
    var activate = a.isPreview
      ? '<button class="btn btn-primary small" onclick="activateQuiz(\'' + a.code + '\')" title="Maak hier een echte ' + LABEL + ' van">▶ Activeren</button>' : '';
    // Sprint 43.9: een preview moet je ook LATER nog kunnen doorlopen als leerkracht.
    var walk = a.isPreview
      ? '<button class="btn btn-soft small" onclick="openPreviewRun(\'' + a.code + '\')" title="Doorloop deze preview zelf, als leerling">🧑‍🎓 Doorlopen</button>' : '';
    var live = a.isPreview ? '' :
      '<a class="btn btn-soft small" href="/teacher-grid.html?code=' + a.code + '" target="_blank">👁 Live</a>' +
      '<button class="btn btn-soft small" onclick="toggleQuizRoster(\'' + a.code + '\')">👥 Voortgang</button>' +
      // Sprint 69: stoppen dient ook als "iedereen nu inleveren" — enkel zinvol zolang
      // de toets nog niet gestopt is.
      (a.stoppedAt
        ? '<span class="badge" style="background:#e2e8f0;color:#475569;" title="Gestopt op ' +
            new Date(a.stoppedAt).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) +
          '">⏹ gestopt</span>'
        : '<button class="btn btn-muted small" onclick="stopQuiz(\'' + a.code + '\',\'' + esc(a.name || a.code) + '\')" ' +
          'title="Iedereen die bezig is meteen laten inleveren en de ' + LABEL + ' sluiten">⏹ Stoppen</button>');
    // Sprint 50 (bug 2): "Aanpassen" — enkel op dit overzicht (niet in het live-/sessiescherm).
    // De server bepaalt of het nog mag (a.editable): geen preview, niet gearchiveerd/gesloten/
    // gestopt, en nog geen leerling gestart of resultaten. Anders: uitgeschakelde knop met uitleg.
    var edit = a.isPreview ? '' : (a.editable
      ? '<a class="btn btn-muted small" href="/quiz-teacher.html?type=' + TYPE + '&edit=' + a.code + '" ' +
          'title="Pas deze ' + LABEL + ' aan (kan enkel zolang niemand gestart is)">✏️ Aanpassen</a>'
      : '<button class="btn btn-muted small" disabled style="opacity:0.55;cursor:not-allowed;" ' +
          'title="Aanpassen kan niet meer: een leerling is al gestart of er zijn resultaten.">✏️ Aanpassen</button>');
    var deadline = a.accessUntil
      ? '<span class="a-sub">⏰ Deadline: ' + new Date(a.accessUntil).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) + '</span>'
      : '';
    return '<div class="' + cls + '">' +
      '<div class="a-meta"><strong>' + esc(a.name || a.code) + '</strong>' + statusBadge(a) +
        (a.onlineCount ? '<span class="badge" style="background:#dcfce7;color:#166534;">👥 ' + a.onlineCount + ' online</span>' : '') +
      '</div>' +
      '<div class="a-sub">Code: <strong>' + esc(a.code) + '</strong>' +
        (a.className ? ' · 👥 ' + esc(a.className) : '') +
        (a.schoolYear ? ' · ' + esc(a.schoolYear) : '') +
        ' · ' + new Date(a.createdAt).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      '</div>' + deadline +
      '<div class="a-actions">' + activate + walk + live +
        // Sprint 50 (bug 2): bewerken is enkel mogelijk zolang niemand gestart is en er geen
        // resultaten zijn (a.editable komt van de server). Anders tonen we een uitgeschakelde
        // knop met uitleg, zodat de leerkracht weet waaróm het niet meer kan.
        edit +
        '<a class="btn btn-muted small" href="/quiz-review.html?code=' + a.code + '">✏️ Verbeteren</a>' +
        '<button class="btn btn-muted small" onclick="duplicateQuiz(\'' + a.code + '\')">📋 Dupliceren</button>' +
        '<button class="btn btn-muted small" onclick="saveAsTemplate(\'' + a.code + '\')" title="Zet deze ' + LABEL + ' als herbruikbaar sjabloon in de bibliotheek">💾 Bewaar als sjabloon</button>' +
        '<button class="btn btn-danger small" onclick="deleteQuiz(\'' + a.code + '\')">🗑 Verwijderen</button>' +
      '</div>' +
      '<div id="roster-' + a.code + '" class="a-roster" style="display:none;"></div>' +
    '</div>';
  }

  function renderList() {
    var el = document.getElementById('assignment-list');
    if (!el) return;
    var list = items.filter(matches);
    if (!list.length) {
      el.innerHTML = items.length
        ? '<p class="empty-state">Geen ' + LABEL_MV + ' die aan de filter voldoen.</p>'
        : '<p class="empty-state">Nog geen ' + LABEL_MV + '. Klik op "+ Nieuwe ' + LABEL + '".</p>';
      return;
    }
    var g = { active: [], preview: [], done: [] };
    list.forEach(function (a) { g[group(a)].push(a); });
    function section(arr, title, color) {
      if (!arr.length) return '';
      return '<div class="group-head" style="color:' + color + ';">' + title + ' (' + arr.length + ')</div>' +
             '<div class="ab-grid">' + arr.map(card).join('') + '</div>';
    }
    el.innerHTML =
      section(g.active, '🟢 Actief', '#166534') +
      section(g.preview, '👁 Preview / onafgewerkt', '#92400e') +
      section(g.done, '✅ Afgerond / te verbeteren', '#334155');
  }

  window.reloadAssignments = async function () {
    var el = document.getElementById('assignment-list');
    try {
      var r = await fetch('/api/quiz-sessions?bank=1');
      if (!r.ok) { el.innerHTML = '<p class="empty-state">Kon niet laden.</p>'; return; }
      var all = await r.json();
      items = all.filter(function (a) { return a.quizType === TYPE; });
      if (window.cacheAssignments) window.cacheAssignments(all);
      renderStats(); renderFilters(); renderList();
    } catch (e) {
      if (el) el.innerHTML = '<p class="empty-state">Kon niet laden.</p>';
    }
  };

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
    if (typeof loadAssignments === 'function') loadAssignments();
    else location.reload();
  } else {
    await window.pyAlert('Stoppen mislukt: ' + (d.error || r.status), 'error');
  }
};
