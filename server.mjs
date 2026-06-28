import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import {
  getTicketByIdFromStorage,
  getTicketsByIdsFromStorage,
  getTicketDynamicSecret,
  getTicketsStorageMode,
  markTicketUsedInStorage,
  serializeTicketForPublic,
  verifyTicketPrivateToken,
} from './db/tickets.storage.mjs';
import {
  getTicketsWriteMode,
  persistTicketPurchaseByWriteMode,
  writeTicketPurchaseToPostgresIfEnabled,
} from './db/tickets.write-mode.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;
const EVENTS_PATH = path.join(__dirname, 'data', 'events.json');
const TICKETS_PATH = path.join(__dirname, 'data', 'tickets.json');
const DYNAMIC_QR_WINDOW_MS = 30_000;
const DYNAMIC_QR_TOLERANCE_WINDOWS = 1;
const SERVICE_FEE_RATE = 0.14;
const SPEI_DISCOUNT_RATE = 0.955;
const OXXO_FEE = 17;
const CHECKOUT_QUOTE_TTL_MS = 10 * 60 * 1000;
const CHECKOUT_SIGNING_SECRET =
  process.env.CHECKOUT_SIGNING_SECRET ||
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'boletamax-dev-checkout-signing-secret');
const TURNSTILE_SITE_KEY = String(process.env.TURNSTILE_SITE_KEY || '').trim();
const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
const TICKETS_STORAGE_MODE = getTicketsStorageMode(process.env.TICKETS_STORAGE);
const TICKETS_WRITE_MODE = getTicketsWriteMode(process.env.TICKETS_WRITE_MODE);
const DATABASE_URL_CONFIGURED = Boolean(String(process.env.DATABASE_URL || '').trim());
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
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || '').trim();
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
const ALLOWED_CATEGORIES = ['musica', 'teatro', 'deportes', 'feria', 'familia', 'comedia'];
const CURRENT_MONTH_INDEX = new Date().getMonth();
const MONTHS = [
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

const eventsCatalog = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
const openai = hasOpenAIKey ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const FILTERS_SCHEMA_KEYS = ['categoria', 'ciudad', 'fecha', 'precioMax', 'keywords'];
const ticketValidationLocks = new Map();
const PAYMENT_METHODS = new Set(['tarjeta', 'spei', 'oxxo']);

// ── Mutex simple para escritura de tickets (previene race conditions) ──
let _ticketsWriteLock = Promise.resolve();
async function withTicketsWriteLock(task) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const previous = _ticketsWriteLock;
  _ticketsWriteLock = previous.catch(() => {}).then(() => gate);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

// ── Archivos sensibles que nunca deben ser servidos por express.static ──
const BLOCKED_FILE_PATTERNS = [
  /^\/data\/backups(?:\/|$)/i,
  /^\/data(?:$|\/(?!events\.json$))/i,
  /^\/db(?:\/|$)/i,
  /^\/scripts(?:\/|$)/i,
  /^\/tests(?:\/|$)/i,
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
const PUBLIC_HTML_FILES = new Map([
  ['/index.html', 'index.html'],
  ['/checkout.html', 'checkout.html'],
  ['/ticket.html', 'ticket.html'],
  ['/ticket-public.html', 'ticket-public.html'],
  ['/validate.html', 'validate.html'],
]);
const SERVER_EVENT_VENUE_MAP = {
  'Gran Festival de Banda': 'palenque',
  'El Fantasma de la Ópera': 'teatro',
  'Noche Urbana GDL': 'festival',
  'Feria del Estado CHH': 'palenque',
  'Comedy Night Puebla': 'teatro',
  'Lucha Libre CMLL': 'arena',
  'Noche de Rock Épica 2025': 'estadio',
  'Festival SolMaX 2025': 'festival',
  'Festival SolMaX': 'festival',
};
const SERVER_VENUE_PRICING = {
  palenque: {
    zones: [
      { key: 'fan', label: 'FAN', priceBase: 1700 },
      { key: 'vip5', label: 'VIP', priceBase: 1150 },
      { key: 'oro5', label: 'ORO 5', priceBase: 1000 },
      { key: 'oro', label: 'ORO', priceBase: 750 },
      { key: 'gen', label: 'GENERAL', priceBase: 480 },
    ],
  },
  arena: {
    zones: [
      { key: 'fan', label: 'RINGSIDE', priceBase: 2000 },
      { key: 'vip5', label: 'VIP', priceBase: 1400 },
      { key: 'oro5', label: 'PLATINO', priceBase: 900 },
      { key: 'oro', label: 'ORO', priceBase: 650 },
      { key: 'gen', label: 'GENERAL', priceBase: 350 },
    ],
  },
  teatro: {
    zones: [
      { key: 'fan', label: 'ORQUESTA', priceBase: 1800 },
      { key: 'vip5', label: 'LUNETA', priceBase: 1100 },
      { key: 'oro5', label: 'MEZZANINE', priceBase: 800 },
      { key: 'oro', label: 'PALCO', priceBase: 600 },
      { key: 'gen', label: 'GALERÍA', priceBase: 380 },
    ],
  },
  estadio: {
    zones: [
      { key: 'fan', label: 'FAN PIT', priceBase: 1900 },
      { key: 'vip5', label: 'VIP', priceBase: 1450 },
      { key: 'oro5', label: 'PREFERENTE', priceBase: 980 },
      { key: 'oro', label: 'PLATEA', priceBase: 720 },
      { key: 'gen', label: 'GRADA', priceBase: 520 },
    ],
  },
  festival: {
    zones: [
      { key: 'fan', label: 'FRONT STAGE', priceBase: 1600 },
      { key: 'vip5', label: 'VIP DECK', priceBase: 1180 },
      { key: 'oro5', label: 'PREFERENTE', priceBase: 900 },
      { key: 'oro', label: 'GENERAL A', priceBase: 650 },
      { key: 'gen', label: 'GENERAL B', priceBase: 430 },
    ],
  },
};

ensureJsonFile(TICKETS_PATH, []);

// ── Headers de seguridad ──
app.use((req, res, next) => {
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
});

// ── Bloquear acceso a archivos sensibles ANTES de express.static ──
app.use((req, res, next) => {
  if (BLOCKED_FILE_PATTERNS.some(pattern => pattern.test(req.path))) {
    return res.status(404).send('Not found');
  }
  next();
});

app.use(express.json({ limit: '64kb' }));
app.get([...PUBLIC_HTML_FILES.keys()], (req, res) => {
  res.sendFile(path.join(__dirname, PUBLIC_HTML_FILES.get(req.path)));
});
app.get('/data/events.json', (req, res) => {
  res.sendFile(EVENTS_PATH);
});
app.use('/css', express.static(path.join(__dirname, 'css'), { index: false }));
app.use('/js', express.static(path.join(__dirname, 'js'), { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { index: false }));

// ── Rate limiting ──
const apiGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes. Intenta más tarde.' },
});

const purchaseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Límite de compras alcanzado. Espera un momento.' },
});

const aiSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas búsquedas. Espera un momento.' },
});

const validationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas validaciones. Espera un momento.' },
});

const ticketQueryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas consultas de boletos. Espera un momento.' },
});

app.use('/api/', apiGeneralLimiter);

// ── Middleware de autenticación para staff/admin ──
function requireAdminAuth(req, res, next) {
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

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeTextVariants(value = '') {
  const raw = String(value || '');
  const variants = new Set([normalizeText(raw)]);
  try {
    variants.add(normalizeText(Buffer.from(raw, 'latin1').toString('utf8')));
  } catch (_) {
    // Keep the raw normalized value when a string cannot be repaired.
  }
  return variants;
}

function textValuesMatch(left = '', right = '') {
  const leftValues = normalizeTextVariants(left);
  const rightValues = normalizeTextVariants(right);
  return [...leftValues].some(value => value && rightValues.has(value));
}

function uniqueCities(events) {
  return [...new Set(events.map(event => event.city))];
}

function inferMonthToken(rawDate) {
  const normalized = normalizeText(rawDate);

  if (!normalized) return null;
  if (normalized.includes('este mes')) return MONTHS[CURRENT_MONTH_INDEX];
  if (normalized.includes('proximo mes') || normalized.includes('próximo mes')) {
    return MONTHS[(CURRENT_MONTH_INDEX + 1) % 12];
  }

  return MONTHS.find(month => normalized.includes(month)) || null;
}

function sanitizeKeywords(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(keyword => normalizeText(keyword))
    .filter(Boolean)
    .slice(0, 6);
}

function sanitizeFilters(rawFilters = {}) {
  const categoria = normalizeText(rawFilters.categoria || '');
  const city = normalizeText(rawFilters.ciudad || '');
  const fecha = rawFilters.fecha ? String(rawFilters.fecha).trim() : null;
  const rawPrice = Number(rawFilters.precioMax);

  const sanitized = {
    categoria: ALLOWED_CATEGORIES.includes(categoria) ? categoria : null,
    ciudad: city || null,
    fecha: fecha || null,
    precioMax: Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null,
    keywords: sanitizeKeywords(rawFilters.keywords),
  };

  if (sanitized.categoria === null && categoria === 'familiar') {
    sanitized.categoria = 'familia';
  }

  return sanitized;
}

function isValidFilterShape(rawFilters) {
  if (!rawFilters || typeof rawFilters !== 'object' || Array.isArray(rawFilters)) return false;

  const keys = Object.keys(rawFilters);
  if (keys.some(key => !FILTERS_SCHEMA_KEYS.includes(key))) return false;

  const isNullableString = value => value === null || typeof value === 'string';
  const isNullableNumber = value => value === null || (typeof value === 'number' && Number.isFinite(value));

  return (
    isNullableString(rawFilters.categoria) &&
    isNullableString(rawFilters.ciudad) &&
    isNullableString(rawFilters.fecha) &&
    isNullableNumber(rawFilters.precioMax) &&
    Array.isArray(rawFilters.keywords) &&
    rawFilters.keywords.every(keyword => typeof keyword === 'string')
  );
}

function logAiFallback(reason) {
  console.warn(`BoletaMax AI debug: fallback local - ${reason}`);
}

function logOpenAIError(error) {
  const responseBody =
    error?.error ??
    error?.response?.data ??
    error?.response?.body ??
    error?.body ??
    null;

  console.error('BoletaMax AI debug: OpenAI fallo', {
    message: error?.message || 'Error sin mensaje',
    status: error?.status ?? null,
    code: error?.code ?? null,
  });

  if (responseBody !== null && responseBody !== undefined) {
    console.error('BoletaMax AI debug: OpenAI response body', responseBody);
  }
}

function ensureJsonFile(filePath, defaultValue) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
}

function readTickets() {
  ensureJsonFile(TICKETS_PATH, []);
  return JSON.parse(fs.readFileSync(TICKETS_PATH, 'utf8'));
}

function writeTickets(tickets) {
  fs.writeFileSync(TICKETS_PATH, JSON.stringify(tickets, null, 2));
}

function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function buildPublicTicketPath(ticketId) {
  return `/tickets/${encodeURIComponent(ticketId)}`;
}

function buildPublicTicketUrl(baseUrl, ticketId) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${buildPublicTicketPath(ticketId)}`;
}

async function withTicketValidationLock(ticketId, task) {
  const previous = ticketValidationLocks.get(ticketId) || Promise.resolve();
  let releaseCurrent;
  const current = new Promise(resolve => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => {}).then(() => current);
  ticketValidationLocks.set(ticketId, queued);

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    releaseCurrent();
    if (ticketValidationLocks.get(ticketId) === queued) {
      ticketValidationLocks.delete(ticketId);
    }
  }
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function buildEventId(event = {}) {
  const seed = [event.name || 'evento', event.date || 'fecha', event.venue || 'venue'].join('|');
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 10);
  return `${slugify(event.name || 'evento') || 'evento'}-${digest}`;
}

function createOrderId() {
  return `BM-ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function createTicketId() {
  return `BM-TKT-${randomBytes(10).toString('hex').toUpperCase()}`;
}

function createTicketToken() {
  return randomBytes(12).toString('hex');
}

function getDynamicQrWindow(timestamp = Date.now()) {
  return Math.floor(timestamp / DYNAMIC_QR_WINDOW_MS);
}

function createDynamicToken(ticket, window) {
  const dynamicSecret = getTicketDynamicSecret(ticket);
  return createHash('sha256')
    .update(`${ticket.ticketId}:${dynamicSecret}:${window}`)
    .digest('hex')
    .slice(0, 24);
}

function buildDynamicQrPayload(ticket, window = getDynamicQrWindow()) {
  return {
    ticketId: ticket.ticketId,
    eventId: ticket.eventId,
    dynamicToken: createDynamicToken(ticket, window),
    window,
  };
}

function getDynamicQrSecondsRemaining(now = Date.now()) {
  const elapsed = now % DYNAMIC_QR_WINDOW_MS;
  return Math.max(1, Math.ceil((DYNAMIC_QR_WINDOW_MS - elapsed) / 1000));
}

