import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.DATABASE_URL) {
  process.env.TICKETS_STORAGE = process.env.TICKETS_STORAGE || 'json';
  process.env.TICKETS_WRITE_MODE = process.env.TICKETS_WRITE_MODE || 'json';
}

const { validatePurchaseRequest } = await import('../src/domain/pricing.mjs');

function buildPurchase() {
  return {
    event: { name: 'Evento Prueba Fechas', date: '15 Marzo 2020', venue: 'Foro Pruebas, CDMX' },
    seats: [{ zone: 'GENERAL', fila: 'A', asiento: 1 }],
    paymentMethod: 'tarjeta',
  };
}

function buildCatalogEvent(startsAt) {
  return {
    name: 'Evento Prueba Fechas',
    date: '15 Marzo 2020',
    venue: 'Foro Pruebas, CDMX',
    price: 850,
    available: true,
    venueType: 'estadio',
    startsAt,
  };
}

test('un evento con startsAt futuro pasa la validación de compra', () => {
  const errors = validatePurchaseRequest(
    buildPurchase(),
    buildCatalogEvent('2030-01-01T20:00:00.000Z'),
  );
  assert.deepEqual(errors, []);
});

test('un evento con startsAt en el pasado debe rechazarse', () => {
  const errors = validatePurchaseRequest(
    buildPurchase(),
    buildCatalogEvent('2020-03-15T20:00:00.000Z'),
  );
  assert.ok(
    errors.includes('El evento ya se realizó.'),
    'validatePurchaseRequest debe rechazar eventos cuya fecha startsAt ya pasó',
  );
});

test('un evento sin startsAt o con startsAt inválido se rechaza', () => {
  const sinFecha = validatePurchaseRequest(buildPurchase(), buildCatalogEvent(undefined));
  assert.ok(
    sinFecha.includes('La fecha del evento no está disponible.'),
    'un catalogEvent sin startsAt debe rechazarse',
  );

  const fechaInvalida = validatePurchaseRequest(buildPurchase(), buildCatalogEvent('no-es-una-fecha'));
  assert.ok(
    fechaInvalida.includes('La fecha del evento no está disponible.'),
    'un startsAt no parseable debe rechazarse',
  );
});
