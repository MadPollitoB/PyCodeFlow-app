// Sprint 47.1 — tests voor de zelf-gehoste Python syntax highlighter.
// De highlighter is een pure functie (public/code-highlight.js exporteert highlightPython
// in een Node-omgeving), dus we kunnen ze rechtstreeks unit-testen zonder browser.

const { test } = require('node:test');
const assert = require('node:assert');
const { highlightPython } = require('../public/code-highlight.js');

test('keywords en builtins krijgen de juiste spans', () => {
  const out = highlightPython('for i in range(10):\n    print(i)');
  assert.match(out, /<span class="tok-kw">for<\/span>/);
  assert.match(out, /<span class="tok-kw">in<\/span>/);
  assert.match(out, /<span class="tok-builtin">range<\/span>/);
  assert.match(out, /<span class="tok-builtin">print<\/span>/);
});

test('getallen krijgen een num-span', () => {
  assert.match(highlightPython('n = 42'), /<span class="tok-num">42<\/span>/);
});

test('strings en comments worden herkend; keywords erin lichten NIET op', () => {
  const out = highlightPython('x = "for while"  # if else');
  assert.match(out, /<span class="tok-str">"for while"<\/span>/);
  assert.match(out, /<span class="tok-com"># if else<\/span>/);
  // 'for'/'while' zitten in de string, 'if'/'else' in de comment → geen keyword-span
  assert.doesNotMatch(out, /tok-kw">for/);
  assert.doesNotMatch(out, /tok-kw">if/);
});

test('HTML-gevaarlijke tekens worden ge-escaped (geen injectie/kapotte weergave)', () => {
  const out = highlightPython('a = 5 < 3 & 2 > 1');
  assert.ok(out.includes('&lt;'), 'kleiner-dan moet &lt; worden');
  assert.ok(out.includes('&gt;'), 'groter-dan moet &gt; worden');
  assert.ok(out.includes('&amp;'), 'ampersand moet &amp; worden');
  assert.ok(!out.includes(' < '), 'geen kale < in de output');
  assert.ok(!out.includes(' > '), 'geen kale > in de output');
});

test('lege / niet-string input is veilig en geeft altijd een string terug', () => {
  assert.strictEqual(typeof highlightPython(''), 'string');
  assert.strictEqual(typeof highlightPython(null), 'string');
  assert.strictEqual(typeof highlightPython(undefined), 'string');
  assert.strictEqual(highlightPython(''), '');
});

test('gewone identifiers blijven ongemoeid (geen valse keyword-treffers)', () => {
  const out = highlightPython('formule = information + informatie');
  // 'formule'/'information'/'informatie' beginnen met 'for'/'in' maar zijn geen keywords
  assert.doesNotMatch(out, /tok-kw/);
});
