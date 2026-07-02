import fs from 'fs';
import { EVENTS_PATH } from './config.mjs';
import { textValuesMatch } from './text.mjs';

export const eventsCatalog = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));

export function uniqueCities(events = eventsCatalog) {
  return [...new Set(events.map(event => event.city))];
}

export function findCatalogEvent(event = {}) {
  const eventVenue = String(event.venue || '').trim();
  const eventDate = String(event.date || '').trim();

  return eventsCatalog.find(item => {
    const nameMatches = textValuesMatch(item.name, event.name);
    const venueMatches = !eventVenue || textValuesMatch(item.venue, eventVenue);
    const dateMatches = !eventDate || textValuesMatch(item.date, eventDate);
    // El par venue+fecha solo identifica al evento si ambos vienen en el request;
    // sin ellos, un nombre desconocido coincidiría con el primer evento del catálogo.
    const venueAndDateIdentify = Boolean(eventVenue) && Boolean(eventDate) && venueMatches && dateMatches;
    return (nameMatches && venueMatches) || (nameMatches && dateMatches) || venueAndDateIdentify;
  }) || null;
}
