'use strict';
// PyCodeFlow v125 — opmaak voor opdrachten (vet, onderlijnd, kleur, code).
// Eén bestand voor server (require) én browser (<script>), zonder DOM: een kleine tokenizer
// met een strikte whitelist. Alles wat niet expliciet toegelaten is, wordt weggefilterd of
// ge-escaped; er komen nooit attributen door behalve de zes kleurklassen op <span>.
(function (root) {
  const TOEGELATEN = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'code', 'pre', 'ul', 'ol', 'li']);
  const LEEG = new Set(['br']);
  const KLEUR = /^rt-c[1-6]$/;
  const MAX_LENGTE = 12000;
  const MAX_DIEPTE = 12;
  const ENTITEIT = /^&(?:amp|lt|gt|quot|#39|nbsp);/;

  function escapeTekst(t) {
    let uit = '';
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '<') uit += '&lt;';
      else if (c === '>') uit += '&gt;';
      else if (c === '&') uit += ENTITEIT.test(t.slice(i)) ? '&' : '&amp;';
      else uit += c;
    }
    return uit;
  }

  function isHtml(s) { return /<\/?[a-zA-Z][^<>]*>/.test(s); }

  // Gewone tekst (oude opdrachten) → veilige HTML met regeleindes.
  function uitPlatteTekst(s) {
    return escapeTekst(s).replace(/\r\n?|\n/g, '<br>');
  }

  function sanitizeRt(invoer) {
    let s = String(invoer == null ? '' : invoer).slice(0, MAX_LENGTE * 2);
    if (!isHtml(s)) return uitPlatteTekst(s).slice(0, MAX_LENGTE);
    const delen = s.split(/(<[^<>]*>)/);
    const stapel = [];
    let uit = '';
    for (const deel of delen) {
      if (!deel) continue;
      if (deel[0] === '<' && deel[deel.length - 1] === '>') {
        const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>$/.exec(deel);
        if (!m) continue;                              // vreemde tag: weg
        const sluit = m[1] === '/';
        const naam = m[2].toLowerCase();
        if (!TOEGELATEN.has(naam)) continue;           // niet toegelaten: tag weg, inhoud blijft
        if (naam === 'br') { if (!sluit) uit += '<br>'; continue; }
        if (sluit) {
          const i = stapel.lastIndexOf(naam);
          if (i === -1) continue;                      // sluittag zonder opener
          while (stapel.length > i) uit += `</${stapel.pop()}>`;
          continue;
        }
        if (stapel.length >= MAX_DIEPTE) continue;
        let attr = '';
        if (naam === 'span') {
          const k = /class\s*=\s*["']([^"']*)["']/i.exec(m[3]);
          if (k) {
            const klas = k[1].split(/\s+/).find(c => KLEUR.test(c));
            if (klas) attr = ` class="${klas}"`;
          }
        }
        if (!LEEG.has(naam)) stapel.push(naam);
        uit += `<${naam}${attr}>`;
      } else {
        uit += escapeTekst(deel);
      }
    }
    while (stapel.length) uit += `</${stapel.pop()}>`;
    return uit.slice(0, MAX_LENGTE);
  }

  // Zichtbare tekst zonder tags: voor "is dit leeg?".
  function tekstVan(html) {
    return String(html || '').replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function rtLeeg(html) { return tekstVan(html) === ''; }

  // Browser: kleur de code-stukken in een weergave-element (leerlingen en leerkrachtkaart).
  function verrijk(el) {
    if (!el || !el.querySelectorAll) return;
    const hl = root.pcfHighlightPython || root.highlightPython;
    el.querySelectorAll('pre, code').forEach(c => {
      c.classList.add('rt-code');
      if (typeof hl === 'function' && !c.dataset.rtHl) {
        c.dataset.rtHl = '1';
        c.classList.add('hl-python');
        c.innerHTML = hl(c.textContent);   // highlightPython escapet zelf
      }
    });
  }

  const api = { sanitizeRt, rtLeeg, tekstVan, verrijk, uitPlatteTekst };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(root, { sanitizeRt, rtLeeg, rtTekstVan: tekstVan, rtVerrijk: verrijk });
})(typeof window !== 'undefined' ? window : globalThis);
