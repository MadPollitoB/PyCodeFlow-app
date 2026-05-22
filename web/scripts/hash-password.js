#!/usr/bin/env node
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Gebruik: node web/scripts/hash-password.js "jouwWachtwoord"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const params = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derivedKey = crypto.scryptSync(password, salt, 64, params);
const hash = `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
console.log(hash);
