/* PyCodeFlow – gedeelde opmaak voor vragen (Markdown + kaders), zelfde als bij toetsen.
 *   PCMd.render(tekst)         → veilige HTML (vet, cursief, onderlijnd, code, lijsten, tabellen, kaders)
 *   PCMd.zetHtml(element, tekst) → zet de opgemaakte tekst in een element
 *   PCMd.toolbar(textarea)     → toolbar + live voorbeeld bij een tekstvak
 * Opmaak: <b>vet</b>, <i>cursief</i>, <u>onderlijnd</u>, `code`, ```python-blok```,
 *         :::tip … :::, :::opgelet … :::, :::kader … :::, :::hint … :::
 * Gebruik zonder marked/DOMPurify: de tekst wordt dan veilig als gewone tekst getoond. */
(function () {
  'use strict';
  var CSS = '' +
    '.pcmd{line-height:1.6;overflow-wrap:anywhere}.pcmd>:first-child{margin-top:0}.pcmd>:last-child{margin-bottom:0}' +
    '.pcmd p{margin:.4em 0}.pcmd ul,.pcmd ol{margin:.4em 0;padding-left:1.4em}' +
    '.pcmd code{background:var(--surface-soft,#f1f5f9);padding:1px 5px;border-radius:4px;font-family:Consolas,Menlo,monospace;font-size:.92em}' +
    '.pcmd pre{background:#1e1e1e;color:#d4d4d4;padding:10px 12px;border-radius:8px;overflow-x:auto;margin:.5em 0}' +
    '.pcmd pre code{background:none;padding:0;color:inherit}' +
    '.pcmd table{border-collapse:collapse;margin:.5em 0}.pcmd th,.pcmd td{border:1px solid var(--border,#cbd5e1);padding:4px 8px}' +
    '.pcmd .info-kader{padding:10px 14px;border-radius:8px;margin:10px 0;font-size:.92em;line-height:1.55;border-left:4px solid}' +
    '.pcmd .info-tip{background:#f0fdf4;border-color:#10b981;color:#065f46}' +
    '.pcmd .info-opgelet{background:#fff7ed;border-color:#f59e0b;color:#92400e}' +
    '.pcmd .info-kader-blauw{background:#eff6ff;border-color:#3b82f6;color:#1e40af}' +
    '.pcmd .info-hint{background:#faf5ff;border-color:#8b5cf6;color:#5b21b6}' +
    '.pcmd .info-kader::before{font-weight:800;display:block;margin-bottom:3px}' +
    '.pcmd .info-tip::before{content:"💡 Tip"}.pcmd .info-opgelet::before{content:"⚠️ Opgelet"}' +
    '.pcmd .info-kader-blauw::before{content:"📌 Extra informatie"}.pcmd .info-hint::before{content:"❓ Hint"}' +
    '.pcmd-bar{display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding:6px 8px;background:var(--surface-soft,#f8fafc);border:1.5px solid var(--border,#cbd5e1);border-radius:8px 8px 0 0;border-bottom:none;margin-top:4px}' +
    '.pcmd-bar+textarea{border-radius:0 0 8px 8px!important;margin-top:0!important}' +
    '.pcmd-b{min-width:28px;height:28px;padding:0 7px;border:1px solid var(--border,#cbd5e1);border-radius:5px;background:var(--surface,#fff);color:var(--text,#0f172a);font-size:.8rem;font-weight:700;cursor:pointer;line-height:1}' +
    '.pcmd-b:hover{background:var(--primary-soft,#e0f2fe);border-color:var(--primary,#0ea5e9)}' +
    '.pcmd-b.aan{background:var(--primary,#0ea5e9);color:#fff}' +
    '.pcmd-sep{width:1px;height:20px;background:var(--border,#cbd5e1);margin:0 2px}' +
    '.pcmd-voorbeeld{display:none;margin-top:6px;padding:10px 14px;background:var(--surface-soft,#f8fafc);border:1.5px dashed var(--border,#cbd5e1);border-radius:8px}' +
    '.pcmd-voorbeeld.aan{display:block}.pcmd-voorbeeld .pcmd-kop{font-size:.72rem;color:var(--muted,#64748b);font-weight:700;margin-bottom:4px}';
  function zetCss() {
    if (document.getElementById('pcmd-css')) return;
    var s = document.createElement('style'); s.id = 'pcmd-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var KADERS = { tip: 'info-tip', opgelet: 'info-opgelet', kader: 'info-kader-blauw', hint: 'info-hint' };
  // Bestaande vragen bevatten gewone tekst als "<stad>", "2 * 3" of "mijn_var". Die mogen NIET als
  // opmaak gelezen worden. Daarom zijn vet/cursief/onderlijnd expliciete tags (<b>, <i>, <u>) en worden
  // * _ en een # aan het begin van een regel buiten code als gewone tekens behandeld.
  var TOEGELATEN = /<(?!\/?(?:b|i|u|em|strong|span|br|sub|sup|mark|kbd)(?:\s|>|\/))/g;
  function beschermTekst(t) {
    return t.replace(TOEGELATEN, '&lt;').replace(/\*/g, '&#42;').replace(/_/g, '&#95;').replace(/^#/gm, '&#35;');
  }
  function voorbewerk(t) {
    var delen = String(t).split(/(```[\s\S]*?```|`[^`\n]*`)/);
    t = delen.map(function (d, i) { return i % 2 ? d : beschermTekst(d); }).join('');
    return t.replace(/:::(\w+)\n([\s\S]*?):::/g, function (_, type, inhoud) {
      return '<div class="info-kader ' + (KADERS[type] || 'info-kader-blauw') + '">\n\n' + inhoud.trim() + '\n\n</div>';
    });
  }
  function render(tekst) {
    tekst = String(tekst == null ? '' : tekst);
    if (!window.marked || !window.DOMPurify) return esc(tekst).replace(/\n/g, '<br>');   // nooit ongezuiverde HTML
    var html = window.marked.parse(voorbewerk(tekst), { breaks: true, gfm: true });
    return window.DOMPurify.sanitize(html, { ADD_ATTR: ['style', 'target'], FORBID_TAGS: ['script', 'iframe', 'style', 'form', 'input', 'object', 'embed'] });
  }
  function zetHtml(element, tekst) { zetCss(); element.classList.add('pcmd'); element.innerHTML = render(tekst); }

  function toolbar(ta, opties) {
    zetCss(); opties = opties || {};
    var bar = document.createElement('div'); bar.className = 'pcmd-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Opmaak');
    var voorbeeld = document.createElement('div'); voorbeeld.className = 'pcmd-voorbeeld';
    var kop = document.createElement('div'); kop.className = 'pcmd-kop'; kop.textContent = 'Zo ziet de leerling het';
    var inhoud = document.createElement('div'); inhoud.className = 'pcmd'; voorbeeld.append(kop, inhoud);
    function ververs() { if (voorbeeld.classList.contains('aan')) inhoud.innerHTML = render(ta.value); }
    function omring(voor, na, standaard) {
      var a = ta.selectionStart, b = ta.selectionEnd; var sel = ta.value.substring(a, b) || standaard || 'tekst';
      ta.setRangeText(voor + sel + na, a, b, 'select'); ta.focus(); ta.selectionStart = a + voor.length; ta.selectionEnd = a + voor.length + sel.length; ververs();
    }
    function regel(prefix) {
      var a = ta.selectionStart; var s = ta.value.lastIndexOf('\n', a - 1) + 1; ta.setRangeText(prefix, s, s, 'end'); ta.focus(); ververs();
    }
    function blok(open, sluit, standaard) {
      var a = ta.selectionStart, b = ta.selectionEnd; var sel = ta.value.substring(a, b) || standaard;
      var vooraf = a > 0 && ta.value[a - 1] !== '\n' ? '\n' : '';
      ta.setRangeText(vooraf + open + '\n' + sel + '\n' + sluit + '\n', a, b, 'end'); ta.focus(); ververs();
    }
    function knop(label, titel, actie, stijl) {
      var k = document.createElement('button'); k.type = 'button'; k.className = 'pcmd-b'; k.title = titel; k.setAttribute('aria-label', titel);
      k.innerHTML = label; if (stijl) k.style.cssText = stijl; k.addEventListener('click', actie); bar.appendChild(k); return k;
    }
    function sep() { var s = document.createElement('span'); s.className = 'pcmd-sep'; bar.appendChild(s); }
    knop('<b>B</b>', 'Vet', function () { omring('<b>', '</b>'); });
    knop('<i>I</i>', 'Cursief', function () { omring('<i>', '</i>'); });
    knop('<u>U</u>', 'Onderlijnd', function () { omring('<u>', '</u>'); });
    knop('‹›', 'Code in de zin (bv. print)', function () { omring('`', '`', 'print()'); });
    knop('&lt;/&gt;', 'Codeblok', function () { blok('```python', '```', 'print("Hallo")'); });
    sep();
    knop('•', 'Lijst', function () { regel('- '); });
    knop('1.', 'Genummerde lijst', function () { regel('1. '); });
    sep();
    knop('💡', 'Tip (groen kader)', function () { blok(':::tip', ':::', 'Schrijf hier je tip…'); });
    knop('⚠️', 'Opgelet (oranje kader)', function () { blok(':::opgelet', ':::', 'Schrijf hier waarop de leerling moet letten…'); });
    knop('📌', 'Extra informatie (blauw kader)', function () { blok(':::kader', ':::', 'Schrijf hier extra informatie…'); });
    sep();
    [['#dc2626', 'Rood'], ['#16a34a', 'Groen'], ['#2563eb', 'Blauw']].forEach(function (c) {
      knop('A', 'Tekstkleur ' + c[1].toLowerCase(), function () { omring('<span style="color:' + c[0] + '">', '</span>'); }, 'color:' + c[0]);
    });
    sep();
    var oog = knop('👁 Voorbeeld', 'Toon hoe de leerling de tekst ziet', function () {
      var aan = voorbeeld.classList.toggle('aan'); oog.classList.toggle('aan', aan); ververs();
    });
    oog.style.marginLeft = 'auto';
    ta.parentNode.insertBefore(bar, ta); ta.parentNode.insertBefore(voorbeeld, ta.nextSibling);
    ta.addEventListener('input', ververs);
    return { ververs: ververs, bar: bar };
  }
  window.PCMd = { _voorbewerk: voorbewerk, render: render, zetHtml: zetHtml, toolbar: toolbar, css: zetCss };
})();
