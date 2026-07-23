import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import {
  getTicketByIdFromStorage,
  getTicketDynamicSecret,
  getTicketsByIdsFromStorage,
  getTicketsStorageMode,
  markTicketUsedInStorage,
  serializeTicketForPublic,
  verifyTicketPrivateToken,
} from '../db/tickets.storage.mjs';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

const privateToken = 'fixture-private-token';
const privateTokenHash = sha256(privateToken);

function makeJsonTicket(overrides = {}) {
  return {
    ticketId: 'BM-TKT-FIXTURE-0001',
    orderId: 'BM-ORD-FIXTURE',
    eventId: 'fixture-event',
    eventName: 'Fixture Event',
    date: '1 Junio 2026',
    venue: 'Fixture Venue',
    zone: 'VIP',
    seatLabel: 'VIP · Fila A · Asiento 1',
    seat: { zone: 'VIP', fila: 'A', asiento: 1, price: 100 },
    totalPaid: 114,
    paymentMethod: 'tarjeta',
    orderSeatCount: 1,
    status: 'active',
    validationCount: 0,
    publicPath: '/tickets/BM-TKT-FIXTURE-0001',
    publicUrl: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    usedAt: null,
    cancelledAt: null,
    token: privateToken,
    ...overrides,
  };
}

function makePostgresTicket(overrides = {}) {
  const { token: _token, ...jsonTicket } = makeJsonTicket();
  return {
    ...jsonTicket,
    privateViewTokenHash: privateTokenHash,
    dynamicSecret: privateTokenHash,
    storageSource: 'postgres',
    ...overrides,
  };
}

test('TICKETS_STORAGE defaults to postgres-primary and supports explicit rollback', () => {
  assert.equal(getTicketsStorageMode(undefined), 'postgres-primary');
  assert.equal(getTicketsStorageMode(''), 'postgres-primary');
  assert.equal(getTicketsStorageMode('unexpected-mode'), 'postgres-primary');
  assert.equal(getTicketsStorageMode('json'), 'json');
  assert.equal(getTicketsStorageMode('dual-read'), 'dual-read');
  assert.equal(getTicketsStorageMode('postgres'), 'postgres');
  assert.equal(getTicketsStorageMode('postgres-primary'), 'postgres-primary');
});

test('default storage mode reads from PostgreSQL without JSON fallback', async () => {
  const postgresTicket = makePostgresTicket();
  const tickets = await getTicketsByIdsFromStorage({
    ids: [postgresTicket.ticketId],
    readJsonTickets: () => {
      throw new Error('json should not be called in default postgres-primary mode');
    },
    repository: {
      findTicketsByCodes: async () => [postgresTicket],
    },
  });

  assert.deepEqual(tickets, [postgresTicket]);
});

test('json storage mode returns JSON tickets without calling PostgreSQL', async () => {
  const jsonTicket = makeJsonTicket();
  const tickets = await getTicketsByIdsFromStorage({
    ids: [jsonTicket.ticketId],
    mode: 'json',
    readJsonTickets: () => [jsonTicket],
    repository: {
      findTicketsByCodes: async () => {
        throw new Error('postgres should not be called in json mode');
      },
    },
  });

  assert.deepEqual(tickets, [jsonTicket]);
});

test('default validation write marks PostgreSQL first and updates JSON backup', async () => {
  const jsonTicket = makeJsonTicket();
  const postgresTicket = makePostgresTicket();
  const usedAt = '2026-05-23T01:00:00.000Z';
  const calls = [];
  let storedTickets = [jsonTicket];

  const result = await markTicketUsedInStorage({
    ticket: postgresTicket,
    ticketId: postgresTicket.ticketId,
    usedAt,
    mutateJsonTickets: async mutator => {
      const { next, result: mutationResult } = mutator(storedTickets);
      if (next !== storedTickets) {
        calls.push('json');
        storedTickets = next;
      }
      return mutationResult;
    },
    repository: {
      markTicketUsedByCode: async (ticketId, options) => {
        calls.push('postgres');
        assert.equal(ticketId, postgresTicket.ticketId);
        assert.equal(options.usedAt, usedAt);
        return {
          updated: true,
          reason: 'used',
          ticket: {
            ...postgresTicket,
            status: 'used',
            usedAt,
            validationCount: 1,
          },
        };
      },
    },
  });

  assert.deepEqual(calls, ['postgres', 'json']);
  assert.equal(result.updated, true);
  assert.equal(result.ticket.status, 'used');
  assert.equal(storedTickets[0].status, 'used');
  assert.equal(storedTickets[0].validationCount, 1);
});

