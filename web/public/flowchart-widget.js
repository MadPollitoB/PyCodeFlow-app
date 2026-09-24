/* ════════════════════════════════════════════════════════════════════════════
   flowchart-widget.js — Sprint 63.

   Herbruikbare, INSTANTIEERBARE versie van de stroomdiagram-builder die al bestond
   op de cursus-site (stroomdiagram-builder.js) — dat was een losstaande pagina met
   hardcoded document.getElementById()-verwijzingen, enkel bruikbaar één keer per
   pagina en zonder JSON-opslag (enkel PNG-export). Deze versie kan meermaals op
   dezelfde pagina gemount worden en kan haar toestand opslaan/herladen als JSON —
   nodig om een stroomdiagram als vraagstelling én als leerlingantwoord te bewaren.

   Bewust een vereenvoudigde versie t.o.v. het origineel: geen knikpunten op pijlen
   (rechte lijnen), geen in-/uitzoomen, geen verslepbaar palet, geen PNG-export. De
   kern — vormen slepen, verbinden met pijlen, Ja/Nee/eigen labels, verwijderen — is
   wel volledig aanwezig, plus (nieuw) JSON-opslag/-herlading en een
   weergave-alleen-modus.

   Gebruik:
     const fc = FlowchartWidget.mount(containerEl, { editable: true, data: null });
     const json = fc.getData();
     fc.destroy();
     FlowchartWidget.mount(containerEl, { editable: false, data: opgeslagenJson });
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var svgNS = 'http://www.w3.org/2000/svg';

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function mount(container, opts) {
    opts = opts || {};
    var editable = opts.editable !== false;
    var onChange = opts.onChange || function () {};

    container.innerHTML = '';
    container.classList.add('fcw-root');
    var arrowheadId = 'fcw-arrowhead-' + (mount._n = (mount._n || 0) + 1);
    if (editable) {
      container.innerHTML =
        '<div class="fcw-toolbar">' +
          '<div class="fcw-palette">' +
            '<div class="fcw-palette-item" draggable="true" data-shape="term">▭ Start/Einde</div>' +
            '<div class="fcw-palette-item" draggable="true" data-shape="proc">▭ Stap</div>' +
            '<div class="fcw-palette-item" draggable="true" data-shape="io">▱ In-/Uitvoer</div>' +
            '<div class="fcw-palette-item" draggable="true" data-shape="dec">◇ Beslissing</div>' +
            '<div class="fcw-palette-item" draggable="true" data-shape="text">🄰 Tekst</div>' +
          '</div>' +
          '<div class="fcw-toolbar-actions">' +
            '<button type="button" class="fcw-arrow-toggle">➜ Pijl-modus: uit</button>' +
            '<span class="fcw-hint">Sleep een vorm op het werkblad. In pijl-modus: klik twee vormen na elkaar om te verbinden. Klik een pijl aan om een label te zetten/verwijderen.</span>' +
          '</div>' +
        '</div>' +
        '<div class="fcw-canvas-wrap"><div class="fcw-canvas"></div>' +
        '<svg class="fcw-arrow-layer"><defs><marker id="' + arrowheadId + '" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#2d3b52"/></marker></defs></svg></div>';
    } else {
      container.innerHTML = '<div class="fcw-canvas-wrap fcw-readonly"><div class="fcw-canvas"></div><svg class="fcw-arrow-layer"></svg></div>';
    }

    var canvas = container.querySelector('.fcw-canvas');
    var svg = container.querySelector('.fcw-arrow-layer');
    var blocks = [];   // {id, el, shape}
    var arrows = [];   // {a, b, line, hit, label:{el,text}}
    var idCounter = 0;
    var arrowMode = false;
    var arrowSource = null;
    var listeners = []; // voor destroy()

    function on(el, ev, fn) { el.addEventListener(ev, fn); listeners.push([el, ev, fn]); }

    function halfOf(el) { return { w: el.offsetWidth / 2, h: el.offsetHeight / 2 }; }
    function center(el) { return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 }; }

    function autosizeDecision(el) {
      var span = el.querySelector('.fcw-block-text');
      var len = (span.textContent || '').length;
      var size = Math.max(110, Math.min(220, 90 + len * 3));
      el.style.width = size + 'px';
      el.style.height = size + 'px';
    }

    function createBlock(shape, x, y, text, id) {
      id = id || ('b' + (idCounter++));
      var el = document.createElement('div');
      el.className = 'fcw-block fcw-shape-' + shape;
      el.dataset.shape = shape; el.dataset.id = id;
      var startTekst = text != null ? text : (shape === 'term' ? 'Start' : shape === 'dec' ? 'Ja/nee?' : shape === 'io' ? 'Vraag …' : shape === 'text' ? 'Tekst' : 'Stap');
      var delBtn = editable ? '<button type="button" class="fcw-block-del" title="Verwijderen">✕</button>' : '';
      el.innerHTML = delBtn + '<div class="fcw-block-text"' + (editable ? ' contenteditable="true"' : '') + '>' + escapeHtml(startTekst) + '</div>';
      canvas.appendChild(el);
      if (shape === 'dec') autosizeDecision(el);
      el.style.left = (x - el.offsetWidth / 2) + 'px';
      el.style.top = (y - el.offsetHeight / 2) + 'px';
      blocks.push({ id: id, el: el, shape: shape });
      if (editable) wireBlock(el, shape);
      return el;
    }

    function deleteBlock(el) {
      arrows = arrows.filter(function (ar) {
        if (ar.a === el || ar.b === el) {
          if (ar.label && ar.label.el) ar.label.el.remove();
          ar.line.remove(); ar.hit.remove();
          return false;
        }
        return true;
      });
      blocks = blocks.filter(function (b) { return b.el !== el; });
      el.remove();
      onChange();
    }

    function wireBlock(el, shape) {
      var dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
      var delBtn = el.querySelector('.fcw-block-del');
      if (delBtn) on(delBtn, 'click', function (e) { e.stopPropagation(); deleteBlock(el); });

      var textEl = el.querySelector('.fcw-block-text');
      if (textEl) on(textEl, 'input', function () { if (shape === 'dec') autosizeDecision(el); redrawArrows(); onChange(); });

      on(el, 'mousedown', function (e) {
        if (e.target.isContentEditable || (delBtn && e.target === delBtn)) return;
        if (arrowMode) {
          e.preventDefault();
          if (!arrowSource) { arrowSource = el; el.classList.add('fcw-selected'); }
          else if (arrowSource !== el) {
            addArrow(arrowSource, el);
            arrowSource.classList.remove('fcw-selected'); arrowSource = null;
          }
          return;
        }
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        origLeft = el.offsetLeft; origTop = el.offsetTop;
        e.preventDefault();
      });
      on(document, 'mousemove', function (e) {
        if (!dragging) return;
        el.style.left = (origLeft + (e.clientX - startX)) + 'px';
        el.style.top = (origTop + (e.clientY - startY)) + 'px';
        redrawArrows();
      });
      on(document, 'mouseup', function () { if (dragging) { dragging = false; onChange(); } });
    }

    function edgePoint(cx, cy, halfW, halfH, tx, ty) {
      var dx = tx - cx, dy = ty - cy;
      if (dx === 0 && dy === 0) return { x: cx, y: cy };
      var scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
      var scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
      var scale = Math.min(scaleX, scaleY);
      return { x: cx + dx * scale, y: cy + dy * scale };
    }

    function addArrow(a, b, labelText) {
      var line = document.createElementNS(svgNS, 'polyline');
      line.setAttribute('class', 'fcw-arrow-visible');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#2d3b52'); line.setAttribute('stroke-width', '2.5');
      line.setAttribute('marker-end', 'url(#' + arrowheadId + ')');
      var hit = document.createElementNS(svgNS, 'polyline');
      hit.setAttribute('fill', 'none'); hit.setAttribute('class', 'fcw-arrow-hit');
      svg.appendChild(line); svg.appendChild(hit);
      var arrowObj = { a: a, b: b, line: line, hit: hit, label: null };
      if (editable) on(hit, 'click', function () { selectArrowForLabel(arrowObj); });
      arrows.push(arrowObj);
      if (labelText) addLabelToArrow(arrowObj, labelText);
      redrawArrows();
      onChange();
      return arrowObj;
    }

    function selectArrowForLabel(ar) {
      if (ar.label) { removeLabel(ar); return; }
      var keuze = prompt('Label op deze pijl (bv. Ja, Nee) — leeg laten annuleert:', '');
      if (keuze) addLabelToArrow(ar, keuze);
    }

    function removeLabel(ar) {
      if (ar.label && ar.label.el) ar.label.el.remove();
      ar.label = null;
      onChange();
    }

    function addLabelToArrow(ar, text) {
      var pts = arrowPath(ar);
      var mid = pts[Math.floor((pts.length - 1) / 2)] || pts[0];
      var el = document.createElement('div');
      el.className = 'fcw-arrow-label';
      el.textContent = text;
      el.style.left = (mid.x - 14) + 'px'; el.style.top = (mid.y - 22) + 'px';
      canvas.appendChild(el);
      ar.label = { el: el, text: text };
      onChange();
    }

    function arrowPath(ar) {
      var c1 = center(ar.a), c2 = center(ar.b);
      var halfA = halfOf(ar.a), halfB = halfOf(ar.b);
      var p1 = edgePoint(c1.x, c1.y, halfA.w, halfA.h, c2.x, c2.y);
      var p2 = edgePoint(c2.x, c2.y, halfB.w, halfB.h, c1.x, c1.y);
      return [p1, p2];
    }

    function redrawArrows() {
      arrows.forEach(function (ar) {
        var pts = arrowPath(ar);
        var attr = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
        ar.line.setAttribute('points', attr);
        ar.hit.setAttribute('points', attr);
        if (ar.label && ar.label.el) {
          var mid = pts[Math.floor((pts.length - 1) / 2)] || pts[0];
          ar.label.el.style.left = (mid.x - 14) + 'px';
          ar.label.el.style.top = (mid.y - 22) + 'px';
        }
      });
    }

    function deleteArrow(ar) {
      if (ar.label && ar.label.el) ar.label.el.remove();
      ar.line.remove(); ar.hit.remove();
      arrows = arrows.filter(function (x) { return x !== ar; });
      onChange();
    }

    if (editable) {
      container.querySelectorAll('.fcw-palette-item').forEach(function (item) {
        on(item, 'dragstart', function (e) { e.dataTransfer.setData('shape', item.dataset.shape); });
      });
      on(canvas, 'dragover', function (e) { e.preventDefault(); });
      on(canvas, 'drop', function (e) {
        e.preventDefault();
        var shape = e.dataTransfer.getData('shape');
        if (!shape) return;
        var rect = canvas.getBoundingClientRect();
        createBlock(shape, e.clientX - rect.left, e.clientY - rect.top);
        onChange();
      });

      var toggleBtn = container.querySelector('.fcw-arrow-toggle');
      on(toggleBtn, 'click', function () {
        arrowMode = !arrowMode;
        toggleBtn.textContent = arrowMode ? '➜ Pijl-modus: aan' : '➜ Pijl-modus: uit';
        toggleBtn.classList.toggle('fcw-active', arrowMode);
        if (arrowSource) { arrowSource.classList.remove('fcw-selected'); arrowSource = null; }
      });

      var laatstGeklikteArrow = null;
      container.addEventListener('click', function (e) {
        arrows.forEach(function (ar) { if (e.target === ar.hit) laatstGeklikteArrow = ar; });
      });
      on(document, 'keydown', function (e) {
        var editing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable);
        if ((e.key === 'Delete' || e.key === 'Backspace') && laatstGeklikteArrow && !editing) {
          deleteArrow(laatstGeklikteArrow);
          laatstGeklikteArrow = null;
        }
      });
    }

    // ── JSON-opslag/-herlading (dit ontbrak volledig in het origineel) ──
    function getData() {
      return JSON.stringify({
        v: 1,
        blocks: blocks.map(function (b) {
          return {
            id: b.id, shape: b.shape,
            x: b.el.offsetLeft, y: b.el.offsetTop,
            w: b.el.offsetWidth, h: b.el.offsetHeight,
            text: (b.el.querySelector('.fcw-block-text') || {}).textContent || '',
          };
        }),
        arrows: arrows.map(function (ar) {
          return { from: ar.a.dataset.id, to: ar.b.dataset.id, label: ar.label ? ar.label.text : null };
        }),
      });
    }

    function setData(jsonStr) {
      var data;
      try { data = JSON.parse(jsonStr || '{}'); } catch (e) { data = {}; }
      canvas.innerHTML = '';
      var oldPolylines = svg.querySelectorAll('polyline');
      oldPolylines.forEach(function (n) { n.remove(); });
      blocks = []; arrows = [];
      var byId = {};
      (data.blocks || []).forEach(function (b) {
        var el = createBlock(b.shape, b.x + (b.w || 100) / 2, b.y + (b.h || 60) / 2, b.text, b.id);
        el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
        if (b.w) el.style.width = b.w + 'px';
        if (b.h) el.style.height = b.h + 'px';
        byId[b.id] = el;
      });
      (data.arrows || []).forEach(function (a) {
        if (byId[a.from] && byId[a.to]) addArrow(byId[a.from], byId[a.to], a.label);
      });
      redrawArrows();
    }

    if (opts.data) setData(opts.data);

    function destroy() {
      listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
      container.innerHTML = '';
    }

    return { getData: getData, setData: setData, destroy: destroy, isEmpty: function () { return blocks.length === 0; } };
  }

  global.FlowchartWidget = { mount: mount };
})(window);
