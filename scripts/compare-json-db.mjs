import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { closePool, query } from '../db/pool.mjs';
import { findTicketsByCodes } from '../db/tickets.repository.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const ticketsPath = path.join(rootDir, 'data', 'tickets.json');

const PUBLIC_FIELDS = [
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

function getLimit() {
  const arg = process.argv.find(item => item.startsWith('--limit='));
  const raw = arg ? arg.split('=')[1] : process.env.COMPARE_JSON_DB_LIMIT;
  const parsed = Number(raw || 20);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 100) : 20;
}

function maskRef(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'unknown';
  if (text.length <= 10) return `${text.slice(0, 3)}...`;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function comparable(field, value) {
  if (field === 'validationCount') {
    const count = Number(value || 0);
    return Number.isFinite(count) ? Math.round(count) : 0;
  }

  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  return String(value);
}

function diffPublicFields(jsonTicket, dbTicket) {
  return PUBLIC_FIELDS.filter(field => comparable(field, jsonTicket[field]) !== comparable(field, dbTicket[field]));
}

function sanitizeError(error = {}) {
  return String(error?.message || 'Unknown database error')
    .replace(/postgres:\/\/[^ ]+/gi, '[database-url-redacted]')
    .replace(/[a-f0-9]{24,}/gi, '[redacted]');
}

async function loadJsonTickets() {
  const raw = await fs.readFile(ticketsPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('data/tickets.json must contain an array.');
  }
  return parsed;
}

async function getPostgresTicketCodes() {
  const result = await query('SELECT ticket_code FROM tickets ORDER BY ticket_code');
  return result.rows.map(row => row.ticket_code);
}

try {
  const limit = getLimit();
  const jsonTickets = await loadJsonTickets();
  const jsonById = new Map(
    jsonTickets
      .filter(ticket => ticket?.ticketId)
      .map(ticket => [ticket.ticketId, ticket]),
  );
  const jsonIds = [...jsonById.keys()];
  const pgCodes = await getPostgresTicketCodes();
  const pgCodeSet = new Set(pgCodes);
  const pgTickets = await findTicketsByCodes(jsonIds);
  const pgById = new Map(pgTickets.map(ticket => [ticket.ticketId, ticket]));

  const missingInPostgres = jsonIds.filter(ticketId => !pgCodeSet.has(ticketId));
  const extraInPostgres = pgCodes.filter(ticketId => !jsonById.has(ticketId));
  const differences = [];

  for (const ticketId of jsonIds) {
    const jsonTicket = jsonById.get(ticketId);
    const pgTicket = pgById.get(ticketId);
    if (!pgTicket) continue;

    const fields = diffPublicFields(jsonTicket, pgTicket);
    if (fields.length) {
      differences.push({
        ticketId: maskRef(ticketId),
        fields,
      });
    }
  }

  console.log('JSON vs PostgreSQL ticket comparison');
  console.log(`JSON tickets: ${jsonIds.length}`);
  console.log(`PostgreSQL tickets: ${pgCodes.length}`);
  console.log(`Missing in PostgreSQL: ${missingInPostgres.length}`);
  console.log(`Extra in PostgreSQL: ${extraInPostgres.length}`);
  console.log(`Tickets with public-field differences: ${differences.length}`);

  if (missingInPostgres.length) {
    console.log(`Missing sample: ${missingInPostgres.slice(0, limit).map(maskRef).join(', ')}`);
  }

  if (extraInPostgres.length) {
    console.log(`Extra sample: ${extraInPostgres.slice(0, limit).map(maskRef).join(', ')}`);
  }

  for (const diff of differences.slice(0, limit)) {
    console.log(`Difference ${diff.ticketId}: fields=${diff.fields.join(', ')}`);
  }

  if (missingInPostgres.length || differences.length) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`JSON/PostgreSQL comparison failed: ${sanitizeError(error)}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
