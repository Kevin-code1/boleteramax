import { SESSION_COOKIE_NAME } from '../../domain/auth.mjs';

export function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const cookies = {};

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }

  return cookies;
}

export function getSessionCookie(req) {
  return parseCookies(req)[SESSION_COOKIE_NAME] || '';
}

export function setSessionCookie(res, token, expiresAt) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  res.append('Set-Cookie', attributes.join('; '));
}

export function clearSessionCookie(res) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  res.append('Set-Cookie', attributes.join('; '));
}
