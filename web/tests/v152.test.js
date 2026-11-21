// v152 — PyBlitz: antwoorden met meerdere regels/code + "Uitproberen" (splitscreen)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/pyblitz');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('152 antwoorden: meerdere regels blijven behouden en worden als code getoond', () => {
  const v = P.normaliseerVraag({ type: 'mc', text: 'Q', options: ['for i in range(3):\n    print(i)', { text: 'x = 1', code: true }, 'gewoon', 'nog'], correct: 0 });
  assert.ok(v.ok);
  assert.equal(v.vraag.options[0].text, 'for i in range(3):\n    print(i)', 'inspringing blijft');
  assert.equal(v.vraag.options[0].code, true, 'meerdere regels → code');
  assert.equal(v.vraag.options[1].code, true);
  assert.ok(!v.vraag.options[2].code);
  const te = P.normaliseerVraag({ type: 'mc', text: 'Q', options: ['a\nb\nc\nd\ne\nf\ng\nh', 'x'], correct: 0 });
  assert.equal(te.vraag.options[0].text.split('\n').length, P.LIMIETEN.OPTIE_REGELS_MAX, 'maximaal 6 regels');
  // JSON-import en -export houden de codevlag
  const imp = P.importeerJson(JSON.stringify({ name: 'n', questions: [{ text: 'q', options: [{ text: 'a\n b', code: true }, 'c'], correct: 'A' }] }));
  assert.equal(imp.vragen[0].options[0].code, true);
  const exp = P.exporteerJson({ name: 'n', questions: imp.vragen });
  assert.equal(P.importeerJson(JSON.stringify(exp)).vragen[0].options[0].text, 'a\n b');
});

test('152 weergave: codeopties met pre-wrap; editor met tekstvak + codevinkje', () => {
  assert.match(r('public/pyblitz.css'), /\.pb-optie-tekst\.pb-mono \{ white-space: pre-wrap/);
  const b = r('public/pyblitz-bibliotheek.js');
  assert.match(b, /pbl-codevink/);
  assert.match(b, /proefStarten/);
  assert.match(b, /▶ Uitproberen/);
});

test('152 proef: splitscreen met twee iframes, bots, geen opslag; motor in de browser', () => {
  const p = r('public/pyblitz-proef.js');
  assert.match(p, /pyblitz-proef\.html\?rol=/);
  assert.match(p, /pbProef/);
  assert.doesNotMatch(p, /fetch\(|socket|pyblitzSave/, 'de proef maakt geen echte spelers of resultaten');
  assert.match(p, /e\.origin !== location\.origin/);
  assert.match(r('public/pyblitz-proef-frame.js'), /e\.origin !== location\.origin/);
  const s = r('server.js');
  assert.match(s, /app\.get\('\/pyblitz-engine\.js'/);
  assert.match(s, /proefFrame = req\.path === '\/pyblitz-proef\.html'/);
  assert.match(s, /X-Frame-Options', 'SAMEORIGIN'/);
  assert.doesNotMatch(r('public/pyblitz-proef.js') + r('public/pyblitz-proef-frame.js'), /innerHTML/);
});
