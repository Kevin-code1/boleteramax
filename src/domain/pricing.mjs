import { createHmac, randomBytes } from 'crypto';
import {
  CHECKOUT_QUOTE_TTL_MS,
  CHECKOUT_SIGNING_SECRET,
  MAX_TICKETS_PER_EVENT,
  OXXO_FEE,
  PAYMENT_METHODS,
  SERVICE_FEE_RATE,
  SPEI_DISCOUNT_RATE,
} from '../config/index.mjs';
import { normalizeZoneLabel, safeEqualString, textValuesMatch } from './text.mjs';

export const SERVER_EVENT_VENUE_MAP = {
  'Gran Festival de Banda': 'palenque',
  'El Fantasma de la Ópera': 'teatro',
  'Noche Urbana GDL': 'festival',
  'Feria del Estado CHH': 'palenque',
  'Comedy Night Puebla': 'teatro',
  'Lucha Libre CMLL': 'arena',
  'Noche de Rock Épica 2025': 'estadio',
  'Festival SolMaX 2025': 'festival',
  'Festival SolMaX': 'festival',
};

export const SERVER_VENUE_PRICING = {
  palenque: {
    zones: [
      { key: 'fan', label: 'FAN', priceBase: 1700 },
      { key: 'vip5', label: 'VIP', priceBase: 1150 },
      { key: 'oro5', label: 'ORO 5', priceBase: 1000 },
      { key: 'oro', label: 'ORO', priceBase: 750 },
      { key: 'gen', label: 'GENERAL', priceBase: 480 },
    ],
  },
  arena: {
    zones: [
      { key: 'fan', label: 'RINGSIDE', priceBase: 2000 },
      { key: 'vip5', label: 'VIP', priceBase: 1400 },
      { key: 'oro5', label: 'PLATINO', priceBase: 900 },
      { key: 'oro', label: 'ORO', priceBase: 650 },
      { key: 'gen', label: 'GENERAL', priceBase: 350 },
    ],
  },
  teatro: {
    zones: [
      { key: 'fan', label: 'ORQUESTA', priceBase: 1800 },
      { key: 'vip5', label: 'LUNETA', priceBase: 1100 },
      { key: 'oro5', label: 'MEZZANINE', priceBase: 800 },
      { key: 'oro', label: 'PALCO', priceBase: 600 },
      { key: 'gen', label: 'GALERÍA', priceBase: 380 },
    ],
  },
  estadio: {
    zones: [
      { key: 'fan', label: 'FAN PIT', priceBase: 1900 },
      { key: 'vip5', label: 'VIP', priceBase: 1450 },
      { key: 'oro5', label: 'PREFERENTE', priceBase: 980 },
      { key: 'oro', label: 'PLATEA', priceBase: 720 },
      { key: 'gen', label: 'GRADA', priceBase: 520 },
    ],
  },
  festival: {
    zones: [
      { key: 'fan', label: 'FRONT STAGE', priceBase: 1600 },
      { key: 'vip5', label: 'VIP DECK', priceBase: 1180 },
      { key: 'oro5', label: 'PREFERENTE', priceBase: 900 },
      { key: 'oro', label: 'GENERAL A', priceBase: 650 },
      { key: 'gen', label: 'GENERAL B', priceBase: 430 },
    ],
  },
};

export function getMappedVenueKey(name = '') {
  const entry = Object.entries(SERVER_EVENT_VENUE_MAP).find(([eventName]) => textValuesMatch(eventName, name));
  return entry?.[1] || null;
}

export function resolveVenuePricingKey(event = {}, catalogEvent = null) {
  return (
    getMappedVenueKey(event.name) ||
    getMappedVenueKey(catalogEvent?.name) ||
    catalogEvent?.venueType ||
    'palenque'
  );
}

export function findPricingZone(venueKey, seat = {}) {
  const pricing = SERVER_VENUE_PRICING[venueKey];
  if (!pricing) return null;

  const zoneLabel = normalizeZoneLabel(seat.zone || seat.zoneLabel || '');
  const exactZone = pricing.zones.find(zone =>
    normalizeZoneLabel(zone.label) === zoneLabel ||
    normalizeZoneLabel(zone.key) === zoneLabel,
  );

  if (exactZone) return exactZone;
  if (zoneLabel.includes('fan') || zoneLabel.includes('ring') || zoneLabel.includes('orquesta')) return pricing.zones[0];
  if (zoneLabel.includes('vip') || zoneLabel.includes('luneta')) return pricing.zones[1];
  if (zoneLabel.includes('preferente') || zoneLabel.includes('platino') || zoneLabel.includes('mezzanine') || zoneLabel.includes('oro 5')) return pricing.zones[2];
  if (zoneLabel.includes('oro') || zoneLabel.includes('platea') || zoneLabel.includes('palco') || zoneLabel.includes('general a')) return pricing.zones[3];
  if (zoneLabel.includes('general') || zoneLabel.includes('grada') || zoneLabel.includes('galeria')) return pricing.zones[4];

  return null;
}

