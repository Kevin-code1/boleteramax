import { createHash, randomBytes } from 'crypto';
import { DYNAMIC_QR_WINDOW_MS } from '../config/index.mjs';
import { slugify } from './text.mjs';

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

export function createDynamicToken(ticketId, dynamicSecret, window) {
  return createHash('sha256')
    .update(`${ticketId}:${dynamicSecret}:${window}`)
    .digest('hex')
    .slice(0, 24);
}

export function buildDynamicQrPayload(ticket, dynamicSecret, window = getDynamicQrWindow()) {
  return {
    ticketId: ticket.ticketId,
    eventId: ticket.eventId,
    dynamicToken: createDynamicToken(ticket.ticketId, dynamicSecret, window),
    window,
  };
}

export function getDynamicQrSecondsRemaining(now = Date.now()) {
  const elapsed = now % DYNAMIC_QR_WINDOW_MS;
  return Math.max(1, Math.ceil((DYNAMIC_QR_WINDOW_MS - elapsed) / 1000));
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
