// v142 — uitklapbare gelijkenisbanner met regelvergelijking
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const { vergelijkRegels, isTriviaal } = require('../public/regelvergelijking.js');

test('142 gelijke regels worden gevonden, ongeacht inspringing/spaties', () => {
  const v = vergelijkRegels('x = 1\nif x>5:\n    print("a")\nelse:\n    print("b")', 'x = 2\nif x>5:\n  print("a")\nelse:\n    print("c")');
  assert.deepStrictEqual(v.links.map(l => l.status), ['verschillend', 'gelijk', 'gelijk', 'triviaal', 'verschillend']);
  assert.strictEqual(v.aantalGelijk, 2);
  assert.strictEqual(v.totaal, 4);
});

test('142 triviale regels (else:, print(, losse }, blanco) tellen niet mee', () => {
  for (const t of ['', '   ', 'else:', 'print(', '}', ' } ']) assert.ok(isTriviaal(t.replace(/\s+/g, ' ').trim()), t);
  const v = vergelijkRegels('else:\n\n}', 'else:\n\n}');
  assert.strictEqual(v.aantalGelijk, 0);
  assert.strictEqual(v.totaal, 0);
});

test('142 een regel die twee keer voorkomt maar bij de ander één keer, telt maar één keer als gelijk', () => {
  const v = vergelijkRegels('a = 1\na = 1', 'a = 1');
  assert.strictEqual(v.links.filter(l => l.status === 'gelijk').length, 1);
  assert.strictEqual(v.aantalGelijk, 1);
});

test('142 leeg antwoord geeft geen fouten', () => {
  const v = vergelijkRegels('', 'x = 1');
  assert.deepStrictEqual(v.links, []);
  assert.strictEqual(v.rechts[0].status, 'verschillend');
  assert.strictEqual(vergelijkRegels(null, undefined).totaal, 0);
});

test('142 client: enkel tekstvragen uitklapbaar, meerkeuze krijgt gewone banner met Open-knop', () => {
  const j = r('public', 'quiz-review.js');
  assert.match(j, /function simIsTekst\(questionId\)/);
  assert.match(j, /if \(!simIsTekst\(w\.questionId\)\) \{/);
  assert.match(j, /Regelvergelijking\.vergelijkRegels/);
  assert.match(j, /function zetSimModus/);
  assert.match(j, /class="sim-meer"/, 'extra\'s achter "meer details"');
  assert.match(j, /window\.zetSimModus = zetSimModus/);
});

test('142 html: script geladen vóór quiz-review.js met dezelfde versie', () => {
  const h = r('public', 'quiz-review.html');
  const v = r('VERSION').trim();
  const a = h.indexOf('/regelvergelijking.js?v=v' + v), b = h.indexOf('/quiz-review.js?v=v' + v);
  assert.ok(a > 0 && b > a);
});
