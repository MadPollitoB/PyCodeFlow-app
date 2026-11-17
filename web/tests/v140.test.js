// v140 — "▶ Uitvoeren" in het nakijkscherm werkt weer (eigen, beveiligde route voor de leerkracht)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('140 server: review_run_request is enkel voor ingelogde leerkrachten en heeft limieten', () => {
  const s = r('server.js');
  const i = s.indexOf("socket.on('review_run_request'");
  assert.ok(i > 0);
  const blok = s.slice(i, i + 2500);
  assert.match(blok, /socketIsTeacherAuthorized\(socket\)/);
  assert.match(blok, /codeText\.length > 32768/);
  assert.match(blok, /RUN_RATE_LIMIT_MS/);
  assert.match(blok, /checkIpRateLimit/);
  assert.match(s, /socket\.on\('review_runtime_input'/);
  assert.match(s, /reviewRun\.runId\) \{ fetch\(`\$\{RUNNER_URL\}\/runs\/\$\{reviewRun\.runId\}\/cancel`/, 'run stopt bij sluiten pagina');
});

test('140 client: nakijkscherm gebruikt de nieuwe events en toont wachtrij/limiet', () => {
  const c = r('public/quiz-review.js');
  assert.match(c, /_socket\.emit\('review_run_request', \{ codeText: code \}\)/);
  assert.match(c, /_socket\.emit\('review_runtime_input'/);
  assert.ok(!/emit\('free_run_request'/.test(c), 'niet meer de leerling-route');
  assert.match(c, /_socket\.on\('free_run_queued'/);
  assert.match(c, /_socket\.on\('free_run_rate_limited'/);
});
