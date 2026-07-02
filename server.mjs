import express from 'express';
import path from 'path';
import {
  ADMIN_API_KEY,
  DYNAMIC_QR_TOLERANCE_WINDOWS,
  EVENTS_PATH,
  PORT,
  ROOT_DIR,
  TICKETS_PATH,
  TICKETS_STORAGE_MODE,
  TICKETS_WRITE_MODE,
  TURNSTILE_ENABLED,
  TURNSTILE_SITE_KEY,
} from './server/config.mjs';
import {
  apiGeneralLimiter,
  aiSearchLimiter,
  blockSensitiveFiles,
  purchaseLimiter,
  requireAdminAuth,
  securityHeaders,
  ticketQueryLimiter,
  validationLimiter,
} from './server/middleware.mjs';
import {
  buildDynamicQrResponse,
  buildEventId,
  buildTicketRecord,
  createDynamicToken,
  createOrderId,
  ensureJsonFile,
  getDynamicQrWindow,
  getPublicBaseUrl,
  readTickets,
  serializeTicketPublic,
  serializeTicketPublicView,
  withTicketValidationLock,
  withTicketsWriteLock,
  writeTickets,
} from './server/tickets.mjs';
import {
  buildCheckoutQuote,
  getAuthoritativePurchase,
  getSoldSeatsForEvent,
  resolveVenuePricingKey,
  sanitizePurchasePayload,
  SERVER_VENUE_PRICING,
  validatePurchaseRequest,
  validateSeatInventory,
} from './server/pricing.mjs';
import { findCatalogEvent } from './server/events.mjs';
import {
  filterEvents,
  hasOpenAIKey,
  inferFiltersFallback,
  inferFiltersWithAI,
  logAiFallback,
  sanitizeFilters,
} from './server/ai-search.mjs';
import { verifyTurnstileToken } from './server/turnstile.mjs';
import { safeEqualString } from './server/text.mjs';
import {
  getTicketByIdFromStorage,
  getTicketsByIdsFromStorage,
  markTicketUsedInStorage,
  verifyTicketPrivateToken,
} from './db/tickets.storage.mjs';
import {
  persistTicketPurchaseByWriteMode,
  writeTicketPurchaseToPostgresIfEnabled,
} from './db/tickets.write-mode.mjs';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

ensureJsonFile(TICKETS_PATH, []);

// ── Middleware base ──
app.use(securityHeaders);
app.use(blockSensitiveFiles);
app.use(express.json({ limit: '64kb' }));

// ── Archivos estáticos ──
const PUBLIC_HTML_FILES = new Map([
  ['/index.html', 'index.html'],
  ['/checkout.html', 'checkout.html'],
  ['/ticket.html', 'ticket.html'],
  ['/ticket-public.html', 'ticket-public.html'],
  ['/validate.html', 'validate.html'],
]);
app.get([...PUBLIC_HTML_FILES.keys()], (req, res) => {
  res.sendFile(path.join(ROOT_DIR, PUBLIC_HTML_FILES.get(req.path)));
});
app.get('/data/events.json', (req, res) => {
  res.sendFile(EVENTS_PATH);
});
app.use('/css', express.static(path.join(ROOT_DIR, 'css'), { index: false }));
app.use('/js', express.static(path.join(ROOT_DIR, 'js'), { index: false }));
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets'), { index: false }));

app.use('/api/', apiGeneralLimiter);

