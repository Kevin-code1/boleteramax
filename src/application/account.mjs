export function createAccount({ ticketStore }) {
  // "Mis boletos": todos los boletos de las órdenes del usuario.
  async function getMyTickets(userId) {
    const tickets = await ticketStore.getTicketsByUserId(userId);
    return {
      outcome: 'ok',
      tickets: tickets.map(ticket => ticketStore.serializePublic(ticket)),
    };
  }

  return { getMyTickets };
}
