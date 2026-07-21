import { DYNAMIC_QR_TOLERANCE_WINDOWS } from '../config/index.mjs';
import { safeEqualString } from '../domain/text.mjs';
import { createDynamicToken, getDynamicQrWindow } from '../domain/tickets.mjs';

export function createValidateTicket({ ticketStore }) {
  return async function validateTicket({ ticketId, eventId, token, dynamicToken, window }) {
    const cleanTicketId = String(ticketId || '').trim();
    const cleanEventId = String(eventId || '').trim();
    const cleanToken = String(token || '').trim();
    const cleanDynamicToken = String(dynamicToken || '').trim();
    const requestedWindow = Number(window);

    if (!cleanTicketId) {
      return {
        valid: false,
        message: 'Boleto inválido',
      };
    }

    return ticketStore.withValidationLock(cleanTicketId, async () => {
      const ticket = await ticketStore.getTicketById(cleanTicketId);

      if (!ticket) {
        return {
          valid: false,
          message: 'Boleto inválido',
        };
      }

      if (cleanEventId && ticket.eventId !== cleanEventId) {
        return {
          valid: false,
          message: 'Boleto inválido',
        };
      }

      const hasDynamicPayload = Boolean(cleanDynamicToken) || Number.isFinite(requestedWindow);
      if (hasDynamicPayload) {
        if (!cleanDynamicToken || !Number.isFinite(requestedWindow)) {
          return {
            valid: false,
            message: 'QR inválido o expirado',
          };
        }

        const currentWindow = getDynamicQrWindow();
        const candidateWindows = new Set([
          currentWindow,
          currentWindow - DYNAMIC_QR_TOLERANCE_WINDOWS,
        ]);

        if (!candidateWindows.has(requestedWindow)) {
          return {
            valid: false,
            message: 'QR inválido o expirado',
          };
        }

        const expectedDynamicToken = createDynamicToken(
          ticket.ticketId,
          ticketStore.getDynamicSecret(ticket),
          requestedWindow,
        );
        if (!safeEqualString(cleanDynamicToken, expectedDynamicToken)) {
          return {
            valid: false,
            message: 'Boleto inválido',
          };
        }
      } else if (cleanToken) {
        if (!ticketStore.verifyPrivateToken(ticket, cleanToken)) {
          return {
            valid: false,
            message: 'Boleto inválido',
          };
        }
      }

      if (ticket.status === 'used' || ticket.usedAt) {
        return {
          valid: false,
          message: 'Boleto ya utilizado',
          usedAt: ticket.usedAt || null,
          ticket: ticketStore.serializePublic(ticket),
        };
      }

      if (ticket.status === 'cancelled') {
        return {
          valid: false,
          message: 'Boleto cancelado',
          ticket: ticketStore.serializePublic(ticket),
        };
      }

      if (ticket.status !== 'active') {
        return {
          valid: false,
          message: 'Boleto inválido',
          ticket: ticketStore.serializePublic(ticket),
        };
      }

      const usedAt = new Date().toISOString();
      const markResult = await ticketStore.markTicketUsed({
        ticket,
        ticketId: cleanTicketId,
        usedAt,
      });

      if (!markResult.updated) {
        const latestTicket = markResult.ticket || ticket;
        if (markResult.reason === 'already_used') {
          return {
            valid: false,
            message: 'Boleto ya utilizado',
            usedAt: latestTicket.usedAt || null,
            ticket: ticketStore.serializePublic(latestTicket),
          };
        }

        if (markResult.reason === 'cancelled') {
          return {
            valid: false,
            message: 'Boleto cancelado',
            ticket: ticketStore.serializePublic(latestTicket),
          };
        }

        return {
          valid: false,
          message: 'Boleto inválido',
          ticket: ticketStore.serializePublic(latestTicket),
        };
      }

      return {
        valid: true,
        message: 'Boleto válido',
        usedAt,
        ticket: ticketStore.serializePublic(markResult.ticket),
      };
    });
  };
}
