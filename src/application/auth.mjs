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

// Hash ficticio para igualar el tiempo de respuesta cuando el correo no
// existe (evita enumerar cuentas midiendo latencia).
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

  // Emite un token nuevo (invalidando los pendientes) y envía el correo.
  // El enlace NUNCA sale de aquí hacia el HTTP: solo lo conoce el EmailService
  // (que en dev lo imprime en consola y en prod lo manda por SMTP).
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
      // No se rompe el registro por un fallo de envío: el usuario puede reenviar.
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

    // NO se inicia sesión: la cuenta no se puede usar hasta verificar.
    // No se devuelve el enlace ni el token en ningún caso.
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

    // Solo tras confirmar la contraseña se revela el estado de verificación
    // (evita filtrar el estado de una cuenta a quien no conoce la clave).
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

  // Devuelve el usuario de la sesión (con id interno) o null.
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

    // El consumo atómico ya falló; solo categorizamos el motivo para el mensaje.
    const existing = await userStore.findVerificationToken(tokenHash);
    if (!existing) return { outcome: 'invalid' };
    if (existing.usedAt) return { outcome: 'used' };
    return { outcome: 'expired' };
  }

  // Anti-enumeración: siempre responde igual. Solo envía si el correo existe
  // y aún no está verificado. Nunca devuelve el enlace ni el token.
  async function resendVerification({ email, buildVerifyUrl }) {
    const user = await userStore.findUserByEmail(normalizeEmail(email));

    if (user && user.status === 'active' && !isUserVerified(user)) {
      await issueVerification(user, { name: user.displayName, buildVerifyUrl });
    }

    // Correo inexistente o ya verificado: misma respuesta genérica.
    return { outcome: 'ok' };
  }

  return { register, login, logout, getSessionUser, verifyEmail, resendVerification };
}
