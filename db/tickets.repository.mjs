import { createHash } from 'crypto';
import { query, withTransaction } from './pool.mjs';

const SYSTEM_BUYER_DOMAIN = 'boletamax.local';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function slugify(value = '', fallback = 'imported') {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || fallback;
}

function centsFromMx(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return fallback;
  return Math.round(amount * 100);
}

function positiveInt(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : null;
}

function asDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeTicketStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'used') return 'used';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'refunded') return 'refunded';
  if (normalized === 'void') return 'void';
  return 'active';
}

function orderStatusFromTickets(status) {
  if (status === 'cancelled' || status === 'void') return 'cancelled';
  if (status === 'refunded') return 'refunded';
  return 'paid';
}

function orderItemStatusFromTicket(status) {
  if (status === 'cancelled' || status === 'void') return 'cancelled';
  if (status === 'refunded') return 'refunded';
  return 'issued';
}

function parseVenueCity(venueName = '') {
  const parts = String(venueName || '').split(',').map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : 'Importado';
}

function getSeatCode(ticket = {}) {
  const seat = ticket.seat || {};
  const zone = cleanText(seat.zone || ticket.zone || 'Zona');
  const row = cleanText(seat.fila || seat.row || 'A').toUpperCase();

  if (seat.tableSize > 1 || seat.mesa) {
    const table = cleanText(seat.mesa || seat.mesaNum || '1');
    const place = cleanText(seat.seatInMesa || seat.asiento || '1');
    return `${zone}|${row}|M${table}|L${place}`;
  }

  return `${zone}|${row}|A${cleanText(seat.asiento || '1')}`;
}

function getUnitPriceCents(ticket = {}) {
  const seatPrice = centsFromMx(ticket.seat?.price, null);
  if (seatPrice !== null) return seatPrice;

  const totalPaid = centsFromMx(ticket.totalPaid, 0);
  const count = positiveInt(ticket.orderSeatCount) || 1;
  return Math.max(0, Math.round(totalPaid / count));
}

async function run(dbClient, text, params = []) {
  return dbClient ? dbClient.query(text, params) : query(text, params);
}

export async function countTickets(dbClient = null) {
  const result = await run(dbClient, 'SELECT count(*)::integer AS count FROM tickets');
  return result.rows[0]?.count || 0;
}

export async function countExistingTicketCodes(ticketCodes, dbClient = null) {
  if (!Array.isArray(ticketCodes) || !ticketCodes.length) return 0;

  const result = await run(
    dbClient,
    'SELECT count(*)::integer AS count FROM tickets WHERE ticket_code = ANY($1::text[])',
    [ticketCodes],
  );

  return result.rows[0]?.count || 0;
}

export async function getExistingTicketCodes(ticketCodes, dbClient = null) {
  if (!Array.isArray(ticketCodes) || !ticketCodes.length) return new Set();

  const result = await run(
    dbClient,
    'SELECT ticket_code FROM tickets WHERE ticket_code = ANY($1::text[])',
    [ticketCodes],
  );

  return new Set(result.rows.map(row => row.ticket_code));
}

function normalizePublicStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'issued') return 'active';
  if (normalized === 'active') return 'active';
  if (normalized === 'used') return 'used';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'refunded') return 'refunded';
  if (normalized === 'void') return 'cancelled';
  return 'active';
}

function mxFromCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return null;
  return Math.round(cents) / 100;
}

function buildImportedSeatLabel(row) {
  const sectionName = cleanText(row.section_name, 'Zona');
  const rowLabel = cleanText(row.row_label, null);
  const tableLabel = cleanText(row.table_label, null);
  const tableSeatNumber = positiveInt(row.table_seat_number);
  const seatNumber = positiveInt(row.seat_number);

  if (tableLabel) {
    return `${sectionName} · Fila ${rowLabel || 'A'} · Mesa ${tableLabel} · Lugar ${tableSeatNumber || 1}`;
  }

  return `${sectionName} · Fila ${rowLabel || 'A'} · Asiento ${seatNumber || 1}`;
}