// ── Búsqueda con IA ──
app.post('/api/ai-search', aiSearchLimiter, async (req, res) => {
  const query = String(req.body?.query || '').trim();

  if (!query) {
    return res.json({
      query,
      filters: {
        categoria: null,
        ciudad: null,
        fecha: null,
        precioMax: null,
        keywords: [],
      },
      results: [],
      meta: {
        mode: 'empty',
        warning: null,
      },
    });
  }

  const aiResult = await inferFiltersWithAI(query);
  let filters = sanitizeFilters(aiResult.filters);
  const hasUsefulFilters =
    Boolean(filters.categoria) ||
    Boolean(filters.ciudad) ||
    Boolean(filters.fecha) ||
    filters.precioMax !== null ||
    filters.keywords.length > 0;

  if (!hasUsefulFilters) {
    logAiFallback(
      aiResult.mode === 'ai'
        ? 'OpenAI no devolvio filtros utiles'
        : 'la interpretacion local no devolvio filtros utiles',
    );
    filters = sanitizeFilters(inferFiltersFallback(query));
  }
  const results = filterEvents(filters).slice(0, 6);

  return res.json({
    query,
    filters,
    results,
    meta: {
      mode: aiResult.mode,
      warning: aiResult.warning || null,
    },
  });
});

app.get('/api/security-config', (req, res) => {
  return res.json({
    ok: true,
    cloudflare: {
      turnstileEnabled: TURNSTILE_ENABLED,
      siteKey: TURNSTILE_ENABLED ? TURNSTILE_SITE_KEY : null,
      mode: TURNSTILE_ENABLED ? 'active' : 'demo',
      message: TURNSTILE_ENABLED
        ? 'Cloudflare Turnstile activo.'
        : 'Cloudflare Turnstile listo para activar configurando TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY.',
    },
  });
});

// ── Endpoint: disponibilidad por descriptor de evento (name/date/venue) ──
// El mapa de asientos del cliente no conoce el eventId (hash del servidor),
// así que consulta con el descriptor y recibe las llaves de asientos vendidos
// junto con las etiquetas de zona que el servidor usa para ese venue.
app.post('/api/events/availability', (req, res) => {
  const rawEvent = req.body?.event && typeof req.body.event === 'object' ? req.body.event : {};
  const event = {
    name: String(rawEvent.name || '').trim(),
    date: String(rawEvent.date || '').trim(),
    venue: String(rawEvent.venue || '').trim(),
  };

  if (!event.name) {
    return res.status(400).json({ ok: false, message: 'event.name requerido.' });
  }

  const catalogEvent = findCatalogEvent(event);
  if (!catalogEvent) {
    return res.status(404).json({ ok: false, message: 'Evento no encontrado en el catalogo.' });
  }

  // Mismo descriptor que usa la cotización segura (datos del catálogo), para
  // que el eventId coincida con el de los boletos ya vendidos.
  const eventId = buildEventId({
    name: catalogEvent.name,
    date: catalogEvent.date,
    venue: catalogEvent.venue,
  });
  const venueKey = resolveVenuePricingKey(event, catalogEvent);
  const zoneLabels = Object.fromEntries(
    (SERVER_VENUE_PRICING[venueKey]?.zones || []).map(zone => [zone.key, zone.label]),
  );
  const soldSeats = getSoldSeatsForEvent(eventId, readTickets());

  return res.json({
    ok: true,
    eventId,
    venueKey,
    zoneLabels,
    totalSold: soldSeats.size,
    soldSeatKeys: [...soldSeats],
  });
});

// ── Endpoint: disponibilidad de asientos por evento ──
app.get('/api/events/:eventId/availability', (req, res) => {
  const eventId = String(req.params.eventId || '').trim();
  if (!eventId) {
    return res.status(400).json({ ok: false, message: 'eventId requerido.' });
  }

  const existingTickets = readTickets();
  const soldSeats = getSoldSeatsForEvent(eventId, existingTickets);
  const totalSold = soldSeats.size;

  return res.json({
    ok: true,
    eventId,
    totalSold,
    soldSeatKeys: [...soldSeats],
  });
});

