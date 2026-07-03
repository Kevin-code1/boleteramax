import {
  createSessionToken,
  getSessionExpiry,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  serializeUserPublic,
  validateRegistration,
  verifyPassword,
} from '../domain/auth.mjs';

// Hash ficticio para igualar el tiempo de respuesta cuando el correo no
// existe (evita enumerar cuentas midiendo latencia).
const DUMMY_HASH_PROMISE = hashPassword('boletamax-dummy-password');

export function createAuth({ userStore }) {
  async function startSession(user) {
    const sessionToken = createSessionToken();
    const expiresAt = getSessionExpiry();
    await userStore.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt,
    });
    return { sessionToken, expiresAt };
  }

  async function register({ name, email, password }) {
    const errors = validateRegistration({ name, email, password });
    if (errors.length) {
      return { outcome: 'invalid', errors };
    }

    const user = await userStore.createUser({
      email: normalizeEmail(email),
      passwordHash: await hashPassword(password),
      displayName: String(name).trim(),
    });

    if (!user) {
      return { outcome: 'email_taken' };
    }

    const session = await startSession(user);
    console.log('BoletaMax Auth: cuenta creada', { userId: user.id });
    return { outcome: 'ok', user: serializeUserPublic(user), ...session };
  }

  async function login({ email, password }) {
    const user = await userStore.findUserByEmail(normalizeEmail(email));

    if (!user || user.status !== 'active') {
      await verifyPassword(String(password || ''), await DUMMY_HASH_PROMISE);
      return { outcome: 'invalid_credentials' };
    }

    const passwordOk = await verifyPassword(String(password || ''), user.passwordHash);
    if (!passwordOk) {
      return { outcome: 'invalid_credentials' };
    }

    const session = await startSession(user);
    return { outcome: 'ok', user: serializeUserPublic(user), ...session };
  }

  async function logout(sessionToken) {
    const token = String(sessionToken || '').trim();
    if (token) {
      await userStore.deleteSession(hashSessionToken(token));
    }
    return { outcome: 'ok' };
  }

  // Devuelve el usuario de la sesión (con id interno) o null.
  async function getSessionUser(sessionToken) {
    const token = String(sessionToken || '').trim();
    if (!token) return null;
    return userStore.findSessionUser(hashSessionToken(token));
  }

  return { register, login, logout, getSessionUser };
}
