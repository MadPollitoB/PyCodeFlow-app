'use strict';
// v124: bronbewaking voor Toegang-pagina, sessieblad-dedupe en offline-opruiming.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('student_join gebruikt het account als identiteit en neemt bestaande blokken over', () => {
  const s = r('server.js');
  assert.match(s, /const accountJoin = socket\.data\.student/);
  assert.match(s, /x\.dbStudentId === accountJoin\.id/);
  assert.match(s, /neemVerbindingOver\(session, student, socket\)/);
  assert.match(s, /voegDubbelenSamen\(session, student, dezelfde\)/);
  assert.match(s, /sessie_overgenomen/);
  assert.match(s, /!accountJoin && !resumeId && actievenNogLevend/);
});
test('offline wordt bijgehouden en nooit automatisch opgeruimd', () => {
  const s = r('server.js');
  assert.match(s, /s\.offlineSince = Date\.now\(\)/);
  assert.match(s, /offlineSince: s\.socketId \? null/);
  assert.match(s, /socket\.on\("teacher_cleanup_offline"/);
  assert.doesNotMatch(s, /setInterval\([^)]*offlineSince/);
});
test('teacher-UI: rood na 60 s, inklapbare Offline-groep en Opruimen met pyConfirm', () => {
  const a = r('public/app.js');
  assert.match(a, /OFFLINE_ROOD_NA_MS = 60 \* 1000/);
  assert.match(a, /data-cleanup-offline/);
  assert.match(a, /Offline \(\$\{weg\.length\}\)/);
  assert.match(a, /teacher_cleanup_offline/);
  assert.match(a, /resumeId/);
  assert.match(a, /sessie_overgenomen/);
  assert.match(r('public/styles.css'), /\.student-item-offline/);
});
test('Toegang-pagina en nav voor alle leerkrachten, geen native dialogs', () => {
  assert.match(r('public/teacher-toegang.html'), /Netwerk ontgrendelen/);
  const js = r('public/teacher-toegang.js') + r('public/toegang-banner.js');
  assert.doesNotMatch(js, /\b(alert|confirm|prompt)\(/);
  assert.match(r('public/teacher-sessions.html'), /teacher-toegang\.html/);
  const s = r('server.js');
  assert.match(s, /\/api\/teacher\/toegang\/leerling/);
  assert.match(s, /\/api\/intern\/netwerk-ontgrendelen/);
});
test('pycodeflow.sh heeft menu 23 voor netwerk ontgrendelen', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/app/pycodeflow.sh'), 'utf8');
  assert.match(sh, /actie_netwerk_ontgrendelen/);
  assert.match(sh, /23\)/);
});