app.post('/api/checkout/quote', purchaseLimiter, (req, res) => {
  try {
    const purchase = sanitizePurchasePayload(req.body);

    // ── Validación server-side del evento ──
    const catalogEvent = findCatalogEvent(purchase.event);
    const validationErrors = validatePurchaseRequest(purchase, catalogEvent);
    if (validationErrors.length) {
      return res.status(400).json({
        ok: false,
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    const quote = buildCheckoutQuote({
      event: purchase.event,
      seats: purchase.seats,
    });

    return res.json({
      ok: true,
      quote,
    });
  } catch (error) {
    console.warn('BoletaMax Checkout: quote rejected', {
      message: error?.message || 'Cotizacion invalida',
    });
    return res.status(400).json({
      ok: false,
      message: error?.message || 'No fue posible calcular una cotizacion segura.',
    });
  }
});

app.post('/api/tickets', purchaseLimiter, async (req, res) => {
  try {
    const purchase = sanitizePurchasePayload(req.body);
    const publicBaseUrl = getPublicBaseUrl(req);

    // ── 1. Validar estructura del request ──
    const catalogEvent = findCatalogEvent(purchase.event);
    const validationErrors = validatePurchaseRequest(purchase, catalogEvent);
    if (validationErrors.length) {
      console.warn('BoletaMax Tickets: validation failed', { errors: validationErrors });
      return res.status(400).json({
        ok: false,
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    // ── 2. Verificar protección Cloudflare ──
    const turnstileResult = await verifyTurnstileToken(req, purchase.turnstileToken);
    if (!turnstileResult.ok) {
      console.warn('BoletaMax Cloudflare: request rejected', {
        reason: turnstileResult.reason,
      });
      return res.status(403).json({
        ok: false,
        message: 'No se pudo verificar la proteccion Cloudflare. Intenta nuevamente.',
      });
    }

    // ── 3. Precios autoritativos del servidor ──
    const authoritativePurchase = getAuthoritativePurchase(purchase);
    const eventId = buildEventId(authoritativePurchase.event);
    const orderId = createOrderId();
    const orderSeatCount = authoritativePurchase.seats.length;

    // ── 4. Validar inventario + escribir atómicamente con mutex ──
    const tickets = await withTicketsWriteLock(async () => {
      const existingTickets = readTickets();

      // Verificar que los asientos no están ya vendidos
      const conflicts = validateSeatInventory(eventId, authoritativePurchase.seats, existingTickets);
      if (conflicts.length) {
        const labels = conflicts.map(c =>
          `${c.seat.zone} Fila ${c.seat.fila} Asiento ${c.seat.asiento || c.seat.seatInMesa || '?'} (${c.reason})`,
        );
        throw new Error(`Asientos no disponibles: ${labels.join(', ')}. Selecciona otros asientos.`);
      }

      // Verificar límite de boletos por evento (mismo IP o misma sesión)
      const ticketsForEvent = existingTickets.filter(
        t => t.eventId === eventId && t.status === 'active',
      );
      if (ticketsForEvent.length + orderSeatCount > 500) {
        throw new Error('El evento ha alcanzado su capacidad maxima.');
      }

      const newTickets = await Promise.all(
        authoritativePurchase.seats.map(seat =>
          buildTicketRecord({
            orderId,
            event: authoritativePurchase.event,
            seat,
            totalPaid: authoritativePurchase.total,
            paymentMethod: purchase.paymentMethod,
            orderSeatCount,
            publicBaseUrl,
          }),
        ),
      );
      if (TICKETS_WRITE_MODE === 'postgres-primary') {
        await persistTicketPurchaseByWriteMode({
          ticketRecords: newTickets,
          mode: TICKETS_WRITE_MODE,
          saveJsonBackup: () => writeTickets([...existingTickets, ...newTickets]),
          logger: console,
        });
      } else {
        writeTickets([...existingTickets, ...newTickets]);
      }
      return newTickets;
    });

    if (TICKETS_WRITE_MODE === 'dual-write') {
      await writeTicketPurchaseToPostgresIfEnabled({
        ticketRecords: tickets,
        mode: TICKETS_WRITE_MODE,
        logger: console,
      });
    }

    console.log('BoletaMax Tickets: orden creada', {
      orderId,
      eventId,
      seats: orderSeatCount,
      total: authoritativePurchase.total,
      method: purchase.paymentMethod,
    });

    return res.status(201).json({
      ok: true,
      orderId,
      eventId,
      pricing: {
        quoteId: authoritativePurchase.quoteId,
        subtotal: authoritativePurchase.subtotal,
        fee: authoritativePurchase.fee,
        totalPaid: authoritativePurchase.total,
        paymentMethod: purchase.paymentMethod,
        currency: 'MXN',
      },
      security: {
        serverPriced: true,
        serverValidated: true,
        inventoryChecked: true,
        cloudflare: turnstileResult.mode,
      },
      tickets: tickets.map(t => ({
        ...serializeTicketPublic(t),
        token: t.token, // Retornamos el token criptográfico privado ÚNICAMENTE al comprador original en la respuesta del checkout
      })),
    });
  } catch (error) {
    const isClientError = /Cotizacion|cotizacion|asientos|Evento|Zona|expir|disponible|invalida|requerido|maximo|metodo/i.test(error?.message || '');
    console.error('BoletaMax Tickets: error al generar boletos', {
      message: error?.message || 'Error desconocido',
    });
    return res.status(isClientError ? 400 : 500).json({
      ok: false,
      message: isClientError
        ? error.message
        : 'No fue posible generar los boletos en este momento.',
    });
  }
});

app.get('/api/tickets', ticketQueryLimiter, async (req, res) => {
  return res.status(410).json({
    ok: false,
    message: 'Este endpoint requiere autenticacion privada. Usa POST /api/tickets/private.',
  });
});

app.get('/api/public/tickets/:ticketId', ticketQueryLimiter, async (req, res) => {
  const ticketId = String(req.params.ticketId || '').trim();
  if (!ticketId) {
    return res.status(400).json({
      ok: false,
      message: 'ticketId requerido.',
    });
  }

  try {
    const ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });

    if (!ticket) {
      return res.status(404).json({
        ok: false,
        message: 'Boleto no encontrado.',
      });
    }

    return res.json({
      ok: true,
      ticket: serializeTicketPublicView(ticket),
    });
  } catch (error) {
    console.error('BoletaMax Tickets: storage read failed', {
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los boletos en este momento.',
    });
  }
});

app.post('/api/tickets/private', ticketQueryLimiter, async (req, res) => {
  const requestedTickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
  const ticketRequests = requestedTickets
    .map(item => ({
      ticketId: String(item?.ticketId || '').trim(),
      token: String(item?.token || '').trim(),
    }))
    .filter(item => item.ticketId && item.token)
    .slice(0, 50);

  if (!ticketRequests.length) {
    return res.status(400).json({
      ok: false,
      message: 'Debes enviar al menos un ticketId con token.',
    });
  }

  const ids = [...new Set(ticketRequests.map(item => item.ticketId))];

  try {
    const tickets = await getTicketsByIdsFromStorage({
      ids,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });
    const ticketsById = new Map(tickets.map(ticket => [ticket.ticketId, ticket]));
    const validTickets = [];
    const returnedIds = new Set();

    for (const request of ticketRequests) {
      const ticket = ticketsById.get(request.ticketId);
      if (!ticket || returnedIds.has(request.ticketId)) continue;
      if (!verifyTicketPrivateToken(ticket, request.token)) continue;
      validTickets.push(serializeTicketPublic(ticket));
      returnedIds.add(request.ticketId);
    }

    return res.json({
      ok: true,
      tickets: validTickets,
    });
  } catch (error) {
    console.error('BoletaMax Tickets: private storage read failed', {
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los boletos en este momento.',
    });
  }
});

app.get('/api/tickets/:ticketId/dynamic-qr', ticketQueryLimiter, async (req, res) => {
  const ticketId = String(req.params.ticketId || '').trim();
  const token = String(req.headers['x-ticket-token'] || '').trim();
  console.log('BoletaMax QR: request', { ticketId });

  let ticket = null;
  try {
    ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });
  } catch (error) {
    console.error('BoletaMax QR: storage read failed', {
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No se pudo consultar el boleto en este momento.',
    });
  }

  if (!ticket) {
    console.warn('BoletaMax QR: ticket not found', { ticketId });
    return res.status(404).json({
      ok: false,
      message: 'Boleto no encontrado.',
    });
  }

  if (!verifyTicketPrivateToken(ticket, token)) {
    console.warn('BoletaMax QR: unauthorized access attempt', { ticketId });
    return res.status(403).json({
      ok: false,
      message: 'Acceso no autorizado al código de entrada.',
    });
  }

  if (ticket.status !== 'active' || ticket.usedAt) {
    const reason = ticket.status === 'used' || ticket.usedAt ? 'boleto ya utilizado' : 'boleto no disponible';
    console.log('BoletaMax QR: unavailable', {
      ticketId,
      status: ticket.status,
      usedAt: ticket.usedAt,
      reason,
    });
    return res.json({
      ok: true,
      active: false,
      ticket: serializeTicketPublic(ticket),
      message: reason,
    });
  }

  try {
    const dynamicQr = await buildDynamicQrResponse(ticket);
    console.log('BoletaMax QR: generated', {
      ticketId,
      status: ticket.status,
      window: dynamicQr.window,
    });

    return res.json({
      ok: true,
      active: true,
      ticket: serializeTicketPublic(ticket),
      ...dynamicQr,
    });
  } catch (error) {
    console.error('BoletaMax QR: generation failed', {
      ticketId,
      status: ticket.status,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No se pudo generar el QR dinámico.',
    });
  }
});

app.get('/api/tickets/:ticketId', ticketQueryLimiter, async (req, res) => {
  const ticketId = String(req.params.ticketId || '').trim();
  const token = String(req.headers['x-ticket-token'] || '').trim();

  try {
    const ticket = await getTicketByIdFromStorage({
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      readJsonTickets: readTickets,
      logger: console,
    });

    if (!ticket) {
      return res.status(404).json({
        ok: false,
        message: 'Boleto no encontrado.',
      });
    }

    if (!verifyTicketPrivateToken(ticket, token)) {
      console.warn('BoletaMax Tickets: unauthorized private detail access attempt', { ticketId });
      return res.status(403).json({
        ok: false,
        message: 'Acceso no autorizado al detalle del boleto.',
      });
    }

    return res.json({
      ok: true,
      ticket: serializeTicketPublic(ticket),
    });
  } catch (error) {
    console.error('BoletaMax Tickets: storage read failed', {
      ticketId,
      mode: TICKETS_STORAGE_MODE,
      message: error?.message || 'Error desconocido',
    });
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el boleto en este momento.',
    });
  }
});

