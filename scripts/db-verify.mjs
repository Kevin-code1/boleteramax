import 'dotenv/config';
import { closePool, query } from '../db/pool.mjs';

const MAX_SAMPLES = 10;

function maskRef(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'unknown';
  if (text.length <= 10) return `${text.slice(0, 3)}...`;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function sanitizeError(error = {}) {
  return String(error?.message || 'Unknown database error')
    .replace(/postgres:\/\/[^ ]+/gi, '[database-url-redacted]')
    .replace(/[a-f0-9]{24,}/gi, '[redacted]');
}

async function countRows(sql, params = []) {
  const result = await query(sql, params);
  return Number(result.rows[0]?.count || 0);
}

async function sampleTicketCodes(sql, params = []) {
  const result = await query(sql, params);
  return result.rows
    .map(row => maskRef(row.ticket_code))
    .slice(0, MAX_SAMPLES);
}

async function runCheck({ name, countSql, sampleSql = null, params = [] }) {
  const count = await countRows(countSql, params);
  const samples = sampleSql && count > 0 ? await sampleTicketCodes(sampleSql, params) : [];
  return { name, count, samples };
}

async function main() {
  const checks = [
    {
      name: 'tickets with invalid order_id',
      countSql: `
        SELECT count(*) FROM tickets t
        LEFT JOIN orders o ON o.id = t.order_id
        WHERE o.id IS NULL
      `,
      sampleSql: `
        SELECT t.ticket_code FROM tickets t
        LEFT JOIN orders o ON o.id = t.order_id
        WHERE o.id IS NULL
        LIMIT ${MAX_SAMPLES}
      `,
    },
    {
      name: 'tickets with invalid event_id',
      countSql: `
        SELECT count(*) FROM tickets t
        LEFT JOIN events e ON e.id = t.event_id
        WHERE e.id IS NULL
      `,
      sampleSql: `
        SELECT t.ticket_code FROM tickets t
        LEFT JOIN events e ON e.id = t.event_id
        WHERE e.id IS NULL
        LIMIT ${MAX_SAMPLES}
      `,
    },
    {
      name: 'duplicate ticket_code values',
      countSql: `
        SELECT count(*) FROM (
          SELECT ticket_code FROM tickets
          GROUP BY ticket_code
          HAVING count(*) > 1
        ) duplicates
      `,
      sampleSql: `
        SELECT ticket_code FROM tickets
        GROUP BY ticket_code
        HAVING count(*) > 1
        LIMIT ${MAX_SAMPLES}
      `,
    },
    {
      name: 'duplicate private_view_token_hash values',
      countSql: `
        SELECT count(*) FROM (
          SELECT private_view_token_hash FROM tickets
          GROUP BY private_view_token_hash
          HAVING count(*) > 1
        ) duplicates
      `,
    },
    {
      name: 'duplicate qr_token_hash values',
      countSql: `
        SELECT count(*) FROM (
          SELECT qr_token_hash FROM tickets
          WHERE qr_token_hash IS NOT NULL
          GROUP BY qr_token_hash
          HAVING count(*) > 1
        ) duplicates
      `,
    },
    {
      name: 'tickets without status',
      countSql: 'SELECT count(*) FROM tickets WHERE status IS NULL OR trim(status) = $1',
      sampleSql: `SELECT ticket_code FROM tickets WHERE status IS NULL OR trim(status) = $1 LIMIT ${MAX_SAMPLES}`,
      params: [''],
    },
    {
      name: 'tickets with invalid status',
      countSql: `
        SELECT count(*) FROM tickets
        WHERE status NOT IN ('issued', 'active', 'used', 'cancelled', 'refunded', 'void')
      `,
      sampleSql: `
        SELECT ticket_code FROM tickets
        WHERE status NOT IN ('issued', 'active', 'used', 'cancelled', 'refunded', 'void')
        LIMIT ${MAX_SAMPLES}
      `,
    },
    {
      name: 'payments with invalid order_id',
      countSql: `
        SELECT count(*) FROM payments p
        LEFT JOIN orders o ON o.id = p.order_id
        WHERE o.id IS NULL
      `,
    },
    {
      name: 'order_items with invalid order_id',
      countSql: `
        SELECT count(*) FROM order_items oi
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE o.id IS NULL
      `,
    },
    {
      name: 'order_items with invalid event_id',
      countSql: `
        SELECT count(*) FROM order_items oi
        LEFT JOIN events e ON e.id = oi.event_id
        WHERE e.id IS NULL
      `,
    },
    {
      name: 'tickets with invalid order_item_id',
      countSql: `
        SELECT count(*) FROM tickets t
        LEFT JOIN order_items oi ON oi.id = t.order_item_id
        WHERE t.order_item_id IS NOT NULL AND oi.id IS NULL
      `,
      sampleSql: `
        SELECT t.ticket_code FROM tickets t
        LEFT JOIN order_items oi ON oi.id = t.order_item_id
        WHERE t.order_item_id IS NOT NULL AND oi.id IS NULL
        LIMIT ${MAX_SAMPLES}
      `,
    },
    {
      name: 'duplicate active seats in active tickets',
      countSql: `
        SELECT count(*) FROM (
          SELECT seat_id FROM tickets
          WHERE seat_id IS NOT NULL AND status IN ('issued', 'active', 'used')
          GROUP BY seat_id
          HAVING count(*) > 1
        ) duplicates
      `,
    },
    {
      name: 'duplicate active seat reservations',
      countSql: `
        SELECT count(*) FROM (
          SELECT seat_id FROM seat_reservations
          WHERE seat_id IS NOT NULL AND status = 'held'
          GROUP BY seat_id
          HAVING count(*) > 1
        ) duplicates
      `,
    },
  ];

  const results = [];
  for (const check of checks) {
    results.push(await runCheck(check));
  }

  const failures = results.filter(result => result.count > 0);
  console.log('PostgreSQL integrity verification');
  console.log(`Checks run: ${results.length}`);
  console.log(`Checks failed: ${failures.length}`);

  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.count}`);
    if (failure.samples.length) {
      console.error(`  sample ticket IDs: ${failure.samples.join(', ')}`);
    }
  }

  if (failures.length) {
    process.exitCode = 1;
    return;
  }

  console.log('All PostgreSQL integrity checks passed.');
}

try {
  await main();
} catch (error) {
  console.error(`PostgreSQL verification failed: ${sanitizeError(error)}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
