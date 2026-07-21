import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';

if (!process.env.DATABASE_URL) {
  process.env.TICKETS_STORAGE = process.env.TICKETS_STORAGE || 'json';
  process.env.TICKETS_WRITE_MODE = process.env.TICKETS_WRITE_MODE || 'json';
}

const HAS_DB = Boolean(process.env.DATABASE_URL);

const { closePool, query } = await import('../db/pool.mjs');
const { createUserStore } = await import('../src/adapters/persistence/user-store.mjs');

async function readLastSeen(tokenHash) {
  const result = await query(
    'SELECT last_seen_at FROM user_sessions WHERE session_token_hash = $1',
    [tokenHash],
  );
  return result.rows[0]?.last_seen_at || null;
}

async function backdateLastSeen(tokenHash, interval) {
  await query(
    `UPDATE user_sessions SET last_seen_at = now() - $2::interval WHERE session_token_hash = $1`,
    [tokenHash, interval],
  );
}

async function cleanup(tokenHash, userId) {
  await query('DELETE FROM user_sessions WHERE session_token_hash = $1', [tokenHash]);
  if (userId) await query('DELETE FROM users WHERE id = $1', [userId]);
}

test('sesión con last_seen_at antiguo se refresca al usarse', { skip: !HAS_DB }, async () => {
  const store = await createUserStore();
  const email = `last-seen-${Date.now()}-${randomBytes(3).toString('hex')}@boletamax.test`;
  const tokenHash = `test-last-seen-${randomBytes(16).toString('hex')}`;
  let userId = null;

  try {
    const user = await store.createUser({
      email,
      passwordHash: 'scrypt:16384:8:1:dGVzdA==:dGVzdA==',
      displayName: 'Prueba LastSeen',
    });
    assert.ok(user, 'el usuario de prueba debe crearse');
    userId = user.id;

    await store.createSession({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await backdateLastSeen(tokenHash, '30 minutes');
    const staleValue = await readLastSeen(tokenHash);

    const sessionUser = await store.findSessionUser(tokenHash);
    assert.ok(sessionUser, 'la sesión debe resolver al usuario');
    assert.equal(sessionUser.id, userId);

    const refreshedValue = await readLastSeen(tokenHash);
    const ageMs = Date.now() - new Date(refreshedValue).getTime();
    assert.ok(
      new Date(refreshedValue) > new Date(staleValue) && ageMs < 60 * 1000,
      'last_seen_at con más de cinco minutos debe refrescarse al usar la sesión',
    );
  } finally {
    await cleanup(tokenHash, userId);
  }
});

test('last_seen_at con menos de cinco minutos no debería reescribirse', { skip: !HAS_DB }, async () => {
  const store = await createUserStore();
  const email = `last-seen-${Date.now()}-${randomBytes(3).toString('hex')}@boletamax.test`;
  const tokenHash = `test-last-seen-${randomBytes(16).toString('hex')}`;
  let userId = null;

  try {
    const user = await store.createUser({
      email,
      passwordHash: 'scrypt:16384:8:1:dGVzdA==:dGVzdA==',
      displayName: 'Prueba LastSeen Ventana',
    });
    assert.ok(user, 'el usuario de prueba debe crearse');
    userId = user.id;

    await store.createSession({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await backdateLastSeen(tokenHash, '1 minute');
    const recentValue = await readLastSeen(tokenHash);

    const sessionUser = await store.findSessionUser(tokenHash);
    assert.ok(sessionUser, 'la sesión debe resolver al usuario');

    const afterValue = await readLastSeen(tokenHash);
    assert.equal(
      new Date(afterValue).getTime(),
      new Date(recentValue).getTime(),
      'last_seen_at reciente (menos de cinco minutos) no debe reescribirse en cada request',
    );
  } finally {
    await cleanup(tokenHash, userId);
  }
});

test.after(async () => {
  if (HAS_DB) await closePool();
});
