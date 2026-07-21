import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

if (!process.env.DATABASE_URL) {
  process.env.TICKETS_STORAGE = process.env.TICKETS_STORAGE || 'json';
  process.env.TICKETS_WRITE_MODE = process.env.TICKETS_WRITE_MODE || 'json';
}

const { buildCheckoutQuote, resolveVenuePricingKey } = await import('../src/domain/pricing.mjs');
const { createCheckout } = await import('../src/application/checkout.mjs');

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seatmapSource = fs.readFileSync(path.join(rootDir, 'js', 'modules', 'seatmap.js'), 'utf8');

function computeRenderedCapacities() {
  const start = seatmapSource.indexOf('const VENUE_CONFIGS');
  const end = seatmapSource.indexOf('/* Correspondencia');
  const block = seatmapSource.slice(start, end);
  const capacities = {};

  for (const venueMatch of block.matchAll(/(\w+):\s*\{[^]*?zones:\s*\[([^]*?)\]\s*,?\s*\}/g)) {
    const [, venueKey, zonesSource] = venueMatch;
    let total = 0;
    for (const zoneMatch of zonesSource.matchAll(/rows:\s*(\d+),\s*rowGap:\s*[\d.]+,\s*nSeats:\s*(\d+)/g)) {
      const rows = Number(zoneMatch[1]);
      const nSeats = Number(zoneMatch[2]);
      for (let row = 0; row < rows; row++) {
        total += nSeats + row * 2;
      }
    }
    capacities[venueKey] = total;
  }

  return capacities;
}

const EXPECTED_CAPACITIES = {
  palenque: 664,
  arena: 602,
  teatro: 508,
  estadio: 508,
  festival: 492,
};

test('el mapa de asientos renderiza la capacidad esperada por venue', () => {
  assert.deepEqual(computeRenderedCapacities(), EXPECTED_CAPACITIES);
});

const CATALOG_EVENT = {
  name: 'Evento Prueba Capacidad',
  date: '1 Enero 2030',
  startsAt: '2030-01-01T20:00:00-06:00',
  venue: 'Palenque Pruebas, Culiacán',
  price: 480,
  available: true,
  venueType: 'palenque',
};

function createCheckoutHarness(soldSeatCount) {
  const soldKeys = new Set(Array.from({ length: soldSeatCount }, (_, i) => `ocupado|${i}`));

  const checkout = createCheckout({
    catalog: { findCatalogEvent: () => CATALOG_EVENT },
    ticketStore: {
      withWriteLock: task => task(),
      getSoldSeatKeys: async () => soldKeys,
      readTickets: () => [],
      saveNewTickets: async () => {},
      syncDualWrite: async () => {},
      serializePublic: ticket => ticket,
    },
    captcha: { verifyToken: async () => ({ ok: true, mode: 'demo' }) },
    qr: { ticketQrDataUrl: async () => 'data:image/png;base64,' },
  });

  const event = {
    name: CATALOG_EVENT.name,
    date: CATALOG_EVENT.date,
    venue: CATALOG_EVENT.venue,
  };
  const seats = [{ zone: 'GENERAL', fila: 'A', asiento: 1, tableSize: 1 }];
  const quote = buildCheckoutQuote({ event, seats, catalogEvent: CATALOG_EVENT });

  return checkout.purchase(
    {
      event,
      seats,
      paymentMethod: 'tarjeta',
      quote,
      buyer: { name: 'Comprador Capacidad', email: 'capacidad@boletamax.test' },
    },
    { publicBaseUrl: 'http://localhost:3000', requestContext: {}, user: null },
  );
}

test('con ocupación baja la compra procede', async () => {
  const result = await createCheckoutHarness(400);
  assert.equal(result.outcome, 'created');
  assert.equal(result.body.tickets.length, 1);
});

test('vender el asiento 501 de un palenque (capacidad 664) debería proceder', async () => {
  const result = await createCheckoutHarness(500);
  assert.equal(result.outcome, 'created');
});

test('vender el último asiento del palenque procede y uno más se rechaza', async () => {
  const lastSeat = await createCheckoutHarness(EXPECTED_CAPACITIES.palenque - 1);
  assert.equal(lastSeat.outcome, 'created');

  await assert.rejects(
    () => createCheckoutHarness(EXPECTED_CAPACITIES.palenque),
    /capacidad maxima/,
  );
});

test('resolveVenuePricingKey deriva el recinto del venueType del catálogo', () => {
  assert.equal(resolveVenuePricingKey({ name: 'Cualquier Nombre' }, { venueType: 'arena' }), 'arena');
  assert.equal(resolveVenuePricingKey({}, { venueType: 'estadio' }), 'estadio');
  assert.equal(resolveVenuePricingKey({}, {}), 'palenque');
});

test('cambiar el nombre del evento no altera el recinto si el venueType es correcto', () => {
  const antes = resolveVenuePricingKey({ name: 'Evento Con Nombre Anterior' }, { name: 'Evento Con Nombre Anterior', venueType: 'festival' });
  const despues = resolveVenuePricingKey({ name: 'Evento Con Nombre Renovado' }, { name: 'Evento Con Nombre Renovado', venueType: 'festival' });
  assert.equal(antes, 'festival');
  assert.equal(despues, 'festival');
});

test('la cotización firmada conserva el venueKey del venueType del catálogo', () => {
  const catalogEvent = {
    name: 'Evento Prueba VenueKey', date: '1 Enero 2030', venue: 'Arena Pruebas, CDMX',
    price: 500, available: true, venueType: 'arena',
  };
  const quote = buildCheckoutQuote({
    event: { name: catalogEvent.name, date: catalogEvent.date, venue: catalogEvent.venue },
    seats: [{ zone: 'GENERAL', fila: 'A', asiento: 1, tableSize: 1 }],
    catalogEvent,
  });
  assert.equal(quote.event.venueKey, 'arena');
});
