// v147 — link naar de leerlingen (klasmodus)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const { normaliseerLink, normaliseerLinks, domeinVan } = require('../lib/link');

test('147 link: https blijft, schema ontbreekt → https:// ervoor', () => {
  assert.strictEqual(normaliseerLink('Cursus', 'https://a.be/x?y=1').url, 'https://a.be/x?y=1');
  assert.strictEqual(normaliseerLink('', 'voorbeeld.be/pad').url, 'https://voorbeeld.be/pad');
});
test('147 link: titel standaard = domein zonder www, max 80 tekens', () => {
  assert.strictEqual(normaliseerLink('', 'https://www.voorbeeld.be/a').titel, 'voorbeeld.be');
  assert.strictEqual(normaliseerLink('x'.repeat(200), 'https://a.be').titel.length, 80);
  assert.strictEqual(domeinVan('https://www.a.be'), 'a.be');
});
test('147 link: javascript:, data:, ftp:, spaties, leeg en te lang worden geweigerd', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.be', 'https://a b.be', '', '   ', 'https://a.be/' + 'x'.repeat(2100), 'file:///etc/passwd', 'geenpunt']) {
    assert.strictEqual(normaliseerLink('t', u).ok, false, u);
  }
});
test('147 links: lijst opgeschoond, leeg blijft minstens één item, max 50', () => {
  assert.deepStrictEqual(normaliseerLinks(undefined), [{ titel: '', url: '' }]);
  const l = normaliseerLinks([{ titel: 'A', url: 'a.be' }, { titel: '', url: '' }]);
  assert.strictEqual(l[0].url, 'https://a.be/'); assert.strictEqual(l.length, 2);
  assert.strictEqual(normaliseerLinks(Array(80).fill({ titel: 'a', url: 'a.be' })).length, 50);
});
test('147 server: handlers, klasmodus-controle, drafts en state', () => {
  const s = r('server.js');
  assert.match(s, /socket\.on\("teacher_send_link"/);
  assert.match(s, /socket\.on\("teacher_clear_link"/);
  assert.match(s, /classWorkspaceMode \|\| "shared"\) !== "shared"/);
  assert.match(s, /links: linkLib\.normaliseerLinks\(links\)/);
  assert.match(s, /link: activeWorkspace === "shared" \? \(session\.link \|\| null\) : null/);
  assert.match(s, /session\.link = null;   \/\/ v147/);
});
test('147 UI: blok, fullscreen-slot, popup en versie', () => {
  const t = r('public/teacher-app.html'), st = r('public/student-app.html'), a = r('public/app.js');
  assert.match(t, /id="link-compose"/); assert.match(t, /id="tfs-slot-link"/); assert.match(t, /id="link-send-btn"/);
  assert.match(st, /id="student-link-card"/);
  assert.match(a, /socket\.on\('link_update'/); assert.match(a, /noopener,noreferrer/);
  assert.match(a, /links: linksSchoon\(_linkDrafts\)/);
  assert.match(r('VERSION').trim(), /^2026\.2\.51\.\d+$/);
});
