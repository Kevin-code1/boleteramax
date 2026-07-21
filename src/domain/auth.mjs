import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = 'bm_session';
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_MIN_LENGTH = 8;

export function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value = '') {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function validateRegistration({ name, email, password } = {}) {
  const errors = [];

  if (!String(name || '').trim()) {
    errors.push('El nombre es requerido.');
  } else if (String(name).trim().length > 80) {
    errors.push('El nombre es demasiado largo.');
  }

  if (!isValidEmail(email)) {
    errors.push('El correo electrónico no es válido.');
  }

  if (String(password || '').length < PASSWORD_MIN_LENGTH) {
    errors.push(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  } else if (String(password).length > 128) {
    errors.push('La contraseña es demasiado larga.');
  }

  return errors;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, saltB64, hashB64] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(String(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function getSessionExpiry(now = Date.now()) {
  return new Date(now + SESSION_TTL_MS).toISOString();
}

export function createVerificationToken() {
  return randomBytes(32).toString('hex');
}

export function hashVerificationToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function getVerificationExpiry(now = Date.now()) {
  return new Date(now + VERIFICATION_TTL_MS).toISOString();
}

export function isVerificationExpired(expiresAt, now = Date.now()) {
  const ts = Date.parse(expiresAt);
  return !Number.isFinite(ts) || ts <= now;
}

export function isUserVerified(user = {}) {
  return Boolean(user.emailVerifiedAt);
}

export function serializeUserPublic(user = {}) {
  return {
    email: user.email,
    displayName: user.displayName,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}