app.post('/api/validate-ticket', validationLimiter, requireAdminAuth, async (req, res) => {
  const ticketId = String(req.body?.ticketId || '').trim();
  const eventId = String(req.body?.eventId || '').trim();
  const token = String(req.body?.token || '').trim();
  const dynamicToken = String(req.body?.dynamicToken || '').trim();
  const requestedWindow = Number(req.body?.window);
  if (!ticketId) {
    return res.json({
      valid: false,
      message: 'Boleto inválido',
    });
  }

  let result;
  try {
    result = await withTicketValidationLock(ticketId, async () => {
      const ticket = await getTicketByIdFromStorage({
        ticketId,
        mode: TICKETS_STORAGE_MODE,
        readJsonTickets: readTickets,
        logger: console,
      });

      if (!ticket) {
        return {
          valid: false,
          message: 'Boleto inválido',
        };
      }

      if (eventId && ticket.eventId !== eventId) {
        return {
          valid: false,
          message: 'Boleto inválido',
        };
      }

      const hasDynamicPayload = Boolean(dynamicToken) || Number.isFinite(requestedWindow);
      if (hasDynamicPayload) {
        if (!dynamicToken || !Number.isFinite(requestedWindow)) {
          return {
            valid: false,
            message: 'QR inválido o expirado',
          };
        }

        const currentWindow = getDynamicQrWindow();
        const candidateWindows = new Set([
          currentWindow,
          currentWindow - DYNAMIC_QR_TOLERANCE_WINDOWS,
        ]);

        if (!candidateWindows.has(requestedWindow)) {
          return {
            valid: false,
            message: 'QR inválido o expirado',
          };
        }

        const expectedDynamicToken = createDynamicToken(ticket, requestedWindow);
        if (!safeEqualString(dynamicToken, expectedDynamicToken)) {
          return {
            valid: false,
            message: 'Boleto inválido',
          };
        }
      } else if (token) {
        if (!verifyTicketPrivateToken(ticket, token)) {
          return {
            valid: false,
            message: 'Boleto inválido',
          };
        }
      }
      // Sin token ni QR dinámico: validación manual por ticketId. Se permite
      // porque este endpoint ya exige la clave de staff (requireAdminAuth) y
      // es el flujo real al escanear el QR público del boleto (una URL con el
      // ticketId). El QR dinámico sigue siendo la vía con mayor garantía.

      if (ticket.status === 'used' || ticket.usedAt) {
        return {
          valid: false,
          message: 'Boleto ya utilizado',
          usedAt: ticket.usedAt || null,
          ticket: serializeTicketPublic(ticket),
        };
      }

      if (ticket.status === 'cancelled') {
        return {
          valid: false,
          message: 'Boleto cancelado',
          ticket: serializeTicketPublic(ticket),
        };
      }

      if (ticket.status !== 'active') {
        return {
          valid: false,
          message: 'Boleto inválido',
          ticket: serializeTicketPublic(ticket),
        };
      }

      const usedAt = new Date().toISOString();
      const markResult = await markTicketUsedInStorage({
        ticket,
        ticketId,
        mode: TICKETS_STORAGE_MODE,
        usedAt,
        readJsonTickets: readTickets,
        writeJsonTickets: writeTickets,
        logger: console,
      });

      if (!markResult.updated) {
        const latestTicket = markResult.ticket || ticket;
        if (markResult.reason === 'already_used') {
          return {
            valid: false,
            message: 'Boleto ya utilizado',
            usedAt: latestTicket.usedAt || null,
            ticket: serializeTicketPublic(latestTicket),
          };
        }

        if (markResult.reason === 'cancelled') {
          return {
            valid: false,
            message: 'Boleto cancelado',
            ticket: serializeTicketPublic(latestTicket),
          };
        }

        return {
          valid: false,
          message: 'Boleto inválido',
          ticket: serializeTicketPublic(latestTicket),
        };
      }

      return {
        valid: true,
        message: 'Boleto válido',
        usedAt,
        ticket: serializeTicketPublic(markResult.ticket),
      };
    });
  } catch (error) {
    console.error('BoletaMax Validate: storage update failed', {
      mode: TICKETS_STORAGE_MODE,
      message: 'Ticket validation storage operation failed.',
    });
    return res.status(500).json({
      valid: false,
      message: 'No fue posible validar el boleto en este momento.',
    });
  }

  return res.json(result);
});

app.get('/ticket', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'ticket.html'));
});

app.get('/tickets/:ticketId', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'ticket-public.html'));
});

app.get('/admin/scan', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'validate.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BoletaMax running at http://localhost:${PORT}`);
  console.log(`BoletaMax AI debug: OPENAI_API_KEY ${hasOpenAIKey ? 'detectada' : 'ausente'}`);
  console.log(hasOpenAIKey ? 'BoletaMax AI: OpenAI habilitado' : 'BoletaMax AI: usando fallback local');
  console.log(`BoletaMax Security: ADMIN_API_KEY ${ADMIN_API_KEY ? 'configurada' : 'NO configurada (admin sin protección)'}`);
  console.log(`BoletaMax Security: Turnstile ${TURNSTILE_ENABLED ? 'activo' : 'desactivado'}`);
  console.log('BoletaMax Security: Rate limiting activo en todos los endpoints API');
  console.log('BoletaMax Security: Archivos sensibles bloqueados (.env, server.mjs, tickets.json)');
});