function mapTicketRow(row) {
  if (!row) return null;

  const ticketMetadata = row.ticket_metadata || {};
  const orderMetadata = row.order_metadata || {};
  const eventMetadata = row.event_metadata || {};

  return {
    ticketId: row.ticket_code,
    orderId: row.order_number,
    eventId: row.event_external_reference || row.event_id,
    eventName: row.event_name,
    date: eventMetadata.legacyDate || (row.starts_at ? new Date(row.starts_at).toISOString() : null),
    venue: ticketMetadata.legacyVenue || row.venue_name,
    zone: ticketMetadata.legacyZone || row.section_name,
    seatLabel: ticketMetadata.legacySeatLabel || buildImportedSeatLabel(row),
    seat: {
      zone: row.section_name,
      fila: row.row_label || null,
      asiento: positiveInt(row.seat_number),
      mesa: row.table_label || null,
      seatInMesa: positiveInt(row.table_seat_number),
      tableSize: row.table_label ? null : 1,
      seatCode: row.seat_code || null,
    },
    totalPaid: mxFromCents(row.order_total_cents),
    paymentMethod: row.payment_method,
    orderSeatCount: positiveInt(orderMetadata.legacyOrderSeatCount),
    status: normalizePublicStatus(row.ticket_status),
    validationCount: Number(row.validation_count || 0),
    publicPath: null,
    publicUrl: null,
    createdAt: row.ticket_created_at ? new Date(row.ticket_created_at).toISOString() : null,
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    privateViewTokenHash: row.private_view_token_hash,
    dynamicSecret: row.private_view_token_hash,
    ownerUserId: row.order_user_id || null,
    storageSource: 'postgres',
  };
}

async function fetchTicketRowsByCodes(ticketCodes, dbClient = null) {
  if (!Array.isArray(ticketCodes) || !ticketCodes.length) return [];

  const result = await run(
    dbClient,
    `
      SELECT
        t.id AS ticket_uuid,
        t.ticket_code,
        t.private_view_token_hash,
        t.status AS ticket_status,
        t.validation_count,
        t.used_at,
        t.cancelled_at,
        t.created_at AS ticket_created_at,
        t.metadata AS ticket_metadata,
        o.order_number,
        o.payment_method,
        o.total_cents AS order_total_cents,
        o.metadata AS order_metadata,
        o.user_id AS order_user_id,
        e.id::text AS event_id,
        e.external_reference AS event_external_reference,
        e.name AS event_name,
        e.starts_at,
        e.metadata AS event_metadata,
        v.name AS venue_name,
        sec.name AS section_name,
        s.seat_code,
        s.row_label,
        s.seat_number,
        s.table_label,
        s.table_seat_number
      FROM tickets t
      JOIN orders o ON o.id = t.order_id
      JOIN events e ON e.id = t.event_id
      JOIN venues v ON v.id = e.venue_id
      LEFT JOIN seats s ON s.id = t.seat_id
      LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE t.ticket_code = ANY($1::text[])
      ORDER BY array_position($1::text[], t.ticket_code)
    `,
    [ticketCodes],
  );

  return result.rows;
}

export async function findTicketsByCodes(ticketCodes, dbClient = null) {
  const uniqueCodes = [...new Set((ticketCodes || []).map(code => String(code || '').trim()).filter(Boolean))];
  const rows = await fetchTicketRowsByCodes(uniqueCodes, dbClient);
  return rows.map(mapTicketRow).filter(Boolean);
}

export async function findTicketByCode(ticketCode, dbClient = null) {
  const code = String(ticketCode || '').trim();
  if (!code) return null;

  const tickets = await findTicketsByCodes([code], dbClient);
  return tickets[0] || null;
}

// Boletos que ocupan asiento para un evento (por external_reference legacy).
// Devuelve la forma mínima { eventId, status, seat } que espera el dominio
// para calcular llaves de asiento; el dominio decide qué estados bloquean.
export async function findSoldSeatTicketsByEvent(eventReference, dbClient = null) {
  const reference = cleanText(eventReference, null);
  if (!reference) return [];

  const result = await run(
    dbClient,
    `
      SELECT
        t.status AS ticket_status,
        t.metadata AS ticket_metadata,
        sec.name AS section_name,
        s.row_label,
        s.seat_number,
        s.table_label,
        s.table_seat_number
      FROM tickets t
      JOIN events e ON e.id = t.event_id
      JOIN seats s ON s.id = t.seat_id
      LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE e.external_reference = $1
        AND t.status IN ('issued', 'active', 'used')
    `,
    [reference],
  );

  return result.rows.map(row => {
    const ticketMetadata = row.ticket_metadata || {};
    return {
      eventId: reference,
      status: normalizePublicStatus(row.ticket_status),
      seat: {
        zone: ticketMetadata.legacyZone || row.section_name,
        fila: row.row_label || null,
        asiento: positiveInt(row.seat_number),
        mesa: row.table_label || null,
        seatInMesa: positiveInt(row.table_seat_number),
        // Solo para construir la llave de asiento: >1 activa la rama de mesa.
        tableSize: row.table_label ? 2 : 1,
      },
    };
  });
}

