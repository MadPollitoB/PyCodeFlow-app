/* Sprint 51c (deel 2) — Bibliotheek: gedeelde vragen + toets/taak-sjablonen.
   Leunt op globals uit app.js: apiFetch (CSRF), escapeHtml, pyToast, pyAlert,
   pyConfirm, pyPrompt. GET's gaan via gewone fetch (cookie-auth); mutaties via apiFetch. */
(function () {
  'use strict';

  var current = 'toetsen';
  var openManage = {};                 // templateId -> bool (manage-paneel open?)
  var cache = { vragen: [], templates: [] };
  var detailCache = {};                // templateId -> detail (questions)

  function esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function toast(m, t) { if (window.pyToast) window.pyToast(m, t || 'success'); }
  function alertMsg(m, t) { if (window.pyAlert) window.pyAlert(m, t || 'error'); else alert(m); }

  function scopeBadge(scope) {
    var label = scope === 'public' ? '🌍 Publiek' : scope === 'school' ? '🏫 School' : '🔒 Privé';
    return '<span class="badge badge-scope-' + esc(scope) + '">' + label + '</span>';
  }
  function ownerBadge(isOwner, name) {
    return isOwner
      ? '<span class="badge badge-owner">✏️ Van jou</span>'
      : (name ? '<span class="badge">👤 ' + esc(name) + '</span>' : '');
  }
  function scopeSelect(kind, id, scope) {
    // kind = 'q' (vraag) of 't' (sjabloon)
    function opt(v, l) { return '<option value="' + v + '"' + (scope === v ? ' selected' : '') + '>' + l + '</option>'; }
    var fn = kind === 'q' ? 'libSetQuestionScope' : 'libSetTemplateScope';
    return '<select class="scope-select" data-prev="' + esc(scope) + '" onchange="' + fn + '(\'' + id + '\', this)">' +
      opt('private', '🔒 Privé') + opt('school', '🏫 School') + opt('public', '🌍 Publiek') + '</select>';
  }

  // ── Data laden ──────────────────────────────────────────────────────────────
  async function loadAll() {
    try {
      var rq = await fetch('/api/library/questions');
      var jq = rq.ok ? await rq.json() : {};
      cache.vragen = jq.items || [];
      var rt = await fetch('/api/library/templates');
      var jt = rt.ok ? await rt.json() : {};
      cache.templates = jt.items || [];
      cache.canModerate = !!(jq.canModerate || jt.canModerate); // Sprint 53d: admin/moderator?
    } catch (e) { cache.vragen = []; cache.templates = []; cache.canModerate = false; }
    libRender();
  }

  // Sprint 53d: verborgen-badge + (voor een admin) verbergen/zichtbaar-maken-knop.
  function moderatieBadge(item) {
    return item.hidden ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">🚫 Verborgen</span>' : '';
  }
  function moderatieKnop(kind, item) {
    if (!cache.canModerate) return '';
    return '<button class="btn btn-muted small" onclick="libToggleHidden(\'' + kind + '\',\'' + item.id + '\',' + (item.hidden ? 'false' : 'true') + ')" title="Admin: een gedeeld item verbergen of terugzetten">' +
      (item.hidden ? '👁 Zichtbaar maken' : '🚫 Verbergen') + '</button>';
  }

  // ── Kaarten ─────────────────────────────────────────────────────────────────
  function questionCard(q) {
    var actions;
    if (q.isOwner) {
      var lockNote = q.templateCount > 0
        ? '<span class="lib-sub" title="Deze vraag hangt aan een sjabloon; zichtbaarheid staat vast tot je ze losmaakt.">🔒 in ' + q.templateCount + ' sjabloon(en)</span>'
        : scopeSelect('q', q.id, q.scope);
      actions = lockNote;
    } else {
      actions = '<button class="btn btn-soft small" onclick="libDupQuestion(\'' + q.id + '\')">📋 Dupliceren naar mijn bank</button>';
    }
    return '<div class="lib-card">' +
      '<div class="lib-meta">' + scopeBadge(q.scope) + ownerBadge(q.isOwner, q.ownerName) + moderatieBadge(q) +
        (q.subject ? '<span class="badge">' + esc(q.subject) + '</span>' : '') +
        '<span class="badge">' + esc(q.maxPoints) + ' ptn</span>' +
      '</div>' +
      '<div class="lib-text">' + esc(q.text) + '</div>' +
      '<div class="lib-actions">' + actions + moderatieKnop('q', q) + '</div>' +
    '</div>';
  }

  function templateCard(t) {
    var typeLabel = t.type === 'taak' ? 'taak' : 'toets';
    var make = '<button class="btn btn-primary small" onclick="libMaterialize(\'' + t.id + '\')" title="Maak een eigen ' + typeLabel + ' van dit sjabloon">➕ Maak ' + typeLabel + '</button>';
    var ownerBits = '';
    if (t.isOwner) {
      ownerBits =
        scopeSelect('t', t.id, t.scope) +
        '<button class="btn btn-muted small" onclick="libToggleManage(\'' + t.id + '\')">🔧 Beheren</button>' +
        '<button class="btn btn-danger small" onclick="libDeleteTemplate(\'' + t.id + '\')">🗑</button>';
    }
    return '<div class="lib-card" id="tplcard-' + t.id + '">' +
      '<div class="lib-meta">' +
        '<span class="badge badge-type">' + (t.type === 'taak' ? '📝 taak' : '🧪 toets') + '</span>' +
        scopeBadge(t.scope) + ownerBadge(t.isOwner, t.ownerName) + moderatieBadge(t) +
        '<span class="badge">' + (t.questionCount || 0) + ' vragen</span>' +
      '</div>' +
      '<div class="lib-title">' + esc(t.name) + '</div>' +
      (t.description ? '<div class="lib-sub">' + esc(t.description) + '</div>' : '') +
      '<div class="lib-actions">' + make + ownerBits + moderatieKnop('t', t) + '</div>' +
      '<div class="manage-panel" id="manage-' + t.id + '" style="display:none;"></div>' +
    '</div>';
  }

  // ── Renderen ────────────────────────────────────────────────────────────────
  function matchSearch(hay) {
    var q = (document.getElementById('lib-search') || {}).value || '';
    if (!q.trim()) return true;
    return hay.toLowerCase().indexOf(q.trim().toLowerCase()) !== -1;
  }

  function sections(items, cardFn, textOf) {
    var school = items.filter(function (i) { return i.scope === 'school' && matchSearch(textOf(i)); });
    var pub = items.filter(function (i) { return i.scope === 'public' && matchSearch(textOf(i)); });
    if (!school.length && !pub.length) {
      return '<p class="empty-state">Nog niets gedeeld hier. Deel een item vanuit de Vragenbank of via “Bewaar als sjabloon” op het toets-/taakoverzicht.</p>';
    }
    function block(arr, title) {
      if (!arr.length) return '';
      return '<div class="group-head">' + title + ' (' + arr.length + ')</div>' +
             '<div class="lib-grid">' + arr.map(cardFn).join('') + '</div>';
    }
    return block(school, '🏫 Gedeeld binnen school') + block(pub, '🌍 Publiek');
  }

  window.libRender = function () {
    var elV = document.getElementById('list-vragen');
    var elToets = document.getElementById('list-toetsen');
    var elTaak = document.getElementById('list-taken');
    if (elV) elV.innerHTML = sections(cache.vragen, questionCard, function (q) { return (q.text || '') + ' ' + (q.subject || ''); });
    if (elToets) elToets.innerHTML = sections(cache.templates.filter(function (t) { return t.type === 'toets'; }), templateCard, function (t) { return (t.name || '') + ' ' + (t.description || ''); });
    if (elTaak) elTaak.innerHTML = sections(cache.templates.filter(function (t) { return t.type === 'taak'; }), templateCard, function (t) { return (t.name || '') + ' ' + (t.description || ''); });
    // Heropen eventueel geopende beheer-panelen na een herrender.
    Object.keys(openManage).forEach(function (id) { if (openManage[id]) renderManage(id); });
  };

  window.libTab = function (tab) {
    current = tab;
    ['vragen', 'toetsen', 'taken'].forEach(function (t) {
      var c = document.getElementById('tab-' + t); if (c) c.classList.toggle('active', t === tab);
      var b = document.getElementById('tabbtn-' + t); if (b) b.classList.toggle('active', t === tab);
    });
  };

  // ── Vraag-acties ────────────────────────────────────────────────────────────
  window.libDupQuestion = async function (id) {
    var r = await window.apiFetch('/api/quiz/bank/' + id + '/duplicate', { method: 'POST' });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) { toast('Vraag gekopieerd naar je eigen bank.'); }
    else alertMsg('Kon niet dupliceren: ' + (d.error || r.status));
  };

  // Sprint 53d: admin verbergt/toont een gedeeld item (takedown).
  window.libToggleHidden = async function (kind, id, hidden) {
    var pad = '/api/library/' + (kind === 'q' ? 'questions' : 'templates') + '/' + id + '/hidden';
    var r = await window.apiFetch(pad, { method: 'PUT', body: JSON.stringify({ hidden: hidden }) });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) { toast(hidden ? 'Verborgen voor andere leerkrachten.' : 'Weer zichtbaar.'); loadAll(); }
    else alertMsg('Actie mislukt: ' + (d.error || r.status));
  };

  window.libSetQuestionScope = async function (id, sel) {
    var scope = sel.value, prev = sel.getAttribute('data-prev');
    var r = await window.apiFetch('/api/quiz/bank/' + id + '/scope', {
      method: 'PUT', body: JSON.stringify({ scope: scope }),
    });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) { toast('Zichtbaarheid aangepast.'); loadAll(); }
    else { alertMsg(d.error || 'Wijzigen mislukt.'); sel.value = prev; }
  };

  // ── Sjabloon-acties ─────────────────────────────────────────────────────────
  window.libMaterialize = async function (id) {
    var r = await window.apiFetch('/api/library/templates/' + id + '/materialize', { method: 'POST' });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) {
      toast('Nieuwe ' + (d.type === 'taak' ? 'taak' : 'toets') + ' aangemaakt (code ' + d.code + '). Kies je klas op het overzicht.');
      setTimeout(function () { window.location = d.type === 'taak' ? '/taak-overzicht.html' : '/toets-overzicht.html'; }, 900);
    } else alertMsg(d.error || 'Materialiseren mislukt.');
  };

  window.libSetTemplateScope = async function (id, sel) {
    var scope = sel.value, prev = sel.getAttribute('data-prev');
    var r = await window.apiFetch('/api/library/templates/' + id + '/scope', {
      method: 'PUT', body: JSON.stringify({ scope: scope }),
    });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) { toast('Zichtbaarheid van sjabloon aangepast.'); loadAll(); }
    else { alertMsg(d.error || 'Wijzigen mislukt.'); sel.value = prev; }
  };

  window.libDeleteTemplate = async function (id) {
    var ok = window.pyConfirm
      ? await window.pyConfirm({ title: 'Sjabloon verwijderen', body: 'Het sjabloon verdwijnt uit de bibliotheek. Reeds gemaakte toetsen/taken blijven bestaan.', confirmLabel: 'Verwijderen', danger: true })
      : confirm('Sjabloon verwijderen?');
    if (!ok) return;
    var r = await window.apiFetch('/api/library/templates/' + id, { method: 'DELETE' });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) { toast('Sjabloon verwijderd.'); delete openManage[id]; loadAll(); }
    else alertMsg(d.error || 'Verwijderen mislukt.');
  };

  // ── Sjabloon beheren (eigenaar): vragen bekijken, herordenen, los/koppelen ──
  window.libToggleManage = async function (id) {
    openManage[id] = !openManage[id];
    var panel = document.getElementById('manage-' + id);
    if (!panel) return;
    if (!openManage[id]) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    await renderManage(id);
  };

  async function renderManage(id) {
    var panel = document.getElementById('manage-' + id);
    if (!panel) return;
    panel.innerHTML = '<p class="lib-sub">Laden…</p>';
    try {
      var r = await fetch('/api/library/templates/' + id);
      if (!r.ok) { panel.innerHTML = '<p class="lib-sub">Kon niet laden.</p>'; return; }
      var det = await r.json();
      detailCache[id] = det;
      var rows = (det.questions || []).map(function (q, i) {
        return '<div class="mq-row">' +
          '<span class="mq-text" title="' + esc(q.text) + '">' + (i + 1) + '. ' + esc(q.text) + '</span>' +
          scopeBadge(q.scope) +
          '<button class="btn btn-muted small" title="Omhoog" onclick="libMoveQ(\'' + id + '\',\'' + q.id + '\',-1)">▲</button>' +
          '<button class="btn btn-muted small" title="Omlaag" onclick="libMoveQ(\'' + id + '\',\'' + q.id + '\',1)">▼</button>' +
          '<button class="btn btn-danger small" title="Losmaken" onclick="libDetachQ(\'' + id + '\',\'' + q.id + '\')">✕</button>' +
        '</div>';
      }).join('');
      // Kandidaat-vragen om toe te voegen: alles wat ik zie en nog niet gekoppeld is.
      var already = {}; (det.questions || []).forEach(function (q) { already[q.id] = true; });
      var cand = cache.vragen.filter(function (q) { return !already[q.id]; });
      var opts = cand.map(function (q) { return '<option value="' + q.id + '">' + esc((q.text || '').slice(0, 60)) + ' [' + q.scope + ']</option>'; }).join('');
      panel.innerHTML =
        '<div class="lib-actions" style="margin-bottom:8px;">' +
          '<button class="btn btn-soft small" onclick="libRenameTemplate(\'' + id + '\')">✏️ Naam</button>' +
        '</div>' +
        (rows || '<p class="lib-sub">Nog geen vragen in dit sjabloon.</p>') +
        '<div class="lib-actions" style="margin-top:10px;">' +
          '<select id="addq-' + id + '" class="scope-select" style="max-width:60%;">' +
            '<option value="">+ Vraag toevoegen…</option>' + opts +
          '</select>' +
          '<button class="btn btn-soft small" onclick="libAttachQ(\'' + id + '\')">Toevoegen</button>' +
        '</div>';
    } catch (e) { panel.innerHTML = '<p class="lib-sub">Kon niet laden.</p>'; }
  }

  window.libDetachQ = async function (tid, qid) {
    var r = await window.apiFetch('/api/library/templates/' + tid + '/questions/' + qid, { method: 'DELETE' });
    if (r.ok) { await renderManage(tid); loadAll(); } else alertMsg('Losmaken mislukt.');
  };

  window.libAttachQ = async function (tid) {
    var sel = document.getElementById('addq-' + tid);
    var qid = sel && sel.value; if (!qid) return;
    var r = await window.apiFetch('/api/library/templates/' + tid + '/questions', {
      method: 'POST', body: JSON.stringify({ questionId: qid }),
    });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok && d.ok) { await renderManage(tid); loadAll(); }
    else alertMsg(d.error || 'Toevoegen mislukt.');
  };

  window.libMoveQ = async function (tid, qid, dir) {
    var det = detailCache[tid]; if (!det) return;
    var ids = (det.questions || []).map(function (q) { return q.id; });
    var i = ids.indexOf(qid); if (i < 0) return;
    var j = i + dir; if (j < 0 || j >= ids.length) return;
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    var r = await window.apiFetch('/api/library/templates/' + tid + '/questions/order', {
      method: 'PUT', body: JSON.stringify({ order: ids }),
    });
    if (r.ok) { await renderManage(tid); } else alertMsg('Herordenen mislukt.');
  };

  window.libRenameTemplate = async function (id) {
    var det = detailCache[id] || {};
    var name = window.pyPrompt
      ? await window.pyPrompt({ title: 'Sjabloon hernoemen', body: 'Nieuwe naam:', defaultValue: det.name || '', confirmLabel: 'Bewaren' })
      : prompt('Nieuwe naam:', det.name || '');
    if (name === null) return;
    var r = await window.apiFetch('/api/library/templates/' + id, {
      method: 'PATCH', body: JSON.stringify({ name: name }),
    });
    if (r.ok) { toast('Naam aangepast.'); loadAll(); } else alertMsg('Hernoemen mislukt.');
  };

  document.addEventListener('DOMContentLoaded', loadAll);
  if (document.readyState !== 'loading') loadAll();
})();