test('explicit json validation rollback does not call PostgreSQL', async () => {
  const jsonTicket = makeJsonTicket();
  const usedAt = '2026-05-23T01:05:00.000Z';
  let storedTickets = [jsonTicket];

  const result = await markTicketUsedInStorage({
    ticket: jsonTicket,
    ticketId: jsonTicket.ticketId,
    mode: 'json',
    usedAt,
    mutateJsonTickets: async mutator => {
      const { next, result: mutationResult } = mutator(storedTickets);
      if (next !== storedTickets) {
        storedTickets = next;
      }
      return mutationResult;
    },
    repository: {
      markTicketUsedByCode: async () => {
        throw new Error('postgres should not be called in json validation rollback mode');
      },
    },
  });

  assert.equal(result.updated, true);
  assert.equal(result.ticket.status, 'used');
  assert.equal(storedTickets[0].usedAt, usedAt);
});

test('postgres storage mode returns tickets from repository', async () => {
  const postgresTicket = makePostgresTicket();
  const tickets = await getTicketsByIdsFromStorage({
    ids: [postgresTicket.ticketId],
    mode: 'postgres',
    readJsonTickets: () => {
      throw new Error('json should not be called in postgres mode');
    },
    repository: {
      findTicketsByCodes: async () => [postgresTicket],
    },
  });

  assert.deepEqual(tickets, [postgresTicket]);
});

test('postgres-primary storage mode reads strictly from repository', async () => {
  const postgresTicket = makePostgresTicket();
  const tickets = await getTicketsByIdsFromStorage({
    ids: [postgresTicket.ticketId],
    mode: 'postgres-primary',
    readJsonTickets: () => {
      throw new Error('json should not be called in postgres-primary mode');
    },
    repository: {
      findTicketsByCodes: async () => [postgresTicket],
    },
  });

  assert.deepEqual(tickets, [postgresTicket]);
});

test('postgres-primary storage mode does not fall back to JSON when PostgreSQL fails', async () => {
  const jsonTicket = makeJsonTicket();

  await assert.rejects(
    () => getTicketByIdFromStorage({
      ticketId: jsonTicket.ticketId,
      mode: 'postgres-primary',
      readJsonTickets: () => [jsonTicket],
      repository: {
        findTicketByCode: async () => {
          throw new Error('postgres unavailable');
        },
      },
    }),
    /postgres unavailable/,
  );
});

test('dual-read falls back to JSON when PostgreSQL misses a ticket', async () => {
  const jsonTicket = makeJsonTicket();
  const ticket = await getTicketByIdFromStorage({
    ticketId: jsonTicket.ticketId,
    mode: 'dual-read',
    readJsonTickets: () => [jsonTicket],
    repository: {
      findTicketByCode: async () => null,
    },
  });

  assert.deepEqual(ticket, jsonTicket);
});

test('dual-read logs field differences without tokens or hashes', async () => {
  const jsonTicket = makeJsonTicket();
  const postgresTicket = makePostgresTicket({ eventName: 'Fixture Event Updated' });
  const warnings = [];

  const ticket = await getTicketByIdFromStorage({
    ticketId: jsonTicket.ticketId,
    mode: 'dual-read',
    readJsonTickets: () => [jsonTicket],
    repository: {
      findTicketByCode: async () => postgresTicket,
    },
    logger: {
      warn: (message, payload) => warnings.push({ message, payload }),
    },
  });

  assert.deepEqual(ticket, postgresTicket);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].payload.fields, ['eventName']);

  const warningText = JSON.stringify(warnings);
  assert.equal(warningText.includes(privateToken), false);
  assert.equal(warningText.includes(privateTokenHash), false);
  assert.equal(warningText.includes('privateViewTokenHash'), false);
});

test('dynamic QR private token validation supports JSON token and PostgreSQL hash', () => {
  const jsonTicket = makeJsonTicket();
  const postgresTicket = makePostgresTicket();

  assert.equal(verifyTicketPrivateToken(jsonTicket, privateToken), true);
  assert.equal(verifyTicketPrivateToken(jsonTicket, 'wrong-token'), false);
  assert.equal(verifyTicketPrivateToken(postgresTicket, privateToken), true);
  assert.equal(verifyTicketPrivateToken(postgresTicket, 'wrong-token'), false);
  assert.equal(getTicketDynamicSecret(postgresTicket), privateTokenHash);
});

test('public serializer does not expose private token or internal hashes', () => {
  const publicTicket = serializeTicketForPublic({
    ...makePostgresTicket(),
    token: privateToken,
    private_view_token_hash: privateTokenHash,
    qrTokenHash: sha256('qr'),
    qr_token_hash: sha256('qr-snake'),
  }, {
    buildPublicTicketPath: ticketId => `/tickets/${ticketId}`,
  });

  assert.equal(Object.hasOwn(publicTicket, 'token'), false);
  assert.equal(Object.hasOwn(publicTicket, 'privateViewTokenHash'), false);
  assert.equal(Object.hasOwn(publicTicket, 'private_view_token_hash'), false);
  assert.equal(Object.hasOwn(publicTicket, 'qrTokenHash'), false);
  assert.equal(Object.hasOwn(publicTicket, 'qr_token_hash'), false);
  assert.equal(Object.hasOwn(publicTicket, 'dynamicSecret'), false);
  assert.equal(publicTicket.publicPath, '/tickets/BM-TKT-FIXTURE-0001');
});