export async function findTicketsByUserId(userId, dbClient = null) {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) return [];

  const result = await run(
    dbClient,
    `
      SELECT
        t.id AS ticket_uuid,
        t.ticket_code,
        t.private_view_token_hash,
        t.status AS ticket_status,
        t.validation_count,
        t.used_at,
        t.cancelled_at,
        t.created_at AS ticket_created_at,
        t.metadata AS ticket_metadata,
        o.order_number,
        o.payment_method,
        o.total_cents AS order_total_cents,
        o.metadata AS order_metadata,
        o.user_id AS order_user_id,
        e.id::text AS event_id,
        e.external_reference AS event_external_reference,
        e.name AS event_name,
        e.starts_at,
        e.metadata AS event_metadata,
        v.name AS venue_name,
        sec.name AS section_name,
        s.seat_code,
        s.row_label,
        s.seat_number,
        s.table_label,
        s.table_seat_number
      FROM tickets t
      JOIN orders o ON o.id = t.order_id
      JOIN events e ON e.id = t.event_id
      JOIN venues v ON v.id = e.venue_id
      LEFT JOIN seats s ON s.id = t.seat_id
      LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE o.user_id = $1
      ORDER BY t.created_at DESC
    `,
    [cleanUserId],
  );

  return result.rows.map(mapTicketRow).filter(Boolean);
}

async function upsertVenue(dbClient, ticket) {
  const venueName = cleanText(ticket.venue, 'Venue importado');
  const slug = slugify(venueName, 'venue-importado');

  const result = await run(
    dbClient,
    `
      INSERT INTO venues (slug, name, city, metadata)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name,
          city = EXCLUDED.city,
          metadata = venues.metadata || EXCLUDED.metadata,
          updated_at = now()
      RETURNING id
    `,
    [
      slug,
      venueName,
      parseVenueCity(venueName),
      { source: 'tickets_json_import' },
    ],
  );

  return result.rows[0].id;
}

async function upsertEvent(dbClient, ticket, venueId) {
  const externalReference = cleanText(ticket.eventId, cleanText(ticket.eventName, 'evento-importado'));
  const slug = slugify(externalReference, slugify(ticket.eventName, 'evento-importado'));
  const name = cleanText(ticket.eventName, 'Evento importado');

  const result = await run(
    dbClient,
    `
      INSERT INTO events (
        venue_id, slug, name, status, external_reference, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (venue_id, slug) DO UPDATE
      SET name = EXCLUDED.name,
          status = EXCLUDED.status,
          external_reference = EXCLUDED.external_reference,
          metadata = events.metadata || EXCLUDED.metadata,
          updated_at = now()
      RETURNING id
    `,
    [
      venueId,
      slug,
      name,
      'on_sale',
      externalReference,
      {
        source: 'tickets_json_import',
        legacyEventId: cleanText(ticket.eventId, null),
        legacyDate: cleanText(ticket.date, null),
      },
    ],
  );

  return result.rows[0].id;
}

async function upsertSection(dbClient, ticket, eventId) {
  const zone = cleanText(ticket.zone || ticket.seat?.zone, 'General');
  const code = slugify(zone, 'general');

  const result = await run(
    dbClient,
    `
      INSERT INTO sections (event_id, code, name, section_type, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (event_id, code) DO UPDATE
      SET name = EXCLUDED.name,
          metadata = sections.metadata || EXCLUDED.metadata,
          updated_at = now()
      RETURNING id
    `,
    [
      eventId,
      code,
      zone,
      ticket.seat?.tableSize > 1 ? 'table' : 'seated',
      'active',
      { source: 'tickets_json_import' },
    ],
  );

  return result.rows[0].id;
}

