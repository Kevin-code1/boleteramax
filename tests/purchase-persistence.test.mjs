import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { closePool, query } from '../db/pool.mjs';
import { insertPurchaseOrder, TicketSeatConflictError } from '../db/tickets.repository.mjs';
import { resolvePurchaseBuyer } from '../src/domain/buyer.mjs';

// Sin DATABASE_URL se fuerza modo json (config aborta en postgres-primary).
if (!process.env.DATABASE_URL) {
  process.env.TICKETS_STORAGE = process.env.TICKETS_STORAGE || 'json';
  process.env.TICKETS_WRITE_MODE = process.env.TICKETS_WRITE_MODE || 'json';
}

const { buildOrderPricingCents } = await import('../src/domain/pricing.mjs');

const HAS_DB = Boolean(process.env.DATABASE_URL);

// ── Unidad: desglose de importes desde la cotización firmada ──

const QUOTE_LIKE = {
  subtotal: 1000,
  fee: 140,
  paymentTotals: { tarjeta: 1140, spei: 1089, oxxo: 1157 },
};

function purchaseForMethod(method) {
  return { ...QUOTE_LIKE, total: QUOTE_LIKE.paymentTotals[method] };
}

test('buildOrderPricingCents: tarjeta sin descuento y fee base', () => {
  const pricing = buildOrderPricingCents(purchaseForMethod('tarjeta'), 'tarjeta');
  assert.deepEqual(pricing, {
    subtotalCents: 100000,
    feeCents: 14000,
    discountCents: 0,
    totalCents: 114000,
    currency: 'MXN',
  });
});

test('buildOrderPricingCents: spei registra el descuento en discount_cents', () => {
  const pricing = buildOrderPricingCents(purchaseForMethod('spei'), 'spei');
  assert.equal(pricing.subtotalCents, 100000);
  assert.equal(pricing.feeCents, 14000);
  assert.equal(pricing.totalCents, 108900);
  assert.equal(pricing.discountCents, 5100);
});

test('buildOrderPricingCents: oxxo suma su comisión fija al fee', () => {
  const pricing = buildOrderPricingCents(purchaseForMethod('oxxo'), 'oxxo');
  assert.equal(pricing.feeCents, 14000 + 1700);
  assert.equal(pricing.totalCents, 115700);
  assert.equal(pricing.discountCents, 0);
});

test('buildOrderPricingCents cumple subtotal + fee - discount = total en todos los métodos', () => {
  for (const method of ['tarjeta', 'spei', 'oxxo']) {
    const p = buildOrderPricingCents(purchaseForMethod(method), method);
    assert.equal(
      p.subtotalCents + p.feeCents - p.discountCents,
      p.totalCents,
      `invariante roto para ${method}`,
    );
  }
});

// ── Unidad: resolución del comprador ──

test('con sesión se usan los datos de la cuenta y se ignora el buyer del body', () => {
  const sessionUser = { id: 'user-1', email: 'Cuenta@Boletamax.Test', displayName: 'Cuenta Real' };
  const { buyer, errors } = resolvePurchaseBuyer({
    sessionUser,
    requestBuyer: { name: 'Otro Nombre', email: 'otro@correo.test' },
  });

  assert.deepEqual(errors, []);
  assert.equal(buyer.name, 'Cuenta Real');
  assert.equal(buyer.email, 'cuenta@boletamax.test');
  assert.equal(buyer.userId, 'user-1');
  assert.equal(buyer.isGuest, false);
});

test('invitado con nombre y correo válidos queda como guest sin userId', () => {
  const { buyer, errors } = resolvePurchaseBuyer({
    sessionUser: null,
    requestBuyer: { name: '  Invitada Pérez  ', email: ' INVITADA@correo.test ' },
  });

  assert.deepEqual(errors, []);
  assert.equal(buyer.name, 'Invitada Pérez');
  assert.equal(buyer.email, 'invitada@correo.test');
  assert.equal(buyer.userId, null);
  assert.equal(buyer.isGuest, true);
});

test('invitado sin nombre o con correo inválido es rechazado', () => {
  const sinNombre = resolvePurchaseBuyer({ requestBuyer: { name: '', email: 'ok@correo.test' } });
  assert.equal(sinNombre.errors.length, 1);
  assert.match(sinNombre.errors[0], /nombre/i);

  const correoMalo = resolvePurchaseBuyer({ requestBuyer: { name: 'Alguien', email: 'no-es-correo' } });
  assert.equal(correoMalo.errors.length, 1);
  assert.match(correoMalo.errors[0], /correo/i);

  const sinNada = resolvePurchaseBuyer({ requestBuyer: null });
  assert.equal(sinNada.errors.length, 2);

  const nombreLargo = resolvePurchaseBuyer({
    requestBuyer: { name: 'x'.repeat(81), email: 'ok@correo.test' },
  });
  assert.equal(nombreLargo.errors.length, 1);
  assert.match(nombreLargo.errors[0], /largo/i);
});

// ── Integración PostgreSQL ──

