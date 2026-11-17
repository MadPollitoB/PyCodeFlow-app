'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const lees = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCRIPT = 'scripts/app/pycodeflow.sh';

test('127 compose: Ollama staat enkel nog in een eigen compose', () => {
  const hoofd = lees('docker-compose.yml');
  assert.doesNotMatch(hoofd, /image: ollama\/ollama/);
  assert.doesNotMatch(hoofd, /ollama_data:/);
  const o = lees('docker-compose.ollama.yml');
  assert.match(o, /^name: pycodeflow-ollama/m);
  assert.match(o, /image: ollama\/ollama/);
  assert.match(o, /container_name: pycodeflow-ollama-1/);
  assert.match(o, /\$\{OLLAMA_BIND:-0\.0\.0\.0\}:\$\{OLLAMA_PORT:-11434\}:11434/);
  assert.match(o, /name: \$\{OLLAMA_VOLUME:-pycodeflow_ollama_data\}/);
  assert.doesNotMatch(o, /profiles:/);
  assert.match(o, /extra_hosts|host\.docker\.internal/.test(hoofd) ? /./ : /./);
  assert.match(hoofd, /host\.docker\.internal:host-gateway/);
});

test('127 compose: beide bestanden zijn geldige compose (indien docker aanwezig)', (t) => {
  const v = spawnSync('docker', ['compose', 'version']);
  if (v.status !== 0) return t.skip('docker compose niet beschikbaar');
  const r = spawnSync('docker', ['compose', '-f', path.join(ROOT, 'docker-compose.ollama.yml'), 'config', '-q']);
  assert.strictEqual(r.status, 0, String(r.stderr));
});

test('127 pycodeflow.sh: syntax OK en Ollama-code is in één blok te verwijderen', () => {
  const src = lees(SCRIPT);
  assert.strictEqual(spawnSync('bash', ['-n', SCRIPT], { cwd: ROOT }).status, 0);
  assert.match(src, /OLLAMA-LOKAAL-START/);
  assert.match(src, /OLLAMA-LOKAAL-EINDE/);
  const gestript = spawnSync('sed', ['/OLLAMA-LOKAAL-STAR[T]/,/OLLAMA-LOKAAL-EIND[E]/d; /\\[OLLAMA-LOKAAL\\]/d', SCRIPT], { cwd: ROOT }).stdout.toString();
  const tmp = path.join(os.tmpdir(), 'pcf-stripped-' + process.pid + '.sh');
  fs.writeFileSync(tmp, gestript);
  assert.strictEqual(spawnSync('bash', ['-n', tmp]).status, 0);
  assert.doesNotMatch(gestript, /ollama_lokaal|configureer_ollama|OLLAMA_COMPOSE/);
  fs.unlinkSync(tmp);
  // alle haken staan op de juiste plaatsen: wizard, start, stop, herstart, rebuild, reset
  const haken = (src.match(/\[OLLAMA-LOKAAL\]/g) || []).length;
  assert.ok(haken >= 9, 'verwacht minstens 9 haken, kreeg ' + haken);
});

// Draait het Ollama-blok in een tijdelijke map met een nep-"docker".
function draai(envInhoud, stdin, extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf127-'));
  fs.writeFileSync(path.join(dir, '.env'), envInhoud);
  fs.writeFileSync(path.join(dir, 'docker-compose.ollama.yml'), 'services: {}\n');
  const src = lees(SCRIPT);
  const helpers = src.slice(src.indexOf('ok()   {'), src.indexOf('# Genereert een sterke'))
    + src.slice(src.indexOf('container_status() {'), src.indexOf('container_status() {') + 200).split('\n}\n')[0] + '\n}\n';
  const blok = src.slice(src.indexOf('# >>> OLLAMA-LOKAAL-START'), src.indexOf('# <<< OLLAMA-LOKAAL-EINDE'));
  const script = `
BASE="${dir}"; ENV_FILE="$BASE/.env"
BLAUW=; GROEN=; GEEL=; ROOD=; RESET=; BOLD=; DIM=
${helpers}
docker() { echo "docker $*" >> "$BASE/docker.log"; case "$1" in inspect) echo "pycodeflow";; esac; return 0; }
${blok}
${extra}
`;
  const f = path.join(dir, 't.sh');
  fs.writeFileSync(f, script);
  const r = spawnSync('bash', [f], { input: stdin, encoding: 'utf8' });
  const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  const log = fs.existsSync(path.join(dir, 'docker.log')) ? fs.readFileSync(path.join(dir, 'docker.log'), 'utf8') : '';
  return { r, env, log };
}

