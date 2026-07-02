        const eventNameEl = document.getElementById('event-name');
        const statusPillEl = document.getElementById('status-pill');
        const messageCardEl = document.getElementById('message-card');
        const messageTitleEl = document.getElementById('message-title');
        const messageTextEl = document.getElementById('message-text');
        const metaGridEl = document.getElementById('meta-grid');
        const dateEl = document.getElementById('ticket-date');
        const venueEl = document.getElementById('ticket-venue');
        const seatEl = document.getElementById('ticket-seat');
        const ticketIdEl = document.getElementById('ticket-id');
        const usedAtCardEl = document.getElementById('used-at-card');
        const usedAtEl = document.getElementById('ticket-used-at');
        const dynamicSectionEl = document.getElementById('dynamic-section');
        const pageStateEl = document.getElementById('page-state');

        function getTicketIdFromPath() {
            const parts = window.location.pathname.split('/').filter(Boolean);
            return decodeURIComponent(parts[parts.length - 1] || '');
        }

        function formatDateTime(value) {
            if (!value) return 'No disponible';
            return new Date(value).toLocaleString('es-MX');
        }

        function applyStatusState(ticket) {
            const status = ticket.status || 'active';
            statusPillEl.className = `status-pill ${status}`;
            statusPillEl.textContent = status === 'used' ? 'Usado' : status === 'cancelled' ? 'Cancelado' : 'Activo';

            messageCardEl.className = `message-card ${status === 'active' ? 'active' : status === 'used' ? 'used' : 'cancelled'}`;

            if (status === 'used') {
                messageTitleEl.textContent = 'Este boleto ya fue utilizado';
                messageTextEl.textContent = ticket.usedAt
                    ? `Fue registrado por primera vez el ${formatDateTime(ticket.usedAt)}.`
                    : 'Este boleto ya no puede utilizarse para ingresar.';
            } else if (status === 'cancelled') {
                messageTitleEl.textContent = 'Este boleto esta cancelado';
                messageTextEl.textContent = 'No es valido para acceso al evento.';
            } else {
                messageTitleEl.textContent = 'Boleto activo';
                messageTextEl.textContent = 'Este es el enlace de visualización pública. Para ingresar al recinto, el titular debe presentar el boleto desde su sesión segura.';
            }
        }

        function renderTicket(ticket) {
            eventNameEl.textContent = ticket.eventName || 'Boleto BoletaMax';
            dateEl.textContent = ticket.date || 'Por confirmar';
            venueEl.textContent = ticket.venue || 'Por confirmar';
            seatEl.textContent = ticket.seatLabel || 'No disponible';
            ticketIdEl.textContent = ticket.ticketId || 'No disponible';
            metaGridEl.hidden = false;

            if (ticket.usedAt) {
                usedAtCardEl.hidden = false;
                usedAtEl.textContent = formatDateTime(ticket.usedAt);
            } else {
                usedAtCardEl.hidden = true;
                usedAtEl.textContent = '-';
            }

            applyStatusState(ticket);

            if (ticket.status === 'active') {
                dynamicSectionEl.hidden = false;
            } else {
                dynamicSectionEl.hidden = true;
            }
        }

        async function loadTicket() {
            const ticketId = getTicketIdFromPath();
            if (!ticketId) {
                pageStateEl.textContent = 'No se encontro un ticketId valido en la URL.';
                messageCardEl.className = 'message-card error';
                messageTitleEl.textContent = 'Boleto no disponible';
                messageTextEl.textContent = 'Abre este boleto desde un enlace valido de BoletaMax.';
                return;
            }

            try {
                const response = await fetch(`/api/public/tickets/${encodeURIComponent(ticketId)}`);
                const payload = await response.json();

                if (!response.ok || !payload.ok || !payload.ticket) {
                    throw new Error(payload.message || 'No se pudo cargar el boleto.');
                }

                renderTicket(payload.ticket);
                pageStateEl.hidden = true;
            } catch (error) {
                messageCardEl.className = 'message-card error';
                messageTitleEl.textContent = 'Boleto no encontrado';
                messageTextEl.textContent = error.message || 'No se pudo consultar este boleto.';
                pageStateEl.textContent = error.message || 'No se pudo consultar este boleto.';
            }
        }

        loadTicket();
    
