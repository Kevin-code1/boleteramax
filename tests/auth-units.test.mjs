import test from 'node:test';
import assert from 'node:assert/strict';

// Evitar el fail-fast de postgres-primary al importar src/config
// en entornos sin DATABASE_URL.
process.env.TICKETS_STORAGE = 'json';
process.env.TICKETS_WRITE_MODE = 'json';

const {
  createSessionToken,
  createVerificationToken,
  getVerificationExpiry,
  hashPassword,
  hashSessionToken,
  hashVerificationToken,
  isUserVerified,
  isValidEmail,
  isVerificationExpired,
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

test('public user serialization exposes email, display name and verification flag only', async () => {
  const user = {
    id: 'uuid-interno',
    email: 'ana@correo.mx',
    displayName: 'Ana',
    passwordHash: await hashPassword('MiClaveSegura123'),
    status: 'active',
    emailVerifiedAt: null,
  };
  const serialized = serializeUserPublic(user);
  assert.deepEqual(Object.keys(serialized).sort(), ['displayName', 'email', 'emailVerified']);
  assert.equal(serialized.emailVerified, false);
  assert.equal(Object.hasOwn(serialized, 'passwordHash'), false);
});

test('verification tokens are unique, hashed deterministically, and never equal the hash', () => {
  const token = createVerificationToken();
  const other = createVerificationToken();
  assert.equal(token.length, 64);
  assert.notEqual(token, other);
  assert.equal(hashVerificationToken(token), hashVerificationToken(token));
  assert.notEqual(hashVerificationToken(token), token, 'stored hash must differ from the plaintext token');
});

test('verification expiry is 24h and expiry detection works', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const expiry = getVerificationExpiry(now);
  assert.equal(Date.parse(expiry) - now, 24 * 60 * 60 * 1000);
  assert.equal(isVerificationExpired(expiry, now), false);
  assert.equal(isVerificationExpired(expiry, now + 25 * 60 * 60 * 1000), true);
  assert.equal(isVerificationExpired('not-a-date', now), true);
});

test('isUserVerified reflects emailVerifiedAt', () => {
  assert.equal(isUserVerified({ emailVerifiedAt: null }), false);
  assert.equal(isUserVerified({ emailVerifiedAt: undefined }), false);
  assert.equal(isUserVerified({ emailVerifiedAt: '2026-01-01T00:00:00.000Z' }), true);
});
