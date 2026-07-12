import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTicketsWriteMode,
  persistTicketPurchaseByWriteMode,
  writeTicketPurchaseToPostgresIfEnabled,
} from '../db/tickets.write-mode.mjs';

const ticketRecords = [{
  ticketId: 'BM-TKT-WRITEMODE-0001',
  orderId: 'BM-ORD-WRITEMODE',
  token: 'do-not-log-this-token',
}];

const order = {
  orderId: 'BM-ORD-WRITEMODE',
  quoteId: 'BM-QTE-WRITEMODE',
  buyer: { name: 'Comprador Prueba', email: 'comprador@boletamax.test', userId: null, isGuest: true },
  paymentMethod: 'tarjeta',
  pricing: { subtotalCents: 10000, feeCents: 1400, discountCents: 0, totalCents: 11400, currency: 'MXN' },
  event: { eventId: 'writemode-event', name: 'WriteMode Event', date: '1 Junio 2026', venue: 'Venue, CDMX' },
  orderSeatCount: 1,
};

test('TICKETS_WRITE_MODE defaults to postgres-primary and supports explicit rollback', () => {
  assert.equal(getTicketsWriteMode(undefined), 'postgres-primary');
  assert.equal(getTicketsWriteMode(''), 'postgres-primary');
  assert.equal(getTicketsWriteMode('postgres'), 'postgres-primary');
  assert.equal(getTicketsWriteMode('json'), 'json');
  assert.equal(getTicketsWriteMode('dual-write'), 'dual-write');
  assert.equal(getTicketsWriteMode('postgres-primary'), 'postgres-primary');
});

test('default write mode uses PostgreSQL primary before JSON backup', async () => {
  const calls = [];
  const result = await persistTicketPurchaseByWriteMode({
    ticketRecords,
    order,
    saveJsonBackup: async () => {
      calls.push('json');
    },
    repository: {
      insertPurchaseOrder: async payload => {
        calls.push('postgres');
        assert.deepEqual(payload.tickets, ticketRecords);
        assert.deepEqual(payload.order, order);
        return { attempted: 1, inserted: 1, skipped: 0 };
      },
    },
  });

  assert.deepEqual(calls, ['postgres', 'json']);
  assert.equal(result.mode, 'postgres-primary');
  assert.equal(result.failed, false);
  assert.equal(result.jsonBackupFailed, false);
});

test('explicit json rollback writes only JSON backup', async () => {
  const calls = [];
  const result = await persistTicketPurchaseByWriteMode({
    ticketRecords,
    mode: 'json',
    saveJsonBackup: async () => {
      calls.push('json');
    },
    repository: {
      insertPurchaseOrder: async () => {
        calls.push('postgres');
        throw new Error('postgres should not be called in json rollback mode');
      },
    },
  });

  assert.deepEqual(calls, ['json']);
  assert.equal(result.mode, 'json');
  assert.equal(result.enabled, false);
});

test('json write mode does not call PostgreSQL repository', async () => {
  let called = false;
  const result = await writeTicketPurchaseToPostgresIfEnabled({
    ticketRecords,
    mode: 'json',
    repository: {
      insertPurchaseOrder: async () => {
        called = true;
        throw new Error('should not be called');
      },
    },
  });

  assert.equal(called, false);
  assert.equal(result.enabled, false);
  assert.equal(result.mode, 'json');
});

test('dual-write calls PostgreSQL repository after JSON save path', async () => {
  let called = false;
  const result = await writeTicketPurchaseToPostgresIfEnabled({
    ticketRecords,
    order,
    mode: 'dual-write',
    repository: {
      insertPurchaseOrder: async payload => {
        called = true;
        assert.deepEqual(payload.tickets, ticketRecords);
        assert.deepEqual(payload.order, order);
        return { attempted: 1, inserted: 1, skipped: 0 };
      },
    },
  });

  assert.equal(called, true);
  assert.equal(result.enabled, true);
  assert.equal(result.failed, false);
  assert.equal(result.inserted, 1);
});

test('dual-write PostgreSQL failure does not throw and logs safely', async () => {
  const warnings = [];
  const result = await writeTicketPurchaseToPostgresIfEnabled({
    ticketRecords,
    mode: 'dual-write',
    repository: {
      insertPurchaseOrder: async () => {
        const error = new Error(`database failed with ${ticketRecords[0].token}`);
        error.code = '57P01';
        throw error;
      },
    },
    logger: {
      warn: (message, payload) => warnings.push({ message, payload }),
    },
  });

  assert.equal(result.failed, true);
  assert.equal(warnings.length, 1);

  const warningText = JSON.stringify(warnings);
  assert.equal(warningText.includes(ticketRecords[0].token), false);
  assert.equal(warningText.includes('database failed with'), false);
  assert.equal(warnings[0].payload.error.code, '57P01');
});

test('postgres-primary writes PostgreSQL before JSON backup', async () => {
  const calls = [];
  const result = await persistTicketPurchaseByWriteMode({
    ticketRecords,
    order,
    mode: 'postgres-primary',
    saveJsonBackup: async () => {
      calls.push('json');
    },
    repository: {
      insertPurchaseOrder: async payload => {
        calls.push('postgres');
        assert.deepEqual(payload.tickets, ticketRecords);
        assert.deepEqual(payload.order, order);
        return { attempted: 1, inserted: 1, skipped: 0 };
      },
    },
  });

  assert.deepEqual(calls, ['postgres', 'json']);
  assert.equal(result.failed, false);
  assert.equal(result.jsonBackupFailed, false);
});

test('postgres-primary fails purchase and skips JSON backup when PostgreSQL fails', async () => {
  const calls = [];
  const errors = [];

  await assert.rejects(
    () => persistTicketPurchaseByWriteMode({
      ticketRecords,
      mode: 'postgres-primary',
      saveJsonBackup: async () => {
        calls.push('json');
      },
      repository: {
        insertPurchaseOrder: async () => {
          calls.push('postgres');
          throw new Error('postgres failed');
        },
      },
      logger: {
        error: (message, payload) => errors.push({ message, payload }),
      },
    }),
    /PostgreSQL primary ticket write failed/,
  );

  assert.deepEqual(calls, ['postgres']);
  assert.equal(errors.length, 1);
  assert.equal(JSON.stringify(errors).includes(ticketRecords[0].token), false);
  assert.equal(JSON.stringify(errors).includes('postgres failed'), false);
});

test('postgres-primary keeps purchase successful if JSON backup fails after PostgreSQL success', async () => {
  const warnings = [];
  const result = await persistTicketPurchaseByWriteMode({
    ticketRecords,
    mode: 'postgres-primary',
    saveJsonBackup: async () => {
      throw new Error(`backup failed with ${ticketRecords[0].token}`);
    },
    repository: {
      insertPurchaseOrder: async () => ({ attempted: 1, inserted: 1, skipped: 0 }),
    },
    logger: {
      warn: (message, payload) => warnings.push({ message, payload }),
    },
  });

  assert.equal(result.jsonBackupFailed, true);
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes(ticketRecords[0].token), false);
});
