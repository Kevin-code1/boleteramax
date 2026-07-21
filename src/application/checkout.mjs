import {
  buildCheckoutQuote,
  buildOrderPricingCents,
  findSeatConflicts,
  getAuthoritativePurchase,
  getVenueCapacity,
  sanitizePurchasePayload,
  validatePurchaseRequest,
} from '../domain/pricing.mjs';
import { resolvePurchaseBuyer } from '../domain/buyer.mjs';
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
      userId: userId || null,
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

  async function purchase(rawBody, { publicBaseUrl, requestContext, user = null }) {
    const purchaseRequest = sanitizePurchasePayload(rawBody);

    const catalogEvent = catalog.findCatalogEvent(purchaseRequest.event);
    const { buyer, errors: buyerErrors } = resolvePurchaseBuyer({
      sessionUser: user,
      requestBuyer: purchaseRequest.buyer,
    });
    const validationErrors = [
      ...validatePurchaseRequest(purchaseRequest, catalogEvent),
      ...buyerErrors,
    ];
    if (validationErrors.length) {
      console.warn('BoletaMax Tickets: validation failed', { errors: validationErrors });
      return { outcome: 'invalid', errors: validationErrors };
    }

    const turnstileResult = await captcha.verifyToken(requestContext, purchaseRequest.turnstileToken);
    if (!turnstileResult.ok) {
      console.warn('BoletaMax Cloudflare: request rejected', {
        reason: turnstileResult.reason,
      });
      return { outcome: 'captcha_rejected' };
    }

    const authoritativePurchase = getAuthoritativePurchase(purchaseRequest);
    const eventId = buildEventId(authoritativePurchase.event);
    const orderId = createOrderId();
    const orderSeatCount = authoritativePurchase.seats.length;

    const order = {
      orderId,
      quoteId: authoritativePurchase.quoteId,
      buyer,
      paymentMethod: purchaseRequest.paymentMethod,
      pricing: buildOrderPricingCents(authoritativePurchase, purchaseRequest.paymentMethod),
      event: {
        eventId,
        name: authoritativePurchase.event.name,
        date: authoritativePurchase.event.date,
        venue: authoritativePurchase.event.venue,
      },
      orderSeatCount,
    };

    const tickets = await ticketStore.withWriteLock(async () => {
      const soldSeatKeys = await ticketStore.getSoldSeatKeys(eventId);

      const conflicts = findSeatConflicts(authoritativePurchase.seats, soldSeatKeys);
      if (conflicts.length) {
        const labels = conflicts.map(c =>
          `${c.seat.zone} Fila ${c.seat.fila} Asiento ${c.seat.asiento || c.seat.seatInMesa || '?'} (${c.reason})`,
        );
        throw new Error(`Asientos no disponibles: ${labels.join(', ')}. Selecciona otros asientos.`);
      }

      const venueCapacity = getVenueCapacity(authoritativePurchase.event?.venueKey);
      if (soldSeatKeys.size + orderSeatCount > venueCapacity) {
        throw new Error('El evento ha alcanzado su capacidad maxima.');
      }

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
            userId: buyer.userId,
          }),
        ),
      );
      await ticketStore.saveNewTickets({ existingTickets, newTickets, order });
      return newTickets;
    });

    await ticketStore.syncDualWrite(tickets, order);

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
          token: t.token,
        })),
      },
    };
  }

  return { quote, purchase };
}