async function upsertSeat(dbClient, ticket, eventId, sectionId, options = {}) {
  const seat = ticket.seat || {};
  const seatCode = getSeatCode(ticket);
  const status = normalizeTicketStatus(ticket.status);
  const rowLabel = cleanText(seat.fila || seat.row, null);
  const seatNumber = positiveInt(seat.asiento);
  const tableLabel = seat.mesa ? String(seat.mesa) : null;
  const tableSeatNumber = positiveInt(seat.seatInMesa);

  if (options.allowSeatConflictFallback) {
    const existingByCode = await run(
      dbClient,
      'SELECT id FROM seats WHERE event_id = $1 AND seat_code = $2 LIMIT 1',
      [eventId, seatCode],
    );
    if (existingByCode.rowCount > 0) {
      return existingByCode.rows[0].id;
    }

    if (seatNumber !== null) {
      const existingByPosition = await run(
        dbClient,
        `
          SELECT id FROM seats
          WHERE event_id = $1
            AND section_id = $2
            AND row_label IS NOT DISTINCT FROM $3
            AND seat_number = $4
          LIMIT 1
        `,
        [eventId, sectionId, rowLabel, seatNumber],
      );
      if (existingByPosition.rowCount > 0) {
        return null;
      }
    }
  }

  let result;
  try {
    result = await run(
      dbClient,
      `
        INSERT INTO seats (
          event_id, section_id, seat_code, row_label, seat_number,
          table_label, table_seat_number, status, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (event_id, seat_code) DO UPDATE
        SET status = CASE
              WHEN seats.status = 'sold' THEN seats.status
              ELSE EXCLUDED.status
            END,
            metadata = seats.metadata || EXCLUDED.metadata,
            updated_at = now()
        RETURNING id
      `,
      [
        eventId,
        sectionId,
        seatCode,
        rowLabel,
        seatNumber,
        tableLabel,
        tableSeatNumber,
        status === 'cancelled' || status === 'void' ? 'available' : 'sold',
        {
          source: 'tickets_json_import',
          legacySeatLabel: cleanText(ticket.seatLabel, null),
        },
      ],
    );
  } catch (error) {
    if (options.allowSeatConflictFallback && error?.code === '23505') {
      return null;
    }
    throw error;
  }

  return result.rows[0].id;
}

async function upsertTicketType(dbClient, ticket, eventId) {
  const zone = cleanText(ticket.zone || ticket.seat?.zone, 'General');
  const code = `json-${slugify(zone, 'general')}`;
  const priceCents = getUnitPriceCents(ticket);

  const result = await run(
    dbClient,
    `
      INSERT INTO ticket_types (event_id, code, name, price_cents, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (event_id, code) DO UPDATE
      SET price_cents = EXCLUDED.price_cents,
          metadata = ticket_types.metadata || EXCLUDED.metadata,
          updated_at = now()
      RETURNING id
    `,
    [
      eventId,
      code,
      zone,
      priceCents,
      'active',
      { source: 'tickets_json_import' },
    ],
  );

  return result.rows[0].id;
}

async function upsertOrder(dbClient, ticket, status) {
  const orderNumber = cleanText(ticket.orderId, `JSON-${ticket.ticketId}`);
  const totalCents = centsFromMx(ticket.totalPaid, getUnitPriceCents(ticket));
  const paymentMethod = cleanText(ticket.paymentMethod, 'unknown');
  const buyerEmail = `imported+${slugify(orderNumber, 'order')}@${SYSTEM_BUYER_DOMAIN}`;

  const result = await run(
    dbClient,
    `
      INSERT INTO orders (
        order_number, buyer_email, buyer_name, status, subtotal_cents,
        fee_cents, total_cents, payment_method, metadata, created_at, updated_at, user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()), now(), $11)
      ON CONFLICT (order_number) DO UPDATE
      SET status = CASE
            WHEN orders.status IN ('paid', 'fulfilled') THEN orders.status
            ELSE EXCLUDED.status
          END,
          total_cents = GREATEST(orders.total_cents, EXCLUDED.total_cents),
          metadata = orders.metadata || EXCLUDED.metadata,
          user_id = COALESCE(orders.user_id, EXCLUDED.user_id),
          updated_at = now()
      RETURNING id
    `,
    [
      orderNumber,
      buyerEmail,
      'Comprador importado',
      orderStatusFromTickets(status),
      totalCents,
      0,
      totalCents,
      paymentMethod,
      {
        source: 'tickets_json_import',
        legacyOrderSeatCount: positiveInt(ticket.orderSeatCount),
      },
      asDateOrNull(ticket.createdAt),
      ticket.userId || null,
    ],
  );

  return result.rows[0].id;
}

async function upsertOrderItem(dbClient, ticket, ids, status) {
  const unitPriceCents = getUnitPriceCents(ticket);

  const result = await run(
    dbClient,
    `
      INSERT INTO order_items (
        order_id, event_id, ticket_type_id, seat_id, unit_price_cents,
        fee_cents, total_cents, status, metadata, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()), now())
      ON CONFLICT (order_id, seat_id) DO UPDATE
      SET metadata = order_items.metadata || EXCLUDED.metadata,
          updated_at = now()
      RETURNING id
    `,
    [
      ids.orderId,
      ids.eventId,
      ids.ticketTypeId,
      ids.seatId,
      unitPriceCents,
      0,
      unitPriceCents,
      orderItemStatusFromTicket(status),
      {
        source: 'tickets_json_import',
        legacyTicketId: ticket.ticketId,
      },
      asDateOrNull(ticket.createdAt),
    ],
  );

  return result.rows[0].id;
}

