/* Sprint 47.1 — lichte, zelf-gehoste Python syntax highlighting voor de codeblokken
   in de vraagstelling. Geen externe library, geen CDN, CSP-veilig (script-src 'self').

   Werkwijze: we haken in op de code-renderer van marked (die op elke quizpagina al
   geladen is). Voor elk ```-codeblok tokeniseren we de Python-broncode en wikkelen we
   keywords/strings/comments/getallen/builtins in <span class="tok-…">. De CSS-kleuren
   staan in styles.css onder `.hl-python .tok-…`.

   Fail-safe: gaat er íéts mis in het highlighten, dan valt het blok terug op gewone
   (ge-escapete) tekst — de code wordt dus nooit kapotgemaakt door deze functie. */
(function () {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var KEYWORDS = {
    'False':1,'None':1,'True':1,'and':1,'as':1,'assert':1,'async':1,'await':1,
    'break':1,'class':1,'continue':1,'def':1,'del':1,'elif':1,'else':1,'except':1,
    'finally':1,'for':1,'from':1,'global':1,'if':1,'import':1,'in':1,'is':1,
    'lambda':1,'nonlocal':1,'not':1,'or':1,'pass':1,'raise':1,'return':1,'try':1,
    'while':1,'with':1,'yield':1
  };
  var BUILTINS = {
    'print':1,'range':1,'len':1,'int':1,'str':1,'float':1,'input':1,'list':1,
    'dict':1,'set':1,'tuple':1,'abs':1,'sum':1,'min':1,'max':1,'round':1,
    'sorted':1,'reversed':1,'enumerate':1,'zip':1,'map':1,'filter':1,'open':1,
    'type':1,'bool':1,'isinstance':1,'format':1,'append':1,'split':1,'join':1,
    'strip':1,'replace':1,'lower':1,'upper':1
  };

  // Volgorde is belangrijk: strings/comments eerst zodat keywords erin niet oplichten.
  var TOKEN = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|\b\d+\.?\d*\b|[A-Za-z_]\w*)/g;

  function highlightPython(code) {
    code = String(code == null ? '' : code);
    var out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code)) !== null) {
      out += esc(code.slice(last, m.index));
      var t = m[0];
      if (t.charAt(0) === '#') out += '<span class="tok-com">' + esc(t) + '</span>';
      else if (t.charAt(0) === '"' || t.charAt(0) === "'") out += '<span class="tok-str">' + esc(t) + '</span>';
      else if (/^\d/.test(t)) out += '<span class="tok-num">' + esc(t) + '</span>';
      else if (KEYWORDS[t]) out += '<span class="tok-kw">' + esc(t) + '</span>';
      else if (BUILTINS[t]) out += '<span class="tok-builtin">' + esc(t) + '</span>';
      else out += esc(t);
      last = TOKEN.lastIndex;
    }
    out += esc(code.slice(last));
    return out;
  }

  // Node/CommonJS: exporteer de pure functie zodat ze in web/tests getest kan worden.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { highlightPython: highlightPython };
  }

  function install() {
    if (!window.marked || typeof window.marked.use !== 'function') return false;
    try {
      window.marked.use({
        renderer: {
          code: function (code, infostring) {
            // marked kan (afhankelijk van versie) een string óf een token-object doorgeven.
            var src = (code && typeof code === 'object') ? (code.text || '') : code;
            var lang = (code && typeof code === 'object') ? (code.lang || '') : (infostring || '');
            var body;
            try { body = highlightPython(src); }
            catch (e) { body = esc(src); }
            var cls = 'hl-python';
            return '<pre><code class="' + cls + '"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '>' + body + '</code></pre>';
          }
        }
      });
      return true;
    } catch (e) {
      // Highlighting is niet essentieel — bij twijfel gewoon marked zijn standaard laten doen.
      return false;
    }
  }

  // Browser: functie beschikbaar maken + de marked code-renderer installeren.
  if (typeof window !== 'undefined') {
    window.pcfHighlightPython = highlightPython;
    if (!install() && typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', install);
    }
  }
})();
