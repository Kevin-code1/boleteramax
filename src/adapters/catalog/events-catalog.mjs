import fs from 'fs';
import { EVENTS_PATH } from '../../config/index.mjs';
import { textValuesMatch } from '../../domain/text.mjs';

export function findCatalogEventIn(eventsCatalog = [], event = {}) {
  const eventVenue = String(event.venue || '').trim();
  const eventDate = String(event.date || '').trim();

  return eventsCatalog.find(item => {
    const nameMatches = textValuesMatch(item.name, event.name);
    const venueMatches = !eventVenue || textValuesMatch(item.venue, eventVenue);
    const dateMatches = !eventDate || textValuesMatch(item.date, eventDate);
    const venueAndDateIdentify = Boolean(eventVenue) && Boolean(eventDate) && venueMatches && dateMatches;
    return (nameMatches && venueMatches) || (nameMatches && dateMatches) || venueAndDateIdentify;
  }) || null;
}

export function createEventsCatalog({ eventsPath = EVENTS_PATH } = {}) {
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

  return {
    events,
    uniqueCities: () => [...new Set(events.map(event => event.city))],
    findCatalogEvent: event => findCatalogEventIn(events, event),
  };
}