async function isSeatAlreadyAssigned(dbClient, seatId) {
  if (!seatId) return false;

  const result = await run(
    dbClient,
    `
      SELECT EXISTS (
        SELECT 1 FROM order_items
        WHERE seat_id = $1 AND status IN ('pending', 'issued')
        UNION ALL
        SELECT 1 FROM tickets
        WHERE seat_id = $1 AND status IN ('issued', 'active', 'used')
        LIMIT 1
      ) AS assigned
    `,
    [seatId],
  );

  return Boolean(result.rows[0]?.assigned);
}

async function upsertPayment(dbClient, ticket, orderId, status) {
  const totalCents = centsFromMx(ticket.totalPaid, getUnitPriceCents(ticket));
  const orderNumber = cleanText(ticket.orderId, `JSON-${ticket.ticketId}`);

  await run(
    dbClient,
    `
      INSERT INTO payments (
        order_id, provider, provider_payment_id, method, status,
        amount_cents, paid_at, raw_payload, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()), now())
      ON CONFLICT (provider, provider_payment_id)
      WHERE provider_payment_id IS NOT NULL
      DO UPDATE
      SET status = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          raw_payload = payments.raw_payload || EXCLUDED.raw_payload,
          updated_at = now()
    `,
    [
      orderId,
      'json_import',
      `json-import:${orderNumber}`,
      cleanText(ticket.paymentMethod, 'unknown'),
      status === 'cancelled' || status === 'void' ? 'cancelled' : 'paid',
      totalCents,
      asDateOrNull(ticket.createdAt),
      { source: 'tickets_json_import' },
      asDateOrNull(ticket.createdAt),
    ],
  );
}

export async function importLegacyTicket(dbClient, ticket, options = {}) {
  const existing = await run(dbClient, 'SELECT id FROM tickets WHERE ticket_code = $1', [ticket.ticketId]);
  if (existing.rowCount > 0) {
    return { inserted: false, reason: 'duplicate_ticket_code' };
  }

  const status = normalizeTicketStatus(ticket.status);
  const venueId = await upsertVenue(dbClient, ticket);
  const eventId = await upsertEvent(dbClient, ticket, venueId);
  const sectionId = await upsertSection(dbClient, ticket, eventId);
  const seatId = await upsertSeat(dbClient, ticket, eventId, sectionId, {
    allowSeatConflictFallback: Boolean(options.allowSeatConflictFallback),
  });
  const effectiveSeatId =
    options.allowSeatConflictFallback && await isSeatAlreadyAssigned(dbClient, seatId)
      ? null
      : seatId;
  const ticketTypeId = await upsertTicketType(dbClient, ticket, eventId);
  const orderId = await upsertOrder(dbClient, ticket, status);
  const orderItemId = await upsertOrderItem(
    dbClient,
    ticket,
    { orderId, eventId, ticketTypeId, seatId: effectiveSeatId },
    status,
  );

  await upsertPayment(dbClient, ticket, orderId, status);

  const result = await run(
    dbClient,
    `
      INSERT INTO tickets (
        order_id, order_item_id, event_id, seat_id, ticket_type_id,
        ticket_code, private_view_token_hash, status, validation_count,
        issued_at, used_at, cancelled_at, metadata, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        COALESCE($10::timestamptz, now()), $11, $12, $13,
        COALESCE($14::timestamptz, now()), now()
      )
      ON CONFLICT (ticket_code) DO NOTHING
      RETURNING id
    `,
    [
      orderId,
      orderItemId,
      eventId,
      effectiveSeatId,
      ticketTypeId,
      ticket.ticketId,
      sha256(ticket.token),
      status,
      Math.max(0, Number(ticket.validationCount || 0)),
      asDateOrNull(ticket.createdAt),
      asDateOrNull(ticket.usedAt),
      asDateOrNull(ticket.cancelledAt),
      {
        source: 'tickets_json_import',
        legacyVenue: cleanText(ticket.venue, null),
        legacyPublicPath: cleanText(ticket.publicPath, null),
        legacyPublicUrlPresent: Boolean(ticket.publicUrl),
        legacyZone: cleanText(ticket.zone || ticket.seat?.zone, null),
        legacySeatLabel: cleanText(ticket.seatLabel, null),
      },
      asDateOrNull(ticket.createdAt),
    ],
  );

  return {
    inserted: result.rowCount > 0,
    reason: result.rowCount > 0 ? 'inserted' : 'duplicate_ticket_code',
  };
}

