import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { insertPurchaseOrder, TicketSeatConflictError } from '../db/tickets.repository.mjs';

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
    token: 'repo-private-token',
    ...overrides,
  };
}

function makeOrder(overrides = {}) {
  return {
    orderId: 'BM-ORD-REPO',
    quoteId: 'BM-QTE-REPO',
    buyer: { name: 'Comprador Repo', email: 'repo@boletamax.test', userId: null, isGuest: true },
    paymentMethod: 'tarjeta',
    pricing: { subtotalCents: 10000, feeCents: 1400, discountCents: 0, totalCents: 11400, currency: 'MXN' },
    event: { eventId: 'repo-event', name: 'Repo Event', date: '1 Junio 2026', venue: 'Repo Venue, CDMX' },
    orderSeatCount: 1,
    ...overrides,
  };
}

function createFakeClient({ seatAlreadySold = false } = {}) {
  const queryCalls = [];
  let idCounter = 0;

  return {
    queryCalls,
    async query(sql, params = []) {
      const text = String(sql);
      queryCalls.push({ sql: text, params });

      if (text.includes('INSERT INTO seats') && seatAlreadySold) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('SELECT id FROM seats')) {
        return { rowCount: 1, rows: [{ id: 'seat-existing' }] };
      }
      if (text.includes('SELECT EXISTS')) {
        return { rowCount: 1, rows: [{ assigned: seatAlreadySold }] };
      }
      if (text.includes('RETURNING id')) {
        idCounter += 1;
        return { rowCount: 1, rows: [{ id: `id-${idCounter}` }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

function countCalls(fakeClient, snippet) {
  return fakeClient.queryCalls.filter(call => call.sql.includes(snippet)).length;
}

test('insertPurchaseOrder writes through a transaction-like callback', async () => {
  const fakeClient = createFakeClient();
  let transactionUsed = false;

  const result = await insertPurchaseOrder(
    { order: makeOrder(), tickets: [makeTicket()] },
    {
      withTransaction: async task => {
        transactionUsed = true;
        return task(fakeClient);
      },
    },
  );

  assert.equal(transactionUsed, true);
  assert.deepEqual(result, { attempted: 1, inserted: 1, skipped: 0 });
});

test('insertPurchaseOrder crea una sola orden con items, tickets y un pago por compra', async () => {
  const fakeClient = createFakeClient();
  const order = makeOrder({ orderSeatCount: 2 });
  const tickets = [
    makeTicket(),
    makeTicket({ ticketId: 'BM-TKT-REPO-0002', seat: { zone: 'VIP', fila: 'A', asiento: 2, price: 100 }, token: 'repo-token-2' }),
  ];

  const result = await insertPurchaseOrder(
    { order, tickets },
    { withTransaction: async task => task(fakeClient) },
  );

  assert.deepEqual(result, { attempted: 2, inserted: 2, skipped: 0 });
  assert.equal(countCalls(fakeClient, 'INSERT INTO orders'), 1);
  assert.equal(countCalls(fakeClient, 'INSERT INTO order_items'), 2);
  assert.equal(countCalls(fakeClient, 'INSERT INTO tickets'), 2);
  assert.equal(countCalls(fakeClient, 'INSERT INTO payments'), 1);

  // La orden lleva comprador real, desglose y referencia de cotización.
  const orderCall = fakeClient.queryCalls.find(call => call.sql.includes('INSERT INTO orders'));
  assert.equal(orderCall.params.includes('repo@boletamax.test'), true);
  assert.equal(orderCall.params.includes('Comprador Repo'), true);
  assert.equal(orderCall.params.includes('BM-QTE-REPO'), true);
  assert.equal(orderCall.params.includes(10000), true);
  assert.equal(orderCall.params.includes(1400), true);
  assert.equal(orderCall.params.includes(11400), true);

  // El pago simulado referencia la orden.
  const paymentCall = fakeClient.queryCalls.find(call => call.sql.includes('INSERT INTO payments'));
  assert.equal(paymentCall.sql.includes(`'simulated'`), true);
  assert.equal(paymentCall.sql.includes(`'paid'`), true);
  assert.equal(paymentCall.params.includes('sim:BM-ORD-REPO'), true);
});

test('insertPurchaseOrder usa lookup/get-or-create sin DO UPDATE sobre el catálogo', async () => {
  const fakeClient = createFakeClient();

  await insertPurchaseOrder(
    { order: makeOrder(), tickets: [makeTicket()] },
    { withTransaction: async task => task(fakeClient) },
  );

  assert.equal(
    fakeClient.queryCalls.every(call => !/DO UPDATE/i.test(call.sql)),
    true,
    'la compra no debe actualizar filas existentes del catálogo',
  );
});

test('insertPurchaseOrder sends only private token hash to SQL params', async () => {
  const fakeClient = createFakeClient();
  const token = 'repo-private-token';

  await insertPurchaseOrder(
    { order: makeOrder(), tickets: [makeTicket({ token })] },
    { withTransaction: async task => task(fakeClient) },
  );

  const serializedParams = JSON.stringify(fakeClient.queryCalls.map(call => call.params));
  assert.equal(serializedParams.includes(token), false);
  assert.equal(serializedParams.includes(sha256(token)), true);
});

test('insertPurchaseOrder lanza TicketSeatConflictError si el asiento ya está ocupado', async () => {
  const fakeClient = createFakeClient({ seatAlreadySold: true });

  await assert.rejects(
    insertPurchaseOrder(
      { order: makeOrder(), tickets: [makeTicket()] },
      { withTransaction: async task => task(fakeClient) },
    ),
    error => {
      assert.equal(error instanceof TicketSeatConflictError, true);
      return true;
    },
  );

  // El conflicto se detecta antes de insertar items, tickets o pagos.
  assert.equal(countCalls(fakeClient, 'INSERT INTO order_items'), 0);
  assert.equal(countCalls(fakeClient, 'INSERT INTO tickets'), 0);
  assert.equal(countCalls(fakeClient, 'INSERT INTO payments'), 0);
});

test('insertPurchaseOrder sin orden o sin boletos no toca la base', async () => {
  let transactionUsed = false;
  const withTransaction = async task => {
    transactionUsed = true;
    return task(createFakeClient());
  };

  const noOrder = await insertPurchaseOrder({ order: null, tickets: [makeTicket()] }, { withTransaction });
  const noTickets = await insertPurchaseOrder({ order: makeOrder(), tickets: [] }, { withTransaction });

  assert.deepEqual(noOrder, { attempted: 0, inserted: 0, skipped: 0 });
  assert.deepEqual(noTickets, { attempted: 0, inserted: 0, skipped: 0 });
  assert.equal(transactionUsed, false);
});
