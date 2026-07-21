import {
  buildDynamicQrPayload,
  getDynamicQrSecondsRemaining,
  getDynamicQrWindow,
  serializeTicketPublicView,
} from '../domain/tickets.mjs';

export function createTicketQueries({ ticketStore, qr }) {
  async function buildDynamicQrResponse(ticket, window = getDynamicQrWindow()) {
    const qrPayload = buildDynamicQrPayload(ticket, ticketStore.getDynamicSecret(ticket), window);
    const qrDataUrl = await qr.dynamicQrDataUrl(JSON.stringify(qrPayload));

    return {
      qrPayload,
      dynamicToken: qrPayload.dynamicToken,
      qrImage: qrDataUrl,
      qrDataUrl,
      window,
      expiresInSec: getDynamicQrSecondsRemaining(),
    };
  }

  async function getPublicTicket(rawTicketId) {
    const ticketId = String(rawTicketId || '').trim();
    if (!ticketId) return { outcome: 'missing_id' };

    const ticket = await ticketStore.getTicketById(ticketId);
    if (!ticket) return { outcome: 'not_found' };

    return { outcome: 'ok', ticket: serializeTicketPublicView(ticket) };
  }

  async function getPrivateTickets(rawRequests) {
    const requestedTickets = Array.isArray(rawRequests) ? rawRequests : [];
    const ticketRequests = requestedTickets
      .map(item => ({
        ticketId: String(item?.ticketId || '').trim(),
        token: String(item?.token || '').trim(),
      }))
      .filter(item => item.ticketId && item.token)
      .slice(0, 50);

    if (!ticketRequests.length) {
      return { outcome: 'empty_request' };
    }

    const ids = [...new Set(ticketRequests.map(item => item.ticketId))];
    const tickets = await ticketStore.getTicketsByIds(ids);
    const ticketsById = new Map(tickets.map(ticket => [ticket.ticketId, ticket]));
    const validTickets = [];
    const returnedIds = new Set();

    for (const request of ticketRequests) {
      const ticket = ticketsById.get(request.ticketId);
      if (!ticket || returnedIds.has(request.ticketId)) continue;
      if (!ticketStore.verifyPrivateToken(ticket, request.token)) continue;
      validTickets.push(ticketStore.serializePublic(ticket));
      returnedIds.add(request.ticketId);
    }

    return { outcome: 'ok', tickets: validTickets };
  }

  function isAuthorizedForPrivateView(ticket, token, sessionUserId) {
    return (
      ticketStore.verifyPrivateToken(ticket, token) ||
      ticketStore.isOwnedBy(ticket, sessionUserId)
    );
  }

  async function getTicketDetail(rawTicketId, token, { sessionUserId = null } = {}) {
    const ticketId = String(rawTicketId || '').trim();

    const ticket = await ticketStore.getTicketById(ticketId);
    if (!ticket) return { outcome: 'not_found' };

    if (!isAuthorizedForPrivateView(ticket, token, sessionUserId)) {
      console.warn('BoletaMax Tickets: unauthorized private detail access attempt', { ticketId });
      return { outcome: 'unauthorized' };
    }

    return { outcome: 'ok', ticket: ticketStore.serializePublic(ticket) };
  }

  async function getDynamicQr(rawTicketId, token, { sessionUserId = null } = {}) {
    const ticketId = String(rawTicketId || '').trim();
    console.log('BoletaMax QR: request', { ticketId });

    let ticket = null;
    try {
      ticket = await ticketStore.getTicketById(ticketId);
    } catch (error) {
      console.error('BoletaMax QR: storage read failed', {
        ticketId,
        mode: ticketStore.storageMode,
        message: error?.message || 'Error desconocido',
      });
      return { outcome: 'storage_error' };
    }

    if (!ticket) {
      console.warn('BoletaMax QR: ticket not found', { ticketId });
      return { outcome: 'not_found' };
    }

    if (!isAuthorizedForPrivateView(ticket, token, sessionUserId)) {
      console.warn('BoletaMax QR: unauthorized access attempt', { ticketId });
      return { outcome: 'unauthorized' };
    }

    if (ticket.status !== 'active' || ticket.usedAt) {
      const reason = ticket.status === 'used' || ticket.usedAt ? 'boleto ya utilizado' : 'boleto no disponible';
      console.log('BoletaMax QR: unavailable', {
        ticketId,
        status: ticket.status,
        usedAt: ticket.usedAt,
        reason,
      });
      return {
        outcome: 'inactive',
        ticket: ticketStore.serializePublic(ticket),
        message: reason,
      };
    }

    try {
      const dynamicQr = await buildDynamicQrResponse(ticket);
      console.log('BoletaMax QR: generated', {
        ticketId,
        status: ticket.status,
        window: dynamicQr.window,
      });

      return {
        outcome: 'active',
        ticket: ticketStore.serializePublic(ticket),
        dynamicQr,
      };
    } catch (error) {
      console.error('BoletaMax QR: generation failed', {
        ticketId,
        status: ticket.status,
        message: error?.message || 'Error desconocido',
      });
      return { outcome: 'generation_error' };
    }
  }

  return { getPublicTicket, getPrivateTickets, getTicketDetail, getDynamicQr };
}