export async function syncLegacyTicketPublicMetadata(dbClient, ticket) {
  const ticketCode = cleanText(ticket?.ticketId, null);
  if (!ticketCode) {
    return { updated: false };
  }

  const result = await run(
    dbClient,
    `
      UPDATE tickets
      SET metadata = metadata || $2,
          updated_at = now()
      WHERE ticket_code = $1
      RETURNING id
    `,
    [
      ticketCode,
      {
        source: 'tickets_json_import',
        legacyVenue: cleanText(ticket.venue, null),
        legacyPublicPath: cleanText(ticket.publicPath, null),
        legacyPublicUrlPresent: Boolean(ticket.publicUrl),
        legacyZone: cleanText(ticket.zone || ticket.seat?.zone, null),
        legacySeatLabel: cleanText(ticket.seatLabel, null),
      },
    ],
  );

  return { updated: result.rowCount > 0 };
}

export async function markTicketUsedByCode(ticketCode, { usedAt = new Date().toISOString(), dbClient = null } = {}) {
  const code = cleanText(ticketCode, null);
  if (!code) {
    return {
      updated: false,
      reason: 'not_found',
      ticket: null,
    };
  }

  const result = await run(
    dbClient,
    `
      UPDATE tickets
      SET status = 'used',
          used_at = COALESCE($2::timestamptz, now()),
          validation_count = validation_count + 1,
          updated_at = now()
      WHERE ticket_code = $1
        AND status = 'active'
        AND used_at IS NULL
      RETURNING ticket_code
    `,
    [code, asDateOrNull(usedAt)],
  );

  const ticket = await findTicketByCode(code, dbClient);
  if (result.rowCount > 0) {
    return {
      updated: true,
      reason: 'used',
      ticket,
    };
  }

  if (!ticket) {
    return {
      updated: false,
      reason: 'not_found',
      ticket: null,
    };
  }

  if (ticket.status === 'used' || ticket.usedAt) {
    return {
      updated: false,
      reason: 'already_used',
      ticket,
    };
  }

  if (ticket.status === 'cancelled') {
    return {
      updated: false,
      reason: 'cancelled',
      ticket,
    };
  }

  return {
    updated: false,
    reason: 'not_active',
    ticket,
  };
}

// ── Persistencia propia de compras nuevas (checkout) ──
// importLegacyTicket queda únicamente para el script de migración de
// tickets.json; las compras del checkout usan insertPurchaseOrder.

// Conflicto de asiento detectado dentro de la transacción de compra.
// El mensaje es apto para el cliente; el adaptador HTTP lo mapea a 400.
export class TicketSeatConflictError extends Error {
  constructor() {
    super('Asientos no disponibles: uno de los asientos seleccionados acaba de venderse. Selecciona otros asientos.');
    this.name = 'TicketSeatConflictError';
  }
}

// Get-or-create sin DO UPDATE: no muta metadata ni updated_at de filas
// existentes y es seguro ante carreras (el INSERT concurrente pierde y
// el SELECT posterior encuentra la fila ganadora ya confirmada).
async function getOrCreateId(dbClient, { insertSql, insertParams, selectSql, selectParams }) {
  const inserted = await run(dbClient, insertSql, insertParams);
  if (inserted.rowCount > 0) return inserted.rows[0].id;

  const existing = await run(dbClient, selectSql, selectParams);
  if (!existing.rowCount) {
    throw new Error('Catalog row lookup failed after insert attempt.');
  }
  return existing.rows[0].id;
}

async function getOrCreateVenueId(dbClient, venueName) {
  const name = cleanText(venueName, 'Venue BoletaMax');
  const slug = slugify(name, 'venue-boletamax');

  return getOrCreateId(dbClient, {
    insertSql: `
      INSERT INTO venues (slug, name, city, metadata)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `,
    insertParams: [slug, name, parseVenueCity(name), { source: 'checkout' }],
    selectSql: 'SELECT id FROM venues WHERE slug = $1',
    selectParams: [slug],
  });
}

