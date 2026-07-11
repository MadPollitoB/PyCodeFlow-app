// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Gestructureerde logger (sprint 32b)
// Niveaus: error < warn < info < debug. LOG_LEVEL bepaalt wat getoond wordt.
// Standaard 'info' in productie. Zet LOG_LEVEL=debug voor uitgebreide logs.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// Bepaalt het actieve niveau uit een string (met veilige fallback naar 'info').
function resolveLevel(name) {
  const key = String(name || '').toLowerCase();
  return key in LEVELS ? key : 'info';
}

// Bouwt een geformatteerde logregel: [YYYY-MM-DD HH:MM:SS NIVEAU] bericht
function formatLine(level, args, now = new Date()) {
  const ts = now.toISOString().slice(0, 19).replace('T', ' ');
  const prefix = `[${ts} ${level.toUpperCase()}]`;
  const msg = args.map(a =>
    typeof a === 'string' ? a : (a instanceof Error ? a.stack || a.message : JSON.stringify(a))
  ).join(' ');
  return `${prefix} ${msg}`;
}

// Beslist of een bericht van 'msgLevel' getoond wordt bij actief 'activeLevel'.
function shouldLog(activeLevel, msgLevel) {
  return LEVELS[msgLevel] <= LEVELS[resolveLevel(activeLevel)];
}

// Maakt een logger. sink is de uitvoerfunctie (standaard console-methodes).
function createLogger(options = {}) {
  const activeLevel = resolveLevel(options.level || process.env.LOG_LEVEL || 'info');
  const sink = options.sink || {
    error: (...a) => console.error(...a),
    warn:  (...a) => console.warn(...a),
    info:  (...a) => console.log(...a),
    debug: (...a) => console.log(...a),
  };

  function emit(level, args) {
    if (!shouldLog(activeLevel, level)) return;
    sink[level](formatLine(level, args));
  }

  return {
    level: activeLevel,
    error: (...args) => emit('error', args),
    warn:  (...args) => emit('warn', args),
    info:  (...args) => emit('info', args),
    debug: (...args) => emit('debug', args),
  };
}

module.exports = { createLogger, formatLine, shouldLog, resolveLevel, LEVELS };
