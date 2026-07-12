import {
  buildCheckoutQuote,
  findSeatConflicts,
  getAuthoritativePurchase,
  sanitizePurchasePayload,
  validatePurchaseRequest,
} from '../domain/pricing.mjs';
import {
  buildEventId,
  buildPublicTicketPath,
  buildPublicTicketUrl,
  buildSeatLabel,
  createOrderId,
  createTicketId,
  createTicketToken,
} from '../domain/tickets.mjs';

export function createCheckout({ catalog, ticketStore, captcha, qr }) {
  async function buildTicketRecord({ orderId, event, seat, totalPaid, paymentMethod, orderSeatCount, publicBaseUrl, userId }) {
    const eventId = buildEventId(event);
    const ticketId = createTicketId();
    const token = createTicketToken();
    const publicPath = buildPublicTicketPath(ticketId);
    const publicUrl = buildPublicTicketUrl(publicBaseUrl, ticketId);
    const qrPayload = publicUrl;

    return {
      ticketId,
      orderId,
      token,
      eventId,
      eventName: event.name || 'Evento',
      date: event.date || 'Por confirmar',
      venue: event.venue || 'Por confirmar',
      zone: seat.zone || 'Zona',
      seatLabel: buildSeatLabel(seat),
      seat,
      totalPaid,
      paymentMethod,
      orderSeatCount,
      status: 'active',
      validationCount: 0,
      userId: userId || null, // dueño de la compra; null = invitado
      publicPath,
      publicUrl,
      createdAt: new Date().toISOString(),
      usedAt: null,
      cancelledAt: null,
      qrPayload,
      qrDataUrl: await qr.ticketQrDataUrl(qrPayload),
    };
  }

  function quote(rawBody) {
    const purchase = sanitizePurchasePayload(rawBody);

    // ── Validación server-side del evento ──
    const catalogEvent = catalog.findCatalogEvent(purchase.event);
    const validationErrors = validatePurchaseRequest(purchase, catalogEvent);
    if (validationErrors.length) {
      return { outcome: 'invalid', errors: validationErrors };
    }

    const checkoutQuote = buildCheckoutQuote({
      event: purchase.event,
      seats: purchase.seats,
      catalogEvent,
    });

    return { outcome: 'ok', quote: checkoutQuote };
  }

  async function purchase(rawBody, { publicBaseUrl, requestContext, userId = null }) {
    const purchaseRequest = sanitizePurchasePayload(rawBody);

    // ── 1. Validar estructura del request ──
    const catalogEvent = catalog.findCatalogEvent(purchaseRequest.event);
    const validationErrors = validatePurchaseRequest(purchaseRequest, catalogEvent);
    if (validationErrors.length) {
      console.warn('BoletaMax Tickets: validation failed', { errors: validationErrors });
      return { outcome: 'invalid', errors: validationErrors };
    }

    // ── 2. Verificar protección Cloudflare ──
    const turnstileResult = await captcha.verifyToken(requestContext, purchaseRequest.turnstileToken);
    if (!turnstileResult.ok) {
      console.warn('BoletaMax Cloudflare: request rejected', {
        reason: turnstileResult.reason,
      });
      return { outcome: 'captcha_rejected' };
    }

    // ── 3. Precios autoritativos del servidor ──
    const authoritativePurchase = getAuthoritativePurchase(purchaseRequest);
    const eventId = buildEventId(authoritativePurchase.event);
    const orderId = createOrderId();
    const orderSeatCount = authoritativePurchase.seats.length;

    // ── 4. Validar inventario + escribir atómicamente con mutex ──
    const tickets = await ticketStore.withWriteLock(async () => {
      // Asientos vendidos desde la fuente de verdad del modo configurado
      // (PostgreSQL en postgres/postgres-primary, JSON en modo json).
      const soldSeatKeys = await ticketStore.getSoldSeatKeys(eventId);

      const conflicts = findSeatConflicts(authoritativePurchase.seats, soldSeatKeys);
      if (conflicts.length) {
        const labels = conflicts.map(c =>
          `${c.seat.zone} Fila ${c.seat.fila} Asiento ${c.seat.asiento || c.seat.seatInMesa || '?'} (${c.reason})`,
        );
        throw new Error(`Asientos no disponibles: ${labels.join(', ')}. Selecciona otros asientos.`);
      }

      // Límite global de asientos ocupados por evento.
      if (soldSeatKeys.size + orderSeatCount > 500) {
        throw new Error('El evento ha alcanzado su capacidad maxima.');
      }

      // El JSON solo se lee aquí para conservar el respaldo local completo.
      const existingTickets = ticketStore.readTickets();

      const newTickets = await Promise.all(
        authoritativePurchase.seats.map(seat =>
          buildTicketRecord({
            orderId,
            event: authoritativePurchase.event,
            seat,
            totalPaid: authoritativePurchase.total,
            paymentMethod: purchaseRequest.paymentMethod,
            orderSeatCount,
            publicBaseUrl,
            userId,
          }),
        ),
      );
      await ticketStore.saveNewTickets({ existingTickets, newTickets });
      return newTickets;
    });

    await ticketStore.syncDualWrite(tickets);

    console.log('BoletaMax Tickets: orden creada', {
      orderId,
      eventId,
      seats: orderSeatCount,
      total: authoritativePurchase.total,
      method: purchaseRequest.paymentMethod,
    });

    return {
      outcome: 'created',
      body: {
        ok: true,
        orderId,
        eventId,
        pricing: {
          quoteId: authoritativePurchase.quoteId,
          subtotal: authoritativePurchase.subtotal,
          fee: authoritativePurchase.fee,
          totalPaid: authoritativePurchase.total,
          paymentMethod: purchaseRequest.paymentMethod,
          currency: 'MXN',
        },
        security: {
          serverPriced: true,
          serverValidated: true,
          inventoryChecked: true,
          cloudflare: turnstileResult.mode,
        },
        tickets: tickets.map(t => ({
          ...ticketStore.serializePublic(t),
          token: t.token, // token privado, solo al comprador
        })),
      },
    };
  }

  return { quote, purchase };
}