async function buildDynamicQrResponse(ticket, window = getDynamicQrWindow()) {
  const qrPayload = buildDynamicQrPayload(ticket, window);
  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), {
    errorCorrectionLevel: 'M',
    margin: 1,
    color: {
      dark: '#0B1220',
      light: '#FFFFFF',
    },
  });

  return {
    qrPayload,
    dynamicToken: qrPayload.dynamicToken,
    qrImage: qrDataUrl,
    qrDataUrl,
    window,
    expiresInSec: getDynamicQrSecondsRemaining(),
  };
}

function serializeTicketPublic(ticket) {
  return serializeTicketForPublic(ticket, { buildPublicTicketPath });
}

function serializeTicketPublicView(ticket = {}) {
  return {
    ticketId: ticket.ticketId,
    eventName: ticket.eventName,
    date: ticket.date,
    venue: ticket.venue,
    status: ticket.status,
    usedAt: ticket.usedAt || null,
    publicPath: ticket.publicPath || buildPublicTicketPath(ticket.ticketId),
  };
}

function buildSeatLabel(seat = {}) {
  if (seat.tableSize > 1) {
    return `${seat.zone} · Fila ${seat.fila} · Mesa ${seat.mesa} · Lugar ${seat.seatInMesa}`;
  }
  return `${seat.zone} · Fila ${seat.fila} · Asiento ${seat.asiento}`;
}

function findCatalogEvent(event = {}) {
  const eventVenue = String(event.venue || '').trim();

  return eventsCatalog.find(item => {
    const nameMatches = textValuesMatch(item.name, event.name);
    const venueMatches = !eventVenue || textValuesMatch(item.venue, eventVenue);
    const dateMatches = !event.date || textValuesMatch(item.date, event.date);
    return (nameMatches && venueMatches) || (nameMatches && dateMatches) || (venueMatches && dateMatches);
  }) || null;
}

function getMappedVenueKey(name = '') {
  const entry = Object.entries(SERVER_EVENT_VENUE_MAP).find(([eventName]) => textValuesMatch(eventName, name));
  return entry?.[1] || null;
}

function resolveVenuePricingKey(event = {}, catalogEvent = null) {
  return (
    getMappedVenueKey(event.name) ||
    getMappedVenueKey(catalogEvent?.name) ||
    catalogEvent?.venueType ||
    'palenque'
  );
}

