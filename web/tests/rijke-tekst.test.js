'use strict';
// v125: opmaak in opdrachten — strikte whitelist + bronbewaking voor de nieuwe sessiescherm-indeling.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { sanitizeRt, rtLeeg } = require('../public/rijke-tekst.js');
const r = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('toegelaten opmaak blijft, scripts en attributen verdwijnen', () => {
  assert.equal(sanitizeRt('<b>vet</b> en <u>onderlijnd</u>'), '<b>vet</b> en <u>onderlijnd</u>');
  const slecht = sanitizeRt('<script>alert(1)</script><b onclick="x()">a</b><img src=x onerror=alert(1)><a href="javascript:x">l</a>');
  assert.doesNotMatch(slecht, /<script|onclick|onerror|<img|<a |javascript/i);
  assert.match(slecht, /<b>a<\/b>/);
});
test('kleur enkel via de zes klassen, geen style-attribuut', () => {
  assert.equal(sanitizeRt('<span class="rt-c3">groen</span>'), '<span class="rt-c3">groen</span>');
  assert.equal(sanitizeRt('<span class="evil" style="color:red">x</span>'), '<span>x</span>');
  assert.equal(sanitizeRt('<span class="rt-c9">x</span>'), '<span>x</span>');
});
test('code en codeblok blijven, tags erin worden tekst', () => {
  assert.equal(sanitizeRt('<code>print(1)</code>'), '<code>print(1)</code>');
  assert.equal(sanitizeRt('<pre>x &lt; 3</pre>'), '<pre>x &lt; 3</pre>');
  assert.equal(sanitizeRt('<code>a < b</code>').includes('&lt;'), true);
});
test('oude gewone tekst blijft leesbaar: regeleindes worden <br>, en wordt ge-escaped', () => {
  assert.equal(sanitizeRt('regel 1\nregel 2'), 'regel 1<br>regel 2');
  assert.equal(sanitizeRt('a & b'), 'a &amp; b');
  assert.equal(sanitizeRt('3 < 5'), '3 &lt; 5');
});
test('tags worden netjes gesloten en niet-passende sluittags genegeerd', () => {
  assert.equal(sanitizeRt('<b>open'), '<b>open</b>');
  assert.equal(sanitizeRt('dicht</b>'), 'dicht');
  assert.equal(sanitizeRt('<b><i>x</b></i>'), '<b><i>x</i></b>');
});
test('leeg: enkel lege regels en tags telt als leeg', () => {
  assert.equal(rtLeeg('<div><br></div>'), true);
  assert.equal(rtLeeg('&nbsp;'), true);
  assert.equal(rtLeeg('<b>a</b>'), false);
});
test('begrensde lengte en diepte', () => {
  assert.ok(sanitizeRt('x'.repeat(50000)).length <= 12000);
  const diep = '<div>'.repeat(40) + 'x' + '</div>'.repeat(40);
  assert.ok((sanitizeRt(diep).match(/<div>/g) || []).length <= 12);
});

test('server: opdrachten gesaneerd, bewaren op knop, rebind zonder reset, hartslag', () => {
  const s = r('server.js');
  assert.match(s, /session\.announcement = schoneOpdracht\(text\)/);
  assert.match(s, /map\(t => schoneOpdracht\(t\)\)/);
  assert.match(s, /socket\.on\("teacher_save_drafts"/);
  assert.match(s, /socket\.on\("teacher_rebind"/);
  assert.match(s, /socket\.on\("teacher_ping"/);
  const rebind = s.slice(s.indexOf('socket.on("teacher_rebind"'), s.indexOf('socket.on("teacher_ping"'));
  assert.doesNotMatch(rebind, /classCanRun = false/, 'rebind mag de leerlingrechten niet resetten');
  assert.match(r('db/database.js'), /_drafts/);
});
test('client: nooit automatisch naar de server bij typen; hartslag en rebind aanwezig', () => {
  const a = r('public/app.js');
  assert.match(a, /teacher_save_drafts/);
  const input = a.slice(a.indexOf("qs('teacher-announcement-input')?.addEventListener('input'"), a.indexOf("qs('announcement-nav-prev-btn')"));
  assert.doesNotMatch(input, /socket\.emit/);
  assert.match(a, /teacher_rebind/);
  assert.match(a, /teacher_ping/);
  assert.match(a, /setInterval\(controleer, 20000\)/);
  assert.match(a, /window\.sanitizeRt/);
  assert.doesNotMatch(a.slice(a.indexOf('bewaakLeerkrachtVerbinding')), /\b(?:alert|confirm|prompt)\(/ , 'geen native dialogs');
});
test('sessiescherm: drie blokken bovenaan en lijsten CODE links, RUN rechts', () => {
  const h = r('public/teacher-app.html');
  assert.match(h, /id="tfs-slot-opdracht"/);
  assert.match(h, /id="tfs-slot-voorbeeld"/);
  assert.match(h, /tfs-top-controls/);
  assert.ok(h.indexOf('id="tfs-pills-group-code"') < h.indexOf('id="tfs-pills-group-run"'), 'CODE staat links van RUN');
  assert.match(h, /contenteditable="true"/);
  assert.match(h, /rijke-tekst\.js/);
  assert.match(r('public/student-app.html'), /rijke-tekst\.js/);
  const c = r('public/styles.css');
  assert.match(c, /\.tfs-pills-row \{ display: flex; flex-direction: column/);
  assert.match(c, /\.rt-c1/);
});

test('volledig scherm: offline-blok onderaan, even breed als CODE+RUN, vaste hoogte, 2 kolommen van 10', () => {
  const h = r('public/teacher-app.html');
  assert.ok(h.indexOf('id="tfs-offline-block"') > h.indexOf('id="tfs-pills-group-run"'), 'offline staat onder CODE/RUN');
  const c = r('public/styles.css');
  assert.match(c, /\.tfs-offline-block \{ flex: none; height: min\(330px, 40vh\)/);
  assert.match(c, /grid-template-rows: repeat\(10, minmax\(0, 1fr\)\)/);
  assert.match(c, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  const a = r('public/app.js');
  assert.match(a, /TFS_OFFLINE_NA_MS = 30 \* 1000/);
  assert.match(a, /tfs-offline-row/);
});
test('volledig scherm: opdracht + voorbeelden samen even breed als het codeveld, timer boven de lijsten', () => {
  const c = r('public/styles.css');
  assert.match(c, /\.tfs-top \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 6px var\(--tfs-sidebar-w/);
  assert.match(c, /\.tfs-top-left \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});