async function getOrCreateEventId(dbClient, orderEvent, venueId) {
  const externalReference = cleanText(orderEvent.eventId, slugify(orderEvent.name || 'evento', 'evento'));
  const slug = slugify(externalReference, 'evento');

  return getOrCreateId(dbClient, {
    insertSql: `
      INSERT INTO events (venue_id, slug, name, status, external_reference, metadata)
      VALUES ($1, $2, $3, 'on_sale', $4, $5)
      ON CONFLICT (venue_id, slug) DO NOTHING
      RETURNING id
    `,
    insertParams: [
      venueId,
      slug,
      cleanText(orderEvent.name, 'Evento'),
      externalReference,
      {
        source: 'checkout',
        legacyEventId: externalReference,
        legacyDate: cleanText(orderEvent.date, null),
      },
    ],
    selectSql: 'SELECT id FROM events WHERE venue_id = $1 AND slug = $2',
    selectParams: [venueId, slug],
  });
}

async function getOrCreateSectionId(dbClient, eventId, ticket) {
  const zone = cleanText(ticket.zone || ticket.seat?.zone, 'General');
  const code = slugify(zone, 'general');

  return getOrCreateId(dbClient, {
    insertSql: `
      INSERT INTO sections (event_id, code, name, section_type, status, metadata)
      VALUES ($1, $2, $3, $4, 'active', $5)
      ON CONFLICT (event_id, code) DO NOTHING
      RETURNING id
    `,
    insertParams: [
      eventId,
      code,
      zone,
      ticket.seat?.tableSize > 1 ? 'table' : 'seated',
      { source: 'checkout' },
    ],
    selectSql: 'SELECT id FROM sections WHERE event_id = $1 AND code = $2',
    selectParams: [eventId, code],
  });
}

async function getOrCreateTicketTypeId(dbClient, eventId, ticket) {
  const zone = cleanText(ticket.zone || ticket.seat?.zone, 'General');
  const code = slugify(zone, 'general');

  return getOrCreateId(dbClient, {
    insertSql: `
      INSERT INTO ticket_types (event_id, code, name, price_cents, status, metadata)
      VALUES ($1, $2, $3, $4, 'active', $5)
      ON CONFLICT (event_id, code) DO NOTHING
      RETURNING id
    `,
    insertParams: [eventId, code, zone, getUnitPriceCents(ticket), { source: 'checkout' }],
    selectSql: 'SELECT id FROM ticket_types WHERE event_id = $1 AND code = $2',
    selectParams: [eventId, code],
  });
}

// Inserta el asiento como vendido. Si ya existe y tiene un boleto que lo
// ocupa (active/used), la compra es un conflicto controlado.
async function insertSoldSeat(dbClient, eventId, sectionId, ticket) {
  const seat = ticket.seat || {};
  const seatCode = getSeatCode(ticket);
  const rowLabel = cleanText(seat.fila || seat.row, null);

  const inserted = await run(
    dbClient,
    `
      INSERT INTO seats (
        event_id, section_id, seat_code, row_label, seat_number,
        table_label, table_seat_number, status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'sold', $8)
      ON CONFLICT (event_id, seat_code) DO NOTHING
      RETURNING id
    `,
    [
      eventId,
      sectionId,
      seatCode,
      rowLabel,
      positiveInt(seat.asiento),
      seat.mesa ? String(seat.mesa) : null,
      positiveInt(seat.seatInMesa),
      { source: 'checkout', legacySeatLabel: cleanText(ticket.seatLabel, null) },
    ],
  );
  if (inserted.rowCount > 0) return inserted.rows[0].id;

  const existing = await run(
    dbClient,
    'SELECT id FROM seats WHERE event_id = $1 AND seat_code = $2',
    [eventId, seatCode],
  );
  if (!existing.rowCount) {
    throw new Error('Seat lookup failed after insert attempt.');
  }
  const seatId = existing.rows[0].id;

  const assigned = await run(
    dbClient,
    `
      SELECT EXISTS (
        SELECT 1 FROM tickets
        WHERE seat_id = $1 AND status IN ('issued', 'active', 'used')
      ) AS assigned
    `,
    [seatId],
  );
  if (assigned.rows[0]?.assigned) {
    throw new TicketSeatConflictError();
  }

  // Asiento reciclado (venta previa cancelada/reembolsada): vuelve a venderse.
  await run(dbClient, `UPDATE seats SET status = 'sold', updated_at = now() WHERE id = $1`, [seatId]);
  return seatId;
}

async function insertOrderRow(dbClient, order) {
  const pricing = order.pricing || {};
  const result = await run(
    dbClient,
    `
      INSERT INTO orders (
        order_number, buyer_email, buyer_name, status, subtotal_cents, fee_cents,
        discount_cents, total_cents, currency, payment_method, checkout_quote_id,
        user_id, metadata
      )
      VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `,
    [
      order.orderId,
      order.buyer.email,
      order.buyer.name,
      pricing.subtotalCents,
      pricing.feeCents,
      pricing.discountCents,
      pricing.totalCents,
      pricing.currency || 'MXN',
      order.paymentMethod,
      cleanText(order.quoteId, null),
      order.buyer.userId || null,
      {
        source: 'checkout',
        legacyOrderSeatCount: positiveInt(order.orderSeatCount),
        guestPurchase: Boolean(order.buyer.isGuest),
      },
    ],
  );
  return result.rows[0].id;
}

