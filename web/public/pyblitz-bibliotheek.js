'use strict';
// v151 — PyBlitz-bibliotheek en editor (leerkracht). Alles via textContent/createElement.
(function () {
  const { h } = window.PyBlitzUI || (function () {
    function h(tag, attrs, ...kids) {
      const el = document.createElement(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
      for (const c of kids.flat()) if (c != null && c !== false) el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      return el;
    }
    return { h };
  })();
  const $ = (id) => document.getElementById(id);
  const LETTERS = ['A', 'B', 'C', 'D'];

  let _csrf = null;
  async function csrf() {
    if (_csrf) return _csrf;
    try { const r = await fetch('/api/csrf-token', { credentials: 'same-origin' }); if (r.ok) _csrf = (await r.json()).token; } catch { /* zie fout bij opslaan */ }
    return _csrf || '';
  }
  async function api(url, opt = {}) {
    const metBody = opt.body !== undefined;
    const r = await fetch(url, {
      method: opt.method || 'GET', credentials: 'same-origin',
      headers: { ...(metBody ? { 'Content-Type': 'application/json' } : {}), ...(opt.method && opt.method !== 'GET' ? { 'X-CSRF-Token': await csrf() } : {}) },
      body: metBody ? JSON.stringify(opt.body) : undefined,
    });
    let d = null; try { d = await r.json(); } catch { /* geen JSON */ }
    if (!r.ok) throw new Error((d && d.error) || `Fout ${r.status}`);
    return d;
  }
  function melding(tekst, soort) {
    const m = $('pbl-melding'); m.textContent = '';
    if (tekst) m.appendChild(h('div', { class: soort === 'fout' ? 'pbl-fout' : 'pbl-fouten', text: tekst }));
    if (tekst) m.scrollIntoView({ block: 'nearest' });
  }
  function toonScherm(naam) {
    for (const id of ['pbl-lijst-scherm', 'pbl-editor-scherm', 'pbl-historiek-scherm']) $(id).classList.toggle('hidden', id !== naam);
    melding('');
  }
  const datum = (t) => t ? new Date(t).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : '–';

  // ── lijst ────────────────────────────────────────────────────────────────
  async function laadLijst() {
    toonScherm('pbl-lijst-scherm');
    const raster = $('pbl-raster'); raster.textContent = '';
    let sets;
    try { sets = (await api('/api/pyblitz/sets')).sets; } catch (e) { return melding(e.message, 'fout'); }
    if (!sets.length) raster.appendChild(h('p', { class: 'muted', text: 'Nog geen PyBlitz. Maak er een, of importeer er een via JSON of Excel.' }));
    sets.forEach(s => raster.appendChild(h('div', { class: 'pbl-kaart' },
      h('h3', { text: s.name }),
      s.description ? h('div', { class: 'pbl-meta', text: s.description }) : null,
      h('div', { class: 'pbl-meta', text: `${s.questionCount} vragen · ${s.plays}× gespeeld` + (s.lastPlayed ? ` · laatst ${datum(s.lastPlayed)}` : '') }),
      h('div', { class: 'pbl-rij' },
        h('button', { class: 'btn btn-primary small', type: 'button', onclick: () => bewerk(s.id), text: 'Bewerken' }),
        h('a', { class: 'btn btn-soft small', href: `/api/pyblitz/sets/${encodeURIComponent(s.id)}/export`, text: 'Exporteren' }),
        h('button', { class: 'btn btn-muted small', type: 'button', onclick: () => verwijder(s), text: 'Verwijderen' })))));
  }
  async function verwijder(s) {
    if (!await pyConfirm({ title: 'PyBlitz verwijderen', body: `"${s.name}" verwijderen? De bewaarde resultaten van eerdere spellen blijven bestaan.`, confirmLabel: 'Verwijderen', danger: true })) return;
    try { await api(`/api/pyblitz/sets/${encodeURIComponent(s.id)}`, { method: 'DELETE' }); laadLijst(); } catch (e) { melding(e.message, 'fout'); }
  }

  // ── editor ───────────────────────────────────────────────────────────────
  let set = null;            // { id|null, name, description, questions: [...] }
  function leegVraag() { return { type: 'mc', text: '', code: '', error: '', imageId: null, options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }], correct: 0, seconds: 20, points: 'standaard', explanation: '' }; }
  async function bewerk(id) {
    try { const d = (await api(`/api/pyblitz/sets/${encodeURIComponent(id)}`)).set; set = { id: d.id, name: d.name, description: d.description || '', questions: d.questions }; }
    catch (e) { return melding(e.message, 'fout'); }
    set.questions.forEach(naarEditorVorm);
    toonEditor();
  }
  function naarEditorVorm(q) { if (q.type === 'mc') while (q.options.length < 4) q.options.push({ text: '' }); }
  function nieuw() { set = { id: null, name: '', description: '', questions: [leegVraag()] }; toonEditor(); }

  function klaarVoorOpslaan() {
    return {
      name: set.name, description: set.description,
      questions: set.questions.map(q => ({
        ...q, options: q.type === 'tf' ? [] : q.options.filter(o => o.text.trim() !== '' || true).map(o => ({ text: o.text, ...(o.code ? { code: true } : {}) })),
      })).map(q => {
        if (q.type === 'mc') { // lege laatste opties weglaten (2–4 toegestaan); de index van het juiste antwoord blijft kloppen
          const o = q.options.slice(); while (o.length > 2 && !o[o.length - 1].text.trim()) o.pop(); q.options = o;
        }
        return q;
      }),
    };
  }
  async function bewaar(sluit) {
    melding('');
    try {
      const d = await api(`/api/pyblitz/sets/${set.id ? encodeURIComponent(set.id) : 'nieuw'}`, { method: 'PUT', body: klaarVoorOpslaan() });
      set.id = d.id;
      if (sluit) return laadLijst();
      melding('Opgeslagen ✓');
    } catch (e) { melding(e.message, 'fout'); }
  }
  function verkleinAfbeelding(bestand) {
    return new Promise((res, rej) => {
      if (!/^image\/(png|jpe?g|webp)$/.test(bestand.type)) return rej(new Error('Alleen PNG, JPEG of WebP.'));
      const url = URL.createObjectURL(bestand); const img = new Image();
      img.onload = () => {
        const max = 1200; const f = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85, data = c.toDataURL('image/jpeg', q);
        while (data.length > 760000 && q > 0.4) { q -= 0.15; data = c.toDataURL('image/jpeg', q); }
        res(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Kon de afbeelding niet lezen.')); };
      img.src = url;
    });
  }

  function vraagKaart(q, i) {
    const veld = (label, el) => h('label', { class: 'pbl-veld' }, h('span', { class: 'pbl-meta', text: label }), el);
    const inp = (waarde, max, onin, extra) => { const e = h('input', { type: 'text', maxlength: max, value: waarde, ...(extra || {}) }); e.addEventListener('input', () => onin(e.value)); return e; };
    const ta = (waarde, rijen, max, onin, mono) => { const e = h('textarea', { rows: rijen, maxlength: max, class: mono ? 'pbl-mono' : '', spellcheck: mono ? 'false' : 'true' }); e.value = waarde; e.addEventListener('input', () => onin(e.value)); return e; };
    const opties = q.type === 'tf'
      ? h('div', { class: 'pbl-opties' }, [0, 1].map(k => h('label', { class: 'pbl-optie' }, h('input', { type: 'radio', name: 'juist' + i, checked: q.correct === k, onchange: () => { q.correct = k; } }), k === 0 ? 'Juist' : 'Onjuist')))
      : h('div', { class: 'pbl-opties' }, q.options.map((o, k) => {
          const veldEl = h('textarea', { rows: o.code || String(o.text).includes('\n') ? 3 : 1, maxlength: 300, class: 'pbl-opt-tekst' + (o.code ? ' pbl-mono' : ''), spellcheck: 'false',
            placeholder: k < 2 ? 'Verplicht — mag uit meerdere regels bestaan' : 'Optioneel', 'aria-label': `Antwoord ${LETTERS[k]}` });
          veldEl.value = o.text;
          const codeBox = h('input', { type: 'checkbox', checked: !!o.code, 'aria-label': `Antwoord ${LETTERS[k]} als code tonen` });
          codeBox.addEventListener('change', () => { o.code = codeBox.checked; veldEl.classList.toggle('pbl-mono', o.code); veldEl.rows = o.code ? 3 : 1; });
          veldEl.addEventListener('input', () => {
            o.text = veldEl.value;
            if (veldEl.value.includes('\n') && !o.code) { o.code = true; codeBox.checked = true; veldEl.classList.add('pbl-mono'); }
            veldEl.rows = Math.min(6, Math.max(o.code ? 3 : 1, veldEl.value.split('\n').length));
          });
          return h('div', { class: 'pbl-optie pbl-optie-blok' },
            h('input', { type: 'radio', name: 'juist' + i, checked: q.correct === k, onchange: () => { q.correct = k; }, 'aria-label': `Antwoord ${LETTERS[k]} is juist` }),
            h('b', { text: LETTERS[k] }), veldEl,
            h('label', { class: 'pbl-codevink', title: 'Toon dit antwoord als code (lettertype met vaste breedte, regels behouden)' }, codeBox, 'code'));
        }));
    const afb = h('div', { class: 'pbl-rij' });
    if (q.imageId) {
      afb.append(h('img', { src: '/api/pyblitz/image/' + encodeURIComponent(q.imageId), alt: 'Afbeelding bij de vraag', style: 'max-height:90px;border-radius:8px;border:1px solid #e4ddd0' }),
        h('button', { class: 'btn btn-muted small', type: 'button', onclick: () => { q.imageId = null; hertekenVragen(); }, text: 'Afbeelding verwijderen' }));
    } else {
      const f = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden' });
      f.addEventListener('change', async () => {
        if (!f.files[0]) return;
        try { const data = await verkleinAfbeelding(f.files[0]); const d = await api('/api/pyblitz/image', { method: 'POST', body: { base64: data } }); q.imageId = d.id; hertekenVragen(); }
        catch (e) { melding(e.message, 'fout'); }
      });
      afb.append(f, h('button', { class: 'btn btn-soft small', type: 'button', onclick: () => f.click(), text: '🖼 Afbeelding toevoegen' }));
    }
    const sel = (opts, waarde, onch, label) => { const s = h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, selected: v === waarde, text: t }))); s.addEventListener('change', () => onch(s.value)); return s; };
    return h('div', { class: 'pbl-vraag' },
      h('div', { class: 'pbl-rij' }, h('b', { text: `Vraag ${i + 1}` }), h('span', { style: 'flex:1' }),
        h('button', { class: 'btn btn-muted small', type: 'button', disabled: i === 0, onclick: () => { set.questions.splice(i - 1, 0, set.questions.splice(i, 1)[0]); hertekenVragen(); }, text: '↑', title: 'Omhoog' }),
        h('button', { class: 'btn btn-muted small', type: 'button', disabled: i === set.questions.length - 1, onclick: () => { set.questions.splice(i + 1, 0, set.questions.splice(i, 1)[0]); hertekenVragen(); }, text: '↓', title: 'Omlaag' }),
        h('button', { class: 'btn btn-muted small', type: 'button', onclick: () => proefStarten(i), text: '▶ Vanaf hier', title: 'Probeer de quiz vanaf deze vraag' }),
        h('button', { class: 'btn btn-muted small', type: 'button', onclick: () => { set.questions.splice(i + 1, 0, JSON.parse(JSON.stringify({ ...q, id: undefined }))); hertekenVragen(); }, text: 'Dupliceer' }),
        h('button', { class: 'btn btn-muted small', type: 'button', onclick: () => { set.questions.splice(i, 1); hertekenVragen(); }, text: 'Verwijder' })),
      veld('Vraag (tekst)', ta(q.text, 2, 400, v => { q.text = v; })),
      veld('Python-code (optioneel)', ta(q.code, 5, 1500, v => { q.code = v; }, true)),
      veld('Foutmelding (optioneel)', ta(q.error, 3, 1000, v => { q.error = v; }, true)),
      afb,
      h('div', { class: 'pbl-rij' },
        sel([['mc', 'Meerkeuze (2–4 opties)'], ['tf', 'Juist / onjuist']], q.type, (v) => { q.type = v; q.correct = 0; hertekenVragen(); }, 'Soort vraag'),
        sel([['standaard', 'Punten: standaard'], ['dubbel', 'Punten: dubbel'], ['geen', 'Punten: geen']], q.points, v => { q.points = v; }, 'Punten'),
        h('label', { class: 'pbl-optie' }, 'Tijd (sec)', (() => { const n = h('input', { type: 'number', min: 5, max: 120, value: q.seconds, style: 'width:80px' }); n.addEventListener('input', () => { q.seconds = Number(n.value) || 20; }); return n; })())),
      h('div', { class: 'pbl-meta', text: 'Duid het juiste antwoord aan:' }), opties,
      veld('Uitleg na de vraag (optioneel)', inp(q.explanation || '', 300, v => { q.explanation = v; })));
  }
  function proefStarten(vanaf) {
    melding('');
    if (!window.pbProef) return melding('De proefmodus kon niet geladen worden. Herlaad de pagina.', 'fout');
    window.pbProef.open(klaarVoorOpslaan(), vanaf, (tekst) => melding(tekst, 'fout'));
  }
  function hertekenVragen() {
    const lijst = $('pbl-vragen'); lijst.textContent = '';
    set.questions.forEach((q, i) => lijst.appendChild(vraagKaart(q, i)));
    const t = $('pbl-vraagtelling'); if (t) t.textContent = `${set.questions.length} vragen`;
  }
  function toonEditor() {
    const root = $('pbl-editor-scherm'); root.textContent = '';
    const naam = h('input', { type: 'text', maxlength: 80, value: set.name, placeholder: 'Naam van de PyBlitz', 'aria-label': 'Naam', style: 'width:100%;font-size:18px;padding:8px 10px;box-sizing:border-box' });
    naam.addEventListener('input', () => { set.name = naam.value; });
    const om = h('input', { type: 'text', maxlength: 300, value: set.description, placeholder: 'Omschrijving (optioneel)', 'aria-label': 'Omschrijving', style: 'width:100%;padding:8px 10px;box-sizing:border-box' });
    om.addEventListener('input', () => { set.description = om.value; });
    root.append(
      h('div', { class: 'pbl-rij', style: 'margin-bottom:12px' },
        h('button', { class: 'btn btn-muted', type: 'button', onclick: laadLijst, text: '← Terug' }),
        h('span', { id: 'pbl-vraagtelling', class: 'pbl-meta' }), h('span', { style: 'flex:1' }),
        h('button', { class: 'btn btn-muted', type: 'button', onclick: () => proefStarten(0), text: '▶ Uitproberen', title: 'Speel deze quiz proef: links wat jij/de beamer toont, rechts wat de leerling op zijn gsm ziet' }),
        h('button', { class: 'btn btn-soft', type: 'button', onclick: () => bewaar(false), text: 'Opslaan' }),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => bewaar(true), text: 'Opslaan en sluiten' })),
      h('div', { style: 'display:grid;gap:8px;margin-bottom:14px' }, naam, om),
      h('div', { id: 'pbl-vragen' }),
      h('div', { class: 'pbl-rij' }, h('button', { class: 'btn btn-soft', type: 'button', onclick: () => { set.questions.push(leegVraag()); hertekenVragen(); }, text: '+ Vraag toevoegen' })));
    toonScherm('pbl-editor-scherm');
    hertekenVragen();
  }

  // ── import ───────────────────────────────────────────────────────────────
  async function importeer(bestand) {
    melding('');
    try {
      let body;
      if (/\.xlsx$/i.test(bestand.name)) {
        const buf = new Uint8Array(await bestand.arrayBuffer()); let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        body = { soort: 'xlsx', base64: btoa(bin) };
      } else body = { soort: 'json', tekst: await bestand.text() };
      const r = await api('/api/pyblitz/import', { method: 'POST', body });
      if (!r.ok) return melding((r.fouten || ['Importeren mislukt.']).join(' '), 'fout');
      set = { id: null, name: r.naam || bestand.name.replace(/\.(json|xlsx)$/i, ''), description: r.omschrijving || '', questions: r.vragen };
      set.questions.forEach(naarEditorVorm);
      toonEditor();
      melding(`${r.vragen.length} vragen ingelezen — controleer ze en klik op Opslaan.` + (r.fouten && r.fouten.length ? ' Let op: ' + r.fouten.join(' ') : ''));
    } catch (e) { melding(e.message, 'fout'); }
  }

  // ── gespeelde spellen ────────────────────────────────────────────────────
  async function historiek() {
    toonScherm('pbl-historiek-scherm');
    const root = $('pbl-historiek-scherm'); root.textContent = '';
    root.appendChild(h('button', { class: 'btn btn-muted', type: 'button', onclick: laadLijst, text: '← Terug' }));
    let games; try { games = (await api('/api/pyblitz/games')).games; } catch (e) { return melding(e.message, 'fout'); }
    if (!games.length) root.appendChild(h('p', { class: 'muted', text: 'Nog geen gespeelde spellen.' }));
    games.forEach(g => root.appendChild(h('div', { class: 'pbl-kaart', style: 'margin-top:10px' },
      h('b', { text: `${g.setName} — ${datum(g.startedAt)}` }),
      h('div', { class: 'pbl-meta', text: `${g.playerCount} deelnemers · ${g.questionCount} vragen` + (g.reason === 'gestopt' ? ' · vroegtijdig gestopt' : '') }),
      h('div', { class: 'pbl-rij' }, h('button', { class: 'btn btn-soft small', type: 'button', onclick: () => resultaat(g.id, root), text: 'Resultaat bekijken' })))));
  }
  async function resultaat(id, root) {
    let g; try { g = (await api(`/api/pyblitz/games/${encodeURIComponent(id)}`)).game; } catch (e) { return melding(e.message, 'fout'); }
    const r = g.results || {};
    const tabel = h('table', { class: 'table', style: 'width:100%;margin-top:10px' },
      h('thead', null, h('tr', null, ['#', 'Naam', 'Punten', 'Juist', 'Beste reeks'].map(t => h('th', { text: t })))),
      h('tbody', null, (r.spelers || []).map(s => h('tr', null,
        h('td', { text: String(s.plaats) }), h('td', { text: s.naam + (s.gast ? ' (gast)' : '') }), h('td', { text: String(s.punten) }),
        h('td', { text: `${s.juist}/${s.beantwoord}` }), h('td', { text: String(s.besteReeks || 0) })))));
    const kaart = h('div', { class: 'pbl-kaart', style: 'margin-top:10px' }, h('h3', { text: `${g.setName} — ${datum(g.startedAt)}` }),
      h('div', { class: 'pbl-meta', text: `Gemiddeld ${r.gemiddeldJuistPct || 0}% juist` + (r.moeilijkste ? ` · moeilijkste vraag nr. ${r.moeilijkste.nr} (${r.moeilijkste.juistPct}% juist)` : '') }), tabel);
    root.querySelectorAll('.pbl-resultaat').forEach(e => e.remove()); kaart.classList.add('pbl-resultaat'); root.appendChild(kaart);
    kaart.scrollIntoView({ block: 'nearest' });
  }

  $('pbl-nieuw').addEventListener('click', nieuw);
  $('pbl-historiek-knop').addEventListener('click', historiek);
  $('pbl-import-bestand').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importeer(f); });
  window.addEventListener('beforeunload', () => { /* geen ongeslagen-melding: bewaren is expliciet */ });
  laadLijst();
})();