test('127 migratie: oude opzet (http://ollama:11434) wordt omgezet en model-switch aangeboden', () => {
  const { r, env } = draai('OLLAMA_URL=http://ollama:11434\nOLLAMA_MODEL=qwen2.5-coder:7b\nCOMPOSE_PROFILES=ollama\n', 'ja\n', 'configureer_ollama');
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(env, /^OLLAMA_URL=http:\/\/host\.docker\.internal:11434$/m);
  assert.match(env, /^OLLAMA_LOKAAL=true$/m);
  assert.doesNotMatch(env, /COMPOSE_PROFILES/);
  assert.match(env, /^OLLAMA_MODEL=qwen3\.5:9b$/m);
  assert.match(env, /^OLLAMA_THINK=false$/m);
});

test('127 nieuwe installatie: "nee" + extern adres → OLLAMA_LOKAAL=false, geen lokale start', () => {
  const { r, env, log } = draai('FOO=1\n', 'nee\nhttp://100.64.0.9:11434\n', 'configureer_ollama; ollama_lokaal_start');
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(env, /^OLLAMA_LOKAAL=false$/m);
  assert.match(env, /^OLLAMA_URL=http:\/\/100\.64\.0\.9:11434$/m);
  assert.match(env, /^OLLAMA_MODEL=qwen3\.5:9b$/m);
  assert.doesNotMatch(log, /compose/);
});

test('127 nieuwe installatie: "JA" → lokaal, start via eigen compose met project pycodeflow-ollama', () => {
  const { r, env, log } = draai('FOO=1\n', 'JA\n', 'configureer_ollama; ollama_lokaal_start; ollama_lokaal_stop');
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(env, /^OLLAMA_LOKAAL=true$/m);
  assert.match(env, /^OLLAMA_URL=http:\/\/host\.docker\.internal:11434$/m);
  assert.match(log, /compose -p pycodeflow-ollama -f .*docker-compose\.ollama\.yml --env-file .* up -d/);
  assert.match(log, /ollama pull qwen3\.5:9b/);
  assert.match(log, /pycodeflow-ollama -f .* down/);
});

test('127 met OLLAMA_LOKAAL=false doen start/stop niets', () => {
  const { r, log } = draai('OLLAMA_LOKAAL=false\nOLLAMA_URL=http://10.0.0.5:11434\nOLLAMA_MODEL=x\n', '', 'ollama_lokaal_start; ollama_lokaal_stop');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(log, /compose/);
});

// ── thinking-parameter ───────────────────────────────────────────────────────
function laadGrading(envThink) {
  delete require.cache[require.resolve('../lib/ai-grading')];
  if (envThink === undefined) delete process.env.OLLAMA_THINK; else process.env.OLLAMA_THINK = envThink;
  return require('../lib/ai-grading');
}
function nepFetch(antwoorden) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const a = antwoorden.shift();
    return {
      ok: a.status === undefined || a.status < 400, status: a.status || 200,
      text: async () => a.tekst || '',
      json: async () => ({ message: { content: JSON.stringify(a.json || { val_tekst: 'x' }) } }),
    };
  };
  return calls;
}

test('127 thinking staat standaard UIT en kan per aanroep aan', async () => {
  const orig = global.fetch;
  try {
    let g = laadGrading(undefined);
    assert.strictEqual(g.OLLAMA_MODEL, process.env.OLLAMA_MODEL || 'qwen3.5:9b');
    let calls = nepFetch([{}]);
    await g._ollamaChat('p', {});
    assert.strictEqual(calls[0].think, false);
    calls = nepFetch([{}]);
    await g._ollamaChat('p', {}, { think: true });
    assert.strictEqual(calls[0].think, true);
    calls = nepFetch([{}]);
    await g.generateHiddenTrap('vraag', { think: true });
    assert.strictEqual(calls[0].think, true);
    calls = nepFetch([{ json: { score: 1, comment: 'ok' } }]);
    await g.gradeAnswer({ maxPunten: 2, vraag: 'v', antwoord: 'a', model: 'm', studentAnswer: 'a', question: 'v' });
    assert.strictEqual(calls[0].think, false);
    g = laadGrading('true');
    calls = nepFetch([{}]);
    await g._ollamaChat('p', {});
    assert.strictEqual(calls[0].think, true);
  } finally { global.fetch = orig; laadGrading(undefined); }
});

test('127 model zonder thinking-ondersteuning: automatisch opnieuw zonder think', async () => {
  const orig = global.fetch;
  try {
    const g = laadGrading(undefined);
    const calls = nepFetch([{ status: 400, tekst: '{"error":"model does not support thinking"}' }, {}]);
    const r = await g._ollamaChat('p', {});
    assert.deepStrictEqual(r, { val_tekst: 'x' });
    assert.strictEqual(calls.length, 2);
    assert.ok(!('think' in calls[1]));
  } finally { global.fetch = orig; }
});

test('127 standaardmodel is qwen3.5:9b (code en script)', () => {
  assert.match(lees('web/lib/ai-grading.js'), /'qwen3\.5:9b'/);
  assert.match(lees(SCRIPT), /OLLAMA_NIEUW_MODEL="qwen3\.5:9b"/);
});