async function insertOrderItemRow(dbClient, { orderUuid, eventId, ticketTypeId, seatId, ticket }) {
  const unitPriceCents = getUnitPriceCents(ticket);
  const result = await run(
    dbClient,
    `
      INSERT INTO order_items (
        order_id, event_id, ticket_type_id, seat_id, unit_price_cents,
        fee_cents, total_cents, status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, 0, $5, 'issued', $6)
      RETURNING id
    `,
    [
      orderUuid,
      eventId,
      ticketTypeId,
      seatId,
      unitPriceCents,
      { source: 'checkout', legacyTicketId: ticket.ticketId },
    ],
  );
  return result.rows[0].id;
}

async function insertTicketRow(dbClient, { orderUuid, orderItemId, eventId, seatId, ticketTypeId, ticket }) {
  await run(
    dbClient,
    `
      INSERT INTO tickets (
        order_id, order_item_id, event_id, seat_id, ticket_type_id,
        ticket_code, private_view_token_hash, status, validation_count, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0, $8)
    `,
    [
      orderUuid,
      orderItemId,
      eventId,
      seatId,
      ticketTypeId,
      ticket.ticketId,
      sha256(ticket.token),
      {
        source: 'checkout',
        legacyVenue: cleanText(ticket.venue, null),
        legacyZone: cleanText(ticket.zone || ticket.seat?.zone, null),
        legacySeatLabel: cleanText(ticket.seatLabel, null),
      },
    ],
  );
}

async function insertPaymentRow(dbClient, { orderUuid, order }) {
  await run(
    dbClient,
    `
      INSERT INTO payments (
        order_id, provider, provider_payment_id, method, status,
        amount_cents, currency, paid_at, raw_payload
      )
      VALUES ($1, 'simulated', $2, $3, 'paid', $4, $5, now(), $6)
    `,
    [
      orderUuid,
      `sim:${order.orderId}`,
      cleanText(order.paymentMethod, 'unknown'),
      order.pricing?.totalCents ?? 0,
      order.pricing?.currency || 'MXN',
      { simulated: true, quoteId: cleanText(order.quoteId, null) },
    ],
  );
}

// Una compra = una orden con sus items, boletos y un pago simulado, en una
// sola transacción: cualquier fallo (incluido conflicto de asiento) hace
// rollback completo y no deja filas parciales.
export async function insertPurchaseOrder({ order, tickets } = {}, options = {}) {
  const records = Array.isArray(tickets) ? tickets.filter(Boolean) : [];
  if (!order || !records.length) {
    return { attempted: 0, inserted: 0, skipped: 0 };
  }

  const runInTransaction = options.withTransaction || withTransaction;

  return runInTransaction(async client => {
    const venueId = await getOrCreateVenueId(client, order.event?.venue);
    const eventId = await getOrCreateEventId(client, order.event || {}, venueId);
    const orderUuid = await insertOrderRow(client, order);

    const sectionIdsByZone = new Map();
    const ticketTypeIdsByZone = new Map();

    for (const ticket of records) {
      const zoneKey = slugify(cleanText(ticket.zone || ticket.seat?.zone, 'General'), 'general');
      if (!sectionIdsByZone.has(zoneKey)) {
        sectionIdsByZone.set(zoneKey, await getOrCreateSectionId(client, eventId, ticket));
      }
      if (!ticketTypeIdsByZone.has(zoneKey)) {
        ticketTypeIdsByZone.set(zoneKey, await getOrCreateTicketTypeId(client, eventId, ticket));
      }

      const seatId = await insertSoldSeat(client, eventId, sectionIdsByZone.get(zoneKey), ticket);
      const orderItemId = await insertOrderItemRow(client, {
        orderUuid,
        eventId,
        ticketTypeId: ticketTypeIdsByZone.get(zoneKey),
        seatId,
        ticket,
      });
      await insertTicketRow(client, {
        orderUuid,
        orderItemId,
        eventId,
        seatId,
        ticketTypeId: ticketTypeIdsByZone.get(zoneKey),
        ticket,
      });
    }

    await insertPaymentRow(client, { orderUuid, order });

    return { attempted: records.length, inserted: records.length, skipped: 0 };
  });
}
