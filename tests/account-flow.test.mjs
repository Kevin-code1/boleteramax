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
  return 41_000 + Math.floor(Math.random() * 2_000);
}

// El token de verificación solo se imprime en el log del servidor (dev),
// nunca en el JSON de la API. Lo leemos de stdout para completar el flujo.
async function waitForVerifyToken(getOutput, email, { timeoutMs = 5000 } = {}) {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`Para:\\s*${escaped}[\\s\\S]*?token=([a-f0-9]+)`, 'g');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const out = getOutput();
    let match;
    let last = null;
    re.lastIndex = 0;
    while ((match = re.exec(out)) !== null) last = match[1];
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`verification token for ${email} not found in server logs`);
}

function extractSessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ||
    (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
  const sessionCookie = cookies.find(cookie => cookie.startsWith('bm_session='));
  if (!sessionCookie) return null;
  return {
    header: sessionCookie.split(';')[0],
    raw: sessionCookie,
  };
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

async function cleanupUser(email) {
  if (!email) return;
  // user_sessions cae en cascada al borrar el usuario.
  await query('DELETE FROM users WHERE email_normalized = lower($1)', [email]);
}

test('buyer account flow: register, login, sessions, guest vs logged purchases, my tickets', {
  skip: process.env.DATABASE_URL ? false : 'DATABASE_URL not configured; skipping account e2e.',
}, async () => {
  const originalTicketsJson = await fs.readFile(ticketsPath, 'utf8');
  const port = getFreeishPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminKey = `TEST_ADMIN_${Date.now()}`;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e+${suffix}@boletamax.test`;
  const password = 'SuperSecreta123';
  const output = [];
  let child = null;
  const orderIds = [];

  try {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        ADMIN_API_KEY: adminKey,
        CHECKOUT_SIGNING_SECRET: `test_checkout_${suffix}`,
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

    // ── Registro: NO inicia sesión (pendiente de verificación) ──
    const register = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Cuenta ${suffix}`, email, password }),
    });
    assert.equal(register.response.status, 201, sanitizeLog(JSON.stringify(register.payload)));
    assert.equal(register.payload.ok, true);
    assert.equal(register.payload.pendingVerification, true);
    assert.equal(extractSessionCookie(register.response), null, 'register must NOT set a session cookie');
    assert.equal(register.payload.devVerifyUrl, undefined, 'register must not leak a verify link');
    assert.equal(Object.hasOwn(register.payload, 'token'), false, 'register must not leak a token');

    // ── Login antes de verificar → 403 email_not_verified, sin cookie ──
    const loginUnverified = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginUnverified.response.status, 403);
    assert.equal(loginUnverified.payload.code, 'email_not_verified');
    assert.equal(extractSessionCookie(loginUnverified.response), null, 'unverified login must NOT set a cookie');

    // ── Verificar el correo con el token leído del log del servidor ──
    const verifyToken = await waitForVerifyToken(getOutput, email);
    const verify = await requestJson(baseUrl, `/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`);
    assert.equal(verify.response.status, 200);
    assert.equal(verify.payload.ok, true);

    // ── Registro duplicado → 409 ──
    const duplicate = await requestJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Otra', email, password }),
    });
    assert.equal(duplicate.response.status, 409);

    // ── Login: contraseña incorrecta 401, correcta 200 (ya verificado) ──
    const badLogin = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'incorrecta123' }),
    });
    assert.equal(badLogin.response.status, 401);

    const login = await requestJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.response.status, 200);
    const sessionCookie = extractSessionCookie(login.response);
    assert.ok(sessionCookie, 'login must set bm_session cookie');
    assert.match(sessionCookie.raw, /HttpOnly/i);
    assert.match(sessionCookie.raw, /SameSite=Lax/i);

    // ── auth/me devuelve emailVerified true ──
    const meLoggedIn = await requestJson(baseUrl, '/api/auth/me', {
      headers: { Cookie: sessionCookie.header },
    });
    assert.equal(meLoggedIn.response.status, 200);
    assert.equal(meLoggedIn.payload.user.email, email);
    assert.equal(meLoggedIn.payload.user.emailVerified, true);
    assert.equal(Object.hasOwn(meLoggedIn.payload.user, 'passwordHash'), false);

    const meAnonymous = await requestJson(baseUrl, '/api/auth/me');
    assert.equal(meAnonymous.response.status, 401);

    // ── Compras: invitado (sin cookie) y logueado (con cookie) ──
    const event = {
      name: 'Comedy Night Puebla',
      date: '18 Junio 2025',
      venue: 'Auditorio Puebla',
    };

    async function buyTicket(cookieHeader, filaTag) {
      const seats = [{ zone: 'LUNETA', fila: filaTag, asiento: 1, tableSize: 1 }];
      const quote = await requestJson(baseUrl, '/api/checkout/quote', {
        method: 'POST',
        body: JSON.stringify({ event, seats }),
      });
      assert.equal(quote.response.status, 200);

      const purchase = await requestJson(baseUrl, '/api/tickets', {
        method: 'POST',
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
        body: JSON.stringify({
          event,
          seats: quote.payload.quote.seats,
          totalPaid: quote.payload.quote.paymentTotals.tarjeta,
          paymentMethod: 'tarjeta',
          quote: quote.payload.quote,
          turnstileToken: '',
        }),
      });
      assert.equal(
        purchase.response.status,
        201,
        `purchase failed: ${sanitizeLog(JSON.stringify(purchase.payload))}`,
      );
      orderIds.push(purchase.payload.orderId);
      return purchase.payload.tickets[0];
    }

    const guestTicket = await buyTicket(null, `GUEST${suffix}`);
    const ownedTicket = await buyTicket(sessionCookie.header, `USER${suffix}`);

    // ── Mis boletos: solo los del usuario ──
    const myTickets = await requestJson(baseUrl, '/api/account/tickets', {
      headers: { Cookie: sessionCookie.header },
    });
    assert.equal(myTickets.response.status, 200);
    const myTicketIds = myTickets.payload.tickets.map(ticket => ticket.ticketId);
    assert.ok(myTicketIds.includes(ownedTicket.ticketId), 'logged purchase must appear in my tickets');
    assert.equal(myTicketIds.includes(guestTicket.ticketId), false, 'guest purchase must not appear');
    assert.equal(
      myTickets.payload.tickets.every(ticket => !Object.hasOwn(ticket, 'token')),
      true,
    );

    const myTicketsAnonymous = await requestJson(baseUrl, '/api/account/tickets');
    assert.equal(myTicketsAnonymous.response.status, 401);

    // ── Vista privada por sesión de dueño (sin token) ──
    const ownedDetail = await requestJson(
      baseUrl,
      `/api/tickets/${encodeURIComponent(ownedTicket.ticketId)}`,
      { headers: { Cookie: sessionCookie.header } },
    );
    assert.equal(ownedDetail.response.status, 200);

    const foreignDetail = await requestJson(
      baseUrl,
      `/api/tickets/${encodeURIComponent(guestTicket.ticketId)}`,
      { headers: { Cookie: sessionCookie.header } },
    );
    assert.equal(foreignDetail.response.status, 403, 'session must not open tickets it does not own');

    // ── QR dinámico por sesión de dueño ──
    const dynamicQr = await requestJson(
      baseUrl,
      `/api/tickets/${encodeURIComponent(ownedTicket.ticketId)}/dynamic-qr`,
      { headers: { Cookie: sessionCookie.header } },
    );
    assert.equal(dynamicQr.response.status, 200);
    assert.equal(dynamicQr.payload.active, true);
    assert.ok(dynamicQr.payload.dynamicToken);

    // ── Staff independiente de la sesión de comprador ──
    const validateWithoutKey = await requestJson(baseUrl, '/api/validate-ticket', {
      method: 'POST',
      headers: { Cookie: sessionCookie.header },
      body: JSON.stringify({ ticketId: ownedTicket.ticketId }),
    });
    assert.equal(validateWithoutKey.response.status, 401, 'buyer session must not validate tickets');

    const staffValidation = await requestJson(baseUrl, '/api/validate-ticket', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey },
      body: JSON.stringify({
        ticketId: ownedTicket.ticketId,
        eventId: dynamicQr.payload.ticket.eventId,
        dynamicToken: dynamicQr.payload.dynamicToken,
        window: dynamicQr.payload.window,
      }),
    });
    assert.equal(staffValidation.response.status, 200);
    assert.equal(staffValidation.payload.valid, true);
  } finally {
    await stopServer(child);
    await fs.writeFile(ticketsPath, originalTicketsJson);
    for (const orderId of orderIds) {
      await cleanupOrder(orderId);
    }
    await cleanupUser(email);
    await closePool();
  }
});
