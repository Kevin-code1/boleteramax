import rateLimit from 'express-rate-limit';
import { randomBytes } from 'crypto';
import { ADMIN_API_KEY } from '../../config/index.mjs';
import { safeEqualString } from '../../domain/text.mjs';

// ── Headers de seguridad ──
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
      "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
      "img-src 'self' data:",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
    ].join('; '),
  );
  next();
}

// ── Archivos sensibles que nunca deben ser servidos por express.static ──
const BLOCKED_FILE_PATTERNS = [
  /^\/data\/backups(?:\/|$)/i,
  /^\/data(?:$|\/(?!events\.json$))/i,
  /^\/db(?:\/|$)/i,
  /^\/scripts(?:\/|$)/i,
  /^\/tests(?:\/|$)/i,
  /^\/server(?:\/|$)/i,
  /^\/src(?:\/|$)/i,
  /^\/\.tmp(?:\/|$)/i,
  /^\/\.env(?:$|\.)/i,
  /^\/server\.mjs$/i,
  /^\/package\.json$/i,
  /^\/package-lock\.json$/i,
  /^\/\.gitignore$/i,
  /^\/\.env\.example$/i,
  /^\/bm_server\.ps1$/i,
  /^\/node_modules(?:\/|$)/i,
  /^\/\.playwright/i,
  /^\/fintech-platform(?:\/|$)/i,
];

export function blockSensitiveFiles(req, res, next) {
  if (BLOCKED_FILE_PATTERNS.some(pattern => pattern.test(req.path))) {
    return res.status(404).send('Not found');
  }
  next();
}

// ── Rate limiting ──
export const apiGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes. Intenta más tarde.' },
});

export const purchaseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Límite de compras alcanzado. Espera un momento.' },
});

export const aiSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas búsquedas. Espera un momento.' },
});

export const validationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas validaciones. Espera un momento.' },
});

export const ticketQueryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas consultas de boletos. Espera un momento.' },
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos. Espera un momento.' },
});

// Reenvío de verificación: más estricto para evitar bombardeo de correos.
export const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados reenvíos. Espera unos minutos.' },
});

// ── Middleware de autenticación para staff/admin ──
export function requireAdminAuth(req, res, next) {
  if (!ADMIN_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      console.error('BoletaMax Security ERROR: ADMIN_API_KEY no configurada en producción. Acceso bloqueado.');
      return res.status(500).json({ ok: false, message: 'Error de configuración de seguridad del servidor.' });
    }
    // Si no está configurada y es local, usamos la clave autogenerada de desarrollo
    if (!global.DEV_ADMIN_API_KEY) {
      global.DEV_ADMIN_API_KEY = randomBytes(16).toString('hex').toUpperCase();
      console.warn('\n======================================================================');
      console.warn('BoletaMax Security Warning: ADMIN_API_KEY no configurada.');
      console.warn(`Clave temporal autogenerada para desarrollo: ${global.DEV_ADMIN_API_KEY}`);
      console.warn('Usa la clave solo en el header x-admin-key; no la pongas en URLs.');
      console.warn('======================================================================\n');
    }
  }

  const expectedKey = ADMIN_API_KEY || global.DEV_ADMIN_API_KEY;
  const provided = String(req.headers['x-admin-key'] || '').trim();

  if (!expectedKey || !provided || !safeEqualString(provided, expectedKey)) {
    console.warn('BoletaMax Security: intento de acceso admin rechazado', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ ok: false, message: 'Acceso no autorizado.' });
  }
  next();
}
