import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { closePool, query } from '../db/pool.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const ticketsPath = path.join(rootDir, 'data', 'tickets.json');

function sanitizeLog(value = '') {
  return String(value)
    .replace(/postgres:\/\/[^ \n\r]+/gi, '[database-url-redacted]')
    .replace(/[a-f0-9]{24,}/gi, '[redacted]');
}

function getFreeishPort() {
  return 39_000 + Math.floor(Math.random() * 2_000);
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitForServer(baseUrl, child, getOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${sanitizeLog(getOutput())}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/security-config`);
      if (response.ok) return;
    } catch (_) {
      // Keep polling until the server is ready.
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`server did not start: ${sanitizeLog(getOutput())}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise(resolve => {
    child.once('exit', resolve);
    setTimeout(resolve, 2_000);
  });
}

async function cleanupOrder(orderNumber) {
  if (!orderNumber) return;

  const orders = await query('SELECT id FROM orders WHERE order_number = $1', [orderNumber]);
  for (const order of orders.rows) {
    const orderId = order.id;
    await query(`
      DELETE FROM ticket_validation_logs
      WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id = $1)
    `, [orderId]);
    await query('DELETE FROM tickets WHERE order_id = $1', [orderId]);
    await query('DELETE FROM payments WHERE order_id = $1', [orderId]);
    await query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
    await query('DELETE FROM seat_reservations WHERE order_id = $1', [orderId]);
    await query('DELETE FROM orders WHERE id = $1', [orderId]);
  }
}

test('postgres-primary purchase, read, dynamic QR, and staff validation flow', {
  skip: process.env.DATABASE_URL ? false : 'DATABASE_URL not configured; skipping postgres-primary e2e.',
}, async () => {
  const originalTicketsJson = await fs.readFile(ticketsPath, 'utf8');
  const port = getFreeishPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminKey = `TEST_ADMIN_${Date.now()}`;
  const checkoutSecret = `test_checkout_${Date.now()}`;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const output = [];
  let child = null;
  let orderId = null;

  try {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        ADMIN_API_KEY: adminKey,
        CHECKOUT_SIGNING_SECRET: checkoutSecret,
        TICKETS_STORAGE: 'postgres-primary',
        TICKETS_WRITE_MODE: 'postgres-primary',
        TURNSTILE_SITE_KEY: '',
        TURNSTILE_SECRET_KEY: '',
        PUBLIC_BASE_URL: baseUrl,
      },
      windowsHide: true,
    });

    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    const getOutput = () => output.join('');
    await waitForServer(baseUrl, child, getOutput);

    const event = {
      name: 'Comedy Night Puebla',
      date: '18 Junio 2025',
      venue: 'Auditorio Puebla',
    };
    const seats = [{
      zone: 'LUNETA',
      fila: `E2E${suffix}`,
      asiento: Number(String(suffix).slice(-4)) || 1,
      tableSize: 1,
    }];

    const quoteResult = await requestJson(baseUrl, '/api/checkout/quote', {
      method: 'POST',
      body: JSON.stringify({ event, seats }),
    });
    assert.equal(quoteResult.response.status, 200);
    assert.equal(quoteResult.payload.ok, true);
    assert.ok(quoteResult.payload.quote?.signature);

    const purchaseResult = await requestJson(baseUrl, '/api/tickets', {
      method: 'POST',
      body: JSON.stringify({
        event,
        seats: quoteResult.payload.quote.seats,
        totalPaid: quoteResult.payload.quote.paymentTotals.tarjeta,
        paymentMethod: 'tarjeta',
        quote: quoteResult.payload.quote,
        turnstileToken: '',
      }),
    });
    assert.equal(
      purchaseResult.response.status,
      201,
      `purchase failed: ${sanitizeLog(JSON.stringify(purchaseResult.payload))} ${sanitizeLog(getOutput())}`,
    );
    assert.equal(purchaseResult.payload.ok, true);
    assert.equal(Array.isArray(purchaseResult.payload.tickets), true);
    assert.equal(purchaseResult.payload.tickets.length, 1);

    orderId = purchaseResult.payload.orderId;
    const ticket = purchaseResult.payload.tickets[0];
    assert.ok(ticket.ticketId);
    assert.ok(ticket.token);

    const privateReadWithoutToken = await requestJson(
      baseUrl,
      `/api/tickets/${encodeURIComponent(ticket.ticketId)}`,
    );
    assert.equal(privateReadWithoutToken.response.status, 403);
    assert.equal(privateReadWithoutToken.payload.ok, false);

    const privateReadWithToken = await requestJson(
      baseUrl,
      `/api/tickets/${encodeURIComponent(ticket.ticketId)}`,
      {
        headers: { 'x-ticket-token': ticket.token },
      },
    );
    assert.equal(privateReadWithToken.response.status, 200);
    assert.equal(privateReadWithToken.payload.ok, true);
    assert.equal(privateReadWithToken.payload.ticket.ticketId, ticket.ticketId);
    assert.equal(Object.hasOwn(privateReadWithToken.payload.ticket, 'token'), false);
    assert.equal(Object.hasOwn(privateReadWithToken.payload.ticket, 'privateViewTokenHash'), false);

    const publicReadResult = await requestJson(
      baseUrl,
      `/api/public/tickets/${encodeURIComponent(ticket.ticketId)}`,
    );
    assert.equal(publicReadResult.response.status, 200);
    assert.equal(publicReadResult.payload.ok, true);
    assert.equal(publicReadResult.payload.ticket.ticketId, ticket.ticketId);
    assert.equal(publicReadResult.payload.ticket.eventName, event.name);
    for (const privateField of [
      'totalPaid',
      'paymentMethod',
      'orderId',
      'orderSeatCount',
      'token',
      'privateViewTokenHash',
      'dynamicSecret',
      'qrPayload',
      'qrDataUrl',
    ]) {
      assert.equal(Object.hasOwn(publicReadResult.payload.ticket, privateField), false);
    }

    const legacyListResult = await requestJson(
      baseUrl,
      `/api/tickets?ids=${encodeURIComponent(ticket.ticketId)}`,
    );
    assert.equal(legacyListResult.response.status, 410);
    assert.equal(legacyListResult.payload.ok, false);

    const privateListResult = await requestJson(baseUrl, '/api/tickets/private', {
      method: 'POST',
      body: JSON.stringify({
        tickets: [{ ticketId: ticket.ticketId, token: ticket.token }],
      }),
    });
    assert.equal(privateListResult.response.status, 200);
    assert.equal(privateListResult.payload.ok, true);
    assert.equal(Array.isArray(privateListResult.payload.tickets), true);
    assert.equal(privateListResult.payload.tickets.length, 1);
    assert.equal(privateListResult.payload.tickets[0].ticketId, ticket.ticketId);
    assert.equal(Object.hasOwn(privateListResult.payload.tickets[0], 'token'), false);

    const qrResult = await requestJson(
      baseUrl,
      `/api/tickets/${encodeURIComponent(ticket.ticketId)}/dynamic-qr`,
      {
        headers: { 'x-ticket-token': ticket.token },
      },
    );
    assert.equal(qrResult.response.status, 200);
    assert.equal(qrResult.payload.ok, true);
    assert.equal(qrResult.payload.active, true);
    assert.ok(qrResult.payload.dynamicToken);
    assert.ok(Number.isFinite(Number(qrResult.payload.window)));

    const validatePayload = {
      ticketId: ticket.ticketId,
      eventId: qrResult.payload.ticket.eventId,
      dynamicToken: qrResult.payload.dynamicToken,
      window: qrResult.payload.window,
    };

    const firstValidation = await requestJson(baseUrl, '/api/validate-ticket', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey },
      body: JSON.stringify(validatePayload),
    });
    assert.equal(firstValidation.response.status, 200);
    assert.equal(firstValidation.payload.valid, true);

    const usedTicketResult = await query(
      'SELECT status, validation_count, used_at FROM tickets WHERE ticket_code = $1',
      [ticket.ticketId],
    );
    assert.equal(usedTicketResult.rows[0]?.status, 'used');
    assert.equal(usedTicketResult.rows[0]?.validation_count, 1);
    assert.ok(usedTicketResult.rows[0]?.used_at);

    const secondValidation = await requestJson(baseUrl, '/api/validate-ticket', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey },
      body: JSON.stringify(validatePayload),
    });
    assert.equal(secondValidation.response.status, 200);
    assert.equal(secondValidation.payload.valid, false);
    assert.match(String(secondValidation.payload.message || ''), /utilizado/i);

    const duplicateCheck = await query(
      'SELECT validation_count FROM tickets WHERE ticket_code = $1',
      [ticket.ticketId],
    );
    assert.equal(duplicateCheck.rows[0]?.validation_count, 1);
  } finally {
    await stopServer(child);
    await fs.writeFile(ticketsPath, originalTicketsJson);
    await cleanupOrder(orderId);
    await closePool();
  }
});
