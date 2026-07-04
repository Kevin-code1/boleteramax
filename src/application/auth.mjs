import {
  createSessionToken,
  createVerificationToken,
  getSessionExpiry,
  getVerificationExpiry,
  hashPassword,
  hashSessionToken,
  hashVerificationToken,
  isUserVerified,
  normalizeEmail,
  serializeUserPublic,
  validateRegistration,
  verifyPassword,
} from '../domain/auth.mjs';

// Hash ficticio para igualar tiempos cuando el correo no existe.
const DUMMY_HASH_PROMISE = hashPassword('boletamax-dummy-password');

export function createAuth({ userStore, emailService }) {
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

  async function issueVerification(user, { name, buildVerifyUrl }) {
    const token = createVerificationToken();
    await userStore.invalidatePendingVerificationTokens(user.id);
    await userStore.saveVerificationToken({
      userId: user.id,
      tokenHash: hashVerificationToken(token),
      expiresAt: getVerificationExpiry(),
    });

    try {
      await emailService.sendVerificationEmail({
        to: user.email,
        name: name || user.displayName,
        verifyUrl: buildVerifyUrl(token),
      });
    } catch (error) {
      console.error('BoletaMax Auth: verification email failed', {
        message: error?.message || 'Error desconocido',
      });
    }
  }

  async function register({ name, email, password, buildVerifyUrl }) {
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

    await issueVerification(user, { name: String(name).trim(), buildVerifyUrl });
    console.log('BoletaMax Auth: cuenta creada (pendiente de verificación)', { userId: user.id });

    // No inicia sesión: requiere verificar el correo.
    return { outcome: 'ok' };
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

    // El estado de verificación solo se revela tras validar la contraseña.
    if (!isUserVerified(user)) {
      return { outcome: 'email_not_verified' };
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

  async function getSessionUser(sessionToken) {
    const token = String(sessionToken || '').trim();
    if (!token) return null;
    return userStore.findSessionUser(hashSessionToken(token));
  }

  async function verifyEmail(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) return { outcome: 'invalid' };

    const tokenHash = hashVerificationToken(token);
    const userId = await userStore.consumeVerificationToken(tokenHash);

    if (userId) {
      await userStore.markUserVerified(userId);
      return { outcome: 'ok' };
    }

    // Categoriza el motivo del fallo para el mensaje.
    const existing = await userStore.findVerificationToken(tokenHash);
    if (!existing) return { outcome: 'invalid' };
    if (existing.usedAt) return { outcome: 'used' };
    return { outcome: 'expired' };
  }

  // Anti-enumeración: respuesta genérica; solo envía si existe y sin verificar.
  async function resendVerification({ email, buildVerifyUrl }) {
    const user = await userStore.findUserByEmail(normalizeEmail(email));

    if (user && user.status === 'active' && !isUserVerified(user)) {
      await issueVerification(user, { name: user.displayName, buildVerifyUrl });
    }

    return { outcome: 'ok' };
  }

  return { register, login, logout, getSessionUser, verifyEmail, resendVerification };
}
