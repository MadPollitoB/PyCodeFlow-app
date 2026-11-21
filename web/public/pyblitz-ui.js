'use strict';
// ════════════════════════════════════════════════════════════════════════════
// v151 — PyBlitz: gedeelde weergave voor leerkracht (beamer), leerling (popup) en gast (telefoon).
// Alles wordt met textContent opgebouwd (nooit innerHTML met vraag- of spelersdata).
//   PyBlitzUI.maak(root, { host, token?, acties }) → { toon(state), stop() }
//   acties: { begin, volgende, sluitvraag, pauze, hervat, sluit, antwoord(i), verlaat }
// ════════════════════════════════════════════════════════════════════════════
(function () {
  const LETTERS = ['A', 'B', 'C', 'D'];

  function h(tag, attrs, ...kinderen) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kinderen.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  const knop = (tekst, klasse, onclick, extra) => h('button', { type: 'button', class: 'pb-btn ' + (klasse || ''), onclick, ...(extra || {}) }, tekst);

  function qrSvg(tekst) {
    const wrap = h('div', { class: 'pb-qr', role: 'img', 'aria-label': 'QR-code om mee te spelen' });
    try {
      if (typeof window.qrcode !== 'function') return wrap;
      const qr = window.qrcode(0, 'M'); qr.addData(tekst); qr.make();
      wrap.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });   // enkel onze eigen URL, door de bibliotheek omgezet
      const svg = wrap.querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
    } catch (e) { /* QR is een extraatje: de pincode blijft altijd zichtbaar */ }
    return wrap;
  }

  function vraagBlok(v, opties) {
    const blok = h('div', { class: 'pb-vraag' });
    if (v.text) blok.appendChild(h('div', { class: 'pb-vraag-tekst', text: v.text }));
    if (v.code) blok.appendChild(h('pre', { class: 'pb-code' }, h('code', { text: v.code })));
    if (v.error) blok.appendChild(h('pre', { class: 'pb-fout' }, h('code', { text: v.error })));
    if (v.imageId) blok.appendChild(h('img', { class: 'pb-afb', src: '/api/pyblitz/image/' + encodeURIComponent(v.imageId), alt: 'Afbeelding bij de vraag' }));
    return blok;
  }

  function maak(root, cfg) {
    const host = !!cfg.host;
    const acties = cfg.acties || {};
    let laatste = null, sleutel = '', offset = 0, ticker = null, state = null;

    function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }
    function tik() {
      const t = root.querySelector('.pb-timer'); if (!t || !state || state.fase !== 'question') return;
      const totaal = Math.max(1, state.deadline - state.start);
      const rest = state.gepauzeerd ? state.restMs : Math.max(0, state.deadline - (Date.now() + offset));
      const num = t.querySelector('.pb-timer-num'), bar = t.querySelector('.pb-timer-bar span');
      if (num) num.textContent = state.gepauzeerd ? '⏸' : String(Math.ceil(rest / 1000));
      if (bar) bar.style.width = Math.max(0, Math.min(100, 100 * rest / totaal)) + '%';
      t.classList.toggle('pb-timer-laag', rest <= 5000 && !state.gepauzeerd);
    }

    function kop(st, rechts) {
      return h('div', { class: 'pb-kop' },
        h('div', { class: 'pb-merk' }, '⚡ PyBlitz', h('span', { class: 'pb-naam', text: st.naam || '' })),
        h('div', { class: 'pb-kop-midden' }, st.fase === 'question' || st.fase === 'reveal' ? `Vraag ${st.index + 1} van ${st.totaal}` : ''),
        h('div', { class: 'pb-kop-rechts' }, rechts));
    }
    const timerEl = () => h('div', { class: 'pb-timer' }, h('div', { class: 'pb-timer-num', text: '' }), h('div', { class: 'pb-timer-bar' }, h('span')));

    // ── lobby ──────────────────────────────────────────────────────────────
    function lobby(st) {
      const url = location.origin + '/play?pin=' + encodeURIComponent(st.pin);
      const namen = h('div', { class: 'pb-namen', 'data-namen': '' });
      vulNamen(namen, st);
      if (host) {
        return h('div', { class: 'pb-scherm pb-lobby' }, kop(st),
          h('div', { class: 'pb-lobby-body' },
            h('div', { class: 'pb-lobby-links' },
              h('div', { class: 'pb-uitleg' }, 'Meedoen met je gsm of laptop:'),
              h('div', { class: 'pb-url', text: location.host + '/play' }),
              h('div', { class: 'pb-pin-label', text: 'Code' }),
              h('div', { class: 'pb-pin', text: st.pin }),
              qrSvg(url)),
            h('div', { class: 'pb-lobby-rechts' },
              h('div', { class: 'pb-teller', 'data-teller': '' }, tellerTekst(st)),
              namen)),
          h('div', { class: 'pb-acties' },
            knop('Stop', 'pb-btn-stil', () => acties.sluit && acties.sluit()),
            knop('▶ Start de quiz', 'pb-btn-groot', () => acties.begin && acties.begin(), { 'data-start': '', disabled: st.spelers < 1 })));
      }
      return h('div', { class: 'pb-scherm pb-lobby pb-speler' }, kop(st),
        h('div', { class: 'pb-midden' },
          h('div', { class: 'pb-groot', text: st.jij ? `Je zit erin, ${st.jij.naam}!` : 'Je zit erin!' }),
          h('div', { class: 'pb-klein', text: 'Wacht tot je leerkracht de quiz start.' }),
          h('div', { class: 'pb-teller', 'data-teller': '' }, tellerTekst(st)),
          namen),
        cfg.token ? h('div', { class: 'pb-acties' }, knop('Verlaat', 'pb-btn-stil', () => acties.verlaat && acties.verlaat())) : null);
    }
    const tellerTekst = (st) => `${st.spelers} ${st.spelers === 1 ? 'deelnemer' : 'deelnemers'}`;
    function vulNamen(el, st) {
      el.textContent = '';
      (st.namen || []).forEach(n => el.appendChild(h('span', { class: 'pb-chip' + (n.guest ? ' pb-chip-gast' : ''), text: n.name })));
    }

    // ── vraag ──────────────────────────────────────────────────────────────
    function opties(st, mode) {
      const v = st.vraag; const wrap = h('div', { class: 'pb-opties pb-opties-' + v.options.length });
      v.options.forEach((o, i) => {
        const cls = ['pb-optie', 'pb-optie-' + LETTERS[i].toLowerCase()];
        const inhoud = [h('span', { class: 'pb-letter', text: LETTERS[i] }), h('span', { class: o.code ? 'pb-optie-tekst pb-mono' : 'pb-optie-tekst', text: o.text })];
        if (mode === 'kies') {
          wrap.appendChild(h('button', { type: 'button', class: cls.join(' '), onclick: () => kies(i), 'aria-label': `Antwoord ${LETTERS[i]}: ${o.text}` }, inhoud));
        } else if (mode === 'uitslag') {
          const juist = st.juist === i; const aantal = (st.tellingen || [])[i] || 0;
          const max = Math.max(1, ...(st.tellingen || [1]));
          if (juist) cls.push('pb-juist'); else cls.push('pb-fout-optie');
          if (st.jij && st.jij.resultaat && st.jij.resultaat.picked === i) cls.push('pb-gekozen');
          wrap.appendChild(h('div', { class: cls.join(' ') }, inhoud,
            h('span', { class: 'pb-staaf' }, h('span', { style: `width:${Math.round(100 * aantal / max)}%` })),
            h('span', { class: 'pb-aantal', text: String(aantal) }), juist ? h('span', { class: 'pb-vink', 'aria-label': 'juist antwoord', text: '✓' }) : null));
        } else {
          wrap.appendChild(h('div', { class: cls.join(' ') }, inhoud));
        }
      });
      return wrap;
    }
    function kies(i) {
      if (!acties.antwoord) return;
      state.jijAntwoordde = i;      // meteen tonen; de server bevestigt via de volgende toestand
      sleutel = ''; toon(state, true);
      Promise.resolve(acties.antwoord(i)).then(r => { if (r && r.ok === false && r.error) { state.jijAntwoordde = null; sleutel = ''; toon(state, true); fl(r.error); } });
    }
    function fl(msg) {
      const t = h('div', { class: 'pb-toast', role: 'status', text: msg }); root.appendChild(t); setTimeout(() => t.remove(), 3500);
    }
    function vraag(st) {
      const ik = !host;
      const kopRechts = host ? [timerEl()] : [timerEl()];
      const antwoordde = st.jijAntwoordde != null;
      let body;
      if (host) {
        body = h('div', { class: 'pb-body' }, vraagBlok(st.vraag), opties(st, 'toon'));
      } else if (antwoordde) {
        body = h('div', { class: 'pb-body' }, vraagBlok(st.vraag), opties(st, 'toon'),
          h('div', { class: 'pb-verstuurd', text: `Antwoord ${LETTERS[st.jijAntwoordde]} verstuurd — wachten op de rest…` }));
      } else {
        body = h('div', { class: 'pb-body' }, vraagBlok(st.vraag), opties(st, 'kies'));
      }
      const voet = host ? h('div', { class: 'pb-acties' },
        h('div', { class: 'pb-voortgang' }, h('b', { 'data-beantwoord': '', text: String(st.beantwoord) }), ` van ${st.verbonden} hebben geantwoord`),
        st.gepauzeerd ? knop('▶ Hervat', 'pb-btn-stil', () => acties.hervat && acties.hervat()) : knop('⏸ Pauze', 'pb-btn-stil', () => acties.pauze && acties.pauze()),
        knop('Toon antwoord', 'pb-btn-groot', () => acties.sluitvraag && acties.sluitvraag())) : null;
      return h('div', { class: 'pb-scherm pb-vraagscherm' + (ik ? ' pb-speler' : '') }, kop(st, kopRechts), body, voet);
    }

    // ── uitslag per vraag ──────────────────────────────────────────────────
    function ranglijst(st) {
      const lijst = h('ol', { class: 'pb-top' });
      (st.top || []).forEach(p => {
        const beweging = p.prevRank && p.rank ? p.prevRank - p.rank : 0;
        lijst.appendChild(h('li', { class: 'pb-top-rij' },
          h('span', { class: 'pb-plaats', text: String(p.rank) }),
          h('span', { class: 'pb-top-naam', text: p.name }),
          beweging > 0 ? h('span', { class: 'pb-op', text: '▲' + beweging }) : (beweging < 0 ? h('span', { class: 'pb-neer', text: '▼' + (-beweging) }) : null),
          p.delta > 0 ? h('span', { class: 'pb-delta', text: '+' + p.delta }) : null,
          p.streak >= 2 ? h('span', { class: 'pb-reeks', title: 'Reeks juiste antwoorden', text: '🔥' + p.streak }) : null,
          h('span', { class: 'pb-punten', text: String(p.points) })));
      });
      return lijst;
    }
    function uitslag(st) {
      if (host) {
        return h('div', { class: 'pb-scherm pb-uitslag' }, kop(st),
          h('div', { class: 'pb-body pb-twee' },
            h('div', { class: 'pb-kolom' }, vraagBlok(st.vraag), opties(st, 'uitslag'),
              st.uitleg ? h('div', { class: 'pb-uitleg-blok' }, h('b', { text: 'Uitleg: ' }), st.uitleg) : null),
            h('div', { class: 'pb-kolom pb-kolom-smal' }, h('h3', { text: 'Top 5' }), ranglijst(st))),
          h('div', { class: 'pb-acties' }, knop('Stop', 'pb-btn-stil', () => acties.sluit && acties.sluit()),
            knop(st.laatste ? '🏁 Eindresultaat' : 'Volgende vraag ▶', 'pb-btn-groot', () => acties.volgende && acties.volgende())));
      }
      const r = (st.jij && st.jij.resultaat) || {};
      const juist = !!r.correct;
      const kopje = !r.answered ? 'Te laat!' : (juist ? 'Juist!' : 'Helaas…');
      return h('div', { class: 'pb-scherm pb-uitslag pb-speler ' + (juist ? 'pb-ok' : 'pb-niet') }, kop(st),
        h('div', { class: 'pb-midden' },
          h('div', { class: 'pb-groot', text: (juist ? '✓ ' : (r.answered ? '✗ ' : '⏱ ')) + kopje }),
          h('div', { class: 'pb-punten-groot', text: juist ? '+' + (r.delta || 0) + ' punten' : '+0 punten' }),
          juist && r.bonus ? h('div', { class: 'pb-klein', text: `waarvan ${r.bonus} reeksbonus 🔥` }) : null,
          !juist ? h('div', { class: 'pb-klein' }, 'Juist was: ', h('b', { text: `${LETTERS[st.juist]} — ${st.vraag.options[st.juist].text}` })) : null,
          st.uitleg ? h('div', { class: 'pb-uitleg-blok', text: st.uitleg }) : null,
          st.jij ? h('div', { class: 'pb-stand' }, `Plaats ${st.jij.plaats || '–'} · ${st.jij.punten} punten`) : null,
          h('div', { class: 'pb-klein', text: st.laatste ? 'Het eindresultaat komt eraan…' : 'Wacht op de volgende vraag.' })));
    }

    // ── eindresultaat ──────────────────────────────────────────────────────
    function eind(st) {
      if (host) {
        const pod = h('div', { class: 'pb-podium' });
        const volg = [1, 0, 2];       // 2e, 1e, 3e
        volg.forEach(i => {
          const p = (st.podium || [])[i]; if (!p) return;
          pod.appendChild(h('div', { class: 'pb-trap pb-trap-' + (i + 1) },
            h('div', { class: 'pb-trap-naam', text: p.name }), h('div', { class: 'pb-trap-punten', text: p.points + ' pt' }),
            h('div', { class: 'pb-trap-blok', text: String(p.rank) })));
        });
        const lijst = h('ol', { class: 'pb-top pb-lijst' });
        (st.lijst || []).slice(3).forEach(p => lijst.appendChild(h('li', { class: 'pb-top-rij' },
          h('span', { class: 'pb-plaats', text: String(p.plaats) }), h('span', { class: 'pb-top-naam', text: p.naam }),
          h('span', { class: 'pb-punten', text: String(p.punten) }))));
        return h('div', { class: 'pb-scherm pb-eind' }, kop(st),
          h('div', { class: 'pb-body pb-twee' },
            h('div', { class: 'pb-kolom' }, h('h2', { text: 'Eindresultaat 🏆' }), pod),
            h('div', { class: 'pb-kolom pb-kolom-smal' },
              h('div', { class: 'pb-statistiek' }, `Gemiddeld ${st.gemiddeldJuistPct}% juist`,
                st.moeilijkste ? h('div', { class: 'pb-klein', text: `Moeilijkste vraag: nr. ${st.moeilijkste.nr} (${st.moeilijkste.juistPct}% juist)` }) : null),
              lijst)),
          h('div', { class: 'pb-acties' }, knop('Eindresultaat sluiten', 'pb-btn-groot', () => acties.sluit && acties.sluit())));
      }
      const j = st.jij || {};
      return h('div', { class: 'pb-scherm pb-eind pb-speler' }, kop(st),
        h('div', { class: 'pb-midden' },
          h('div', { class: 'pb-groot', text: j.plaats === 1 ? '🥇 Gewonnen!' : (j.plaats ? `Plaats ${j.plaats}` : 'Klaar') }),
          h('div', { class: 'pb-punten-groot', text: `${j.punten || 0} punten` }),
          h('div', { class: 'pb-klein', text: `${j.juist || 0} van ${j.vragen || st.totaal} juist` + (j.besteReeks >= 2 ? ` · beste reeks ${j.besteReeks} 🔥` : '') }),
          h('div', { class: 'pb-klein', text: 'Je leerkracht sluit het eindresultaat zo af.' })),
        cfg.token ? h('div', { class: 'pb-acties' }, knop('Klaar', 'pb-btn-stil', () => acties.verlaat && acties.verlaat())) : null);
    }

    // ── tonen ──────────────────────────────────────────────────────────────
    function toon(st, geforceerd) {
      state = st; laatste = st;
      if (st && st.nu) offset = st.nu - Date.now();
      const nieuw = `${st.fase}|${st.index}|${st.gepauzeerd}|${st.jijAntwoordde}|${st.jij && st.jij.resultaat ? 1 : 0}`;
      if (!geforceerd && nieuw === sleutel && (st.fase === 'question' || st.fase === 'lobby')) {
        // alleen tellers bijwerken; de rest blijft staan (geen flikkerende afbeeldingen/knoppen)
        const b = root.querySelector('[data-beantwoord]'); if (b) b.textContent = String(st.beantwoord);
        const t = root.querySelector('[data-teller]'); if (t) t.textContent = tellerTekst(st);
        const n = root.querySelector('[data-namen]'); if (n) vulNamen(n, st);
        const s = root.querySelector('[data-start]'); if (s) s.disabled = st.spelers < 1;
        return;
      }
      sleutel = nieuw;
      stopTicker();
      root.textContent = '';
      const scherm = st.fase === 'lobby' ? lobby(st) : st.fase === 'question' ? vraag(st) : st.fase === 'reveal' ? uitslag(st) : st.fase === 'final' ? eind(st) : h('div', { class: 'pb-scherm' });
      root.appendChild(scherm);
      if (st.fase === 'question') { tik(); ticker = setInterval(tik, 100); }
    }
    return { toon, stop: () => { stopTicker(); root.textContent = ''; }, melding: fl };
  }

  window.PyBlitzUI = { maak, h, LETTERS };
})();