export function calculateSeatPrice(basePrice, venueKey, seat = {}) {
  const pricing = SERVER_VENUE_PRICING[venueKey];
  const zone = findPricingZone(venueKey, seat);
  if (!pricing || !zone) return null;

  const lowestZone = pricing.zones[pricing.zones.length - 1];
  const ratio = zone.priceBase / lowestZone.priceBase;
  return Math.round(basePrice * ratio);
}

export function sanitizeSeatForQuote(seat = {}, index, basePrice, venueKey) {
  const expectedPrice = calculateSeatPrice(basePrice, venueKey, seat);
  const pricingZone = findPricingZone(venueKey, seat);

  if (!pricingZone || !Number.isFinite(expectedPrice) || expectedPrice <= 0) {
    throw new Error(`Zona de asiento invalida en la posicion ${index + 1}.`);
  }

  return {
    zone: pricingZone.label,
    fila: String(seat.fila || '').trim() || 'A',
    mesa: Number.isFinite(Number(seat.mesa)) ? Number(seat.mesa) : null,
    asiento: Number.isFinite(Number(seat.asiento)) ? Number(seat.asiento) : index + 1,
    seatInMesa: Number.isFinite(Number(seat.seatInMesa)) ? Number(seat.seatInMesa) : null,
    tableSize: Number.isFinite(Number(seat.tableSize)) ? Number(seat.tableSize) : 1,
    price: expectedPrice,
    serverPriced: true,
  };
}

export function buildSeatKey(seat = {}) {
  const zone = normalizeZoneLabel(seat.zone || seat.zoneLabel || '');
  const fila = String(seat.fila || 'A').trim().toUpperCase();
  if (seat.tableSize > 1 && seat.mesa) {
    return `${zone}|${fila}|M${seat.mesa}|L${seat.seatInMesa || 1}`;
  }
  return `${zone}|${fila}|A${seat.asiento || 1}`;
}

// active y used ocupan el asiento; los demás estados lo liberan.
const SEAT_BLOCKING_STATUSES = new Set(['active', 'used']);

export function getSoldSeatsForEvent(eventId, existingTickets) {
  const sold = new Set();
  for (const ticket of existingTickets) {
    if (ticket.eventId === eventId && SEAT_BLOCKING_STATUSES.has(ticket.status)) {
      sold.add(buildSeatKey(ticket.seat));
    }
  }
  return sold;
}

export function validateSeatInventory(eventId, seats, existingTickets) {
  return findSeatConflicts(seats, getSoldSeatsForEvent(eventId, existingTickets));
}

// Conflictos contra un set de llaves vendidas.
export function findSeatConflicts(seats, soldSeats) {
  const conflicts = [];
  const seenInOrder = new Set();

  for (let i = 0; i < seats.length; i++) {
    const key = buildSeatKey(seats[i]);

    // Verificar duplicados dentro de la misma orden
    if (seenInOrder.has(key)) {
      conflicts.push({ index: i, seat: seats[i], reason: 'duplicado en la misma orden' });
      continue;
    }
    seenInOrder.add(key);

    // Verificar contra inventario existente
    if (soldSeats.has(key)) {
      conflicts.push({ index: i, seat: seats[i], reason: 'ya vendido' });
    }
  }

  return conflicts;
}

export function validatePurchaseRequest(purchase, catalogEvent) {
  const errors = [];

  // 1. Evento debe existir en el catálogo
  if (!catalogEvent) {
    errors.push('El evento solicitado no existe en nuestro catalogo.');
  } else if (catalogEvent.available === false) {
    errors.push('El evento ya no tiene boletos disponibles.');
  } else if (!Number.isFinite(Number(catalogEvent.price))) {
    errors.push('El evento no tiene un precio valido configurado.');
  }

  // 2. Validar cantidad de asientos
  if (!Array.isArray(purchase.seats) || purchase.seats.length === 0) {
    errors.push('Debes seleccionar al menos un asiento.');
  } else if (purchase.seats.length > MAX_TICKETS_PER_EVENT) {
    errors.push(`Maximo ${MAX_TICKETS_PER_EVENT} boletos por compra.`);
  }

  // 3. Nombre de evento requerido
  if (!purchase.event?.name?.trim()) {
    errors.push('El nombre del evento es requerido.');
  }

  // 4. Método de pago válido
  if (!PAYMENT_METHODS.has(purchase.paymentMethod)) {
    errors.push('Metodo de pago no valido.');
  }

  return errors;
}

