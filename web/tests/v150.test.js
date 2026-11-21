// v150 — bugfix: heropenen gaf 1 minuut; startknop bleef grijs bij een heropende leerling
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('150 bulk-heropenen: extra seconden uit de gekozen eindtijd + live student bijwerken', () => {
  const s = r('server.js');
  const i = s.indexOf("app.post('/api/quiz-sessions/:code/reopen-bulk'");
  const blok = s.slice(i, i + 3500);
  assert.match(blok, /bouwHerstelPlan\(code, s\.id, s\.name, minTot, 'vanafNu'\)/);
  assert.match(blok, /setIndividualAccess\(code, s\.id, s\.name \|\| null, toegangTot, extraSec\)/);
  assert.match(blok, /live\.quizExtraSeconds = extraSec/);
});
test('150 startinfo: heropende leerling is niet "stopped" en krijgt heropendTot', () => {
  const s = r('server.js');
  assert.match(s, /stopped: !!meta\.stopped_at && heropendTot == null/);
  assert.match(s, /getIndividualAccessUntil\(String\(req\.params\.code \|\| ''\)\.toUpperCase\(\), null, leerlingNaam\)/);
  const c = r('public/quiz-student.js');
  assert.match(c, /'\/startinfo' \+ \(urlName \? '\?name=' \+ encodeURIComponent\(urlName\)/);
  assert.match(c, /Heropend door je leerkracht/);
});
test('150 "Heropenen" per leerling gebruikt het herstelvenster (geen 1 minuut meer)', () => {
  const a = r('public/app.js');
  const f = a.slice(a.indexOf('window.heropenLeerling'), a.indexOf('window.duplicateQuiz'));
  assert.match(f, /return window\.herstelLeerling\(code, studentId, studentName, \{ bron: 'heropenen' \}\)/);
  assert.doesNotMatch(f, /\/reopen'/);
});
test('150 versie', () => assert.match(r('VERSION').trim(), /^2026\.2\.51\.\d+$/));
