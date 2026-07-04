import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { closePool, query } from '../db/pool.mjs';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.join(path.dirname(__filename), '..');

function sanitizeLog(value = '') {
  return String(value)
    .replace(/postgres:\/\/[^ \n\r]+/gi, '[database-url-redacted]')
    .replace(/[a-f0-9]{24,}/gi, '[redacted]');
}

function getFreeishPort() {
  return 43_000 + Math.floor(Math.random() * 2_000);
}

function hasSessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ||
    (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
  return cookies.some(cookie => cookie.startsWith('bm_session='));
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitForServer(baseUrl, child, getOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${sanitizeLog(getOutput())}`);
    try {
      const response = await fetch(`${baseUrl}/api/security-config`);
      if (response.ok) return;
    } catch (_) { /* keep polling */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`server did not start: ${sanitizeLog(getOutput())}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise(resolve => {
    child.once('exit', resolve);
    setTimeout(resolve, 2_000);
  });
}

// El token plano SOLO aparece en el log del EmailService (consola en dev).
// Nunca viaja en el JSON de la API. Los tests lo leen desde stdout del server.
async function waitForVerifyToken(getOutput, email, { timeoutMs = 5000, excludeToken = null } = {}) {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`Para:\\s*${escaped}[\\s\\S]*?token=([a-f0-9]+)`, 'g');
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const out = getOutput();
    let match;
    let last = null;
    re.lastIndex = 0;
    // El más reciente distinto de excludeToken (espera al token nuevo tras un resend).
    while ((match = re.exec(out)) !== null) {
      if (!excludeToken || match[1] !== excludeToken) last = match[1];
    }
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`verification token for ${email} not found in server logs`);
}

function assertNoLeakedToken(payload) {
  assert.equal(payload.devVerifyUrl, undefined, 'response must not include devVerifyUrl');
  assert.equal(Object.hasOwn(payload, 'token'), false, 'response must not include a token');
  assert.equal(Object.hasOwn(payload, 'verifyUrl'), false, 'response must not include a verifyUrl');
}

