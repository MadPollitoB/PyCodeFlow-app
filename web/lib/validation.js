// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Input-validatie helpers (pure, testbaar)
// Sprint 34a: basis voor consistente API-validatie (zie ook sprint 36c).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

// Sessiecode: 8 hoofdletters/cijfers (formaat gebruikt door de app).
function isValidSessionCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code);
}

// Config-sleutels die via session-config aangepast mogen worden (whitelist).
const ALLOWED_CONFIG_KEYS = [
  'autoIndent', 'autoClosingBrackets', 'autoClosingQuotes',
  'quickSuggestions', 'parameterHints',
];

function isAllowedConfigKey(key) {
  return ALLOWED_CONFIG_KEYS.includes(key);
}

// Config-waarde moet boolean zijn.
function isValidConfigValue(value) {
  return typeof value === 'boolean';
}

// Begrens een string tot maxLen (trim + slice). Niet-strings → ''.
function clampString(value, maxLen) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

// Geheel getal binnen [min, max]; ongeldige input → fallback.
function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Rol-validatie voor leerkrachtaccounts.
function isValidRole(role) {
  return role === 'teacher' || role === 'admin';
}

module.exports = {
  isValidSessionCode,
  ALLOWED_CONFIG_KEYS,
  isAllowedConfigKey,
  isValidConfigValue,
  clampString,
  clampInt,
  isValidRole,
};
