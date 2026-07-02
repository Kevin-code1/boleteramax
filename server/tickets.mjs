import fs from 'fs';
import QRCode from 'qrcode';
import { createHash, randomBytes } from 'crypto';
import {
  DYNAMIC_QR_WINDOW_MS,
  TICKETS_PATH,
} from './config.mjs';
import { slugify } from './text.mjs';
import {
  getTicketDynamicSecret,
  serializeTicketForPublic,
} from '../db/tickets.storage.mjs';

// ── Mutex simple para escritura de tickets (previene race conditions) ──
let _ticketsWriteLock = Promise.resolve();
export async function withTicketsWriteLock(task) {
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

const ticketValidationLocks = new Map();
export async function withTicketValidationLock(ticketId, task) {
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

export function ensureJsonFile(filePath, defaultValue) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
}

export function readTickets() {
  ensureJsonFile(TICKETS_PATH, []);
  return JSON.parse(fs.readFileSync(TICKETS_PATH, 'utf8'));
}

export function writeTickets(tickets) {
  fs.writeFileSync(TICKETS_PATH, JSON.stringify(tickets, null, 2));
}

export function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

export function buildPublicTicketPath(ticketId) {
  return `/tickets/${encodeURIComponent(ticketId)}`;
}

export function buildPublicTicketUrl(baseUrl, ticketId) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${buildPublicTicketPath(ticketId)}`;
}

export function buildEventId(event = {}) {
  const seed = [event.name || 'evento', event.date || 'fecha', event.venue || 'venue'].join('|');
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 10);
  return `${slugify(event.name || 'evento') || 'evento'}-${digest}`;
}

export function createOrderId() {
  return `BM-ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createTicketId() {
  return `BM-TKT-${randomBytes(10).toString('hex').toUpperCase()}`;
}

export function createTicketToken() {
  return randomBytes(12).toString('hex');
}

export function getDynamicQrWindow(timestamp = Date.now()) {
  return Math.floor(timestamp / DYNAMIC_QR_WINDOW_MS);
}

export function createDynamicToken(ticket, window) {
  const dynamicSecret = getTicketDynamicSecret(ticket);
  return createHash('sha256')
    .update(`${ticket.ticketId}:${dynamicSecret}:${window}`)
    .digest('hex')
    .slice(0, 24);
}

export function buildDynamicQrPayload(ticket, window = getDynamicQrWindow()) {
  return {
    ticketId: ticket.ticketId,
    eventId: ticket.eventId,
    dynamicToken: createDynamicToken(ticket, window),
    window,
  };
}

export function getDynamicQrSecondsRemaining(now = Date.now()) {
  const elapsed = now % DYNAMIC_QR_WINDOW_MS;
  return Math.max(1, Math.ceil((DYNAMIC_QR_WINDOW_MS - elapsed) / 1000));
}

export async function buildDynamicQrResponse(ticket, window = getDynamicQrWindow()) {
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

export function serializeTicketPublic(ticket) {
  return serializeTicketForPublic(ticket, { buildPublicTicketPath });
}

export function serializeTicketPublicView(ticket = {}) {
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

export function buildSeatLabel(seat = {}) {
  if (seat.tableSize > 1) {
    return `${seat.zone} · Fila ${seat.fila} · Mesa ${seat.mesa} · Lugar ${seat.seatInMesa}`;
  }
  return `${seat.zone} · Fila ${seat.fila} · Asiento ${seat.asiento}`;
}

export async function buildTicketRecord({ orderId, event, seat, totalPaid, paymentMethod, orderSeatCount, publicBaseUrl }) {
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