test('email verification flow: register, tokens, verify, reuse, expiry, resend', {
  skip: process.env.DATABASE_URL ? false : 'DATABASE_URL not configured; skipping email verification e2e.',
}, async () => {
  const port = getFreeishPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `verify+${suffix}@boletamax.test`;
  const password = 'ClaveVerificada123';
  const output = [];
  let child = null;

  try {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        ADMIN_API_KEY: `TEST_ADMIN_${suffix}`,
        CHECKOUT_SIGNING_SECRET: `test_checkout_${suffix}`,
        TICKETS_STORAGE: 'postgres-primary',
        TICKETS_WRITE_MODE: 'postgres-primary',
        TURNSTILE_SITE_KEY: '',
        TURNSTILE_SECRET_KEY: '',
        PUBLIC_BASE_URL: baseUrl,
      },
      windowsHide: true,
    });
    const getOutput = () => output.join('');
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    await waitForServer(baseUrl, child, getOutput);

    // ── register: no session, user unverified, NO token in the response ──
    const register = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Verify E2E', email, password }),
    });
    assert.equal(register.response.status, 201);
    assert.equal(register.payload.pendingVerification, true);
    assert.equal(hasSessionCookie(register.response), false, 'register must not set a session cookie');
    assertNoLeakedToken(register.payload);

    const userRow = await query('SELECT id, email_verified_at FROM users WHERE email_normalized = lower($1)', [email]);
    assert.equal(userRow.rows.length, 1);
    assert.equal(userRow.rows[0].email_verified_at, null, 'new user must be unverified');
    const userId = userRow.rows[0].id;

    // ── token stored hashed, plaintext never persisted (token leído del log) ──
    const plainToken = await waitForVerifyToken(getOutput, email);
    const expectedHash = createHash('sha256').update(plainToken).digest('hex');
    const tokenRows = await query(
      'SELECT token_hash, used_at FROM email_verification_tokens WHERE user_id = $1',
      [userId],
    );
    assert.equal(tokenRows.rows.length, 1);
    assert.equal(tokenRows.rows[0].token_hash, expectedHash, 'DB must store sha256 hash of the token');
    assert.notEqual(tokenRows.rows[0].token_hash, plainToken, 'plaintext token must not be stored');
    assert.equal(tokenRows.rows[0].used_at, null);

    // ── login before verifying → 403, no cookie ──
    const loginBefore = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginBefore.response.status, 403);
    assert.equal(loginBefore.payload.code, 'email_not_verified');
    assert.equal(hasSessionCookie(loginBefore.response), false);

    // ── invalid token fails safe ──
    const invalid = await requestJson(baseUrl, '/api/auth/verify-email?token=no-existe-1234');
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.code, 'invalid');

    // ── verify with valid token → ok, marks verified, consumes token ──
    const verify = await requestJson(baseUrl, `/api/auth/verify-email?token=${encodeURIComponent(plainToken)}`);
    assert.equal(verify.response.status, 200);
    assert.equal(verify.payload.ok, true);

    const verifiedRow = await query('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
    assert.ok(verifiedRow.rows[0].email_verified_at, 'email_verified_at must be set');

    const usedRow = await query('SELECT used_at FROM email_verification_tokens WHERE token_hash = $1', [expectedHash]);
    assert.ok(usedRow.rows[0].used_at, 'token must be marked used');

    // ── used token cannot be reused ──
    const reuse = await requestJson(baseUrl, `/api/auth/verify-email?token=${encodeURIComponent(plainToken)}`);
    assert.equal(reuse.response.status, 400);
    assert.equal(reuse.payload.code, 'used');

    // ── login after verifying works, sets cookie ──
    const loginAfter = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginAfter.response.status, 200);
    assert.equal(hasSessionCookie(loginAfter.response), true);

    // ── resend for an already-verified account is safe & generic (no token) ──
    const resendVerified = await requestJson(baseUrl, '/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    assert.equal(resendVerified.response.status, 200);
    assert.equal(resendVerified.payload.ok, true);
    assertNoLeakedToken(resendVerified.payload);

    // ── resend for an unverified account issues a NEW token and invalidates pending ──
    const email2 = `verify2+${suffix}@boletamax.test`;
    const register2 = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Verify Two', email: email2, password }),
    });
    assertNoLeakedToken(register2.payload);
    const firstToken = await waitForVerifyToken(getOutput, email2);
    const firstHash = createHash('sha256').update(firstToken).digest('hex');

    const resend = await requestJson(baseUrl, '/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email: email2 }),
    });
    assert.equal(resend.response.status, 200);
    assertNoLeakedToken(resend.payload);
    // El token nuevo solo aparece en el log; debe diferir del anterior.
    const secondToken = await waitForVerifyToken(getOutput, email2, { timeoutMs: 6000, excludeToken: firstToken });
    assert.notEqual(secondToken, firstToken, 'resend must issue a different token');

    // El token anterior queda invalidado (usado).
    const firstTokenState = await query('SELECT used_at FROM email_verification_tokens WHERE token_hash = $1', [firstHash]);
    assert.ok(firstTokenState.rows[0].used_at, 'previous pending token must be invalidated on resend');

    // El token viejo ya no verifica.
    const oldTokenTry = await requestJson(baseUrl, `/api/auth/verify-email?token=${encodeURIComponent(firstToken)}`);
    assert.equal(oldTokenTry.response.status, 400);

    // ── expired token fails ──
    const secondHash = createHash('sha256').update(secondToken).digest('hex');
    await query(
      "UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour' WHERE token_hash = $1",
      [secondHash],
    );
    const expired = await requestJson(baseUrl, `/api/auth/verify-email?token=${encodeURIComponent(secondToken)}`);
    assert.equal(expired.response.status, 400);
    assert.equal(expired.payload.code, 'expired');

    // ── logout still works ──
    const logout = await requestJson(baseUrl, '/api/auth/logout', { method: 'POST' });
    assert.equal(logout.response.status, 200);
    assert.equal(logout.payload.ok, true);
  } finally {
    await stopServer(child);
    await query('DELETE FROM users WHERE email_normalized LIKE $1', [`verify%${suffix}@boletamax.test`]);
    await closePool();
  }
});
