'use strict';
// Regressietest v101: na een serverherstart is het onthouden CSRF-token ongeldig (403 "CSRF
// validatie mislukt"). apiFetch haalt dan één keer een vers token op en herhaalt de aanvraag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bron = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const start = bron.indexOf('  let _csrfToken = null;');
const einde = bron.indexOf('  // Sprint 10J: sneltoetsen overlay');
assert.ok(start > 0 && einde > start, 'apiFetch-blok niet gevonden');
const blok = bron.slice(start, einde);

function omgeving(serverToken) {
  const log = [];
  let huidig = serverToken.waarde;
  const ctx = {
    console,
    fetch: async (url, opt = {}) => {
      log.push(url);
      if (url === '/api/csrf-token') return { ok: true, status: 200, json: async () => ({ token: huidig }) };
      const gestuurd = (opt.headers || {})['X-CSRF-Token'];
      const goed = gestuurd === huidig;
      return {
        ok: goed, status: goed ? 200 : 403,
        clone() { return this; },
        text: async () => (goed ? '{}' : JSON.stringify({ error: 'CSRF validatie mislukt' })),
      };
    },
    wijzigServerToken: (t) => { huidig = t; },
  };
  vm.createContext(ctx);
  vm.runInContext(blok + '\nthis.apiFetch = apiFetch;', ctx);
  return { ctx, log };
}

test('gewone aanvraag: token wordt eenmalig opgehaald', async () => {
  const { ctx, log } = omgeving({ waarde: 'A' });
  assert.equal((await ctx.apiFetch('/x', { method: 'PUT' })).status, 200);
  assert.equal((await ctx.apiFetch('/y', { method: 'PUT' })).status, 200);
  assert.equal(log.filter(u => u === '/api/csrf-token').length, 1);
});

test('na serverherstart (nieuw token): één keer opnieuw proberen en het lukt', async () => {
  const { ctx, log } = omgeving({ waarde: 'A' });
  assert.equal((await ctx.apiFetch('/x', { method: 'PUT' })).status, 200);
  ctx.wijzigServerToken('B');
  const r = await ctx.apiFetch('/x', { method: 'PUT' });
  assert.equal(r.status, 200);
  assert.equal(log.filter(u => u === '/api/csrf-token').length, 2);
});

test('een andere 403 wordt niet herhaald', async () => {
  const ctx = { console, fetch: async (u) => (u === '/api/csrf-token'
    ? { ok: true, json: async () => ({ token: 'A' }) }
    : { ok: false, status: 403, clone() { return this; }, text: async () => '{"error":"Je hebt geen toegang tot deze sessie."}' }) };
  vm.createContext(ctx);
  vm.runInContext(blok + '\nthis.apiFetch = apiFetch;', ctx);
  assert.equal((await ctx.apiFetch('/x')).status, 403);
});
