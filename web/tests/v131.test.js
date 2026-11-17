'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('131 dupliceren: groepen en alle instellingen worden doorgegeven', () => {
  const s = r('server.js');
  const i = s.indexOf("app.post('/api/quiz/:code/duplicate'");
  const blok = s.slice(i, i + 6500);
  for (const k of ['randomGroup: parseInt(q.random_group)', 'autoSubmitLate: meta.auto_submit_late', 'noBack: meta.no_back',
    'tabSwitchEnabled: meta.tab_switch_enabled', 'tabSwitchThreshold: meta.tab_switch_threshold', 'tabSwitchGraceSeconds: meta.tab_switch_grace_seconds',
    'cursusLinks: meta.cursus_links', 'selfEvalEnabled: meta.self_eval_enabled', 'klasbordEnabled: meta.klasbord_enabled',
    'fullscreenRequired: meta.fullscreen_required', 'copyPasteBlocked: meta.copy_paste_blocked', 'accessFrom: meta.access_from']) {
    assert.ok(blok.includes(k), 'ontbreekt: ' + k);
  }
  assert.doesNotMatch(blok, /reviewMode|results_released: /);
});

test('131 bevestigingsscherm: instellingenblok en groepkoppen met aantal en punten', () => {
  const j = r('public/quiz-teacher.js');
  const i = j.indexOf('function renderConfirm()');
  const blok = j.slice(i, j.indexOf('async function createQuiz()'));
  for (const k of ['Automatisch indienen', '1 kans per vraag', 'Anti-spiek', 'Volledig scherm', 'Kopiëren/plakken', 'Cursus-link', 'Zelfevaluatie', 'Klasbord', 'Deadline']) {
    assert.ok(blok.includes(k), 'ontbreekt: ' + k);
  }
  assert.match(blok, /i === 0 \|\| _groupBreaks\.has\(id\)/);
  assert.match(blok, /gi\.n/);
  assert.match(blok, /gi\.p === 1 \? 'punt' : 'punten'/);
});
