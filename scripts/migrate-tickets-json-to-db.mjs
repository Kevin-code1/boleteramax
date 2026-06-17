import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { closePool, withTransaction } from '../db/pool.mjs';
import {
  countExistingTicketCodes,
  countTickets,
  getExistingTicketCodes,
  importLegacyTicket,
  syncLegacyTicketPublicMetadata,
} from '../db/tickets.repository.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const ticketsPath = path.join(rootDir, 'data', 'tickets.json');
const backupsDir = path.join(rootDir, 'data', 'backups');

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');
const isCountOnly = args.has('--count');

function maskRef(value) {
  const text = String(value || '').trim();
  if (!text) return 'unknown';
  if (text.length <= 10) return `${text.slice(0, 3)}...`;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function sanitizeError(error) {
  const message = String(error?.message || 'Unknown error');
  return message
    .replace(/[a-f0-9]{24,}/gi, '[redacted]')
    .replace(/BM-TKT-[A-Z0-9-]+/g, '[ticket-redacted]')
    .replace(/BM-ORD-[A-Z0-9-]+/g, '[order-redacted]');
}

function validateTicketShape(ticket, index) {
  const errors = [];

  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    return [`Ticket at index ${index} must be an object.`];
  }

  const requiredStrings = ['ticketId', 'orderId', 'eventName', 'token'];
  for (const field of requiredStrings) {
    if (typeof ticket[field] !== 'string' || !ticket[field].trim()) {
      errors.push(`Ticket ${maskRef(ticket.ticketId)} is missing ${field}.`);
    }
  }

  if (ticket.seat !== undefined && (typeof ticket.seat !== 'object' || Array.isArray(ticket.seat))) {
    errors.push(`Ticket ${maskRef(ticket.ticketId)} has invalid seat data.`);
  }

  if (ticket.totalPaid !== undefined && !Number.isFinite(Number(ticket.totalPaid))) {
    errors.push(`Ticket ${maskRef(ticket.ticketId)} has invalid totalPaid.`);
  }

  const status = String(ticket.status || 'active').toLowerCase();
  if (!['active', 'used', 'cancelled', 'canceled', 'refunded', 'void'].includes(status)) {
    errors.push(`Ticket ${maskRef(ticket.ticketId)} has unsupported status.`);
  }

  return errors;
}

function validateTickets(tickets) {
  const errors = [];
  const seenTicketIds = new Set();

  tickets.forEach((ticket, index) => {
    errors.push(...validateTicketShape(ticket, index));

    const ticketId = typeof ticket?.ticketId === 'string' ? ticket.ticketId.trim() : '';
    if (!ticketId) return;

    if (seenTicketIds.has(ticketId)) {
      errors.push(`Duplicate ticket code in JSON: ${maskRef(ticketId)}.`);
      return;
    }

    seenTicketIds.add(ticketId);
  });

  return errors;
}

async function loadTicketsJson() {
  const raw = await fs.readFile(ticketsPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('data/tickets.json must contain an array.');
  }

  return parsed;
}

async function createBackup() {
  await fs.mkdir(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `tickets-${stamp}.json`);
  await fs.copyFile(ticketsPath, backupPath);
  return backupPath;
}

function printValidationErrors(errors) {
  const maxErrors = 10;
  for (const error of errors.slice(0, maxErrors)) {
    console.error(`- ${error}`);
  }

  if (errors.length > maxErrors) {
    console.error(`- ...and ${errors.length - maxErrors} more validation error(s).`);
  }
}

async function countMode() {
  const tickets = await loadTicketsJson();
  const dbCount = await countTickets();
  const ticketCodes = tickets.map(ticket => String(ticket?.ticketId || '').trim()).filter(Boolean);
  const alreadyImported = await countExistingTicketCodes(ticketCodes);

  console.log(`JSON tickets: ${tickets.length}`);
  console.log(`PostgreSQL tickets: ${dbCount}`);
  console.log(`JSON tickets already present in PostgreSQL: ${alreadyImported}`);
}

async function dryRunMode() {
  const tickets = await loadTicketsJson();
  const validationErrors = validateTickets(tickets);
  const ticketCodes = tickets.map(ticket => String(ticket?.ticketId || '').trim()).filter(Boolean);
  const alreadyImported = validationErrors.length ? 0 : await countExistingTicketCodes(ticketCodes);

  console.log('Dry run only. No database writes and no backup created.');
  console.log(`Tickets found in JSON: ${tickets.length}`);
  console.log(`Validation errors: ${validationErrors.length}`);

  if (validationErrors.length) {
    printValidationErrors(validationErrors);
    process.exitCode = 1;
    return;
  }

  console.log(`Already present in PostgreSQL: ${alreadyImported}`);
  console.log(`Would insert: ${tickets.length - alreadyImported}`);
}

async function migrateMode() {
  const tickets = await loadTicketsJson();
  const validationErrors = validateTickets(tickets);

  if (validationErrors.length) {
    console.error(`Migration stopped. Validation errors: ${validationErrors.length}`);
    printValidationErrors(validationErrors);
    process.exitCode = 1;
    return;
  }

  const backupPath = await createBackup();
  const existingTicketCodes = await getExistingTicketCodes(tickets.map(ticket => ticket.ticketId));

  let inserted = 0;
  let skipped = 0;
  let reconciled = 0;
  const failures = [];

  for (const ticket of tickets) {
    if (existingTicketCodes.has(ticket.ticketId)) {
      skipped++;
      try {
        const result = await withTransaction(client => syncLegacyTicketPublicMetadata(client, ticket));
        if (result.updated) reconciled++;
      } catch (error) {
        failures.push({
          ticket: maskRef(ticket.ticketId),
          message: sanitizeError(error),
        });
      }
      continue;
    }

    try {
      const result = await withTransaction(client => importLegacyTicket(client, ticket, {
        allowSeatConflictFallback: true,
      }));
      if (result.inserted) {
        inserted++;
        existingTicketCodes.add(ticket.ticketId);
      } else {
        skipped++;
      }
    } catch (error) {
      failures.push({
        ticket: maskRef(ticket.ticketId),
        message: sanitizeError(error),
      });
    }
  }

  console.log(`Backup created: ${backupPath}`);
  console.log(`Tickets found in JSON: ${tickets.length}`);
  console.log(`Tickets migrated: ${inserted}`);
  console.log(`Tickets skipped as duplicates: ${skipped}`);
  console.log(`Tickets reconciled public metadata: ${reconciled}`);
  console.log(`Tickets failed: ${failures.length}`);

  for (const failure of failures.slice(0, 10)) {
    console.error(`- ${failure.ticket}: ${failure.message}`);
  }

  if (failures.length > 10) {
    console.error(`- ...and ${failures.length - 10} more migration error(s).`);
  }

  if (failures.length) {
    process.exitCode = 1;
  }
}

try {
  if (isCountOnly) {
    await countMode();
  } else if (isDryRun) {
    await dryRunMode();
  } else {
    await migrateMode();
  }
} catch (error) {
  console.error(`Ticket migration failed: ${sanitizeError(error)}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