function normalizeZoneLabel(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function findPricingZone(venueKey, seat = {}) {
  const pricing = SERVER_VENUE_PRICING[venueKey];
  if (!pricing) return null;

  const zoneLabel = normalizeZoneLabel(seat.zone || seat.zoneLabel || '');
  const exactZone = pricing.zones.find(zone =>
    normalizeZoneLabel(zone.label) === zoneLabel ||
    normalizeZoneLabel(zone.key) === zoneLabel,
  );

  if (exactZone) return exactZone;
  if (zoneLabel.includes('fan') || zoneLabel.includes('ring') || zoneLabel.includes('orquesta')) return pricing.zones[0];
  if (zoneLabel.includes('vip') || zoneLabel.includes('luneta')) return pricing.zones[1];
  if (zoneLabel.includes('preferente') || zoneLabel.includes('platino') || zoneLabel.includes('mezzanine') || zoneLabel.includes('oro 5')) return pricing.zones[2];
  if (zoneLabel.includes('oro') || zoneLabel.includes('platea') || zoneLabel.includes('palco') || zoneLabel.includes('general a')) return pricing.zones[3];
  if (zoneLabel.includes('general') || zoneLabel.includes('grada') || zoneLabel.includes('galeria')) return pricing.zones[4];

  return null;
}

function calculateSeatPrice(basePrice, venueKey, seat = {}) {
  const pricing = SERVER_VENUE_PRICING[venueKey];
  const zone = findPricingZone(venueKey, seat);
  if (!pricing || !zone) return null;

  const lowestZone = pricing.zones[pricing.zones.length - 1];
  const ratio = zone.priceBase / lowestZone.priceBase;
  return Math.round(basePrice * ratio);
}

function sanitizeSeatForQuote(seat = {}, index, basePrice, venueKey) {
  const expectedPrice = calculateSeatPrice(basePrice, venueKey, seat);
  const pricingZone = findPricingZone(venueKey, seat);

  if (!pricingZone || !Number.isFinite(expectedPrice) || expectedPrice <= 0) {
    throw new Error(`Zona de asiento invalida en la posicion ${index + 1}.`);
  }

  return {
    zone: pricingZone.label,
    fila: String(seat.fila || '').trim() || 'A',
    mesa: Number.isFinite(Number(seat.mesa)) ? Number(seat.mesa) : null,
    asiento: Number.isFinite(Number(seat.asiento)) ? Number(seat.asiento) : index + 1,
    seatInMesa: Number.isFinite(Number(seat.seatInMesa)) ? Number(seat.seatInMesa) : null,
    tableSize: Number.isFinite(Number(seat.tableSize)) ? Number(seat.tableSize) : 1,
    price: expectedPrice,
    serverPriced: true,
  };
}

// ── Validación de inventario de asientos ──
const MAX_TICKETS_PER_EVENT = 10;

function buildSeatKey(seat = {}) {
  const zone = normalizeZoneLabel(seat.zone || seat.zoneLabel || '');
  const fila = String(seat.fila || 'A').trim().toUpperCase();
  if (seat.tableSize > 1 && seat.mesa) {
    return `${zone}|${fila}|M${seat.mesa}|L${seat.seatInMesa || 1}`;
  }
  return `${zone}|${fila}|A${seat.asiento || 1}`;
}

function getSoldSeatsForEvent(eventId, existingTickets) {
  const sold = new Set();
  for (const ticket of existingTickets) {
    if (ticket.eventId === eventId && ticket.status === 'active') {
      sold.add(buildSeatKey(ticket.seat));
    }
  }
  return sold;
}

function validateSeatInventory(eventId, seats, existingTickets) {
  const soldSeats = getSoldSeatsForEvent(eventId, existingTickets);
  const conflicts = [];
  const seenInOrder = new Set();

  for (let i = 0; i < seats.length; i++) {
    const key = buildSeatKey(seats[i]);

    // Verificar duplicados dentro de la misma orden
    if (seenInOrder.has(key)) {
      conflicts.push({ index: i, seat: seats[i], reason: 'duplicado en la misma orden' });
      continue;
    }
    seenInOrder.add(key);

    // Verificar contra inventario existente
    if (soldSeats.has(key)) {
      conflicts.push({ index: i, seat: seats[i], reason: 'ya vendido' });
    }
  }

  return conflicts;
}

function validatePurchaseRequest(purchase, catalogEvent) {
  const errors = [];

  // 1. Evento debe existir en el catálogo
  if (!catalogEvent) {
    errors.push('El evento solicitado no existe en nuestro catalogo.');
  } else if (catalogEvent.available === false) {
    errors.push('El evento ya no tiene boletos disponibles.');
  } else if (!Number.isFinite(Number(catalogEvent.price))) {
    errors.push('El evento no tiene un precio valido configurado.');
  }

  // 2. Validar cantidad de asientos
  if (!Array.isArray(purchase.seats) || purchase.seats.length === 0) {
    errors.push('Debes seleccionar al menos un asiento.');
  } else if (purchase.seats.length > MAX_TICKETS_PER_EVENT) {
    errors.push(`Maximo ${MAX_TICKETS_PER_EVENT} boletos por compra.`);
  }

  // 3. Nombre de evento requerido
  if (!purchase.event?.name?.trim()) {
    errors.push('El nombre del evento es requerido.');
  }

  // 4. Método de pago válido
  if (!PAYMENT_METHODS.has(purchase.paymentMethod)) {
    errors.push('Metodo de pago no valido.');
  }

  return errors;
}

function buildCheckoutQuote({ event, seats, now = Date.now() }) {
  const catalogEvent = findCatalogEvent(event);
  if (!catalogEvent || catalogEvent.available === false || !Number.isFinite(Number(catalogEvent.price))) {
    throw new Error('Evento no disponible para cotizacion segura.');
  }

  if (!Array.isArray(seats) || !seats.length || seats.length > MAX_TICKETS_PER_EVENT) {
    throw new Error(`Seleccion de asientos invalida (maximo ${MAX_TICKETS_PER_EVENT}).`);
  }

  const basePrice = Number(catalogEvent.price);
  const venueKey = resolveVenuePricingKey(event, catalogEvent);
  const pricedSeats = seats.map((seat, index) => sanitizeSeatForQuote(seat, index, basePrice, venueKey));
  const subtotal = pricedSeats.reduce((total, seat) => total + seat.price, 0);
  const fee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + fee;
  const paymentTotals = {
    tarjeta: total,
    spei: Math.round(total * SPEI_DISCOUNT_RATE),
    oxxo: total + OXXO_FEE,
  };

  const quote = {
    version: 1,
    quoteId: `BM-QTE-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHECKOUT_QUOTE_TTL_MS).toISOString(),
    event: {
      name: catalogEvent.name,
      date: catalogEvent.date,
      venue: catalogEvent.venue,
      venueKey,
    },
    seats: pricedSeats,
    subtotal,
    fee,
    total,
    paymentTotals,
    currency: 'MXN',
  };

  return {
    ...quote,
    signature: signCheckoutQuote(quote),
  };
}

function signCheckoutQuote(quote) {
  return createHmac('sha256', CHECKOUT_SIGNING_SECRET)
    .update(JSON.stringify(quote))
    .digest('hex');
}

function safeEqualString(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCheckoutQuote(rawQuote) {
  if (!rawQuote || typeof rawQuote !== 'object') {
    throw new Error('Cotizacion segura faltante.');
  }

  const { signature, ...unsignedQuote } = rawQuote;
  if (!signature || !safeEqualString(signature, signCheckoutQuote(unsignedQuote))) {
    throw new Error('Cotizacion segura invalida o alterada.');
  }

  if (Date.parse(unsignedQuote.expiresAt) <= Date.now()) {
    throw new Error('La cotizacion expiro. Vuelve a seleccionar tus asientos.');
  }

  return rawQuote;
}

function getAuthoritativePurchase(purchase) {
  if (!purchase.quote) {
    throw new Error('Cotizacion segura obligatoria. El flujo directo sin cotizar no esta permitido.');
  }

  const verifiedQuote = verifyCheckoutQuote(purchase.quote);
  const quoteMethod = PAYMENT_METHODS.has(purchase.paymentMethod) ? purchase.paymentMethod : 'tarjeta';
  return {
    event: verifiedQuote.event,
    seats: verifiedQuote.seats,
    subtotal: verifiedQuote.subtotal,
    fee: verifiedQuote.fee,
    total: verifiedQuote.paymentTotals[quoteMethod],
    paymentTotals: verifiedQuote.paymentTotals,
    quoteId: verifiedQuote.quoteId,
  };
}

async function verifyTurnstileToken(req, token) {
  if (!TURNSTILE_ENABLED) {
    return { ok: true, mode: 'demo', reason: 'turnstile_not_configured' };
  }

  if (!token || typeof token !== 'string' || token.length > 2048) {
    return { ok: false, mode: 'active', reason: 'missing_or_invalid_token' };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: req.ip,
      }),
    });
    const payload = await response.json();
    return {
      ok: Boolean(payload.success),
      mode: 'active',
      reason: payload.success ? 'verified' : (payload['error-codes'] || []).join(',') || 'turnstile_failed',
    };
  } catch (error) {
    console.error('BoletaMax Cloudflare: Turnstile verification failed', {
      message: error?.message || 'Error desconocido',
    });
    return { ok: false, mode: 'active', reason: 'turnstile_unavailable' };
  }
}

async function buildTicketRecord({ orderId, event, seat, totalPaid, paymentMethod, orderSeatCount, publicBaseUrl }) {
  const eventId = buildEventId(event);
  const ticketId = createTicketId();
  const token = createTicketToken();
  const publicPath = buildPublicTicketPath(ticketId);
  const publicUrl = buildPublicTicketUrl(publicBaseUrl, ticketId);
  const qrPayload = publicUrl;

  return {
    ticketId,
    orderId,
    token,
    eventId,
    eventName: event.name || 'Evento',
    date: event.date || 'Por confirmar',
    venue: event.venue || 'Por confirmar',
    zone: seat.zone || 'Zona',
    seatLabel: buildSeatLabel(seat),
    seat,
    totalPaid,
    paymentMethod,
    orderSeatCount,
    status: 'active',
    validationCount: 0,
    publicPath,
    publicUrl,
    createdAt: new Date().toISOString(),
    usedAt: null,
    cancelledAt: null,
    qrPayload,
    qrDataUrl: await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      color: {
        dark: '#0B1220',
        light: '#F8F3E8',
      },
    }),
  };
}

function sanitizePurchasePayload(rawBody = {}) {
  const event = rawBody.event && typeof rawBody.event === 'object' ? rawBody.event : {};
  const seats = Array.isArray(rawBody.seats) ? rawBody.seats.filter(Boolean) : [];
  const totalPaid = Number(rawBody.totalPaid);
  const paymentMethod = String(rawBody.paymentMethod || '').trim();

  return {
    event: {
      name: String(event.name || '').trim(),
      date: String(event.date || '').trim(),
      venue: String(event.venue || '').trim(),
    },
    seats,
    totalPaid: Number.isFinite(totalPaid) && totalPaid > 0 ? totalPaid : null,
    paymentMethod: PAYMENT_METHODS.has(paymentMethod) ? paymentMethod : 'tarjeta',
    quote: rawBody.quote && typeof rawBody.quote === 'object' ? rawBody.quote : null,
    turnstileToken: String(rawBody.turnstileToken || '').trim(),
  };
}

function inferFiltersFallback(query) {
  const normalized = normalizeText(query);
  const filters = {
    categoria: null,
    ciudad: null,
    fecha: null,
    precioMax: null,
    keywords: [],
  };

  const categoryMatchers = {
    musica: ['musica', 'música', 'concierto', 'rock', 'banda', 'urbano', 'festival'],
    teatro: ['teatro', 'musical', 'opera', 'ópera', 'escena'],
    deportes: ['deporte', 'deportes', 'lucha', 'arena'],
    feria: ['feria', 'ferias'],
    familia: ['familia', 'familiar', 'ninos', 'niños'],
    comedia: ['comedia', 'humor', 'standup', 'stand up'],
  };

  for (const [category, terms] of Object.entries(categoryMatchers)) {
    if (terms.some(term => normalized.includes(normalizeText(term)))) {
      filters.categoria = category;
      if (category === 'familia') filters.keywords.push('familia');
      break;
    }
  }

  const matchedCity = uniqueCities(eventsCatalog).find(city =>
    normalized.includes(normalizeText(city)),
  );
  if (matchedCity) filters.ciudad = matchedCity;

  const explicitPrice = normalized.match(/(?:hasta|menos de|maximo|maximo de|máximo|maximo por|por debajo de)\s*\$?\s*(\d{2,5})/);
  if (explicitPrice) {
    filters.precioMax = Number(explicitPrice[1]);
  } else if (normalized.includes('barato') || normalized.includes('económico') || normalized.includes('economico')) {
    filters.precioMax = 500;
  }

  filters.fecha = inferMonthToken(query);

  const stopwords = new Set([
    'quiero', 'algo', 'eventos', 'evento', 'de', 'del', 'la', 'el', 'en', 'para', 'este', 'mes',
    'una', 'un', 'con', 'por', 'que', 'sea', 'los', 'las', 'barato', 'barata', 'familiares',
  ]);

  filters.keywords = [
    ...new Set(
      normalized
        .split(/[^a-z0-9]+/i)
        .map(token => token.trim())
        .filter(token => token && !stopwords.has(token) && token.length > 2),
    ),
  ].slice(0, 6);

  return filters;
}

async function inferFiltersWithAI(query) {
  if (!openai) {
    logAiFallback('OPENAI_API_KEY no configurada');
    return {
      filters: inferFiltersFallback(query),
      mode: 'fallback',
      warning: 'OPENAI_API_KEY no está configurada. Se usó interpretación local.',
    };
  }

  try {
    console.log('BoletaMax AI debug: intentando llamada a OpenAI');
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'Convierte búsquedas de usuarios de una boletera en JSON de filtros. Usa solo estas categorías: musica, teatro, deportes, feria, familia, comedia. Si el usuario dice "barato" y no da monto, usa precioMax=500. Si no puedes inferir un valor, usa null. Devuelve JSON válido.',
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: query }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'boletamax_event_filters',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              categoria: { type: ['string', 'null'] },
              ciudad: { type: ['string', 'null'] },
              fecha: { type: ['string', 'null'] },
              precioMax: { type: ['number', 'null'] },
              keywords: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['categoria', 'ciudad', 'fecha', 'precioMax', 'keywords'],
          },
        },
      },
    });

    const rawText =
      response.output_text ||
      response.output?.[0]?.content?.find(item => item.type === 'output_text')?.text ||
      '{}';

    const parsed = JSON.parse(rawText);
    if (!isValidFilterShape(parsed)) {
      logAiFallback('respuesta IA con formato inesperado');
      return {
        filters: inferFiltersFallback(query),
        mode: 'fallback',
        warning: 'La IA respondió con un formato inesperado. Se usó interpretación local.',
      };
    }

    return {
      filters: sanitizeFilters(parsed),
      mode: 'ai',
      warning: null,
    };
  } catch (error) {
    const isParseError = error instanceof SyntaxError;
    logOpenAIError(error);
    logAiFallback(
      isParseError
        ? 'no se pudo interpretar la respuesta de OpenAI'
        : 'fallo la llamada a OpenAI',
    );
    return {
      filters: inferFiltersFallback(query),
      mode: 'fallback',
      warning: isParseError
        ? 'La respuesta IA no pudo interpretarse. Se usó interpretación local.'
        : 'La búsqueda IA no estuvo disponible. Se usó interpretación local.',
    };
  }
}

function matchesDateFilter(event, dateFilter) {
  if (!dateFilter) return true;
  const requestedMonth = inferMonthToken(dateFilter);
  if (!requestedMonth) return true;
  return normalizeText(event.date).includes(requestedMonth);
}

function matchesKeywords(event, keywords) {
  if (!keywords.length) return true;

  const searchable = normalizeText(
    [event.name, event.city, event.venue, event.description, ...(event.keywords || [])].join(' '),
  );

  return keywords.some(keyword => searchable.includes(normalizeText(keyword)));
}

function matchStrength(sourceValue, targetValue) {
  const source = normalizeText(sourceValue);
  const target = normalizeText(targetValue);

  if (!source || !target) return 0;
  if (source === target) return 3;
  if (source.includes(target) || target.includes(source)) return 2;
  if (source.split(/\s+/).some(token => token && target.includes(token))) return 1;
  return 0;
}

function keywordMatchScore(event, keywords) {
  if (!keywords.length) return 0;

  const searchFields = [
    event.name,
    event.city,
    event.venue,
    event.description,
    ...(event.keywords || []),
  ];

  return keywords.reduce((total, keyword) => {
    let best = 0;
    for (const field of searchFields) {
      best = Math.max(best, matchStrength(field, keyword));
      if (best === 3) break;
    }
    return total + best;
  }, 0);
}

function eventScore(event, filters) {
  let score = 0;

  if (filters.categoria) {
    score += event.category === filters.categoria ? 9 : matchStrength(event.category, filters.categoria) * 2;
  }
  if (filters.ciudad) {
    score += matchStrength(event.city, filters.ciudad) * 8;
  }
  if (filters.fecha && matchesDateFilter(event, filters.fecha)) score += 5;
  if (filters.precioMax !== null && event.price !== null && event.price <= filters.precioMax) score += 4;
  score += keywordMatchScore(event, filters.keywords) * 3;

  return score;
}

function filterEvents(filters) {
  const normalizedCity = filters.ciudad ? normalizeText(filters.ciudad) : null;

  return eventsCatalog
    .filter(event => !filters.categoria || event.category === filters.categoria || (filters.categoria === 'familia' && (event.keywords || []).includes('familia')))
    .filter(event => !normalizedCity || matchStrength(event.city, normalizedCity) > 0)
    .filter(event => !filters.fecha || matchesDateFilter(event, filters.fecha))
    .filter(event => filters.precioMax === null || (event.price !== null && event.price <= filters.precioMax))
    .filter(event => matchesKeywords(event, filters.keywords))
    .sort((left, right) => {
      const scoreDiff = eventScore(right, filters) - eventScore(left, filters);
      if (scoreDiff !== 0) return scoreDiff;

      const leftPrice = left.price ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = right.price ?? Number.MAX_SAFE_INTEGER;
      return leftPrice - rightPrice;
    });
}

app.post('/api/ai-search', aiSearchLimiter, async (req, res) => {
  const query = String(req.body?.query || '').trim();

  if (!query) {
    return res.json({
      query,
      filters: {
        categoria: null,
        ciudad: null,
        fecha: null,
        precioMax: null,
        keywords: [],
      },
      results: [],
      meta: {
        mode: 'empty',
        warning: null,
      },
    });
  }

  const aiResult = await inferFiltersWithAI(query);
  let filters = sanitizeFilters(aiResult.filters);
  const hasUsefulFilters =
    Boolean(filters.categoria) ||
    Boolean(filters.ciudad) ||
    Boolean(filters.fecha) ||
    filters.precioMax !== null ||
    filters.keywords.length > 0;

  if (!hasUsefulFilters) {
    logAiFallback(
      aiResult.mode === 'ai'
        ? 'OpenAI no devolvio filtros utiles'
        : 'la interpretacion local no devolvio filtros utiles',
    );
    filters = sanitizeFilters(inferFiltersFallback(query));
  }
  const results = filterEvents(filters).slice(0, 6);

  return res.json({
    query,
    filters,
    results,
    meta: {
      mode: aiResult.mode,
      warning: aiResult.warning || null,
    },
  });
});

app.get('/api/security-config', (req, res) => {
  return res.json({
    ok: true,
    cloudflare: {
      turnstileEnabled: TURNSTILE_ENABLED,
      siteKey: TURNSTILE_ENABLED ? TURNSTILE_SITE_KEY : null,
      mode: TURNSTILE_ENABLED ? 'active' : 'demo',
      message: TURNSTILE_ENABLED
        ? 'Cloudflare Turnstile activo.'
        : 'Cloudflare Turnstile listo para activar configurando TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY.',
    },
  });
});

// ── Endpoint: disponibilidad de asientos por evento ──
app.get('/api/events/:eventId/availability', (req, res) => {
  const eventId = String(req.params.eventId || '').trim();
  if (!eventId) {
    return res.status(400).json({ ok: false, message: 'eventId requerido.' });
  }

  const existingTickets = readTickets();
  const soldSeats = getSoldSeatsForEvent(eventId, existingTickets);
  const totalSold = soldSeats.size;

  return res.json({
    ok: true,
    eventId,
    totalSold,
    soldSeatKeys: [...soldSeats],
  });
});

app.post('/api/checkout/quote', purchaseLimiter, (req, res) => {
  try {
    const purchase = sanitizePurchasePayload(req.body);

    // ── Validación server-side del evento ──
    const catalogEvent = findCatalogEvent(purchase.event);
    const validationErrors = validatePurchaseRequest(purchase, catalogEvent);
    if (validationErrors.length) {
      return res.status(400).json({
        ok: false,
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    const quote = buildCheckoutQuote({
      event: purchase.event,
      seats: purchase.seats,
    });

    return res.json({
      ok: true,
      quote,
    });
  } catch (error) {
    console.warn('BoletaMax Checkout: quote rejected', {
      message: error?.message || 'Cotizacion invalida',
    });
    return res.status(400).json({
      ok: false,
      message: error?.message || 'No fue posible calcular una cotizacion segura.',
    });
  }
});

app.post('/api/tickets', purchaseLimiter, async (req, res) => {
  try {
    const purchase = sanitizePurchasePayload(req.body);
    const publicBaseUrl = getPublicBaseUrl(req);

    // ── 1. Validar estructura del request ──
    const catalogEvent = findCatalogEvent(purchase.event);
    const validationErrors = validatePurchaseRequest(purchase, catalogEvent);
    if (validationErrors.length) {
      console.warn('BoletaMax Tickets: validation failed', { errors: validationErrors });
      return res.status(400).json({
        ok: false,
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    // ── 2. Verificar protección Cloudflare ──
    const turnstileResult = await verifyTurnstileToken(req, purchase.turnstileToken);
    if (!turnstileResult.ok) {
      console.warn('BoletaMax Cloudflare: request rejected', {
        reason: turnstileResult.reason,
      });
      return res.status(403).json({
        ok: false,
        message: 'No se pudo verificar la proteccion Cloudflare. Intenta nuevamente.',
      });
    }

    // ── 3. Precios autoritativos del servidor ──
    const authoritativePurchase = getAuthoritativePurchase(purchase);
    const eventId = buildEventId(authoritativePurchase.event);
    const orderId = createOrderId();
    const orderSeatCount = authoritativePurchase.seats.length;

    // ── 4. Validar inventario + escribir atómicamente con mutex ──
    const tickets = await withTicketsWriteLock(async () => {
      const existingTickets = readTickets();

      // Verificar que los asientos no están ya vendidos
      const conflicts = validateSeatInventory(eventId, authoritativePurchase.seats, existingTickets);
      if (conflicts.length) {
        const labels = conflicts.map(c =>
          `${c.seat.zone} Fila ${c.seat.fila} Asiento ${c.seat.asiento || c.seat.seatInMesa || '?'} (${c.reason})`,
        );
        throw new Error(`Asientos no disponibles: ${labels.join(', ')}. Selecciona otros asientos.`);
      }

      // Verificar límite de boletos por evento (mismo IP o misma sesión)
      const ticketsForEvent = existingTickets.filter(
        t => t.eventId === eventId && t.status === 'active',
      );
      if (ticketsForEvent.length + orderSeatCount > 500) {
        throw new Error('El evento ha alcanzado su capacidad maxima.');
      }

      const newTickets = await Promise.all(
        authoritativePurchase.seats.map(seat =>
          buildTicketRecord({
            orderId,
            event: authoritativePurchase.event,
            seat,
            totalPaid: authoritativePurchase.total,
            paymentMethod: purchase.paymentMethod,
            orderSeatCount,
            publicBaseUrl,
          }),
        ),
      );
      if (TICKETS_WRITE_MODE === 'postgres-primary') {
        await persistTicketPurchaseByWriteMode({
          ticketRecords: newTickets,
          mode: TICKETS_WRITE_MODE,
          saveJsonBackup: () => writeTickets([...existingTickets, ...newTickets]),
          logger: console,
        });
      } else {
        writeTickets([...existingTickets, ...newTickets]);
      }
      return newTickets;
    });

    if (TICKETS_WRITE_MODE === 'dual-write') {
      await writeTicketPurchaseToPostgresIfEnabled({
        ticketRecords: tickets,
        mode: TICKETS_WRITE_MODE,
        logger: console,
      });
    }

    console.log('BoletaMax Tickets: orden creada', {
      orderId,
      eventId,
      seats: orderSeatCount,
      total: authoritativePurchase.total,
      method: purchase.paymentMethod,
    });

    return res.status(201).json({
      ok: true,
      orderId,
      eventId,
      pricing: {
        quoteId: authoritativePurchase.quoteId,
        subtotal: authoritativePurchase.subtotal,
        fee: authoritativePurchase.fee,
        totalPaid: authoritativePurchase.total,
        paymentMethod: purchase.paymentMethod,
        currency: 'MXN',
      },
      security: {
        serverPriced: true,
        serverValidated: true,
        inventoryChecked: true,
        cloudflare: turnstileResult.mode,
      },
      tickets: tickets.map(t => ({
        ...serializeTicketPublic(t),
        token: t.token, // Retornamos el token criptográfico privado ÚNICAMENTE al comprador original en la respuesta del checkout
      })),
    });
  } catch (error) {
    const isClientError = /Cotizacion|cotizacion|asientos|Evento|Zona|expir|disponible|invalida|requerido|maximo|metodo/i.test(error?.message || '');
    console.error('BoletaMax Tickets: error al generar boletos', {
      message: error?.message || 'Error desconocido',
    });
    return res.status(isClientError ? 400 : 500).json({
      ok: false,
      message: isClientError
        ? error.message
        : 'No fue posible generar los boletos en este momento.',
    });
  }
});

app.get('/api/tickets', ticketQueryLimiter, async (req, res) => {
  return res.status(410).json({
    ok: false,
    message: 'Este endpoint requiere autenticacion privada. Usa POST /api/tickets/private.',
  });
});

app.get('/api/public/tickets/:ticketId', ticketQueryLimiter, async (req, res) => {
  const ticketId = String(req.params.ticketId || '').trim();
  if (!ticketId) {
    return res.status(400).json({
      ok: false,
      message: 'ticketId requerido.',
    });
  }

  try {
    const ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });

    if (!ticket) {
      return res.status(404).json({
        ok: false,
        message: 'Boleto no encontrado.',
      });
    }

    return res.json({
      ok: true,
      ticket: serializeTicketPublicView(ticket),
    });
  } catch (error) {
    console.error('BoletaMax Tickets: storage read failed', {
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los boletos en este momento.',
    });
  }
});

app.post('/api/tickets/private', ticketQueryLimiter, async (req, res) => {
  const requestedTickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
  const ticketRequests = requestedTickets
    .map(item => ({
      ticketId: String(item?.ticketId || '').trim(),
      token: String(item?.token || '').trim(),
    }))
    .filter(item => item.ticketId && item.token)
    .slice(0, 50);

  if (!ticketRequests.length) {
    return res.status(400).json({
      ok: false,
      message: 'Debes enviar al menos un ticketId con token.',
    });
  }

  const ids = [...new Set(ticketRequests.map(item => item.ticketId))];

  try {
    const tickets = await getTicketsByIdsFromStorage({
      ids,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });
    const ticketsById = new Map(tickets.map(ticket => [ticket.ticketId, ticket]));
    const validTickets = [];
    const returnedIds = new Set();

    for (const request of ticketRequests) {
      const ticket = ticketsById.get(request.ticketId);
      if (!ticket || returnedIds.has(request.ticketId)) continue;
      if (!verifyTicketPrivateToken(ticket, request.token)) continue;
      validTickets.push(serializeTicketPublic(ticket));
      returnedIds.add(request.ticketId);
    }

    return res.json({
      ok: true,
      tickets: validTickets,
    });
  } catch (error) {
    console.error('BoletaMax Tickets: private storage read failed', {
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los boletos en este momento.',
    });
  }
});

app.get('/api/tickets/:ticketId/dynamic-qr', ticketQueryLimiter, async (req, res) => {
  const ticketId = String(req.params.ticketId || '').trim();
  const token = String(req.headers['x-ticket-token'] || '').trim();
  console.log('BoletaMax QR: request', { ticketId });

  let ticket = null;
  try {
    ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });
  } catch (error) {
    console.error('BoletaMax QR: storage read failed', {
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No se pudo consultar el boleto en este momento.',
    });
  }

  if (!ticket) {
    console.warn('BoletaMax QR: ticket not found', { ticketId });
    return res.status(404).json({
      ok: false,
      message: 'Boleto no encontrado.',
    });
  }

  if (!verifyTicketPrivateToken(ticket, token)) {
    console.warn('BoletaMax QR: unauthorized access attempt', { ticketId });
    return res.status(403).json({
      ok: false,
      message: 'Acceso no autorizado al código de entrada.',
    });
  }

  if (ticket.status !== 'active' || ticket.usedAt) {
    const reason = ticket.status === 'used' || ticket.usedAt ? 'boleto ya utilizado' : 'boleto no disponible';
    console.log('BoletaMax QR: unavailable', {
      ticketId,
      status: ticket.status,
      usedAt: ticket.usedAt,
      reason,
    });
    return res.json({
      ok: true,
      active: false,
      ticket: serializeTicketPublic(ticket),
      message: reason,
    });
  }

  try {
    const dynamicQr = await buildDynamicQrResponse(ticket);
    console.log('BoletaMax QR: generated', {
      ticketId,
      status: ticket.status,
      window: dynamicQr.window,
    });

    return res.json({
      ok: true,
      active: true,
      ticket: serializeTicketPublic(ticket),
      ...dynamicQr,
    });
  } catch (error) {
    console.error('BoletaMax QR: generation failed', {
      ticketId,
      status: ticket.status,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No se pudo generar el QR dinámico.',
    });
  }
});

app.get('/api/tickets/:ticketId', ticketQueryLimiter, async (req, res) => {
  const ticketId = String(req.params.ticketId || '').trim();
  const token = String(req.headers['x-ticket-token'] || '').trim();

  try {
    const ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });

    if (!ticket) {
      return res.status(404).json({
        ok: false,
        message: 'Boleto no encontrado.',
      });
    }

    if (!verifyTicketPrivateToken(ticket, token)) {
      console.warn('BoletaMax Tickets: unauthorized private detail access attempt', { ticketId });
      return res.status(403).json({
        ok: false,
        message: 'Acceso no autorizado al detalle del boleto.',
      });
    }

    return res.json({
      ok: true,
      ticket: serializeTicketPublic(ticket),
    });
  } catch (error) {
    console.error('BoletaMax Tickets: storage read failed', {
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el boleto en este momento.',
    });
  }
});

app.post('/api/validate-ticket', validationLimiter, requireAdminAuth, async (req, res) => {
  const ticketId = String(req.body?.ticketId || '').trim();
  const eventId = String(req.body?.eventId || '').trim();
  const token = String(req.body?.token || '').trim();
  const dynamicToken = String(req.body?.dynamicToken || '').trim();
  const requestedWindow = Number(req.body?.window);
  if (!ticketId) {
    return res.json({
      valid: false,
      message: 'Boleto inválido',
    });
  }

  let result;
  try {
    result = await withTicketValidationLock(ticketId, async () => {
    const ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });

    if (!ticket) {
      return {
        valid: false,
        message: 'Boleto inválido',
      };
    }

    if (eventId && ticket.eventId !== eventId) {
      return {
        valid: false,
        message: 'Boleto inválido',
      };
    }

    const hasDynamicPayload = Boolean(dynamicToken) || Number.isFinite(requestedWindow);
    if (hasDynamicPayload) {
      if (!dynamicToken || !Number.isFinite(requestedWindow)) {
        return {
          valid: false,
          message: 'QR inválido o expirado',
        };
      }

      const currentWindow = getDynamicQrWindow();
      const candidateWindows = new Set([
        currentWindow,
        currentWindow - DYNAMIC_QR_TOLERANCE_WINDOWS,
      ]);

      if (!candidateWindows.has(requestedWindow)) {
        return {
          valid: false,
          message: 'QR inválido o expirado',
        };
      }

      const expectedDynamicToken = createDynamicToken(ticket, requestedWindow);
      if (!safeEqualString(dynamicToken, expectedDynamicToken)) {
        return {
          valid: false,
          message: 'Boleto inválido',
        };
      }
    } else if (token) {
      if (!verifyTicketPrivateToken(ticket, token)) {
        return {
          valid: false,
          message: 'Boleto inválido',
        };
      }
    } else {
      return {
        valid: false,
        message: 'Boleto inválido',
      };
    }

    if (ticket.status === 'used' || ticket.usedAt) {
      return {
        valid: false,
        message: 'Boleto ya utilizado',
        usedAt: ticket.usedAt || null,
        ticket: serializeTicketPublic(ticket),
      };
    }

    if (ticket.status === 'cancelled') {
      return {
        valid: false,
        message: 'Boleto cancelado',
        ticket: serializeTicketPublic(ticket),
      };
    }

    if (ticket.status !== 'active') {
      return {
        valid: false,
        message: 'Boleto inválido',
        ticket: serializeTicketPublic(ticket),
      };
    }

    const usedAt = new Date().toISOString();
    const markResult = await markTicketUsedInStorage({
      ticket,
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      usedAt,
      readJsonTickets: readTickets,
      writeJsonTickets: writeTickets,
      logger: console,
    });

    if (!markResult.updated) {
      const latestTicket = markResult.ticket || ticket;
      if (markResult.reason === 'already_used') {
        return {
          valid: false,
          message: 'Boleto ya utilizado',
          usedAt: latestTicket.usedAt || null,
          ticket: serializeTicketPublic(latestTicket),
        };
      }

      if (markResult.reason === 'cancelled') {
        return {
          valid: false,
          message: 'Boleto cancelado',
          ticket: serializeTicketPublic(latestTicket),
        };
      }

      return {
        valid: false,
        message: 'Boleto inválido',
        ticket: serializeTicketPublic(latestTicket),
      };
    }

    return {
      valid: true,
      message: 'Boleto válido',
      usedAt,
      ticket: serializeTicketPublic(markResult.ticket),
    };
    });
  } catch (error) {
    console.error('BoletaMax Validate: storage update failed', {
      mode: TICKETS_STORAGE_MODE,
      message: 'Ticket validation storage operation failed.',
    });
    return res.status(500).json({
      valid: false,
      message: 'No fue posible validar el boleto en este momento.',
    });
  }

  return res.json(result);
});

app.get('/ticket', (req, res) => {
  res.sendFile(path.join(__dirname, 'ticket.html'));
});

app.get('/tickets/:ticketId', (req, res) => {
  res.sendFile(path.join(__dirname, 'ticket-public.html'));
});

app.get('/admin/scan', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'validate.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BoletaMax running at http://localhost:${PORT}`);
  console.log(`BoletaMax AI debug: OPENAI_API_KEY ${hasOpenAIKey ? 'detectada' : 'ausente'}`);
  console.log(hasOpenAIKey ? 'BoletaMax AI: OpenAI habilitado' : 'BoletaMax AI: usando fallback local');
  console.log(`BoletaMax Security: ADMIN_API_KEY ${ADMIN_API_KEY ? 'configurada' : 'NO configurada (admin sin protección)'}`);
  console.log(`BoletaMax Security: Turnstile ${TURNSTILE_ENABLED ? 'activo' : 'desactivado'}`);
  console.log('BoletaMax Security: Rate limiting activo en todos los endpoints API');
  console.log('BoletaMax Security: Archivos sensibles bloqueados (.env, server.mjs, tickets.json)');
});
