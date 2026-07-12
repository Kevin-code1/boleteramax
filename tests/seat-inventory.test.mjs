import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';

// src/config hace process.exit(1) si el modo postgres-primary no tiene
// DATABASE_URL; estas pruebas unitarias no necesitan base de datos.
if (!process.env.DATABASE_URL) {
  process.env.TICKETS_STORAGE = process.env.TICKETS_STORAGE || 'json';
  process.env.TICKETS_WRITE_MODE = process.env.TICKETS_WRITE_MODE || 'json';
}

const {
  buildSeatKey,
  findSeatConflicts,
  getSoldSeatsForEvent,
  validateSeatInventory,
} = await import('../src/domain/pricing.mjs');
const { getSoldSeatKeysFromStorage } = await import('../db/tickets.storage.mjs');
const {
  TicketPurchasePrimaryWriteError,
  TicketSeatConflictError,
  writeTicketPurchaseToPostgresPrimary,
} = await import('../db/tickets.write-mode.mjs');

const EVENT_ID = 'comedy-night-puebla-abc123';

function makeTicket({ status, zone = 'LUNETA', fila = 'B', asiento = 4 }) {
  return {
    eventId: EVENT_ID,
    status,
    seat: { zone, fila, asiento, tableSize: 1 },
  };
}

// ── Dominio: qué estados bloquean el asiento ──

test('un boleto active bloquea su asiento', () => {
  const ticket = makeTicket({ status: 'active' });
  const sold = getSoldSeatsForEvent(EVENT_ID, [ticket]);
  assert.equal(sold.has(buildSeatKey(ticket.seat)), true);
});

test('un boleto used sigue bloqueando su asiento', () => {
  const ticket = makeTicket({ status: 'used' });
  const sold = getSoldSeatsForEvent(EVENT_ID, [ticket]);
  assert.equal(sold.has(buildSeatKey(ticket.seat)), true);
});

test('un boleto cancelled no bloquea su asiento', () => {
  const ticket = makeTicket({ status: 'cancelled' });
  const sold = getSoldSeatsForEvent(EVENT_ID, [ticket]);
  assert.equal(sold.size, 0);
});

test('otros estados no activos (refunded, void) no bloquean el asiento', () => {
  const tickets = [
    makeTicket({ status: 'refunded', asiento: 1 }),
    makeTicket({ status: 'void', asiento: 2 }),
  ];
  const sold = getSoldSeatsForEvent(EVENT_ID, tickets);
  assert.equal(sold.size, 0);
});

test('boletos de otro evento no bloquean asientos de este evento', () => {
  const foreign = { ...makeTicket({ status: 'active' }), eventId: 'otro-evento-xyz' };
  const sold = getSoldSeatsForEvent(EVENT_ID, [foreign]);
  assert.equal(sold.size, 0);
});

test('validateSeatInventory rechaza comprar el asiento de un boleto used', () => {
  const usedTicket = makeTicket({ status: 'used' });
  const conflicts = validateSeatInventory(EVENT_ID, [usedTicket.seat], [usedTicket]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, 'ya vendido');
});

test('validateSeatInventory permite comprar el asiento de un boleto cancelled', () => {
  const cancelledTicket = makeTicket({ status: 'cancelled' });
  const conflicts = validateSeatInventory(EVENT_ID, [cancelledTicket.seat], [cancelledTicket]);
  assert.equal(conflicts.length, 0);
});

test('validateSeatInventory sigue detectando duplicados dentro de la misma orden', () => {
  const seat = { zone: 'LUNETA', fila: 'C', asiento: 7, tableSize: 1 };
  const conflicts = validateSeatInventory(EVENT_ID, [seat, { ...seat }], []);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, 'duplicado en la misma orden');
});

test('findSeatConflicts detecta conflictos contra un set de llaves vendidas', () => {
  const seat = { zone: 'LUNETA', fila: 'D', asiento: 9, tableSize: 1 };
  const soldKeys = new Set([buildSeatKey(seat)]);
  const conflicts = findSeatConflicts([seat], soldKeys);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, 'ya vendido');
  assert.equal(findSeatConflicts([{ ...seat, asiento: 10 }], soldKeys).length, 0);
});

// ── Storage: fuente de asientos vendidos según el modo ──

function storageDeps({ jsonTickets = [], postgresTickets = [], failPostgres = false } = {}) {
  const calls = { postgres: 0, json: 0 };
  return {
    calls,
    readJsonTickets: () => {
      calls.json++;
      return jsonTickets;
    },
    repository: {
      findSoldSeatTicketsByEvent: async () => {
        calls.postgres++;
        if (failPostgres) throw new Error('database unavailable');
        return postgresTickets;
      },
    },
    computeSoldSeatKeys: getSoldSeatsForEvent,
    logger: { warn: () => {}, error: () => {} },
  };
}

