// v144: diagnose van "weg van de toets" (tabwissel, ander venster/programma, Chromebook-zoekknop, ...).
// Een webpagina ziet niet WAT de leerling opende, wel wat er vlak ervoor gebeurde:
//   • de laatste systeemtoetsen (Meta = zoek-/startknop, Alt, Ctrl, Tab, F-toetsen — GEEN letters of cijfers),
//   • langs welke rand de muis het venster verliet (onder = taakbalk / vak rechtsonder met bestanden),
//   • welke gebeurtenis het eerst kwam (blur, visibilitychange, fullscreenchange).
// ChromeOS vangt sommige toetsen zelf af; dan blijft de oorzaak "onbekend". Dit bestand is UMD: zuivere
// functies zijn te testen in Node, de DOM-koppeling (maakDiagnose) draait enkel in de browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TabDiagnose = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOETS_VENSTER_MS = 4000;   // toetsen van vóór het weggaan die nog meetellen
  const MUIS_VENSTER_MS = 3000;

  // Enkel "systeemtoetsen" worden bewaard — nooit wat de leerling typt.
  function systeemToetsLabel(e) {
    const k = e && e.key;
    if (!k) return null;
    if (k === 'Meta' || k === 'OS' || (e.code && /^(Meta|OS)(Left|Right)$/.test(e.code))) return 'Meta (zoek-/startknop)';
    if (k === 'Alt') return 'Alt';
    if (k === 'Control') return 'Ctrl';
    if (k === 'Tab') return e.altKey ? 'Alt+Tab' : e.ctrlKey ? 'Ctrl+Tab' : 'Tab';
    if (k === 'Escape') return 'Esc';
    if (k === 'ContextMenu') return 'Menu';
    if (/^F([1-9]|1[0-2])$/.test(k)) return k;
    if (k === 'LaunchApplication1' || k === 'LaunchApplication2' || k === 'BrowserHome' || k === 'BrowserSearch') return k;
    if (k === 'PrintScreen') return 'PrintScreen';
    // Ctrl/Alt/Meta + letter: enkel het feit dat er een combinatie was, niet de letter zelf.
    return null;
  }

  // Door welke rand verliet de muis het venster? (x,y = laatste muispositie binnen het venster)
  function randVan(x, y, w, h) {
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    const links = x, rechts = w - x, boven = y, onder = h - y;
    const min = Math.min(links, rechts, boven, onder);
    if (min === onder) return x > w * 0.7 ? 'rechtsonder' : 'onder';
    if (min === boven) return 'boven';
    if (min === links) return 'links';
    return 'rechts';
  }

  const RAND_TEKST = {
    onder: 'de muis ging naar de onderkant (taakbalk / schap)',
    rechtsonder: 'de muis ging naar rechtsonder (vak met klok, meldingen en bestanden)',
    boven: 'de muis ging naar de bovenkant (tabbladen / adresbalk)',
    links: 'de muis ging naar de linkerkant',
    rechts: 'de muis ging naar de rechterkant',
  };

  // Bouwt de leesbare oorzaak uit wat er vlak voor het weggaan gebeurde.
  // invoer: { event, toetsen:[{label,t}], rand, randT, t (tijdstip van weggaan) }
  function bouwOordeel(inv) {
    const t = inv.t;
    const recent = (inv.toetsen || []).filter(x => t - x.t >= 0 && t - x.t <= TOETS_VENSTER_MS).map(x => x.label);
    const uniek = [...new Set(recent)];
    const randOk = inv.rand && inv.randT != null && t - inv.randT >= 0 && t - inv.randT <= MUIS_VENSTER_MS ? inv.rand : null;
    let oorzaak;
    if (uniek.includes('Alt+Tab')) oorzaak = 'Alt+Tab (van venster gewisseld)';
    else if (uniek.includes('Ctrl+Tab')) oorzaak = 'Ctrl+Tab (naar een ander tabblad)';
    else if (uniek.some(x => x.startsWith('Meta'))) oorzaak = 'zoek-/startknop (Meta) ingedrukt';
    else if (uniek.some(x => /^F\d+$/.test(x))) oorzaak = 'functietoets (' + uniek.filter(x => /^F\d+$/.test(x)).join(', ') + ')';
    else if (randOk) oorzaak = RAND_TEKST[randOk];
    else if (uniek.length) oorzaak = 'toets(en) ' + uniek.join(', ');
    else oorzaak = 'onbekende oorzaak (bv. een systeemtoets of -gebaar dat het toestel zelf afhandelt)';
    return {
      oorzaak,
      ev: inv.event || null,
      rand: randOk,
      toetsen: uniek.slice(0, 6),
    };
  }

  // DOM-koppeling. Geeft { snapshot(eventNaam) } terug; roep dat op het moment van weggaan aan.
  function maakDiagnose(win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    const doc = win && win.document;
    const toetsen = [];
    let rand = null, randT = null, laatsteX = null, laatsteY = null;
    if (!doc) return { snapshot: () => null };

    doc.addEventListener('keydown', (e) => {
      const label = systeemToetsLabel(e);
      if (!label) return;
      toetsen.push({ label, t: Date.now() });
      if (toetsen.length > 12) toetsen.shift();
    }, true);
    doc.addEventListener('mousemove', (e) => { laatsteX = e.clientX; laatsteY = e.clientY; }, true);
    const verlaat = (e) => {
      // relatedTarget null = de muis verliet het document
      if (e.relatedTarget) return;
      const x = Number.isFinite(e.clientX) ? e.clientX : laatsteX;
      const y = Number.isFinite(e.clientY) ? e.clientY : laatsteY;
      const r = randVan(x, y, win.innerWidth, win.innerHeight);
      if (r) { rand = r; randT = Date.now(); }
    };
    doc.documentElement.addEventListener('mouseleave', verlaat);
    doc.addEventListener('mouseout', verlaat, true);

    return {
      snapshot(eventNaam) {
        return bouwOordeel({ event: eventNaam, toetsen, rand, randT, t: Date.now() });
      },
    };
  }

  return { systeemToetsLabel, randVan, bouwOordeel, maakDiagnose, TOETS_VENSTER_MS, MUIS_VENSTER_MS };
}));
