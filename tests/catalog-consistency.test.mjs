import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const events = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'events.json'), 'utf8'));

const CARD_PATTERN = /openTicketModal\('([^']+)','([^']+)','([^']+)','([^']+)','([^']+)'\)/g;

function extractCards() {
  const cards = new Map();
  const duplicates = [];

  for (const match of indexHtml.matchAll(CARD_PATTERN)) {
    const card = {
      name: match[1],
      date: match[2],
      venue: match[3],
      price: Number(match[4].replace(/[^0-9]/g, '')),
      venueType: match[5],
    };

    const existing = cards.get(card.name);
    if (existing) {
      duplicates.push({ existing, card });
    } else {
      cards.set(card.name, card);
    }
  }

  return { cards, duplicates };
}

test('las apariciones repetidas de un evento en index.html usan los mismos datos', () => {
  const { duplicates } = extractCards();

  for (const { existing, card } of duplicates) {
    assert.deepEqual(
      card,
      existing,
      `El evento "${card.name}" aparece varias veces en index.html con datos distintos.`,
    );
  }
});

test('cada tarjeta de index.html coincide con su evento en events.json', () => {
  const { cards } = extractCards();
  assert.ok(cards.size > 0, 'index.html debe contener tarjetas de eventos.');

  for (const card of cards.values()) {
    const event = events.find(item => item.name === card.name);
    assert.ok(event, `La tarjeta "${card.name}" no existe en data/events.json.`);
    assert.equal(card.date, event.date, `Fecha distinta para "${card.name}".`);
    assert.equal(card.venue, event.venue, `Venue distinto para "${card.name}".`);
    assert.equal(card.price, event.price, `Precio distinto para "${card.name}".`);
    assert.equal(card.venueType, event.venueType, `venueType distinto para "${card.name}".`);
  }
});

test('cada evento disponible del catálogo tiene tarjeta en index.html', () => {
  const { cards } = extractCards();

  for (const event of events) {
    if (event.available === false) continue;
    assert.ok(
      cards.has(event.name),
      `El evento disponible "${event.name}" no tiene tarjeta en index.html.`,
    );
  }
});
