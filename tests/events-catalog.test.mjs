import test from 'node:test';
import assert from 'node:assert/strict';

// Evitar el fail-fast de postgres-primary al importar src/config
// en entornos sin DATABASE_URL.
process.env.TICKETS_STORAGE = 'json';
process.env.TICKETS_WRITE_MODE = 'json';

const { createEventsCatalog } = await import('../src/adapters/catalog/events-catalog.mjs');
const { findCatalogEvent } = createEventsCatalog();

test('unknown event name without date/venue does not match the catalog', () => {
  const match = findCatalogEvent({ name: 'Evento Que No Existe' });
  assert.equal(match, null);
});

test('unknown event name with empty date/venue strings does not match', () => {
  const match = findCatalogEvent({ name: 'Otro Evento Falso', date: '', venue: '  ' });
  assert.equal(match, null);
});

test('exact event name alone matches its catalog entry', () => {
  const match = findCatalogEvent({ name: 'Gran Festival de Banda' });
  assert.equal(match?.name, 'Gran Festival de Banda');
});

test('event name matches ignoring accents and case', () => {
  const match = findCatalogEvent({ name: 'el fantasma de la opera' });
  assert.equal(match?.name, 'El Fantasma de la Ópera');
});

test('name + date + venue matches the right event (checkout flow shape)', () => {
  const match = findCatalogEvent({
    name: 'Comedy Night Puebla',
    date: '18 Junio 2025',
    venue: 'Auditorio Puebla',
  });
  assert.equal(match?.name, 'Comedy Night Puebla');
});

test('venue + date still identify an event when the name has a typo', () => {
  const match = findCatalogEvent({
    name: 'Comedy Nigth Pueblaa',
    date: '18 Junio 2025',
    venue: 'Auditorio Puebla',
  });
  assert.equal(match?.name, 'Comedy Night Puebla');
});

test('wrong name with only a venue does not match by venue alone', () => {
  const match = findCatalogEvent({ name: 'Evento Falso', venue: 'Auditorio Puebla' });
  assert.equal(match, null);
});
