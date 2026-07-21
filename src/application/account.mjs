export function createAccount({ ticketStore }) {
  async function getMyTickets(userId) {
    const tickets = await ticketStore.getTicketsByUserId(userId);
    return {
      outcome: 'ok',
      tickets: tickets.map(ticket => ticketStore.serializePublic(ticket)),
    };
  }

  return { getMyTickets };
}
