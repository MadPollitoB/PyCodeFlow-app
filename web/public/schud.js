// Sprint 98 — antwoordopties van single/multiple choice in willekeurige volgorde tonen.
// De volgorde hangt af van een "sleutel" (leerling + vraag), niet van het toeval bij elke
// weergave: zo blijft de volgorde stabiel bij het aanvinken, terugnavigeren of herladen,
// maar krijgt elke leerling een andere volgorde dan zijn buur. Het antwoord blijft aan de
// id/index van de optie hangen, dus nakijken en scores veranderen niet.
// Opties als "Alle bovenstaande" of "Geen van bovenstaande" blijven onderaan staan: die
// zijn enkel zinvol als laatste keuze.
(function (root) {
  'use strict';
  const VAST_ONDERAAN = /^\s*(alle|geen)\s+(van\s+)?(de\s+)?(bovenstaande|voorgaande|beide|bovenstaand)/i;

  function hash(tekst) {                       // xmur3-achtig: tekst → 32-bit getal
    let h = 1779033703 ^ tekst.length;
    for (let i = 0; i < tekst.length; i++) {
      h = Math.imul(h ^ tekst.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // items: lijst van opties (strings of objecten); tekstVan haalt de tekst eruit.
  function schud(items, sleutel, tekstVan) {
    const lijst = Array.isArray(items) ? items.slice() : [];
    const tekst = tekstVan || (x => (x && typeof x === 'object' ? x.text : x));
    const vast = lijst.filter(x => VAST_ONDERAAN.test(String(tekst(x) == null ? '' : tekst(x))));
    const vrij = lijst.filter(x => vast.indexOf(x) === -1);
    const rng = mulberry32(hash(String(sleutel)));
    for (let i = vrij.length - 1; i > 0; i--) {   // Fisher-Yates
      const j = Math.floor(rng() * (i + 1));
      const t = vrij[i]; vrij[i] = vrij[j]; vrij[j] = t;
    }
    return vrij.concat(vast);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { schud };
  else root.pySchud = schud;
})(typeof window !== 'undefined' ? window : this);
