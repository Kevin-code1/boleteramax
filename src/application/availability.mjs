import { getSoldSeatsForEvent, resolveVenuePricingKey, SERVER_VENUE_PRICING } from '../domain/pricing.mjs';
import { buildEventId } from '../domain/tickets.mjs';

export function createAvailability({ catalog, ticketStore }) {
  // Disponibilidad por descriptor (name/date/venue).
  function byDescriptor(rawEvent = {}) {
    const event = {
      name: String(rawEvent.name || '').trim(),
      date: String(rawEvent.date || '').trim(),
      venue: String(rawEvent.venue || '').trim(),
    };

    if (!event.name) {
      return { outcome: 'missing_name' };
    }

    const catalogEvent = catalog.findCatalogEvent(event);
    if (!catalogEvent) {
      return { outcome: 'not_found' };
    }

    // Mismo eventId que la cotización (datos del catálogo).
    const eventId = buildEventId({
      name: catalogEvent.name,
      date: catalogEvent.date,
      venue: catalogEvent.venue,
    });
    const venueKey = resolveVenuePricingKey(event, catalogEvent);
    const zoneLabels = Object.fromEntries(
      (SERVER_VENUE_PRICING[venueKey]?.zones || []).map(zone => [zone.key, zone.label]),
    );
    const soldSeats = getSoldSeatsForEvent(eventId, ticketStore.readTickets());

    return {
      outcome: 'ok',
      body: {
        ok: true,
        eventId,
        venueKey,
        zoneLabels,
        totalSold: soldSeats.size,
        soldSeatKeys: [...soldSeats],
      },
    };
  }

  function byEventId(rawEventId) {
    const eventId = String(rawEventId || '').trim();
    if (!eventId) {
      return { outcome: 'missing_id' };
    }

    const existingTickets = ticketStore.readTickets();
    const soldSeats = getSoldSeatsForEvent(eventId, existingTickets);
    const totalSold = soldSeats.size;

    return {
      outcome: 'ok',
      body: {
        ok: true,
        eventId,
        totalSold,
        soldSeatKeys: [...soldSeats],
      },
    };
  }

  return { byDescriptor, byEventId };
}