function makeTicketRecord({ orderId, eventName, date, venue, fila, asiento, token }) {
  return {
    ticketId: `BM-TKT-B4-${randomBytes(6).toString('hex').toUpperCase()}`,
    orderId,
    eventId: null, // el repo usa order.event.eventId
    eventName,
    date,
    venue,
    zone: 'VIP',
    seatLabel: `VIP · Fila ${fila} · Asiento ${asiento}`,
    seat: { zone: 'VIP', fila, asiento, price: 500, tableSize: 1 },
    totalPaid: 1140,
    paymentMethod: 'tarjeta',
    orderSeatCount: 2,
    status: 'active',
    token: token || randomBytes(12).toString('hex'),
  };
}

test('insertPurchaseOrder integración: orden única, lookup estable, conflicto controlado y rollback', {
  skip: HAS_DB ? false : 'DATABASE_URL not configured; skipping purchase persistence integration.',
}, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const eventRef = `b4-evento-${suffix}`;
  const eventName = `B4 Persistencia ${suffix}`;
  const venueName = `Venue B4 ${suffix}, Testlandia`;
  const date = '1 Diciembre 2026';
  const orderNumbers = [];
  let tempUserId = null;

  function makeOrder({ orderId, buyer, seatCount = 2 }) {
    orderNumbers.push(orderId);
    return {
      orderId,
      quoteId: `BM-QTE-B4-${suffix}`,
      buyer,
      paymentMethod: 'tarjeta',
      pricing: { subtotalCents: 100000, feeCents: 14000, discountCents: 0, totalCents: 114000, currency: 'MXN' },
      event: { eventId: eventRef, name: eventName, date, venue: venueName },
      orderSeatCount: seatCount,
    };
  }

  const guestBuyer = { name: 'Invitado B4', email: `b4-guest-${suffix}@boletamax.test`, userId: null, isGuest: true };

  try {
    // ── Compra invitada de 2 asientos ──
    const order1 = makeOrder({ orderId: `BM-ORD-B4A-${suffix}`, buyer: guestBuyer });
    const tickets1 = [
      makeTicketRecord({ orderId: order1.orderId, eventName, date, venue: venueName, fila: 'A', asiento: 1 }),
      makeTicketRecord({ orderId: order1.orderId, eventName, date, venue: venueName, fila: 'A', asiento: 2 }),
    ];
    const result1 = await insertPurchaseOrder({ order: order1, tickets: tickets1 });
    assert.deepEqual(result1, { attempted: 2, inserted: 2, skipped: 0 });

    const orderRow = (await query(
      `SELECT id, buyer_email, buyer_name, status, subtotal_cents, fee_cents, discount_cents,
              total_cents, payment_method, checkout_quote_id, user_id, metadata
       FROM orders WHERE order_number = $1`,
      [order1.orderId],
    )).rows[0];
    assert.ok(orderRow, 'la orden debe existir');
    assert.equal(orderRow.buyer_email, guestBuyer.email);
    assert.equal(orderRow.buyer_name, guestBuyer.name);
    assert.equal(orderRow.status, 'paid');
    assert.equal(orderRow.subtotal_cents, 100000);
    assert.equal(orderRow.fee_cents, 14000);
    assert.equal(orderRow.discount_cents, 0);
    assert.equal(orderRow.total_cents, 114000);
    assert.equal(orderRow.checkout_quote_id, `BM-QTE-B4-${suffix}`);
    assert.equal(orderRow.user_id, null);
    assert.equal(orderRow.metadata.source, 'checkout');
    assert.equal(orderRow.metadata.guestPurchase, true);
    assert.equal(orderRow.metadata.legacyOrderSeatCount, 2);

    const counts = (await query(
      `SELECT
         (SELECT count(*)::int FROM order_items WHERE order_id = $1) AS items,
         (SELECT count(*)::int FROM tickets WHERE order_id = $1) AS tickets,
         (SELECT count(*)::int FROM payments WHERE order_id = $1) AS payments`,
      [orderRow.id],
    )).rows[0];
    assert.deepEqual(counts, { items: 2, tickets: 2, payments: 1 });

    const payment = (await query(
      'SELECT provider, status, method, amount_cents, paid_at FROM payments WHERE order_id = $1',
      [orderRow.id],
    )).rows[0];
    assert.equal(payment.provider, 'simulated');
    assert.equal(payment.status, 'paid');
    assert.equal(payment.method, 'tarjeta');
    assert.equal(payment.amount_cents, 114000);
    assert.ok(payment.paid_at);

    // Vínculos: cada ticket apunta a un order_item de la misma orden.
    const linkCheck = (await query(
      `SELECT count(*)::int AS linked
       FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id
       WHERE t.order_id = $1 AND oi.order_id = $1 AND t.seat_id = oi.seat_id`,
      [orderRow.id],
    )).rows[0];
    assert.equal(linkCheck.linked, 2);

    // ── Lookup estable: otra compra no modifica la fila del evento ──
    const eventBefore = (await query(
      'SELECT id, updated_at FROM events WHERE external_reference = $1',
      [eventRef],
    )).rows[0];
    assert.ok(eventBefore, 'el evento debe haberse creado');

    // ── Compra con cuenta (user_id) ──
    const userResult = await query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, 'scrypt:test', 'Cuenta B4') RETURNING id`,
      [`b4-user-${suffix}@boletamax.test`],
    );
    tempUserId = userResult.rows[0].id;

    const order2 = makeOrder({
      orderId: `BM-ORD-B4B-${suffix}`,
      buyer: { name: 'Cuenta B4', email: `b4-user-${suffix}@boletamax.test`, userId: tempUserId, isGuest: false },
    });
    const tickets2 = [
      makeTicketRecord({ orderId: order2.orderId, eventName, date, venue: venueName, fila: 'B', asiento: 1 }),
      makeTicketRecord({ orderId: order2.orderId, eventName, date, venue: venueName, fila: 'B', asiento: 2 }),
    ];
    await insertPurchaseOrder({ order: order2, tickets: tickets2 });

    const order2Row = (await query(
      'SELECT user_id, metadata FROM orders WHERE order_number = $1',
      [order2.orderId],
    )).rows[0];
    assert.equal(order2Row.user_id, tempUserId);
    assert.equal(order2Row.metadata.guestPurchase, false);

    const eventAfter = (await query(
      'SELECT updated_at FROM events WHERE id = $1',
      [eventBefore.id],
    )).rows[0];
    assert.equal(
      String(eventAfter.updated_at),
      String(eventBefore.updated_at),
      'la segunda compra no debe hacer upsert sobre el evento existente',
    );

    // ── Conflicto de asiento: mismo asiento A1 → error controlado + rollback ──
    const order3 = makeOrder({ orderId: `BM-ORD-B4C-${suffix}`, buyer: guestBuyer, seatCount: 1 });
    const conflictTicket = makeTicketRecord({
      orderId: order3.orderId, eventName, date, venue: venueName, fila: 'A', asiento: 1,
    });
    await assert.rejects(
      insertPurchaseOrder({ order: order3, tickets: [conflictTicket] }),
      error => error instanceof TicketSeatConflictError,
    );
    const order3Count = (await query(
      'SELECT count(*)::int AS count FROM orders WHERE order_number = $1',
      [order3.orderId],
    )).rows[0];
    assert.equal(order3Count.count, 0, 'el conflicto debe hacer rollback de la orden completa');

    // ── Rollback total ante fallo a mitad de transacción ──
    // Dos boletos con el mismo ticket_code fuerzan el fallo.
    const order4 = makeOrder({ orderId: `BM-ORD-B4D-${suffix}`, buyer: guestBuyer });
    const dupCode = `BM-TKT-B4-DUP-${suffix}`;
    const tickets4 = [
      { ...makeTicketRecord({ orderId: order4.orderId, eventName, date, venue: venueName, fila: 'C', asiento: 1 }), ticketId: dupCode },
      { ...makeTicketRecord({ orderId: order4.orderId, eventName, date, venue: venueName, fila: 'C', asiento: 2 }), ticketId: dupCode },
    ];
    await assert.rejects(insertPurchaseOrder({ order: order4, tickets: tickets4 }));

    const rollbackChecks = (await query(
      `SELECT
         (SELECT count(*)::int FROM orders WHERE order_number = $1) AS orders,
         (SELECT count(*)::int FROM tickets WHERE ticket_code = $2) AS tickets,
         (SELECT count(*)::int FROM seats s JOIN events e ON e.id = s.event_id
          WHERE e.external_reference = $3 AND s.row_label = 'C') AS seats`,
      [order4.orderId, dupCode, eventRef],
    )).rows[0];
    assert.deepEqual(rollbackChecks, { orders: 0, tickets: 0, seats: 0 });
  } finally {
    // Limpieza de los datos creados por la prueba.
    for (const orderNumber of orderNumbers) {
      const orders = await query('SELECT id FROM orders WHERE order_number = $1', [orderNumber]);
      for (const row of orders.rows) {
        await query('DELETE FROM ticket_validation_logs WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id = $1)', [row.id]);
        await query('DELETE FROM tickets WHERE order_id = $1', [row.id]);
        await query('DELETE FROM payments WHERE order_id = $1', [row.id]);
        await query('DELETE FROM order_items WHERE order_id = $1', [row.id]);
        await query('DELETE FROM orders WHERE id = $1', [row.id]);
      }
    }
    const events = await query('SELECT id FROM events WHERE external_reference = $1', [eventRef]);
    for (const row of events.rows) {
      await query('DELETE FROM seats WHERE event_id = $1', [row.id]);
      await query('DELETE FROM ticket_types WHERE event_id = $1', [row.id]);
      await query('DELETE FROM sections WHERE event_id = $1', [row.id]);
      await query('DELETE FROM events WHERE id = $1', [row.id]);
    }
    await query('DELETE FROM venues WHERE name = $1', [venueName]);
    if (tempUserId) {
      await query('DELETE FROM users WHERE id = $1', [tempUserId]);
    }
    if (HAS_DB) await closePool();
  }
});
