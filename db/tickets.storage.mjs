import { createHash, timingSafeEqual } from 'crypto';
import {
  findSoldSeatTicketsByEvent,
  findTicketByCode,
  findTicketsByCodes,
  markTicketUsedByCode,
} from './tickets.repository.mjs';

const VALID_STORAGE_MODES = new Set(['json', 'postgres', 'dual-read', 'postgres-primary']);
export const DEFAULT_TICKETS_STORAGE_MODE = 'postgres-primary';
const SENSITIVE_KEYS = new Set([
  'token',
  'privateViewTokenHash',
  'private_view_token_hash',
  'qrTokenHash',
  'qr_token_hash',
  'dynamicSecret',
]);
const COMPARED_FIELDS = [
  'orderId',
  'eventId',
  'eventName',
  'date',
  'venue',
  'zone',
  'seatLabel',
  'totalPaid',
  'paymentMethod',
  'orderSeatCount',
  'status',
  'validationCount',
  'createdAt',
  'usedAt',
  'cancelledAt',
];

function hashPrivateToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqualString(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function maskTicketId(ticketId = '') {
  const value = String(ticketId || '').trim();
  if (!value) return 'unknown';
  if (value.length <= 10) return `${value.slice(0, 3)}...`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function stableComparable(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  return String(value);
}

function readJsonTickets(readJsonTicketsFn) {
  const tickets = readJsonTicketsFn();
  return Array.isArray(tickets) ? tickets : [];
}

function mapByTicketId(tickets) {
  const byId = new Map();
  for (const ticket of tickets || []) {
    if (ticket?.ticketId) byId.set(ticket.ticketId, ticket);
  }
  return byId;
}

function getRepository(repository = {}) {
  return {
    findTicketByCode: repository.findTicketByCode || findTicketByCode,
    findTicketsByCodes: repository.findTicketsByCodes || findTicketsByCodes,
    markTicketUsedByCode: repository.markTicketUsedByCode || markTicketUsedByCode,
    findSoldSeatTicketsByEvent: repository.findSoldSeatTicketsByEvent || findSoldSeatTicketsByEvent,
  };
}

function logStorageWarning(logger, message, payload = {}) {
  const cleanPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    cleanPayload[key] = value;
  }

  if (logger?.warn) {
    logger.warn(message, cleanPayload);
  }
}

export function getTicketsStorageMode(rawMode = process.env.TICKETS_STORAGE) {
  const mode = String(rawMode || DEFAULT_TICKETS_STORAGE_MODE).trim().toLowerCase();
  return VALID_STORAGE_MODES.has(mode) ? mode : DEFAULT_TICKETS_STORAGE_MODE;
}

export function compareTicketSnapshots(postgresTicket, jsonTicket) {
  if (!postgresTicket || !jsonTicket) return [];

  return COMPARED_FIELDS.filter(field => (
    stableComparable(postgresTicket[field]) !== stableComparable(jsonTicket[field])
  ));
}

export function warnOnTicketDifference({ postgresTicket, jsonTicket, logger = console }) {
  const differences = compareTicketSnapshots(postgresTicket, jsonTicket);
  if (!differences.length) return differences;

  logStorageWarning(logger, 'BoletaMax Tickets storage: dual-read mismatch', {
    ticketId: maskTicketId(postgresTicket?.ticketId || jsonTicket?.ticketId),
    fields: differences,
  });

  return differences;
}

export async function getTicketsByIdsFromStorage({
  ids,
  mode = getTicketsStorageMode(),
  readJsonTickets: readJsonTicketsFn,
  repository,
  logger = console,
}) {
  const cleanIds = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
  const storageMode = getTicketsStorageMode(mode);
  const repo = getRepository(repository);

  if (storageMode === 'json') {
    return readJsonTickets(readJsonTicketsFn).filter(ticket => cleanIds.includes(ticket.ticketId));
  }

  if (storageMode === 'postgres' || storageMode === 'postgres-primary') {
    return repo.findTicketsByCodes(cleanIds);
  }

  let postgresTickets = [];
  try {
    postgresTickets = await repo.findTicketsByCodes(cleanIds);
  } catch (error) {
    logStorageWarning(logger, 'BoletaMax Tickets storage: postgres read failed during dual-read', {
      message: error?.message || 'unknown database error',
    });
  }

  const postgresById = mapByTicketId(postgresTickets);
  const jsonTickets = readJsonTickets(readJsonTicketsFn);
  const jsonById = mapByTicketId(jsonTickets);
  const resolved = [];

  for (const ticketId of cleanIds) {
    const postgresTicket = postgresById.get(ticketId);
    const jsonTicket = jsonById.get(ticketId);

    if (postgresTicket) {
      if (jsonTicket) {
        warnOnTicketDifference({ postgresTicket, jsonTicket, logger });
      }
      resolved.push(postgresTicket);
    } else if (jsonTicket) {
      resolved.push(jsonTicket);
    }
  }

  return resolved;
}

export async function getTicketByIdFromStorage({
  ticketId,
  mode = getTicketsStorageMode(),
  readJsonTickets: readJsonTicketsFn,
  repository,
  logger = console,
}) {
  const cleanTicketId = String(ticketId || '').trim();
  if (!cleanTicketId) return null;

  const storageMode = getTicketsStorageMode(mode);
  const repo = getRepository(repository);

  if (storageMode === 'json') {
    return readJsonTickets(readJsonTicketsFn).find(ticket => ticket.ticketId === cleanTicketId) || null;
  }

  if (storageMode === 'postgres' || storageMode === 'postgres-primary') {
    return repo.findTicketByCode(cleanTicketId);
  }

  let postgresTicket = null;
  try {
    postgresTicket = await repo.findTicketByCode(cleanTicketId);
  } catch (error) {
    logStorageWarning(logger, 'BoletaMax Tickets storage: postgres read failed during dual-read', {
      ticketId: maskTicketId(cleanTicketId),
      message: error?.message || 'unknown database error',
    });
  }

  const jsonTicket = readJsonTickets(readJsonTicketsFn).find(ticket => ticket.ticketId === cleanTicketId) || null;
  if (postgresTicket) {
    if (jsonTicket) warnOnTicketDifference({ postgresTicket, jsonTicket, logger });
    return postgresTicket;
  }

  return jsonTicket;
}

// Asientos vendidos por evento según el modo de storage.
export async function getSoldSeatKeysFromStorage({
  eventId,
  mode = getTicketsStorageMode(),
  readJsonTickets: readJsonTicketsFn,
  repository,
  computeSoldSeatKeys,
  logger = console,
}) {
  const cleanEventId = String(eventId || '').trim();
  if (!cleanEventId) return new Set();

  const storageMode = getTicketsStorageMode(mode);
  const repo = getRepository(repository);
  const jsonKeys = () => computeSoldSeatKeys(cleanEventId, readJsonTickets(readJsonTicketsFn));

  if (storageMode === 'json') {
    return jsonKeys();
  }

  if (storageMode === 'postgres' || storageMode === 'postgres-primary') {
    const tickets = await repo.findSoldSeatTicketsByEvent(cleanEventId);
    return computeSoldSeatKeys(cleanEventId, tickets);
  }

  // dual-read: unión de ambas fuentes; si PostgreSQL falla, JSON sigue protegiendo.
  let postgresKeys = new Set();
  try {
    const tickets = await repo.findSoldSeatTicketsByEvent(cleanEventId);
    postgresKeys = computeSoldSeatKeys(cleanEventId, tickets);
  } catch (error) {
    logStorageWarning(logger, 'BoletaMax Tickets storage: postgres sold-seats read failed during dual-read', {
      message: error?.message || 'unknown database error',
    });
  }

  return new Set([...postgresKeys, ...jsonKeys()]);
}

export function getTicketDynamicSecret(ticket = {}) {
  if (ticket.dynamicSecret) return ticket.dynamicSecret;
  if (ticket.privateViewTokenHash) return ticket.privateViewTokenHash;
  if (ticket.token) return hashPrivateToken(ticket.token);
  return '';
}

export function verifyTicketPrivateToken(ticket = {}, token = '') {
  const provided = String(token || '').trim();
  if (!provided) return false;

  if (ticket.privateViewTokenHash) {
    return safeEqualString(hashPrivateToken(provided), ticket.privateViewTokenHash);
  }

  if (ticket.token) {
    return safeEqualString(provided, ticket.token);
  }

  return false;
}

function markJsonTicketUsed({ ticketId, usedAt, readJsonTickets: readJsonTicketsFn, writeJsonTickets }) {
  const tickets = readJsonTickets(readJsonTicketsFn);
  const ticketIndex = tickets.findIndex(item => item.ticketId === ticketId);

  if (ticketIndex === -1) {
    return {
      updated: false,
      reason: 'not_found',
      ticket: null,
    };
  }

  const ticket = tickets[ticketIndex];
  if (ticket.status === 'used' || ticket.usedAt) {
    return {
      updated: false,
      reason: 'already_used',
      ticket,
    };
  }

  if (ticket.status === 'cancelled') {
    return {
      updated: false,
      reason: 'cancelled',
      ticket,
    };
  }

  if (ticket.status !== 'active') {
    return {
      updated: false,
      reason: 'not_active',
      ticket,
    };
  }

  const updatedTicket = {
    ...ticket,
    status: 'used',
    usedAt,
    validationCount: Number(ticket.validationCount || 0) + 1,
  };

  tickets[ticketIndex] = updatedTicket;
  writeJsonTickets(tickets);

  return {
    updated: true,
    reason: 'used',
    ticket: updatedTicket,
  };
}

function logJsonBackupWarning(logger, ticketId, error) {
  logStorageWarning(logger, 'BoletaMax Tickets storage: JSON validation backup failed after PostgreSQL save', {
    ticketId: maskTicketId(ticketId),
    error: {
      name: error?.name || 'Error',
      code: error?.code || null,
      message: 'JSON validation backup failed.',
    },
  });
}

export async function markTicketUsedInStorage({
  ticket,
  ticketId,
  mode = getTicketsStorageMode(),
  usedAt = new Date().toISOString(),
  readJsonTickets: readJsonTicketsFn,
  writeJsonTickets,
  repository,
  logger = console,
}) {
  const cleanTicketId = String(ticketId || ticket?.ticketId || '').trim();
  const storageMode = getTicketsStorageMode(mode);
  const repo = getRepository(repository);

  if (storageMode === 'json') {
    return markJsonTicketUsed({
      ticketId: cleanTicketId,
      usedAt,
      readJsonTickets: readJsonTicketsFn,
      writeJsonTickets,
    });
  }

  const shouldUsePostgres =
    storageMode === 'postgres' ||
    storageMode === 'postgres-primary' ||
    ticket?.storageSource === 'postgres' ||
    Boolean(ticket?.privateViewTokenHash);

  if (shouldUsePostgres) {
    const result = await repo.markTicketUsedByCode(cleanTicketId, { usedAt });

    if (result.updated && writeJsonTickets && readJsonTicketsFn) {
      try {
        markJsonTicketUsed({
          ticketId: cleanTicketId,
          usedAt,
          readJsonTickets: readJsonTicketsFn,
          writeJsonTickets,
        });
      } catch (error) {
        logJsonBackupWarning(logger, cleanTicketId, error);
      }
    }

    return result;
  }

  return markJsonTicketUsed({
    ticketId: cleanTicketId,
    usedAt,
    readJsonTickets: readJsonTicketsFn,
    writeJsonTickets,
  });
}

export function serializeTicketForPublic(ticket = {}, { buildPublicTicketPath } = {}) {
  return {
    ticketId: ticket.ticketId,
    orderId: ticket.orderId,
    eventId: ticket.eventId,
    eventName: ticket.eventName,
    date: ticket.date,
    venue: ticket.venue,
    zone: ticket.zone,
    seatLabel: ticket.seatLabel,
    seat: ticket.seat,
    totalPaid: ticket.totalPaid,
    paymentMethod: ticket.paymentMethod,
    orderSeatCount: ticket.orderSeatCount,
    status: ticket.status,
    validationCount: Number(ticket.validationCount || 0),
    publicPath: ticket.publicPath || buildPublicTicketPath?.(ticket.ticketId) || null,
    publicUrl: ticket.publicUrl || null,
    createdAt: ticket.createdAt,
    usedAt: ticket.usedAt,
    cancelledAt: ticket.cancelledAt,
  };
}
