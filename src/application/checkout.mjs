import {
  buildCheckoutQuote,
  getAuthoritativePurchase,
  sanitizePurchasePayload,
  validatePurchaseRequest,
  validateSeatInventory,
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
  async function buildTicketRecord({ orderId, event, seat, totalPaid, paymentMethod, orderSeatCount, publicBaseUrl }) {
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

  async function purchase(rawBody, { publicBaseUrl, requestContext }) {
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
      const existingTickets = ticketStore.readTickets();

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
            paymentMethod: purchaseRequest.paymentMethod,
            orderSeatCount,
            publicBaseUrl,
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
          token: t.token, // Retornamos el token criptográfico privado ÚNICAMENTE al comprador original en la respuesta del checkout
        })),
      },
    };
  }

  return { quote, purchase };
}
