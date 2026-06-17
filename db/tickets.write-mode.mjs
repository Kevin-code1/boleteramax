import { insertTicketPurchase } from './tickets.repository.mjs';

const VALID_WRITE_MODES = new Set(['json', 'dual-write', 'postgres-primary']);
export const DEFAULT_TICKETS_WRITE_MODE = 'postgres-primary';

function maskReference(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'unknown';
  if (text.length <= 10) return `${text.slice(0, 3)}...`;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function getSafeErrorInfo(error = {}) {
  return {
    name: error?.name || 'Error',
    code: error?.code || null,
    message: 'PostgreSQL ticket write failed.',
  };
}

function logPostgresPrimaryError(logger, ticketRecords, error) {
  if (!logger?.error) return;

  const records = Array.isArray(ticketRecords) ? ticketRecords : [];
  logger.error('BoletaMax Tickets: PostgreSQL primary write failed', {
    orderId: maskReference(records[0]?.orderId),
    firstTicketId: maskReference(records[0]?.ticketId),
    ticketCount: records.length,
    error: getSafeErrorInfo(error),
  });
}

function logJsonBackupWarning(logger, ticketRecords, error) {
  if (!logger?.warn) return;

  const records = Array.isArray(ticketRecords) ? ticketRecords : [];
  logger.warn('BoletaMax Tickets: JSON backup write failed after PostgreSQL primary save', {
    orderId: maskReference(records[0]?.orderId),
    firstTicketId: maskReference(records[0]?.ticketId),
    ticketCount: records.length,
    error: {
      name: error?.name || 'Error',
      code: error?.code || null,
      message: 'JSON backup write failed.',
    },
  });
}

export class TicketPurchasePrimaryWriteError extends Error {
  constructor() {
    super('PostgreSQL primary ticket write failed.');
    this.name = 'TicketPurchasePrimaryWriteError';
  }
}

function logDualWriteWarning(logger, ticketRecords, error) {
  if (!logger?.warn) return;

  const records = Array.isArray(ticketRecords) ? ticketRecords : [];
  logger.warn('BoletaMax Tickets: PostgreSQL dual-write failed after JSON save', {
    orderId: maskReference(records[0]?.orderId),
    firstTicketId: maskReference(records[0]?.ticketId),
    ticketCount: records.length,
    error: getSafeErrorInfo(error),
  });
}

export function getTicketsWriteMode(rawMode = process.env.TICKETS_WRITE_MODE) {
  const mode = String(rawMode || DEFAULT_TICKETS_WRITE_MODE).trim().toLowerCase();
  return VALID_WRITE_MODES.has(mode) ? mode : DEFAULT_TICKETS_WRITE_MODE;
}

export async function writeTicketPurchaseToPostgresIfEnabled({
  ticketRecords,
  mode = getTicketsWriteMode(),
  repository = { insertTicketPurchase },
  logger = console,
} = {}) {
  const writeMode = getTicketsWriteMode(mode);

  if (writeMode !== 'dual-write') {
    return {
      mode: writeMode,
      attempted: 0,
      inserted: 0,
      skipped: 0,
      enabled: false,
    };
  }

  try {
    const result = await repository.insertTicketPurchase(ticketRecords);
    return {
      mode: writeMode,
      enabled: true,
      failed: false,
      ...result,
    };
  } catch (error) {
    logDualWriteWarning(logger, ticketRecords, error);
    return {
      mode: writeMode,
      enabled: true,
      failed: true,
      attempted: Array.isArray(ticketRecords) ? ticketRecords.length : 0,
      inserted: 0,
      skipped: 0,
    };
  }
}

export async function writeTicketPurchaseToPostgresPrimary({
  ticketRecords,
  repository = { insertTicketPurchase },
  logger = console,
} = {}) {
  try {
    const result = await repository.insertTicketPurchase(ticketRecords);
    return {
      mode: 'postgres-primary',
      enabled: true,
      failed: false,
      ...result,
    };
  } catch (error) {
    logPostgresPrimaryError(logger, ticketRecords, error);
    throw new TicketPurchasePrimaryWriteError();
  }
}

export async function persistTicketPurchaseByWriteMode({
  ticketRecords,
  mode = getTicketsWriteMode(),
  saveJsonBackup,
  repository = { insertTicketPurchase },
  logger = console,
} = {}) {
  const writeMode = getTicketsWriteMode(mode);

  if (writeMode === 'json') {
    await saveJsonBackup?.();
    return {
      mode: writeMode,
      enabled: false,
      attempted: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  if (writeMode === 'dual-write') {
    await saveJsonBackup?.();
    return writeTicketPurchaseToPostgresIfEnabled({
      ticketRecords,
      mode: writeMode,
      repository,
      logger,
    });
  }

  const postgresResult = await writeTicketPurchaseToPostgresPrimary({
    ticketRecords,
    repository,
    logger,
  });

  try {
    await saveJsonBackup?.();
  } catch (error) {
    logJsonBackupWarning(logger, ticketRecords, error);
    return {
      ...postgresResult,
      jsonBackupFailed: true,
    };
  }

  return {
    ...postgresResult,
    jsonBackupFailed: false,
  };
}
