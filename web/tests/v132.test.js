'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const v = require('../lib/validation.js');

test('132 validatie: links normaliseren, filteren en weigeren', () => {
  const ok = v.normaliseerCursusLinks([
    { id: 'a', title: '  Cursus  ', url: 'https://x.be/a', questionIds: ['1', '2', '9', '1'] },
    { url: 'https://x.be/b' },
  ], null, ['1', '2', '3']);
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.links[0], { id: 'a', title: 'Cursus', url: 'https://x.be/a', questionIds: ['1', '2'] });
  assert.strictEqual(ok.links[1].title, 'Link 2');
  assert.deepStrictEqual(ok.links[1].questionIds, []);
  assert.strictEqual(v.normaliseerCursusLinks([{ url: 'http://x.be' }], null, []).ok, false);
  assert.strictEqual(v.normaliseerCursusLinks([{ url: '' }], null, []).ok, false);
  assert.strictEqual(v.normaliseerCursusLinks('geen lijst', null, []).ok, false);
  assert.strictEqual(v.normaliseerCursusLinks(Array.from({ length: 21 }, () => ({ url: 'https://x.be' })), null, []).ok, false);
  assert.strictEqual(v.normaliseerCursusLinks([{ url: 'https://x.be', title: 'x'.repeat(100) }], null, []).links[0].title.length, 40);
});

test('132 validatie: oude cursusUrl wordt één link voor alle vragen; niets = geen links', () => {
  const oud = v.normaliseerCursusLinks(undefined, ' https://oud.be/c ', ['1', '2']);
  assert.deepStrictEqual(oud.links.map(l => l.questionIds), [['1', '2']]);
  assert.deepStrictEqual(v.normaliseerCursusLinks(undefined, '', ['1']).links, []);
  assert.deepStrictEqual(v.normaliseerCursusLinks([], 'https://oud.be', ['1']).links, []);
});

test('132 server: opslaan, edit-GET, dupliceren en leerling-state gebruiken de links', () => {
  const s = r('server.js');
  assert.strictEqual((s.match(/normaliseerCursusLinks\(cursusLinks, cursusUrl, questions\.map/g) || []).length, 2);
  assert.strictEqual((s.match(/cursusLinks: JSON\.stringify\(cursusCheck\.links\)/g) || []).length, 2);
  assert.match(s, /cursusLinks: leesCursusLinks\(meta\)/);
  assert.match(s, /cursusLinks: meta\.cursus_links \|\| '\[\]'/);
  assert.match(s, /cursusLinks: cursusLinksVoorLeerling\(meta, questions\)/);
  assert.doesNotMatch(s, /cursusUrl: meta\.cursus_url/);
  const i = s.indexOf('function cursusLinksVoorLeerling');
  assert.match(s.slice(i, i + 700), /filter\(l => l\.url && l\.vragen\.length\)/);
});

test('132 database: kolom, opslag en migratie van de oude cursus_url', () => {
  const d = r('db/database.js');
  assert.match(d, /ADD COLUMN cursus_links TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(d, /cursus_links = \$16, cursus_url = NULL/);
  assert.match(d, /WHERE ab\.cursus_url IS NOT NULL AND ab\.cursus_url <> '' AND ab\.cursus_links = '\[\]'/);
  assert.match(d, /copy_paste_blocked, cursus_links, mc_scoring, pool_json, created_at\)/);
});

test('132 aanmaakscherm: rooster, popup met groepen, oude invoer weg', () => {
  const h = r('public/quiz-teacher.html');
  assert.ok(h.includes('id="cl-lijst"') && h.includes('voegCursusLinkToe()'));
  assert.ok(!h.includes('quiz-cursus-url'));
  const j = r('public/quiz-teacher.js');
  assert.ok(!j.includes('quiz-cursus-url'));
  for (const k of ['function openCursusKoppeling', 'indeterminate', 'Alle vragen', 'function beschrijfKoppeling', 'function synchroniseerCursusKoppelingen',
    'function verzamelCursusLinks', 'renderCursusLinks();   // v132', 'cursusLinks,', 'niet gekoppeld aan een vraag']) {
    assert.ok(j.includes(k), 'ontbreekt: ' + k);
  }
  assert.doesNotMatch(j, /cursusUrl/);
});

test('132 leerling: tabs per vraag, geen botsing met de klassessie-stijl', () => {
  const j = r('public/quiz-student.js');
  assert.match(j, /function updateCursusVoorVraag\(qid\)/);
  assert.match(j, /updateCursusVoorVraag\(q\.id\);/);
  assert.match(j, /setupCursusPaneel\(state\.cursusLinks \|\| \[\]\)/);
  assert.match(j, /'cursus-linktab'/);
  assert.doesNotMatch(j, /state\.cursusUrl/);
  const h = r('public/quiz-student.html');
  assert.ok(h.includes('id="cursus-tabs"') && h.includes('.cursus-linktab'));
  assert.ok(!h.includes('.cursus-tab{'));
});
