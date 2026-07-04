import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTicketsStorageMode } from '../../db/tickets.storage.mjs';
import { getTicketsWriteMode } from '../../db/tickets.write-mode.mjs';

const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.join(path.dirname(__filename), '..', '..');

export const PORT = Number(process.env.PORT) || 3000;
export const EVENTS_PATH = path.join(ROOT_DIR, 'data', 'events.json');
export const TICKETS_PATH = path.join(ROOT_DIR, 'data', 'tickets.json');
export const DYNAMIC_QR_WINDOW_MS = 30_000;
export const DYNAMIC_QR_TOLERANCE_WINDOWS = 1;
export const SERVICE_FEE_RATE = 0.14;
export const SPEI_DISCOUNT_RATE = 0.955;
export const OXXO_FEE = 17;
export const CHECKOUT_QUOTE_TTL_MS = 10 * 60 * 1000;
export const CHECKOUT_SIGNING_SECRET =
  process.env.CHECKOUT_SIGNING_SECRET ||
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'boletamax-dev-checkout-signing-secret');
export const TURNSTILE_SITE_KEY = String(process.env.TURNSTILE_SITE_KEY || '').trim();
export const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
export const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
export const TICKETS_STORAGE_MODE = getTicketsStorageMode(process.env.TICKETS_STORAGE);
export const TICKETS_WRITE_MODE = getTicketsWriteMode(process.env.TICKETS_WRITE_MODE);
export const DATABASE_URL_CONFIGURED = Boolean(String(process.env.DATABASE_URL || '').trim());

if (
  (TICKETS_STORAGE_MODE === 'postgres-primary' || TICKETS_WRITE_MODE === 'postgres-primary') &&
  !DATABASE_URL_CONFIGURED
) {
  console.error('\n======================================================================');
  console.error('BoletaMax Database ERROR: DATABASE_URL no configurada.');
  console.error('postgres-primary requiere PostgreSQL configurado antes de iniciar.');
  console.error('======================================================================\n');
  process.exit(1);
}

export const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || '').trim();

// ── Correo (verificación de cuenta) ──
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const APP_BASE_URL = String(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
export const SMTP_CONFIG = {
  host: String(process.env.SMTP_HOST || '').trim(),
  port: Number(process.env.SMTP_PORT) || 587,
  user: String(process.env.SMTP_USER || '').trim(),
  pass: String(process.env.SMTP_PASS || '').trim(),
  from: String(process.env.SMTP_FROM || 'BoletaMax <no-reply@boletamax.local>').trim(),
};
export const SMTP_ENABLED = Boolean(SMTP_CONFIG.host);

if (process.env.NODE_ENV === 'production' && !CHECKOUT_SIGNING_SECRET) {
  console.error('\n======================================================================');
  console.error('BoletaMax Security ERROR: CHECKOUT_SIGNING_SECRET no configurado en produccion.');
  console.error('El servidor se detiene para evitar cotizaciones firmadas con secreto de desarrollo.');
  console.error('======================================================================\n');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !ADMIN_API_KEY) {
  console.error('\n======================================================================');
  console.error('BoletaMax Security ERROR: ADMIN_API_KEY no configurada en producción.');
  console.error('El servidor se detiene de forma segura para evitar accesos sin protección.');
  console.error('======================================================================\n');
  process.exit(1);
}
if (IS_PRODUCTION && !SMTP_ENABLED) {
  console.error('\n======================================================================');
  console.error('BoletaMax Email ERROR: proveedor de correo (SMTP_HOST) no configurado en producción.');
  console.error('La verificación de correo es obligatoria; el servidor se detiene sin proveedor de envío.');
  console.error('======================================================================\n');
  process.exit(1);
}

export const ALLOWED_CATEGORIES = ['musica', 'teatro', 'deportes', 'feria', 'familia', 'comedia'];
export const CURRENT_MONTH_INDEX = new Date().getMonth();
export const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export const FILTERS_SCHEMA_KEYS = ['categoria', 'ciudad', 'fecha', 'precioMax', 'keywords'];
export const PAYMENT_METHODS = new Set(['tarjeta', 'spei', 'oxxo']);
export const MAX_TICKETS_PER_EVENT = 10;
