import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { insertTicketPurchase } from '../db/tickets.repository.mjs';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function makeTicket(overrides = {}) {
  return {
    ticketId: 'BM-TKT-REPO-0001',
    orderId: 'BM-ORD-REPO',
    eventId: 'repo-event',
    eventName: 'Repo Event',
    date: '1 Junio 2026',
    venue: 'Repo Venue, CDMX',
    zone: 'VIP',
    seatLabel: 'VIP · Fila A · Asiento 1',
    seat: { zone: 'VIP', fila: 'A', asiento: 1, price: 100 },
    totalPaid: 114,
    paymentMethod: 'tarjeta',
    orderSeatCount: 1,
    status: 'active',
    validationCount: 0,
    createdAt: '2026-05-23T00:00:00.000Z',
    usedAt: null,
    cancelledAt: null,
    publicPath: '/tickets/BM-TKT-REPO-0001',
    publicUrl: 'https://example.test/tickets/BM-TKT-REPO-0001',
    token: 'repo-private-token',
    ...overrides,
  };
}

function createFakeClient() {
  const insertedCodes = new Set();
  const queryCalls = [];
  let idCounter = 0;

  return {
    queryCalls,
    insertedCodes,
    async query(sql, params = []) {
      queryCalls.push({ sql: String(sql), params });

      if (String(sql).includes('SELECT id FROM tickets WHERE ticket_code')) {
        const ticketCode = params[0];
        return insertedCodes.has(ticketCode)
          ? { rowCount: 1, rows: [{ id: `ticket-${ticketCode}` }] }
          : { rowCount: 0, rows: [] };
      }

      if (String(sql).includes('INSERT INTO tickets')) {
        const ticketCode = params[5];
        if (insertedCodes.has(ticketCode)) {
          return { rowCount: 0, rows: [] };
        }
        insertedCodes.add(ticketCode);
        return { rowCount: 1, rows: [{ id: `ticket-${ticketCode}` }] };
      }

      if (String(sql).includes('RETURNING id')) {
        idCounter += 1;
        return { rowCount: 1, rows: [{ id: `id-${idCounter}` }] };
      }

      return { rowCount: 1, rows: [] };
    },
  };
}

test('insertTicketPurchase writes through a transaction-like callback', async () => {
  const fakeClient = createFakeClient();
  let transactionUsed = false;

  const result = await insertTicketPurchase([makeTicket()], {
    withTransaction: async task => {
      transactionUsed = true;
      return task(fakeClient);
    },
  });

  assert.equal(transactionUsed, true);
  assert.deepEqual(result, { attempted: 1, inserted: 1, skipped: 0 });
});

test('insertTicketPurchase is idempotent by ticket_code', async () => {
  const fakeClient = createFakeClient();
  const withTransaction = async task => task(fakeClient);
  const ticket = makeTicket();

  const first = await insertTicketPurchase([ticket], { withTransaction });
  const second = await insertTicketPurchase([ticket], { withTransaction });

  assert.deepEqual(first, { attempted: 1, inserted: 1, skipped: 0 });
  assert.deepEqual(second, { attempted: 1, inserted: 0, skipped: 1 });
});

test('insertTicketPurchase sends only private token hash to SQL params', async () => {
  const fakeClient = createFakeClient();
  const token = 'repo-private-token';

  await insertTicketPurchase([makeTicket({ token })], {
    withTransaction: async task => task(fakeClient),
  });

  const serializedParams = JSON.stringify(fakeClient.queryCalls.map(call => call.params));
  assert.equal(serializedParams.includes(token), false);
  assert.equal(serializedParams.includes(sha256(token)), true);
});
