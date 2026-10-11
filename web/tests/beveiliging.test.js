'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const db = rd('db/database.js');
const srv = rd('server.js');
const stu = rd('public/quiz-student.js');
const tea = rd('public/quiz-teacher.js');

test('kolommen standaard aan voor toets én taak', () => {
  assert.match(db, /fullscreen_required BOOLEAN NOT NULL DEFAULT true/);
  assert.match(db, /copy_paste_blocked BOOLEAN NOT NULL DEFAULT true/);
  assert.match(db, /fullscreenRequired !== false, copyPasteBlocked !== false/);
});

test('server geeft de instellingen door aan leerling, startinfo en bewerkscherm', () => {
  assert.ok((srv.match(/fullscreenRequired: meta\.fullscreen_required !== false/g) || []).length >= 3);
  assert.ok((srv.match(/copyPasteBlocked: meta\.copy_paste_blocked !== false/g) || []).length >= 3);
});

test('cursus-link is niet langer enkel voor toetsen', () => {
  assert.doesNotMatch(srv, /type === 'toets' \? \(cursusUrl/);
  assert.doesNotMatch(srv, /meta\.type === 'toets' \? \(cursusUrl/);
  assert.doesNotMatch(tea, /isToetsType \? \(document\.getElementById\('quiz-cursus-url'\)/);
});

test('leerling: kopiëren/plakken geblokkeerd in capture-fase en vergrendeling zonder volledig scherm', () => {
  assert.match(stu, /\['copy', 'cut', 'paste', 'drop', 'dragstart', 'contextmenu'\]/);
  assert.match(stu, /addEventListener\(ev, stop, true\)/);
  assert.match(stu, /function updateFullscreenVergrendeling/);
  assert.match(stu, /fullscreenMogelijk\(\)/);       // geen blokkade op toestellen zonder fullscreen
  assert.match(stu, /_afgesloten/);                  // indienen is de uitweg
  assert.match(rd('public/quiz-student.html'), /id="fullscreen-overlay"/);
});

test('leerkrachtformulier: twee vinkjes standaard aan, voor beide types', () => {
  const h = rd('public/quiz-teacher.html');
  assert.match(h, /id="quiz-copypaste-blocked" checked/);
  assert.match(h, /id="quiz-fullscreen-required" checked/);
  assert.match(tea, /copyPasteBlocked, fullscreenRequired/);
});

test('inline scripts blijven geldig', () => {
  for (const f of ['public/quiz-student.js', 'public/quiz-teacher.js']) assert.doesNotThrow(() => new Function(rd(f)));
});

test('v114: auto-indienen bij tabwissel geldt ook voor taken', () => {
  assert.doesNotMatch(srv, /meta\.type !== 'toets' \|\| meta\.tab_switch_enabled/);
  assert.match(db, /const effectiveTabSwitchEnabled = tabSwitchEnabled === true;/);
  assert.match(stu, /if \(!_tabSwitchEnabled \|\| _afgesloten/);
  assert.doesNotMatch(tea, /isToetsType && document\.getElementById\('quiz-tabswitch-enabled'\)/);
  assert.match(tea, /antiSpiekSectie\.style\.display = ''/);
});
