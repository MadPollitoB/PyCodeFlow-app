'use strict';
// v123 — voorbereide codevoorbeelden in klasmodus (werkwijze zoals de opdrachten).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const lees = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = lees('public/teacher-app.html');
const app = lees('public/app.js');

test('v123: paneel met veld, Vorige/Volgende, Nieuw, Wissen en "Naar codeveld"', () => {
  for (const id of ['code-draft-input', 'code-nav-prev-btn', 'code-nav-next-btn', 'code-nav-add-btn', 'code-nav-pos', 'code-send-btn', 'code-clear-btn'])
    assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, />Naar codeveld</);
  assert.doesNotMatch(html.slice(html.indexOf('id="code-compose"'), html.indexOf('teacher-announcement-card')), />Sturen</);
});
test('v123: "Naar codeveld" vervangt de editorinhoud via een gewone wijziging (sync naar leerlingen, Ctrl+Z werkt)', () => {
  const blok = app.slice(app.indexOf("qs('code-send-btn')"));
  assert.match(blok, /executeEdits\('codevoorbeeld'/);
  assert.doesNotMatch(blok.slice(0, 900), /setEditorValue/);   // die zou de sync onderdrukken
});
test('v123: voorbeelden blijven bewaard na een herlaad en Tab springt in', () => {
  // v125: per sessie in localStorage (sleutel pcf-drafts-<code>); de oude gedeelde sleutel wordt enkel nog eenmalig gelezen
  assert.match(app, /localStorage\.setItem\(draftSleutel\(\)/);
  assert.match(app, /localStorage\.getItem\('pcf-code-drafts'\)/);
  assert.match(app, /e\.key !== 'Tab'/);
});
test('v123: geen native browserdialogen in de nieuwe code', () => {
  const blok = app.slice(app.indexOf('v123: voorbereide codevoorbeelden'), app.indexOf("qs('teacher-send-input-btn')"));
  assert.doesNotMatch(blok.replace(/window\.pyAlert/g, ''), /\b(alert|confirm|prompt)\(/);
});
