#!/usr/bin/env node

/**
 * Smoke test — validates API contract without real carrier credentials.
 * Run: node scripts/test-flow.js
 */

const BASE = process.env.BASE_URL || 'http://localhost:3001';

async function run() {
  console.log(`Testing against ${BASE}\n`);

  // 1. Health check
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await health.json();
  console.log(`[${health.status}] GET /api/health — ${JSON.stringify(healthBody)}`);
  assert(health.ok, 'Health check should return 200');

  // 2. Get JWT token
  const tokenRes = await fetch(`${BASE}/api/auth/token`, { method: 'POST' });
  const tokenBody = await tokenRes.json();
  console.log(`[${tokenRes.status}] POST /api/auth/token — token: ${tokenBody.token ? tokenBody.token.slice(0, 20) + '...' : 'MISSING'}`);
  assert(tokenRes.ok && tokenBody.token, 'Should return JWT token');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenBody.token}`,
  };

  // 3. Start flow with missing carrier — expect 400
  const badStart = await fetch(`${BASE}/api/carrier/start`, {
    method: 'POST', headers,
    body: JSON.stringify({ carrier: '', email: 'test@test.com' }),
  });
  console.log(`[${badStart.status}] POST /api/carrier/start (empty carrier) — expect 400`);
  assert(badStart.status === 400, 'Empty carrier should return 400');

  // 4. Start flow with unknown carrier — expect 400
  const unknownStart = await fetch(`${BASE}/api/carrier/start`, {
    method: 'POST', headers,
    body: JSON.stringify({ carrier: 'unknown_carrier', email: 'test@test.com' }),
  });
  console.log(`[${unknownStart.status}] POST /api/carrier/start (unknown carrier) — expect 400`);
  assert(unknownStart.status === 400, 'Unknown carrier should return 400');

  // 5. Get documents for non-existent session — expect 404
  const noDocs = await fetch(`${BASE}/api/carrier/documents/nonexistent-session-id`, { headers });
  console.log(`[${noDocs.status}] GET /api/carrier/documents/fake-id — expect 404`);
  assert(noDocs.status === 404, 'Non-existent session docs should return 404');

  // 6. No auth on protected route — expect 401
  const noAuth = await fetch(`${BASE}/api/carrier/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'lemonade', email: 'test@test.com' }),
  });
  console.log(`[${noAuth.status}] POST /api/carrier/start (no auth) — expect 401`);
  assert(noAuth.status === 401, 'No auth should return 401');

  console.log('\nAll smoke tests passed.');
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
