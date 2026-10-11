'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const lees = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function laadMd() {
  const w = {}; const f = new Function('window', 'document', lees('public', 'md-editor.js'));
  f(w, { getElementById() { return null; }, createElement() { return {}; }, head: {} });
  return w.PCMd;
}

test('opmaak: gewone tekens in oude vragen blijven gewone tekst', () => {
  const md = laadMd();
  const uit = md._voorbewerk('Weerbericht voor <stad>: 2 * 3 en mijn_var\n# geen kop');
  assert.ok(uit.includes('&lt;stad>'), '<stad> moet als tekst blijven');
  assert.ok(uit.includes('2 &#42; 3') && uit.includes('mijn&#95;var'));
  assert.ok(uit.includes('&#35; geen kop'));
});

test('opmaak: toegelaten tags en code blijven intact, kaders worden omgezet', () => {
  const md = laadMd();
  const uit = md._voorbewerk('Een <b>vet</b> en <u>onderlijnd</u> woord en `print(a * b)`\n:::opgelet\nLet op!\n:::');
  assert.ok(uit.includes('<b>vet</b>') && uit.includes('<u>onderlijnd</u>'));
  assert.ok(uit.includes('`print(a * b)`'), 'sterretjes in code blijven ongemoeid');
  assert.ok(uit.includes('info-kader info-opgelet') && uit.includes('Let op!'));
  assert.ok(!uit.includes(':::'));
});

test('opmaak: zonder marked/DOMPurify wordt tekst veilig geëscaped', () => {
  const md = laadMd();
  const html = md.render('<img src=x onerror=alert(1)>\nregel 2');
  assert.ok(!html.includes('<img') && html.includes('&lt;img') && html.includes('<br>'));
});

test('opmaak: editor en leerlingscherm gebruiken PCMd', () => {
  const ov = lees('public', 'training-overzicht.html'); const tr = lees('public', 'training.html');
  for (const h of [ov, tr]) { assert.ok(h.includes('/md-editor.js') && h.includes('/vendor/dompurify/purify.min.js') && h.includes('/vendor/marked/marked.min.js')); }
  assert.ok(ov.includes("PCMd.toolbar($('vf-tekst'))") && ov.includes("PCMd.toolbar($('vf-uitleg'))"));
  assert.ok(/PCMd\.zetHtml\(tt, v\.text\)/.test(tr), 'vraagtekst wordt opgemaakt getoond');
  const js = lees('public', 'md-editor.js');
  for (const t of ["'Vet'", "'Onderlijnd'", "'Cursief'", 'Opgelet', 'Tip']) assert.ok(js.includes(t), t);
});

test('analyse-route en formulierpaneel bestaan', () => {
  assert.ok(lees('lib', 'training-routes.js').includes("'/api/teacher/training/questions/analyse'"));
  const ov = lees('public', 'training-overzicht.html');
  assert.ok(ov.includes('analyseerForm') && ov.includes('vf-analyse'));
});

test('versie: de hoogste VERSION-kopie wint en de rebuild controleert de deploy', () => {
  const srv = lees('server.js');
  assert.ok(srv.includes('de hoogste wordt getoond') && srv.includes('gevonden.sort(cmp)'));
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'app', 'pycodeflow.sh'), 'utf8');
  assert.ok(sh.includes('controleer_deploy()') && /ok "Rebuild voltooid\."\s*\n\s*controleer_deploy/.test(sh));
});

test('versie: alle pagina\'s en het VERSION-bestand dragen dezelfde versie', () => {
  const v = fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
  assert.strictEqual(lees('VERSION').trim(), v);
  const verkeerd = [];
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'public')).filter(n => /\.(html|js)$/.test(n))) {
    const s = lees('public', f);
    for (const m of s.matchAll(/\?v=v?(2026\.2\.51\.\d+)/g)) if (m[1] !== v) verkeerd.push(f + ' ' + m[1]);
  }
  assert.deepStrictEqual(verkeerd, [], 'pagina\'s met een andere versie dan VERSION');
});

test('vragen aanpassen: checklist-editor, vergrendelde algemene vragen en scrollbare popups', () => {
  const ov = lees('public', 'training-overzicht.html');
  assert.ok(ov.includes('function tekenChecks') && ov.includes('function leesChecks') && ov.includes('CK_SOORTEN'));
  assert.ok(!ov.includes("id: 'vf-checks'"), 'de JSON-checklist is vervangen');
  assert.ok(ov.includes('🔒 Aanpassen'));
  assert.ok(/\.vf \{[^}]*max-height:calc\(100vh - 48px\); overflow-y:auto/.test(ov) && /\.dt \{[^}]*max-height:calc\(100vh - 48px\); overflow-y:auto/.test(ov));
});

test('popups: nergens nog alert(), confirm() of prompt() van de browser', () => {
  const dir = path.join(__dirname, '..', 'public');
  const fouten = [];
  for (const f of fs.readdirSync(dir).filter(n => /\.(html|js)$/.test(n))) {
    const src = lees('public', f).split('\n');
    src.forEach((regel, i) => {
      if (/^\s*(\*|\/\/)/.test(regel)) return;
      const r = regel.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/(^|[^\w.$])(window\.)?(alert|confirm|prompt)\(/.test(r)) fouten.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(fouten, [], 'gebruik pyAlert/pyConfirm/pyPrompt: ' + fouten.join(', '));
  assert.ok(lees('public', 'popups.js').includes('window.pyConfirm = function'));
  // elke pagina die popups gebruikt laadt popups.js
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.html'))) {
    const h = lees('public', f);
    if (/<script src="\/(app|training-code)\.js/.test(h) || /pyAlert|pyConfirm|pyPrompt/.test(h)) assert.ok(h.includes('/popups.js'), f + ' mist popups.js');
  }
});
