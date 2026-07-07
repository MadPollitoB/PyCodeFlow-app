// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 36a — Unit tests: withTransaction helper
// Test de BEGIN/COMMIT/ROLLBACK-logica met een mock pg-client (geen echte DB nodig).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Mock van een pg pool die precies één client teruggeeft en de query-volgorde logt.
function makeMockPool({ failOn = null } = {}) {
  const log = [];
  let released = false;
  const client = {
    async query(sql) {
      log.push(sql);
      if (failOn && sql.includes(failOn)) {
        throw new Error(`gesimuleerde fout op ${failOn}`);
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  return {
    log,
    isReleased: () => released,
    async connect() { return client; },
  };
}

// Repliceert de withTransaction-implementatie uit database.js (zelfde logica).
function makeWithTransaction(pool) {
  return async function withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* rollback-fout negeren in test */ }
      throw err;
    } finally {
      client.release();
    }
  };
}

test('withTransaction: succesvolle transactie doet BEGIN + werk + COMMIT', async () => {
  const pool = makeMockPool();
  const withTransaction = makeWithTransaction(pool);
  const result = await withTransaction(async (client) => {
    await client.query('INSERT INTO quiz_meta ...');
    await client.query('INSERT INTO quiz_question_snapshots ...');
    return 'klaar';
  });
  assert.strictEqual(result, 'klaar');
  assert.deepStrictEqual(pool.log, [
    'BEGIN',
    'INSERT INTO quiz_meta ...',
    'INSERT INTO quiz_question_snapshots ...',
    'COMMIT',
  ]);
  assert.strictEqual(pool.isReleased(), true);
});

test('withTransaction: fout in het werk → ROLLBACK, geen COMMIT', async () => {
  const pool = makeMockPool({ failOn: 'snapshots' });
  const withTransaction = makeWithTransaction(pool);
  await assert.rejects(
    withTransaction(async (client) => {
      await client.query('INSERT INTO quiz_meta ...');
      await client.query('INSERT INTO quiz_question_snapshots ...'); // faalt
    }),
    /gesimuleerde fout/
  );
  assert.ok(pool.log.includes('BEGIN'));
  assert.ok(pool.log.includes('ROLLBACK'));
  assert.ok(!pool.log.includes('COMMIT'), 'COMMIT mag niet uitgevoerd zijn na een fout');
  assert.strictEqual(pool.isReleased(), true);
});

test('withTransaction: client wordt altijd vrijgegeven (ook bij succes)', async () => {
  const pool = makeMockPool();
  const withTransaction = makeWithTransaction(pool);
  await withTransaction(async () => { /* niets */ });
  assert.strictEqual(pool.isReleased(), true);
});

test('withTransaction: retourwaarde van fn wordt doorgegeven', async () => {
  const pool = makeMockPool();
  const withTransaction = makeWithTransaction(pool);
  const r = await withTransaction(async () => ({ id: 42 }));
  assert.deepStrictEqual(r, { id: 42 });
});
