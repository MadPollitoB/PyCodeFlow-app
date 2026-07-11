// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 32b — Unit tests: gestructureerde logger (lib/logger.js)
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createLogger, formatLine, shouldLog, resolveLevel } = require('../lib/logger');

// ── resolveLevel ──────────────────────────────────────────────────────────────
test('resolveLevel: geldige niveaus', () => {
  assert.strictEqual(resolveLevel('debug'), 'debug');
  assert.strictEqual(resolveLevel('ERROR'), 'error');
  assert.strictEqual(resolveLevel('Warn'), 'warn');
});

test('resolveLevel: ongeldig → fallback info', () => {
  assert.strictEqual(resolveLevel('onzin'), 'info');
  assert.strictEqual(resolveLevel(''), 'info');
  assert.strictEqual(resolveLevel(undefined), 'info');
});

// ── shouldLog ─────────────────────────────────────────────────────────────────
test('shouldLog: op info-niveau geen debug', () => {
  assert.strictEqual(shouldLog('info', 'debug'), false);
  assert.strictEqual(shouldLog('info', 'info'), true);
  assert.strictEqual(shouldLog('info', 'warn'), true);
  assert.strictEqual(shouldLog('info', 'error'), true);
});

test('shouldLog: op debug-niveau alles', () => {
  assert.strictEqual(shouldLog('debug', 'debug'), true);
  assert.strictEqual(shouldLog('debug', 'error'), true);
});

test('shouldLog: op error-niveau enkel error', () => {
  assert.strictEqual(shouldLog('error', 'error'), true);
  assert.strictEqual(shouldLog('error', 'warn'), false);
  assert.strictEqual(shouldLog('error', 'info'), false);
});

// ── formatLine ────────────────────────────────────────────────────────────────
test('formatLine: bevat niveau en bericht', () => {
  const line = formatLine('info', ['hallo wereld']);
  assert.match(line, /\[.* INFO\] hallo wereld/);
});

test('formatLine: objecten worden geserialiseerd', () => {
  const line = formatLine('debug', ['data:', { a: 1 }]);
  assert.match(line, /data: \{"a":1\}/);
});

test('formatLine: Error toont stack of message', () => {
  const line = formatLine('error', [new Error('kapot')]);
  assert.match(line, /kapot/);
});

// ── createLogger met mock sink ────────────────────────────────────────────────
test('createLogger: filtert op niveau', () => {
  const captured = [];
  const sink = {
    error: (m) => captured.push(['error', m]),
    warn: (m) => captured.push(['warn', m]),
    info: (m) => captured.push(['info', m]),
    debug: (m) => captured.push(['debug', m]),
  };
  const log = createLogger({ level: 'warn', sink });
  log.error('fout');   // getoond
  log.warn('waarschuwing'); // getoond
  log.info('info');    // onderdrukt
  log.debug('debug');  // onderdrukt
  assert.strictEqual(captured.length, 2);
  assert.strictEqual(captured[0][0], 'error');
  assert.strictEqual(captured[1][0], 'warn');
});

test('createLogger: debug-niveau toont alles', () => {
  const captured = [];
  const sink = {
    error: (m) => captured.push(m), warn: (m) => captured.push(m),
    info: (m) => captured.push(m), debug: (m) => captured.push(m),
  };
  const log = createLogger({ level: 'debug', sink });
  log.error('a'); log.warn('b'); log.info('c'); log.debug('d');
  assert.strictEqual(captured.length, 4);
});

test('createLogger: standaardniveau is info', () => {
  const captured = [];
  const sink = {
    error: (m) => captured.push(m), warn: (m) => captured.push(m),
    info: (m) => captured.push(m), debug: (m) => captured.push(m),
  };
  const log = createLogger({ sink }); // geen level → info
  log.debug('onderdrukt');
  log.info('getoond');
  assert.strictEqual(captured.length, 1);
  assert.match(captured[0], /getoond/);
});
