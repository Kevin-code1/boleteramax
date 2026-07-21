import fs from 'fs';
import { TICKETS_PATH, TICKETS_STORAGE_MODE, TICKETS_WRITE_MODE } from '../../config/index.mjs';
import { buildPublicTicketPath } from '../../domain/tickets.mjs';
import { getSoldSeatsForEvent } from '../../domain/pricing.mjs';
import {
  getSoldSeatKeysFromStorage,
  getTicketByIdFromStorage,
  getTicketsByIdsFromStorage,
  getTicketDynamicSecret,
  markTicketUsedInStorage,
  serializeTicketForPublic,
  verifyTicketPrivateToken,
} from '../../../db/tickets.storage.mjs';
import { findTicketsByUserId } from '../../../db/tickets.repository.mjs';
import {
  persistTicketPurchaseByWriteMode,
  writeTicketPurchaseToPostgresIfEnabled,
} from '../../../db/tickets.write-mode.mjs';

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

const ticketValidationLocks = new Map();
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

export function createTicketStore({ logger = console } = {}) {
  return {
    storageMode: TICKETS_STORAGE_MODE,
    writeMode: TICKETS_WRITE_MODE,

    ensureTicketsFile: () => ensureJsonFile(TICKETS_PATH, []),
    readTickets,
    writeTickets,
    withWriteLock: withTicketsWriteLock,
    withValidationLock: withTicketValidationLock,

    getTicketById: ticketId =>
      getTicketByIdFromStorage({
        ticketId,
        mode: TICKETS_STORAGE_MODE,
        readJsonTickets: readTickets,
        logger,
      }),

    getTicketsByIds: ids =>
      getTicketsByIdsFromStorage({
        ids,
        mode: TICKETS_STORAGE_MODE,
        readJsonTickets: readTickets,
        logger,
      }),

    getSoldSeatKeys: eventId =>
      getSoldSeatKeysFromStorage({
        eventId,
        mode: TICKETS_STORAGE_MODE,
        readJsonTickets: readTickets,
        computeSoldSeatKeys: getSoldSeatsForEvent,
        logger,
      }),

    markTicketUsed: ({ ticket, ticketId, usedAt }) =>
      markTicketUsedInStorage({
        ticket,
        ticketId,
        mode: TICKETS_STORAGE_MODE,
        usedAt,
        readJsonTickets: readTickets,
        writeJsonTickets: writeTickets,
        logger,
      }),

    verifyPrivateToken: verifyTicketPrivateToken,
    getDynamicSecret: getTicketDynamicSecret,
    serializePublic: ticket => serializeTicketForPublic(ticket, { buildPublicTicketPath }),

    isOwnedBy: (ticket, userId) =>
      Boolean(userId) &&
      (ticket?.ownerUserId === userId || ticket?.userId === userId),

    getTicketsByUserId: async userId => {
      const cleanUserId = String(userId || '').trim();
      if (!cleanUserId) return [];

      if (TICKETS_STORAGE_MODE === 'json') {
        return readTickets().filter(ticket => ticket.userId === cleanUserId);
      }

      return findTicketsByUserId(cleanUserId);
    },

    saveNewTickets: async ({ existingTickets, newTickets, order = null }) => {
      if (TICKETS_WRITE_MODE === 'postgres-primary') {
        await persistTicketPurchaseByWriteMode({
          ticketRecords: newTickets,
          order,
          mode: TICKETS_WRITE_MODE,
          saveJsonBackup: () => writeTickets([...existingTickets, ...newTickets]),
          logger,
        });
      } else {
        writeTickets([...existingTickets, ...newTickets]);
      }
    },

    syncDualWrite: async (tickets, order = null) => {
      if (TICKETS_WRITE_MODE !== 'dual-write') return;
      await writeTicketPurchaseToPostgresIfEnabled({
        ticketRecords: tickets,
        order,
        mode: TICKETS_WRITE_MODE,
        logger,
      });
    },
  };
}
