'use strict';
// v152 — "Uitproberen": speel een PyBlitz proef in een splitscreen. Links wat de leerkracht/beamer toont,
// rechts wat een leerling op de gsm ziet. Draait volledig in de browser met dezelfde spelmotor als de server
// (/pyblitz-engine.js); er worden geen echte spelers, resultaten of sessies aangemaakt.
(function () {
  let engine = null, laden = null;
  function laadEngine() {
    if (engine) return Promise.resolve(engine);
    if (laden) return laden;
    laden = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = '/pyblitz-engine.js?v=' + Date.now();
      s.onload = () => { engine = window.PyBlitzEngine; engine ? res(engine) : rej(new Error('leeg')); };
      s.onerror = () => { laden = null; rej(new Error('Kon de spelmotor niet laden.')); };
      document.head.appendChild(s);
    });
    return laden;
  }
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  };

  const BOTS = [['Lena', 0.75, 3000, 9000], ['Mo', 0.6, 2000, 7000], ['Sarah', 0.5, 4000, 11000]];

  async function open(rawSet, vanaf, toonFout) {
    let E;
    try { E = await laadEngine(); } catch (e) { return toonFout(e.message); }
    const norm = E.P.normaliseerSet({ name: rawSet.name || 'Proef', description: rawSet.description, questions: rawSet.questions });
    if (!norm.ok) return toonFout((norm.fouten && norm.fouten[0]) || 'Er zijn nog fouten in de vragen. Controleer ze en probeer opnieuw.');
    const alle = norm.vragen;
    let startIndex = Math.max(0, Math.min(alle.length - 1, vanaf || 0));

    let spel = null, botTimers = [], laatsteStand = { host: null, speler: null }, klaar = { host: false, speler: false }, vorigeVraag = -1;
    const modal = h('div', { class: 'pbp', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'PyBlitz uitproberen' });
    const kies = h('select', { 'aria-label': 'Begin bij vraag' }, alle.map((v, i) => h('option', { value: String(i), text: `Vanaf vraag ${i + 1}`, selected: i === startIndex })));
    const balk = h('div', { class: 'pbp-balk' },
      h('b', { text: '▶ Uitproberen' }), h('span', { class: 'pbp-label', text: 'Geen echte spelers, niets wordt bewaard. Rechts speel je mee als leerling; drie bots spelen ook mee.' }),
      h('span', { class: 'pbp-vrij' }), kies,
      h('button', { type: 'button', class: 'pb-btn pb-btn-stil', text: '↺ Opnieuw', onclick: () => herstart() }),
      h('button', { type: 'button', class: 'pb-btn', text: '✕ Sluiten', onclick: () => sluit() }));
    const maakFrame = (rol, breed, hoog, klasse) => {
      const f = h('iframe', { src: `/pyblitz-proef.html?rol=${rol}`, title: rol === 'host' ? 'Leerkracht / beamer' : 'Leerling / gsm', width: String(breed), height: String(hoog) });
      const wrap = h('div', { class: 'pbp-frame-wrap ' + (klasse || '') }, f);
      return { f, wrap, breed, hoog };
    };
    const L = maakFrame('host', 1280, 720), R = maakFrame('speler', 390, 780, 'pbp-gsm');
    const vakL = h('div', { class: 'pbp-vak' }, L.wrap), vakR = h('div', { class: 'pbp-vak' }, R.wrap);
    modal.append(balk, h('div', { class: 'pbp-body' },
      h('div', { class: 'pbp-paneel pbp-links' }, h('div', { class: 'pbp-label', text: 'Leerkracht — zo ziet de beamer eruit' }), vakL),
      h('div', { class: 'pbp-paneel pbp-rechts' }, h('div', { class: 'pbp-label', text: 'Leerling — zo ziet het eruit op een gsm' }), vakR)));
    document.body.appendChild(modal);
    document.documentElement.style.overflow = 'hidden';

    function schaal() {
      for (const [vak, F] of [[vakL, L], [vakR, R]]) {
        const w = vak.clientWidth - 16, hh = vak.clientHeight - 16; if (w <= 0 || hh <= 0) continue;   // marge voor de rand rond de gsm
        const sc = Math.min(w / F.breed, hh / F.hoog);
        F.wrap.style.width = Math.floor(F.breed * sc) + 'px'; F.wrap.style.height = Math.floor(F.hoog * sc) + 'px';
        F.f.style.transform = `scale(${sc})`;
      }
    }
    const ro = new ResizeObserver(schaal); ro.observe(vakL); ro.observe(vakR); schaal();

    const stuur = (rol, state) => {
      laatsteStand[rol] = state;
      const F = rol === 'host' ? L : R;
      if (klaar[rol] && F.f.contentWindow) F.f.contentWindow.postMessage({ pbProef: 'state', state }, location.origin);
    };
    const verspreid = () => { if (!spel) return; stuur('host', spel.toestand(null)); stuur('speler', spel.toestand('jij')); };

    function wisBots() { botTimers.forEach(t => clearTimeout(t)); botTimers = []; }
    function planBots(index) {
      wisBots();
      const q = alle[startIndex + index]; if (!q) return;   // index telt binnen het (eventueel ingekorte) proefspel
      BOTS.forEach(([naam, kans, min, max]) => {
        const sec = q.seconds * 1000;
        const wacht = Math.min(sec - 1500, min + Math.random() * (max - min));
        botTimers.push(setTimeout(() => {
          if (!spel || spel.fase() !== 'question') return;
          const juist = Math.random() < kans;
          let keuze = q.correct;
          if (!juist) { const andere = q.options.map((_, i) => i).filter(i => i !== q.correct); keuze = andere[Math.floor(Math.random() * andere.length)]; }
          spel.antwoord('bot-' + naam, keuze);
        }, Math.max(800, wacht)));
      });
    }

    function herstart() {
      wisBots(); if (spel) { try { spel.stop(); } catch { /* al gestopt */ } }
      startIndex = Number(kies.value) || 0; vorigeVraag = -1;
      spel = E.maakSpel({
        id: 'proef', pin: '12345', set: { id: 'proef', name: norm.naam || 'Proef', questions: alle.slice(startIndex) },
        now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t),
        onChange: (st) => {
          if (st.fase === 'question' && st.index !== vorigeVraag) { vorigeVraag = st.index; planBots(st.index); }
          if (st.fase !== 'question') wisBots();
          verspreid();
        },
      });
      // bots zijn deelnemers "van de klas"; de proefleerling is 'jij'
      spel.voegSpelerToe({ id: 'jij', naam: 'Jij (proef)' });
      BOTS.forEach(([naam]) => spel.voegSpelerToe({ id: 'bot-' + naam, naam }));
      verspreid();
    }
    function sluit() {
      wisBots(); if (spel) { try { spel.stop(); } catch { /* */ } }
      window.removeEventListener('message', ontvang); ro.disconnect(); modal.remove();
      document.documentElement.style.overflow = ''; document.removeEventListener('keydown', toets, true);
    }
    const acties = {
      begin: () => spel && spel.begin(), volgende: () => spel && spel.volgende(), sluitvraag: () => spel && spel.sluitVraag(),
      pauze: () => spel && spel.pauzeer(), hervat: () => spel && spel.hervat(), sluit: () => sluit(),
      antwoord: (i) => spel && spel.antwoord('jij', Number(i)),
    };
    function ontvang(e) {
      if (e.origin !== location.origin || !e.data || !e.data.pbProef) return;
      if (e.data.pbProef === 'klaar') { klaar[e.data.rol] = true; stuur(e.data.rol, laatsteStand[e.data.rol]); return; }
      if (e.data.pbProef === 'actie' && acties[e.data.naam]) acties[e.data.naam](e.data.arg);
    }
    const toets = (e) => { if (e.key === 'Escape') { e.stopPropagation(); sluit(); } };
    window.addEventListener('message', ontvang); document.addEventListener('keydown', toets, true);
    kies.addEventListener('change', herstart);
    herstart();
  }
  window.pbProef = { open };
})();