export function buildCheckoutQuote({ event, seats, catalogEvent, now = Date.now() }) {
  if (!catalogEvent || catalogEvent.available === false || !Number.isFinite(Number(catalogEvent.price))) {
    throw new Error('Evento no disponible para cotizacion segura.');
  }

  if (!Array.isArray(seats) || !seats.length || seats.length > MAX_TICKETS_PER_EVENT) {
    throw new Error(`Seleccion de asientos invalida (maximo ${MAX_TICKETS_PER_EVENT}).`);
  }

  const basePrice = Number(catalogEvent.price);
  const venueKey = resolveVenuePricingKey(event, catalogEvent);
  const pricedSeats = seats.map((seat, index) => sanitizeSeatForQuote(seat, index, basePrice, venueKey));
  const subtotal = pricedSeats.reduce((total, seat) => total + seat.price, 0);
  const fee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + fee;
  const paymentTotals = {
    tarjeta: total,
    spei: Math.round(total * SPEI_DISCOUNT_RATE),
    oxxo: total + OXXO_FEE,
  };

  const quote = {
    version: 1,
    quoteId: `BM-QTE-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHECKOUT_QUOTE_TTL_MS).toISOString(),
    event: {
      name: catalogEvent.name,
      date: catalogEvent.date,
      venue: catalogEvent.venue,
      venueKey,
    },
    seats: pricedSeats,
    subtotal,
    fee,
    total,
    paymentTotals,
    currency: 'MXN',
  };

  return {
    ...quote,
    signature: signCheckoutQuote(quote),
  };
}

export function signCheckoutQuote(quote) {
  return createHmac('sha256', CHECKOUT_SIGNING_SECRET)
    .update(JSON.stringify(quote))
    .digest('hex');
}

export function verifyCheckoutQuote(rawQuote) {
  if (!rawQuote || typeof rawQuote !== 'object') {
    throw new Error('Cotizacion segura faltante.');
  }

  const { signature, ...unsignedQuote } = rawQuote;
  if (!signature || !safeEqualString(signature, signCheckoutQuote(unsignedQuote))) {
    throw new Error('Cotizacion segura invalida o alterada.');
  }

  if (Date.parse(unsignedQuote.expiresAt) <= Date.now()) {
    throw new Error('La cotizacion expiro. Vuelve a seleccionar tus asientos.');
  }

  return rawQuote;
}

export function getAuthoritativePurchase(purchase) {
  if (!purchase.quote) {
    throw new Error('Cotizacion segura obligatoria. El flujo directo sin cotizar no esta permitido.');
  }

  const verifiedQuote = verifyCheckoutQuote(purchase.quote);
  const quoteMethod = PAYMENT_METHODS.has(purchase.paymentMethod) ? purchase.paymentMethod : 'tarjeta';
  return {
    event: verifiedQuote.event,
    seats: verifiedQuote.seats,
    subtotal: verifiedQuote.subtotal,
    fee: verifiedQuote.fee,
    total: verifiedQuote.paymentTotals[quoteMethod],
    paymentTotals: verifiedQuote.paymentTotals,
    quoteId: verifiedQuote.quoteId,
  };
}

// Desglose en centavos desde la cotización firmada.
// Invariante: subtotal + fee - discount = total.
export function buildOrderPricingCents(authoritativePurchase, paymentMethod) {
  const toCents = value => Math.round(Number(value || 0) * 100);

  const subtotalCents = toCents(authoritativePurchase.subtotal);
  const baseFeeCents = toCents(authoritativePurchase.fee);
  // OXXO suma su comisión fija al fee.
  const feeCents = paymentMethod === 'oxxo' ? baseFeeCents + toCents(OXXO_FEE) : baseFeeCents;
  const totalCents = toCents(authoritativePurchase.total);
  // El ahorro SPEI se registra como descuento.
  const discountCents = Math.max(0, subtotalCents + feeCents - totalCents);

  return { subtotalCents, feeCents, discountCents, totalCents, currency: 'MXN' };
}

export function sanitizePurchasePayload(rawBody = {}) {
  const event = rawBody.event && typeof rawBody.event === 'object' ? rawBody.event : {};
  const seats = Array.isArray(rawBody.seats) ? rawBody.seats.filter(Boolean) : [];
  const totalPaid = Number(rawBody.totalPaid);
  const paymentMethod = String(rawBody.paymentMethod || '').trim();

  return {
    event: {
      name: String(event.name || '').trim(),
      date: String(event.date || '').trim(),
      venue: String(event.venue || '').trim(),
    },
    seats,
    totalPaid: Number.isFinite(totalPaid) && totalPaid > 0 ? totalPaid : null,
    paymentMethod: PAYMENT_METHODS.has(paymentMethod) ? paymentMethod : 'tarjeta',
    quote: rawBody.quote && typeof rawBody.quote === 'object' ? rawBody.quote : null,
    turnstileToken: String(rawBody.turnstileToken || '').trim(),
    buyer: rawBody.buyer && typeof rawBody.buyer === 'object' ? rawBody.buyer : null,
  };
}
