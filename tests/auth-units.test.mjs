import test from 'node:test';
import assert from 'node:assert/strict';

// Evitar el fail-fast de postgres-primary al importar src/config
// en entornos sin DATABASE_URL.
process.env.TICKETS_STORAGE = 'json';
process.env.TICKETS_WRITE_MODE = 'json';

const {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isValidEmail,
  normalizeEmail,
  serializeUserPublic,
  validateRegistration,
  verifyPassword,
} = await import('../src/domain/auth.mjs');

test('password hash roundtrip verifies the original password', async () => {
  const hash = await hashPassword('MiClaveSegura123');
  assert.match(hash, /^scrypt:\d+:\d+:\d+:.+:.+$/);
  assert.equal(await verifyPassword('MiClaveSegura123', hash), true);
});

test('wrong password does not verify', async () => {
  const hash = await hashPassword('MiClaveSegura123');
  assert.equal(await verifyPassword('otra-clave', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('two hashes of the same password use different salts', async () => {
  const first = await hashPassword('repetida');
  const second = await hashPassword('repetida');
  assert.notEqual(first, second);
});

test('malformed stored hashes never verify', async () => {
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', 'plaintext'), false);
  assert.equal(await verifyPassword('x', 'scrypt:bad:parts'), false);
});

test('session tokens are unique and hash deterministically', () => {
  const token = createSessionToken();
  const other = createSessionToken();
  assert.equal(token.length, 64);
  assert.notEqual(token, other);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
  assert.notEqual(hashSessionToken(token), token);
});

test('email validation and normalization', () => {
  assert.equal(isValidEmail('Persona@Correo.MX'), true);
  assert.equal(isValidEmail('sin-arroba.com'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(normalizeEmail('  Persona@Correo.MX '), 'persona@correo.mx');
});

test('registration validation catches missing fields and short passwords', () => {
  assert.equal(validateRegistration({ name: 'Ana', email: 'ana@correo.mx', password: 'clave-larga-8' }).length, 0);
  assert.ok(validateRegistration({ name: '', email: 'ana@correo.mx', password: 'clave-larga-8' }).length > 0);
  assert.ok(validateRegistration({ name: 'Ana', email: 'no-es-correo', password: 'clave-larga-8' }).length > 0);
  assert.ok(validateRegistration({ name: 'Ana', email: 'ana@correo.mx', password: 'corta' }).length > 0);
});

test('public user serialization exposes only email and display name', async () => {
  const user = {
    id: 'uuid-interno',
    email: 'ana@correo.mx',
    displayName: 'Ana',
    passwordHash: await hashPassword('MiClaveSegura123'),
    status: 'active',
  };
  const serialized = serializeUserPublic(user);
  assert.deepEqual(Object.keys(serialized).sort(), ['displayName', 'email']);
});