test('modo json calcula vendidos desde tickets.json sin tocar PostgreSQL', async () => {
  const jsonTicket = makeTicket({ status: 'active', fila: 'J', asiento: 1 });
  const deps = storageDeps({ jsonTickets: [jsonTicket] });
  const sold = await getSoldSeatKeysFromStorage({ eventId: EVENT_ID, mode: 'json', ...deps });

  assert.equal(sold.has(buildSeatKey(jsonTicket.seat)), true);
  assert.equal(deps.calls.postgres, 0);
});

test('modo postgres-primary calcula vendidos desde PostgreSQL sin leer JSON', async () => {
  const pgTicket = makeTicket({ status: 'used', fila: 'P', asiento: 2 });
  const deps = storageDeps({ postgresTickets: [pgTicket] });
  const sold = await getSoldSeatKeysFromStorage({ eventId: EVENT_ID, mode: 'postgres-primary', ...deps });

  assert.equal(sold.has(buildSeatKey(pgTicket.seat)), true);
  assert.equal(deps.calls.json, 0);
});

test('modo postgres calcula vendidos desde PostgreSQL sin leer JSON', async () => {
  const pgTicket = makeTicket({ status: 'active', fila: 'P', asiento: 3 });
  const deps = storageDeps({ postgresTickets: [pgTicket] });
  const sold = await getSoldSeatKeysFromStorage({ eventId: EVENT_ID, mode: 'postgres', ...deps });

  assert.equal(sold.has(buildSeatKey(pgTicket.seat)), true);
  assert.equal(deps.calls.json, 0);
});

test('modo dual-read une los vendidos de PostgreSQL y JSON', async () => {
  const pgTicket = makeTicket({ status: 'active', fila: 'P', asiento: 4 });
  const jsonTicket = makeTicket({ status: 'active', fila: 'J', asiento: 5 });
  const deps = storageDeps({ postgresTickets: [pgTicket], jsonTickets: [jsonTicket] });
  const sold = await getSoldSeatKeysFromStorage({ eventId: EVENT_ID, mode: 'dual-read', ...deps });

  assert.equal(sold.has(buildSeatKey(pgTicket.seat)), true);
  assert.equal(sold.has(buildSeatKey(jsonTicket.seat)), true);
});

test('modo dual-read cae a JSON si PostgreSQL falla, sin lanzar', async () => {
  const jsonTicket = makeTicket({ status: 'active', fila: 'J', asiento: 6 });
  const deps = storageDeps({ jsonTickets: [jsonTicket], failPostgres: true });
  const sold = await getSoldSeatKeysFromStorage({ eventId: EVENT_ID, mode: 'dual-read', ...deps });

  assert.equal(sold.has(buildSeatKey(jsonTicket.seat)), true);
});

test('eventId vacío devuelve un set vacío sin consultar nada', async () => {
  const deps = storageDeps({ jsonTickets: [makeTicket({ status: 'active' })] });
  const sold = await getSoldSeatKeysFromStorage({ eventId: '', mode: 'postgres-primary', ...deps });

  assert.equal(sold.size, 0);
  assert.equal(deps.calls.postgres, 0);
  assert.equal(deps.calls.json, 0);
});

// ── Write-mode: conflicto de asiento en PostgreSQL → error controlado ──

test('un 23505 sobre índice de asiento se convierte en TicketSeatConflictError', async () => {
  const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'tickets_active_seat_uidx',
  });

  await assert.rejects(
    writeTicketPurchaseToPostgresPrimary({
      ticketRecords: [{ orderId: 'BM-ORD-X', ticketId: 'BM-TKT-X' }],
      repository: { insertPurchaseOrder: async () => { throw conflict; } },
      logger: { warn: () => {}, error: () => {} },
    }),
    error => {
      assert.equal(error instanceof TicketSeatConflictError, true);
      assert.match(error.message, /Asientos no disponibles/);
      return true;
    },
  );
});

test('un TicketSeatConflictError del pre-chequeo se propaga sin envolverse', async () => {
  const conflict = new TicketSeatConflictError();

  await assert.rejects(
    writeTicketPurchaseToPostgresPrimary({
      ticketRecords: [{ orderId: 'BM-ORD-Z', ticketId: 'BM-TKT-Z' }],
      repository: { insertPurchaseOrder: async () => { throw conflict; } },
      logger: { warn: () => {}, error: () => {} },
    }),
    error => {
      assert.equal(error, conflict);
      return true;
    },
  );
});

test('otros errores de PostgreSQL siguen siendo TicketPurchasePrimaryWriteError', async () => {
  const genericError = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });

  await assert.rejects(
    writeTicketPurchaseToPostgresPrimary({
      ticketRecords: [{ orderId: 'BM-ORD-Y', ticketId: 'BM-TKT-Y' }],
      repository: { insertPurchaseOrder: async () => { throw genericError; } },
      logger: { warn: () => {}, error: () => {} },
    }),
    error => {
      assert.equal(error instanceof TicketPurchasePrimaryWriteError, true);
      return true;
    },
  );
});
