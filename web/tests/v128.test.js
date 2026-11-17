'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('128 server: student_copy_to_class controleert klasmodus, recht en leeg werkblad', () => {
  const s = r('server.js');
  const i = s.indexOf('socket.on("student_copy_to_class"');
  assert.ok(i > 0);
  const blok = s.slice(i, i + 2200);
  assert.match(blok, /session\.mode !== "class"/);
  assert.match(blok, /s\.classCanEdit === false/);
  assert.match(blok, /s\.personalCode/);          // de server neemt de eigen werkbladcode, niet de client
  assert.match(blok, /!code\.trim\(\)/);
  assert.match(blok, /session\.sharedCode = code/);
  assert.match(blok, /sharedCodeSourceSocketId = null/);
  assert.match(blok, /codeNaarKlasAt = Date\.now\(\)/);
  assert.match(blok, /heeft zijn code naar de klas gezet/);
  assert.match(s, /codeNaarKlasAt: s\.codeNaarKlasAt \|\| null/);
  assert.match(s, /socket\.on\("teacher_reset_copy"/);
});

test('128 leerling: knop, enkel actief met recht en op het werkblad', () => {
  const h = r('public/student-app.html');
  assert.match(h, /id="student-copy-class-btn"[^>]*disabled/);
  const a = r('public/app.js');
  assert.match(a, /function updateStudentCopyToClassButton/);
  assert.match(a, /btn\.disabled = !\(heeftRecht && opWerkblad\)/);
  assert.match(a, /socket\.emit\('student_copy_to_class'/);
  assert.match(a, /updateStudentCopyToClassButton\(data\);\n\}/);
});

test('128 leerkracht: melding in balk en leerlingenlijst, geen native dialogs', () => {
  const a = r('public/app.js');
  assert.match(a, /tfs-copy-bar/);
  assert.match(a, /_tfsResetCopy/);
  assert.match(a, /kopieBadge/);
  const i = a.indexOf('function updateStudentCopyToClassButton');
  assert.doesNotMatch(a.slice(i, i + 1500), /\b(alert|confirm|prompt)\(/);
  assert.match(r('public/teacher-app.html'), /id="tfs-copy-bar"/);
});
