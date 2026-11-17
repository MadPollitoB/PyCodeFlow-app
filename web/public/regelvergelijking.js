// v142 — regelgewijze vergelijking van twee antwoorden (gebruikt door het nakijkscherm én de tests).
// Een regel is "gelijk" als hij (zonder rekening te houden met spaties/hoofdletter-loze witruimte)
// woordelijk ook bij de andere leerling voorkomt. Triviale regels tellen niet mee.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Regelvergelijking = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TRIVIAAL = new Set([
    'else:', 'else', 'try:', 'finally:', 'pass', 'break', 'continue', 'return',
    '}', '{', '};', ')', '(', ']', '[', 'print(', 'print()', '"""', "'''", 'end', 'begin',
  ]);

  const normaliseer = (regel) => String(regel == null ? '' : regel).replace(/\s+/g, ' ').trim();
  const isTriviaal = (norm) => norm === '' || TRIVIAAL.has(norm);

  function regelsVan(tekst) {
    const t = String(tekst == null ? '' : tekst).replace(/\r\n?/g, '\n');
    return t === '' ? [] : t.split('\n');
  }

  /**
   * @returns {{links:{tekst:string,status:'gelijk'|'verschillend'|'triviaal'}[], rechts:[...],
   *            aantalGelijk:number, totaal:number}}
   * totaal = aantal betekenisvolle (niet-triviale) regels van de langste kant.
   */
  function vergelijkRegels(tekstA, tekstB) {
    const a = regelsVan(tekstA), b = regelsVan(tekstB);
    const telling = (regels) => {
      const m = new Map();
      for (const r of regels) { const n = normaliseer(r); if (!isTriviaal(n)) m.set(n, (m.get(n) || 0) + 1); }
      return m;
    };
    const mapA = telling(a), mapB = telling(b);
    const markeer = (regels, andere) => {
      const over = new Map(andere);            // elke regel van de andere kant kan maar één keer "gebruikt" worden
      return regels.map((r) => {
        const n = normaliseer(r);
        if (isTriviaal(n)) return { tekst: r, status: 'triviaal' };
        const rest = over.get(n) || 0;
        if (rest > 0) { over.set(n, rest - 1); return { tekst: r, status: 'gelijk' }; }
        return { tekst: r, status: 'verschillend' };
      });
    };
    const links = markeer(a, mapB), rechts = markeer(b, mapA);
    const sign = (x) => x.filter((r) => r.status !== 'triviaal').length;
    return {
      links, rechts,
      aantalGelijk: Math.min(links.filter((r) => r.status === 'gelijk').length, rechts.filter((r) => r.status === 'gelijk').length),
      totaal: Math.max(sign(links), sign(rechts)),
    };
  }

  return { vergelijkRegels, normaliseer, isTriviaal };
});
