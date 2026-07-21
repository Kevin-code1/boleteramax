import { isValidEmail, normalizeEmail } from './auth.mjs';

export const BUYER_NAME_MAX_LENGTH = 80;

export function sanitizeBuyerPayload(rawBuyer) {
  const source = rawBuyer && typeof rawBuyer === 'object' ? rawBuyer : {};
  return {
    name: String(source.name || '').trim(),
    email: normalizeEmail(source.email),
  };
}

export function resolvePurchaseBuyer({ sessionUser = null, requestBuyer = null } = {}) {
  if (sessionUser) {
    return {
      errors: [],
      buyer: {
        name: String(sessionUser.displayName || '').trim(),
        email: normalizeEmail(sessionUser.email),
        userId: sessionUser.id,
        isGuest: false,
      },
    };
  }

  const { name, email } = sanitizeBuyerPayload(requestBuyer);
  const errors = [];

  if (!name) {
    errors.push('El nombre del comprador es requerido.');
  } else if (name.length > BUYER_NAME_MAX_LENGTH) {
    errors.push('El nombre del comprador es demasiado largo.');
  }

  if (!isValidEmail(email)) {
    errors.push('El correo del comprador no es válido.');
  }

  return {
    errors,
    buyer: { name, email, userId: null, isGuest: true },
  };
}
