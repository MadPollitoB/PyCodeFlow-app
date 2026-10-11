/* v2026.2.51.119 — Trainingscenter: echte code-editor, interactief uitvoeren en hulp per niveau.
   Gebruikt de helpers $, el en api uit training.html (globaal). */
(function () {
  'use strict';

  var STAAT = null;   // { editor, textarea, runId, poll, ... } voor de huidige codevraag

  // ── Editor (Monaco, zonder automatische aanvulling: de leerling moet het zelf leren) ──────
  function laadMonaco() {
    if (window.monaco && window.monaco.editor) return Promise.resolve(window.monaco);
    return new Promise(function (resolve, reject) {
      if (!window.require) return reject(new Error('Monaco loader niet gevonden'));
      window.require.config({ paths: { vs: '/monaco/min/vs' } });
      window.require(['vs/editor/editor.main'], function () {
        if (!window.monaco) return reject(new Error('Monaco niet geladen'));
        window.monaco.editor.defineTheme('pycodeflow-dark', {
          base: 'vs-dark', inherit: true, rules: [],
          colors: { 'editor.background': '#1e1e1e', 'editorLineNumber.foreground': '#9fb3c8', 'editorLineNumber.activeForeground': '#ffffff', 'editorGutter.background': '#071737', 'editor.lineHighlightBackground': '#23272e', 'editor.lineHighlightBorder': '#23272e' }
        });
        resolve(window.monaco);
      }, reject);
    });
  }

  function maakEditor(host, start) {
    var terugval = function () {
      var ta = el('textarea', { class: 'tc-editor', spellcheck: 'false', 'aria-label': 'Jouw code', autocapitalize: 'off' });
      ta.value = start || '';
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); }
      });
      host.replaceChildren(ta); host.style.height = 'auto';
      STAAT.textarea = ta;
    };
    laadMonaco().then(function (monaco) {
      if (!STAAT || !document.body.contains(host)) return;
      STAAT.editor = monaco.editor.create(host, {
        value: start || '', language: 'python', theme: 'pycodeflow-dark', automaticLayout: true,
        minimap: { enabled: false }, fontSize: 18, lineHeight: 30, lineNumbers: 'off', lineNumbersMinChars: 0, lineDecorationsWidth: 0,
        glyphMargin: false, folding: false, overviewRulerLanes: 0, overviewRulerBorder: false, fixedOverflowWidgets: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false, alwaysConsumeMouseWheel: false },
        roundedSelection: false, scrollBeyondLastLine: false, tabSize: 4,
        insertSpaces: true, wordWrap: 'off', renderLineHighlight: 'line', contextmenu: false,
        quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: 'off',
        parameterHints: { enabled: false }, acceptSuggestionOnEnter: 'off', tabCompletion: 'off',
        snippetSuggestions: 'none', hover: { enabled: false }, autoClosingBrackets: 'never', autoClosingQuotes: 'never',
        rulers: [],
      });
      var ed = STAAT.editor;
      ed.onDidChangeModelContent(function () { tekenGoot(); tekenStatus(); });
      ed.onDidChangeCursorPosition(function () { tekenGoot(); tekenStatus(); });
      ed.onDidScrollChange(function () { var g = $('tc-gutter'); if (g) g.scrollTop = ed.getScrollTop(); });
      tekenGoot(); tekenStatus();
    }).catch(terugval);
  }

  // Regelnummers in een eigen kolom, zoals in Vrij oefenen
  function tekenGoot() {
    var g = $('tc-gutter'); if (!g || !STAAT || !STAAT.editor) return;
    var m = STAAT.editor.getModel(); if (!m) return;
    var huidig = (STAAT.editor.getPosition() || {}).lineNumber || 1, h = '';
    for (var i = 1; i <= m.getLineCount(); i++) h += '<div class="gutter-line' + (i === huidig ? ' active' : '') + '">' + i + '</div>';
    g.innerHTML = h; g.scrollTop = STAAT.editor.getScrollTop();
  }
  function tekenStatus() {
    var s = $('tc-pos'), n = $('tc-regels'); if (!s || !STAAT || !STAAT.editor) return;
    var p = STAAT.editor.getPosition() || { lineNumber: 1, column: 1 }, m = STAAT.editor.getModel();
    s.textContent = 'Ln ' + p.lineNumber + ', Kol ' + p.column; if (n && m) n.textContent = m.getLineCount() + ' regels';
  }

  function krijgCode() {
    if (!STAAT) return '';
    if (STAAT.editor) return STAAT.editor.getValue();
    return STAAT.textarea ? STAAT.textarea.value : '';
  }

  // ── Uitvoeren: het programma wacht zelf op input(), zoals in de rest van de app ──────────
  var AFSLUITING = /\n*===== Compiler klaar met runnen =====\n?/g;

  function uitvoerSchrijf(tekst) {
    var pre = $('tc-uitvoer'); if (!pre) return;
    pre.textContent += tekst;
    pre.scrollTop = pre.scrollHeight;
  }
  function invoerToon(aan) {
    var rij = $('tc-invoerrij'); if (!rij) return;
    rij.hidden = !aan;
    var veld = $('tc-invoerveld'), knop = $('tc-invoerknop');
    veld.disabled = !aan; knop.disabled = !aan;
    $('tc-wacht').hidden = !aan;
    if (aan) { veld.value = ''; veld.focus(); }
  }

  async function stuurInvoer(waarde) {
    if (!STAAT || !STAAT.runId) return;
    invoerToon(false);
    uitvoerSchrijf(waarde + '\n');
    try { await api('/api/training/run/' + STAAT.runId + '/input', { method: 'POST', body: { value: waarde } }); }
    catch (e) { uitvoerSchrijf('[fout: ' + e.message + ']\n'); }
  }

  function stopPoll() { if (STAAT && STAAT.poll) { clearTimeout(STAAT.poll); STAAT.poll = null; } }

  async function pollEvents(runId) {
    if (!STAAT || STAAT.runId !== runId) return;
    try {
      var d = await api('/api/training/run/' + runId + '/events?since=' + (STAAT.seq || 0));
      var klaar = false;
      for (var i = 0; i < d.events.length; i++) {
        var ev = d.events[i]; STAAT.seq = ev.seq;
        if (ev.type === 'stdout' || ev.type === 'stderr') uitvoerSchrijf(String(ev.data).replace(AFSLUITING, '\n'));
        else if (ev.type === 'input_request') {
          if (STAAT.vooraf.length) { var w = STAAT.vooraf.shift(); uitvoerSchrijf(w + '\n'); api('/api/training/run/' + runId + '/input', { method: 'POST', body: { value: w } }).catch(function () {}); }
          else invoerToon(true);
        } else if (ev.type === 'run_error') {
          var m = ev.data; try { m = (typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data).message || ev.data; } catch (e) { /* ruwe tekst */ }
          uitvoerSchrijf('\n' + m + '\n');
        } else if (ev.type === 'end') klaar = true;
      }
      if (klaar || !d.running) return eindeUitvoering();
    } catch (e) {
      uitvoerSchrijf('\n[' + e.message + ']\n'); return eindeUitvoering();
    }
    STAAT.poll = setTimeout(function () { pollEvents(runId); }, 200);
  }

  function eindeUitvoering() {
    if (!STAAT) return;
    stopPoll(); invoerToon(false); STAAT.runId = null;
    var knop = $('knop-run'); if (knop) { knop.disabled = false; knop.textContent = 'Run'; }
    var st = $('tc-stop'); if (st) st.hidden = true;
  }

  async function voerUit() {
    if (!STAAT) return;
    var code = krijgCode();
    if (!code.trim()) { $('tc-uitvoer').textContent = 'Schrijf eerst code.'; return; }
    var knop = $('knop-run'); knop.disabled = true; knop.textContent = 'Bezig…';
    $('tc-uitvoer').textContent = ''; STAAT.seq = 0;
    STAAT.vooraf = ($('tc-vooraf').value || '').split('\n').filter(function (r, i, a) { return r !== '' || i < a.length - 1; });
    if (STAAT.vooraf.length === 1 && STAAT.vooraf[0] === '') STAAT.vooraf = [];
    try {
      var d = await api('/api/training/run/start', { method: 'POST', body: { code: code } });
      STAAT.runId = d.runId; $('tc-stop').hidden = false;
      pollEvents(d.runId);
    } catch (e) { $('tc-uitvoer').textContent = e.message; knop.disabled = false; knop.textContent = 'Run'; }
  }

  async function stopUitvoering() {
    if (!STAAT || !STAAT.runId) return;
    var id = STAAT.runId; uitvoerSchrijf('\n[gestopt]\n');
    try { await api('/api/training/run/' + id + '/cancel', { method: 'POST', body: {} }); } catch (e) { /* stil */ }
    eindeUitvoering();
  }

  // ── Hulp per niveau ────────────────────────────────────────────────────────────────────────
  function hulpPaneel(v, stand) {
    var h = v.hulp; if (!h) return null;
    var p = el('aside', { class: 'tc-hulp', 'aria-label': 'Hulp bij deze vraag' }, el('div', { class: 'tc-hulp-kop', text: 'Hulp' }));
    if (h.hoofdstuk) {
      p.append(el('a', { class: 'tc-hoofdstuk', href: h.hoofdstuk.url, target: '_blank', rel: 'noopener' },
        el('span', { text: 'Cursus' }), el('strong', { text: 'Hoofdstuk ' + h.hoofdstuk.nr + ': ' + h.hoofdstuk.titel + ' ↗' })));
    }
    if (h.kernwoorden && h.kernwoorden.length) {
      p.append(el('div', { class: 'tc-kern' }, el('span', { class: 'muted', text: 'Kernwoorden' }),
        el('div', {}, h.kernwoorden.map(function (k) { return el('code', { class: 'tc-chip', text: k }); }))));
    }
    if (h.checks && h.checks.length) p.append(checklijst(v, h, stand));
    if (h.soort === 'hints' && h.aantalHints) p.append(hintBlok(v, h, stand));
    return p;
  }

  function checklijst(v, h, stand) {
    var laatste = stand && stand.laatste ? stand.laatste : null;
    var gebruikt = stand ? stand.checks || 0 : 0;
    var lijst = el('ul', { class: 'tc-checks', id: 'tc-checks' });
    function teken(res) {
      lijst.replaceChildren();
      h.checks.forEach(function (c) {
        var r = res ? res.filter(function (x) { return x.id === c.id; })[0] : null;
        lijst.append(el('li', { class: r ? (r.ok ? 'ja' : 'nee') : '' },
          el('span', { class: 'vak', 'aria-hidden': 'true', text: r && r.ok ? '☑' : '☐' }),
          el('span', { text: c.label }),
          el('span', { class: 'sr', text: r ? (r.ok ? ' (in orde)' : ' (nog niet in orde)') : ' (nog niet gecheckt)' })));
      });
      var uitvoerFout = res && h.checks.some(function (c) { var r = res.filter(function (x) { return x.id === c.id; })[0]; return r && !r.ok && /^De uitvoer klopt/.test(c.label); });
      if (uitvoerFout) lijst.append(el('li', { class: 'tip' }, el('span', { class: 'vak', 'aria-hidden': 'true', text: '💡' }),
        el('span', { text: 'De uitvoer moet exact kloppen. Staat er extra tekst in je uitvoer, bijvoorbeeld een vraag tussen de haakjes van input()? Of een spatie of hoofdletter te veel of te weinig? Vergelijk met het voorbeeld in de opgave.' })));
    }
    teken(laatste);
    var knop = el('button', { class: 'btn tc-checkknop', type: 'button', id: 'tc-checkknop' });
    var info = el('div', { class: 'muted', style: 'font-size:0.8rem;margin-top:4px;', id: 'tc-checkinfo' });
    var gratis = h.gratisChecks == null ? 1 : h.gratisChecks, pct = h.strafPct == null ? 10 : h.strafPct;
    function label() {
      var kost = gebruikt >= gratis && pct > 0;
      knop.textContent = (gebruikt === 0 ? 'Check mijn code' : 'Check opnieuw') + (gebruikt < gratis ? ' (gratis)' : (pct > 0 ? ' (−' + pct + '% score)' : ''));
      if (gratis === 0) info.textContent = pct > 0 ? 'Elke check kost ' + pct + '% van je score voor deze vraag.' : 'Checken is gratis.';
      else if (gebruikt < gratis) info.textContent = 'Nog ' + (gratis - gebruikt) + ' gratis check' + (gratis - gebruikt > 1 ? 's' : '') + (pct > 0 ? ', daarna kost elke check ' + pct + '% van je score voor deze vraag.' : '.');
      else info.textContent = 'Je gebruikte ' + gebruikt + ' check' + (gebruikt > 1 ? 's' : '') + (pct > 0 ? '. Elke extra check kost ' + pct + '%.' : '.');
      label.kost = kost;
    }
    label();
    knop.addEventListener('click', async function () {
      if (gebruikt >= gratis && pct > 0 && !(await pyConfirm({ title: 'Check gebruiken', body: 'Deze check kost ' + pct + '% van je score voor deze vraag. Toch checken?', confirmLabel: 'Toch checken', cancelLabel: 'Nee' }))) return;
      if (!krijgCode().trim()) { $('tc-melding').textContent = 'Schrijf eerst code voor je checkt.'; return; }
      $('tc-melding').textContent = '';
      knop.disabled = true; knop.textContent = 'Bezig met checken…';
      try {
        var d = await api('/api/training/' + RUN.id + '/check', { method: 'POST', body: { questionId: v.id, code: krijgCode(), dag: RUN.dag || undefined } });
        gebruikt = d.gebruikt; teken(d.resultaat); RUN.hulpGebruikt = d.straf;
      } catch (e) { $('tc-melding').textContent = e.message; }
      knop.disabled = false; label();
    });
    return el('div', { class: 'tc-checkblok' }, el('div', { class: 'tc-hulp-sub', text: 'Checklist' }), lijst, knop, info);
  }

  function hintBlok(v, h, stand) {
    var getoond = stand && stand.getoondeHints ? stand.getoondeHints.slice() : [];
    var lijst = el('div', { id: 'tc-hints' });
    var knop = el('button', { class: 'btn btn-muted', type: 'button', id: 'tc-hintknop' });
    var gratisH = h.gratisHints == null ? 1 : h.gratisHints, pctH = h.strafPct == null ? 10 : h.strafPct;
    function teken() {
      lijst.replaceChildren();
      getoond.forEach(function (t, i) { lijst.append(el('div', { class: 'tc-hint' }, el('strong', { text: 'Hint ' + (i + 1) }), el('div', { text: t }))); });
      var volgende = getoond.length + 1;
      if (volgende > h.aantalHints) { knop.hidden = true; return; }
      knop.hidden = false;
      knop.textContent = 'Toon hint ' + volgende + (volgende <= gratisH ? ' (gratis)' : (pctH > 0 ? ' (−' + pctH + '% score)' : ''));
    }
    knop.addEventListener('click', async function () {
      var nr = getoond.length + 1;
      if (nr > gratisH && pctH > 0 && !(await pyConfirm({ title: 'Hint tonen', body: 'Deze hint kost ' + pctH + '% van je score voor deze vraag. Toch tonen?', confirmLabel: 'Toch tonen', cancelLabel: 'Nee' }))) return;
      knop.disabled = true;
      try {
        var d = await api('/api/training/' + RUN.id + '/hint', { method: 'POST', body: { questionId: v.id, nr: nr, dag: RUN.dag || undefined } });
        getoond.push(d.hint);
      } catch (e) { $('tc-melding').textContent = e.message; }
      knop.disabled = false; teken();
    });
    teken();
    return el('div', { class: 'tc-hintblok' }, el('div', { class: 'tc-hulp-sub', text: 'Hints' }), lijst, knop,
      el('div', { class: 'muted', style: 'font-size:0.8rem;margin-top:4px;', text:
        (gratisH === 0 ? 'Elke hint' : gratisH >= h.aantalHints ? 'Hints zijn' : gratisH === 1 ? 'De eerste hint is gratis, elke volgende hint' : 'De eerste ' + gratisH + ' hints zijn gratis, daarna elke hint')
        + (gratisH >= h.aantalHints || pctH === 0 ? (gratisH >= h.aantalHints ? ' gratis.' : ' is gratis.') : ' kost ' + pctH + '% van je score voor deze vraag.') }));
  }

  // ── Opbouw van het codevraag-scherm ────────────────────────────────────────────────────────
  function bouwCodeVraag(k, v, stand) {
    ruimOp();
    STAAT = { editor: null, textarea: null, runId: null, poll: null, seq: 0, vooraf: [] };
    var host = el('div', { id: 'editor', class: 'monaco-editor-host tc-host', 'aria-label': 'Jouw code' });
    var schil = el('div', { class: 'editor-shell tc-schil' },
      el('div', { class: 'editor-toolbar' },
        el('span', { class: 'dot red' }), el('span', { class: 'dot yellow' }), el('span', { class: 'dot green' }),
        el('div', { class: 'toolbar-spacer' }),
        el('button', { class: 'btn btn-soft small', id: 'tc-stop', type: 'button', hidden: true, onclick: stopUitvoering, text: 'Stop' }),
        el('button', { class: 'btn btn-soft small', id: 'knop-run', type: 'button', onclick: voerUit, text: 'Run' })),
      el('div', { class: 'editor-frame-wrap' },
        el('div', { class: 'editor-frame tc-frame' }, el('div', { id: 'tc-gutter', class: 'custom-gutter tc-goot' }), host),
        el('div', { class: 'tc-statusbalk' }, el('span', { id: 'tc-pos', text: 'Ln 1, Kol 1' }), el('span', { text: '|' }), el('span', { id: 'tc-regels', text: '1 regels' }),
          el('span', { text: '|' }), el('span', { text: 'Python' }), el('span', { text: '|' }), el('span', { text: 'UTF-8' }), el('span', { style: 'margin-left:auto;', text: 'Spaties: 4' }))));
    k.append(el('div', { style: 'font-weight:700;font-size:0.9rem;margin-bottom:6px;', text: 'Jouw code' }), schil);
    maakEditor(host, v.starter || '');

    // Invoer staat boven de uitvoer (zoals overal in de app)
    var veld = el('input', { id: 'tc-invoerveld', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Invoer voor je programma', disabled: true });
    veld.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); stuurInvoer(veld.value); } });
    var knopInvoer = el('button', { class: 'btn btn-soft', type: 'button', id: 'tc-invoerknop', disabled: true, text: 'Stuur input', onclick: function () { stuurInvoer(veld.value); } });
    k.append(el('div', { id: 'tc-wacht', class: 'tc-wacht', hidden: true, role: 'status', text: '⌨️ Je programma wacht op jouw invoer…' }));
    k.append(el('div', { id: 'tc-invoerrij', class: 'tc-invoerrij', hidden: true }, veld, knopInvoer));
    k.append(el('pre', { class: 'tc-uitvoer', id: 'tc-uitvoer', 'aria-live': 'polite' }));
    k.append(el('details', { class: 'tc-vooraf' },
      el('summary', { text: 'Testwaarden vooraf invullen (optioneel)' }),
      el('p', { class: 'muted', style: 'margin:6px 0;font-size:0.84rem;', text: 'Normaal vraagt je programma zelf om invoer, net zoals in echte Python. Wil je dezelfde invoer meerdere keren testen zonder telkens te typen? Zet hier één waarde per regel, in de volgorde van de input()-aanroepen. Laat je dit leeg, dan typ je de invoer gewoon wanneer het programma erom vraagt.' }),
      el('textarea', { id: 'tc-vooraf', class: 'tc-editor tc-invoer', spellcheck: 'false', 'aria-label': 'Testwaarden, één per regel' })));
    k.append(el('div', { class: 'tc-voet' }, el('span'),
      el('button', { class: 'btn btn-primary', id: 'knop-dien-in', type: 'button', onclick: function () { window.dienIn(); }, text: 'Antwoord indienen' })));
  }

  function ruimOp() {
    if (STAAT) {
      stopPoll();
      if (STAAT.runId) api('/api/training/run/' + STAAT.runId + '/cancel', { method: 'POST', body: {} }).catch(function () {});
      if (STAAT.editor) { try { STAAT.editor.dispose(); } catch (e) { /* al weg */ } }
    }
    STAAT = null;
  }

  // Eigen eerdere antwoord terugzetten (editor kan nog laden)
  function zetCode(tekst) {
    var n = 0;
    (function poging() {
      if (STAAT && STAAT.editor) STAAT.editor.setValue(String(tekst));
      else if (STAAT && STAAT.textarea) STAAT.textarea.value = String(tekst);
      else if (STAAT && n++ < 100) setTimeout(poging, 100);
    })();
  }

  function vergrendel() {
    if (!STAAT) return;
    if (STAAT.editor) STAAT.editor.updateOptions({ readOnly: true });
    if (STAAT.textarea) STAAT.textarea.readOnly = true;
    var r = $('knop-run'); if (r) r.disabled = true;
    ['tc-checkknop', 'tc-hintknop'].forEach(function (id) { var b = $(id); if (b) b.disabled = true; });
    stopUitvoering();
  }

  window.TCCode = { bouwCodeVraag: bouwCodeVraag, hulpPaneel: hulpPaneel, krijgCode: krijgCode, zetCode: zetCode, ruimOp: ruimOp, vergrendel: vergrendel };
})();
