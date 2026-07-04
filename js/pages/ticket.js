        const stateEl = document.getElementById('page-state');
        const ticketsGrid = document.getElementById('tickets-grid');
        const summaryGrid = document.getElementById('summary-grid');

        function esc(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getTicketIds() {
            const params = new URLSearchParams(window.location.search);
            const fromQuery = (params.get('ticketIds') || '')
                .split(',')
                .map(id => id.trim())
                .filter(Boolean);

            if (fromQuery.length) return fromQuery;

            try {
                const fromSession = JSON.parse(sessionStorage.getItem('bm_last_ticket_ids') || '[]');
                return Array.isArray(fromSession) ? fromSession.filter(Boolean) : [];
            } catch (_) {
                return [];
            }
        }

        function getTicketTokens() {
            try {
                const fromSession = JSON.parse(sessionStorage.getItem('bm_last_tickets') || '[]');
                const map = {};
                if (Array.isArray(fromSession)) {
                    fromSession.forEach(item => {
                        if (item && item.ticketId && item.token) {
                            map[item.ticketId] = item.token;
                        }
                    });
                }
                return map;
            } catch (_) {
                return {};
            }
        }

        function statusLabel(status) {
            return ({
                active: 'Activo',
                used: 'Usado',
                cancelled: 'Cancelado',
            })[status] || status;
        }

        function statusClass(status) {
            return ['active', 'used', 'cancelled'].includes(status) ? status : 'cancelled';
        }

        function formatMoney(value) {
            return `$${Number(value || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
        }

        function renderSummary(tickets) {
            const first = tickets[0];
            const uniqueSeats = tickets.length;
            const summaryItems = [
                { label: 'Evento', value: first.eventName },
                { label: 'Fecha', value: first.date },
                { label: 'Venue', value: first.venue },
                { label: 'Boletos', value: `${uniqueSeats} ticket${uniqueSeats !== 1 ? 's' : ''}` },
            ];

            summaryGrid.replaceChildren();
            summaryItems.forEach(item => {
                const card = document.createElement('div');
                card.className = 'summary-card';
                card.innerHTML = `<span>${esc(item.label)}</span><strong>${esc(item.value)}</strong>`;
                summaryGrid.appendChild(card);
            });
        }

        function renderTicket(ticket) {
            const card = document.createElement('article');
            card.className = 'ticket-card';

            const usedMeta = ticket.usedAt
                ? `<div class="meta-row"><span>Usado el</span><strong>${esc(new Date(ticket.usedAt).toLocaleString('es-MX'))}</strong></div>`
                : '';
            const ticketId = String(ticket.ticketId || '');
            const eventId = String(ticket.eventId || '');

            card.innerHTML = `
                <div class="ticket-head">
                    <strong>Ticket ${esc(ticketId)}</strong>
                    <span class="status-pill ${statusClass(ticket.status)}">${esc(statusLabel(ticket.status))}</span>
                </div>
                <div class="ticket-body">
                    <div class="ticket-info">
                        <h2>${esc(ticket.eventName)}</h2>
                        <div class="meta-list">
                            <div class="meta-row"><span>Fecha</span><strong>${esc(ticket.date)}</strong></div>
                            <div class="meta-row"><span>Venue</span><strong>${esc(ticket.venue)}</strong></div>
                            <div class="meta-row"><span>Zona / Asiento</span><strong>${esc(ticket.seatLabel)}</strong></div>
                            ${usedMeta}
                        </div>
                        <div class="ticket-meta-grid">
                            <div class="ticket-meta-card">
                                <span>Ticket ID</span>
                                <strong class="ticket-code">${esc(ticketId)}</strong>
                            </div>
                            <div class="ticket-meta-card">
                                <span>Event ID</span>
                                <strong>${esc(eventId)}</strong>
                            </div>
                            <div class="ticket-meta-card price-card">
                                <span>Total Pagado</span>
                                <strong>${esc(formatMoney(ticket.totalPaid))}</strong>
                            </div>
                            <div class="ticket-meta-card">
                                <span>Estado</span>
                                <strong>${esc(statusLabel(ticket.status))}</strong>
                            </div>
                        </div>
                        <div class="ticket-actions">
                            <a class="btn" href="validate.html?ticketId=${encodeURIComponent(ticketId)}&eventId=${encodeURIComponent(eventId)}">Abrir validador</a>
                            <button class="btn copy-qr-btn" type="button" data-ticket-id="${esc(ticketId)}" data-event-id="${esc(eventId)}" disabled>Copiar contenido QR</button>
                        </div>
                    </div>
                    <div class="qr-panel" data-ticket-id="${esc(ticketId)}" data-event-id="${esc(eventId)}">
                        <div class="qr-status-row">
                            <div class="qr-dynamic-badge">QR dinámico activo</div>
                            <div class="qr-refresh">
                                <span class="qr-refresh-label">Renovación</span>
                                <strong class="qr-countdown">30s</strong>
                            </div>
                        </div>
                        <div class="qr-box">
                            <img class="qr-image" alt="QR del boleto ${esc(ticketId)}" />
                            <div class="qr-loading" hidden>
                                <div class="qr-skeleton" aria-hidden="true"></div>
                                <div class="qr-loading-text">Generando código seguro...</div>
                            </div>
                            <div class="qr-blocked" hidden>
                                <span class="qr-blocked-label">Estado del QR</span>
                                <strong class="qr-blocked-status">No disponible</strong>
                            </div>
                        </div>
                        <div class="qr-timer-track" aria-hidden="true">
                            <span class="qr-timer-fill"></span>
                        </div>
                        <div class="qr-note">
                            <strong>Presenta este codigo en el acceso</strong>
                            Si el staff tarda en escanear, espera la renovacion y vuelve a mostrar el QR actualizado.
                        </div>
                        <div class="qr-error" hidden></div>
                    </div>
                </div>
            `;

            return card;
        }

        // Modo cuenta (?mine=1): boletos y QR se autorizan por sesión.
        async function loadAccountTickets() {
            const params = new URLSearchParams(window.location.search);
            const wanted = (params.get('ticketIds') || '')
                .split(',')
                .map(id => id.trim())
                .filter(Boolean);

            try {
                const response = await fetch('/api/account/tickets');
                const payload = await response.json();

                if (response.status === 401) {
                    throw new Error(payload.message || 'Inicia sesión para ver tus boletos.');
                }
                if (!response.ok || !payload.ok) {
                    throw new Error(payload.message || 'No se pudieron cargar tus boletos.');
                }

                let tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
                if (wanted.length) {
                    tickets = tickets.filter(ticket => wanted.includes(ticket.ticketId));
                }
                if (!tickets.length) {
                    throw new Error('No encontramos boletos en tu cuenta.');
                }

                renderSummary(tickets);
                ticketsGrid.replaceChildren(...tickets.map(renderTicket));
                stateEl.remove();
                startDynamicQrLoop();
            } catch (error) {
                stateEl.textContent = error.message || 'No se pudieron cargar tus boletos.';
            }
        }

        async function loadTickets() {
            const params = new URLSearchParams(window.location.search);
            if (params.get('mine') === '1') {
                return loadAccountTickets();
            }

            const ticketIds = getTicketIds();
            const tokensMap = getTicketTokens();
            const resolvedIds = ticketIds.length ? ticketIds : Object.keys(tokensMap);
            const ticketRequests = resolvedIds
                .map(ticketId => ({
                    ticketId,
                    token: tokensMap[ticketId] || '',
                }))
                .filter(item => item.ticketId && item.token);

            if (!ticketRequests.length) {
                stateEl.textContent = 'No encontramos boletos recientes. Completa una compra o abre esta página con ?ticketIds=...';
                return;
            }

            try {
                const response = await fetch('/api/tickets/private', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tickets: ticketRequests }),
                });
                const payload = await response.json();

                if (!response.ok || !payload.ok || !Array.isArray(payload.tickets) || !payload.tickets.length) {
                    throw new Error(payload.message || 'No se pudieron cargar los boletos.');
                }

                const orderedTickets = resolvedIds
                    .map(id => payload.tickets.find(ticket => ticket.ticketId === id))
                    .filter(Boolean);

                renderSummary(orderedTickets);
                ticketsGrid.replaceChildren(...orderedTickets.map(renderTicket));
                stateEl.remove();
                startDynamicQrLoop();
            } catch (error) {
                stateEl.textContent = error.message || 'No se pudieron cargar los boletos.';
            }
        }

        function setQrLoadingState(panel, message = 'Generando código seguro...') {
            const image = panel.querySelector('.qr-image');
            const loading = panel.querySelector('.qr-loading');
            const loadingText = panel.querySelector('.qr-loading-text');
            const countdown = panel.querySelector('.qr-countdown');
            const badge = panel.querySelector('.qr-dynamic-badge');
            const refresh = panel.querySelector('.qr-refresh');
            const note = panel.querySelector('.qr-note');
            const error = panel.querySelector('.qr-error');
            const box = panel.querySelector('.qr-box');
            const blocked = panel.querySelector('.qr-blocked');
            const timerFill = panel.querySelector('.qr-timer-fill');
            updateCopyButtonState(panel, {
                disabled: true,
                label: 'Preparando QR...',
            });

            panel.dataset.active = 'loading';
            panel.dataset.expiresIn = '30';
            panel.classList.remove('is-warning', 'is-blocked');
            if (refresh) refresh.classList.remove('is-warning');
            if (box) box.classList.remove('is-blocked');
            if (image) image.removeAttribute('src');
            if (loadingText) loadingText.textContent = message;
            if (loading) loading.hidden = false;
            if (blocked) blocked.hidden = true;
            if (countdown) countdown.textContent = '--';
            if (badge) badge.textContent = 'QR dinámico activo';
            if (note) note.innerHTML = '<strong>Presenta este codigo en el acceso</strong><span>Si el staff tarda en escanear, espera la renovacion y vuelve a mostrar el QR actualizado.</span>';
            if (error) {
                error.hidden = true;
                error.textContent = '';
            }
            if (timerFill) timerFill.style.transform = 'scaleX(1)';
        }

        function updateCopyButtonState(panel, { disabled, label }) {
            const ticketId = panel.dataset.ticketId;
            if (!ticketId) return;

            const button = document.querySelector(`.copy-qr-btn[data-ticket-id="${ticketId}"]`);
            if (!button) return;

            button.disabled = disabled;
            button.textContent = label;
        }

        async function writeTextToClipboard(text) {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    return true;
                } catch (error) {
                    console.warn('BoletaMax QR: Clipboard API fallback', {
                        message: error?.message || 'Clipboard API bloqueada',
                    });
                }
            }

            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '0';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);

            try {
                return document.execCommand('copy');
            } finally {
                textarea.remove();
            }
        }

        function updateQrPanelState(panel, { state = 'active', active, message, qrImage, qrDataUrl, dynamicToken, window, expiresInSec, ticket }) {
            const image = panel.querySelector('.qr-image');
            const countdown = panel.querySelector('.qr-countdown');
            const badge = panel.querySelector('.qr-dynamic-badge');
            const refresh = panel.querySelector('.qr-refresh');
            const note = panel.querySelector('.qr-note');
            const error = panel.querySelector('.qr-error');
            const box = panel.querySelector('.qr-box');
            const loading = panel.querySelector('.qr-loading');
            const blocked = panel.querySelector('.qr-blocked');
            const blockedStatus = panel.querySelector('.qr-blocked-status');
            const timerFill = panel.querySelector('.qr-timer-fill');
            const imageSrc = qrImage || qrDataUrl || '';
            const resolvedState = state === 'blocked'
                ? 'blocked'
                : state === 'error'
                    ? 'error'
                    : active === false
                        ? 'blocked'
                        : 'active';

            panel.dataset.active = resolvedState === 'active' ? 'true' : 'false';
            panel.classList.remove('is-warning', 'is-blocked');
            if (refresh) refresh.classList.remove('is-warning');
            if (loading) loading.hidden = true;

            if (resolvedState === 'blocked') {
                if (image) image.removeAttribute('src');
                panel.dataset.expiresIn = '0';
                panel.dataset.dynamicToken = '';
                panel.dataset.window = '';
                panel.dataset.qrPayload = '';
                if (countdown) countdown.textContent = '0s';
                if (badge) badge.textContent = ticket?.status === 'used' ? 'QR no disponible' : 'QR inactivo';
                if (refresh) refresh.classList.add('is-warning');
                panel.classList.add('is-blocked');
                if (box) box.classList.add('is-blocked');
                if (blockedStatus) blockedStatus.textContent = ticket?.status === 'used' ? 'Boleto ya utilizado' : ticket?.status === 'cancelled' ? 'Boleto cancelado' : 'QR no disponible';
                if (blocked) blocked.hidden = false;
                if (timerFill) timerFill.style.transform = 'scaleX(0)';
                if (note) note.innerHTML = `<strong>Estado del boleto</strong><span>${esc(message || 'Este boleto ya no puede generar un QR válido.')}</span>`;
                if (error) {
                    error.hidden = false;
                    error.textContent = message || 'No se pudo generar el QR dinámico.';
                }
                updateCopyButtonState(panel, {
                    disabled: true,
                    label: 'QR no disponible',
                });
                return;
            }

            if (resolvedState === 'error') {
                if (image) image.removeAttribute('src');
                panel.dataset.expiresIn = '0';
                panel.dataset.dynamicToken = '';
                panel.dataset.window = '';
                panel.dataset.qrPayload = '';
                if (countdown) countdown.textContent = '--';
                if (badge) badge.textContent = 'Error QR';
                if (box) box.classList.remove('is-blocked');
                if (blocked) blocked.hidden = true;
                if (note) note.innerHTML = `<strong>No se pudo cargar el código</strong><span>${esc(message || 'Intenta nuevamente en unos segundos.')}</span>`;
                if (error) {
                    error.hidden = false;
                    error.textContent = message || 'No se pudo generar el QR dinámico.';
                }
                if (timerFill) timerFill.style.transform = 'scaleX(0)';
                updateCopyButtonState(panel, {
                    disabled: true,
                    label: 'Error de QR',
                });
                return;
            }

            if (image && imageSrc) image.src = imageSrc;
            if (countdown) countdown.textContent = `${expiresInSec || 30}s`;
            if (badge) badge.textContent = 'QR dinámico activo';
            if (box) box.classList.remove('is-blocked');
            if (blocked) blocked.hidden = true;
            if (note) note.innerHTML = '<strong>Presenta este codigo en el acceso</strong><span>Si el staff tarda en escanear, espera la renovacion y vuelve a mostrar el QR actualizado.</span>';
            if (error) {
                error.hidden = true;
                error.textContent = '';
            }
            panel.dataset.dynamicToken = dynamicToken || '';
            panel.dataset.window = window !== undefined && window !== null ? String(window) : '';
            panel.dataset.qrPayload = JSON.stringify({
                ticketId: panel.dataset.ticketId || '',
                eventId: panel.dataset.eventId || '',
                dynamicToken: dynamicToken || '',
                window: Number(window),
            }, null, 2);
            updateCopyButtonState(panel, {
                disabled: false,
                label: 'Copiar contenido QR',
            });
            updateQrCountdownVisual(panel, Number(expiresInSec || 30));
        }

        function updateQrCountdownVisual(panel, seconds) {
            const refresh = panel.querySelector('.qr-refresh');
            const timerFill = panel.querySelector('.qr-timer-fill');
            const next = Math.max(0, Number(seconds || 0));
            const progress = Math.min(1, Math.max(0, next / 30));

            if (timerFill) {
                timerFill.style.transform = `scaleX(${progress})`;
                timerFill.style.background = next < 5
                    ? 'linear-gradient(90deg, rgba(255, 213, 122, 0.95), rgba(255, 239, 188, 1))'
                    : 'linear-gradient(90deg, rgba(212, 175, 55, 0.9), rgba(248, 223, 142, 0.98))';
            }

            const isWarning = next > 0 && next < 5;
            panel.classList.toggle('is-warning', isWarning);
            if (refresh) refresh.classList.toggle('is-warning', isWarning);
        }

        async function refreshDynamicQr(panel) {
            const ticketId = panel.dataset.ticketId;
            if (!ticketId) return;
            if (document.hidden || panel.dataset.inViewport === 'false') return;

            const tokensMap = getTicketTokens();
            const token = tokensMap[ticketId] || '';

            console.log('BoletaMax QR: frontend request', { ticketId });
            setQrLoadingState(panel);

            try {
                const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/dynamic-qr`, {
                    headers: {
                        'x-ticket-token': token,
                    },
                });
                const payload = await response.json();

                if (!response.ok || !payload.ok) {
                    throw new Error(payload.message || 'No se pudo actualizar el QR.');
                }

                if (payload.active === true) {
                    if (!(payload.qrImage || payload.qrDataUrl) || !payload.dynamicToken || payload.window === undefined || payload.window === null) {
                        throw new Error('Respuesta incompleta del QR dinámico.');
                    }

                    console.log('BoletaMax QR: frontend success', {
                        ticketId,
                        window: payload.window,
                        expiresInSec: payload.expiresInSec,
                    });
                    updateQrPanelState(panel, payload);
                } else {
                    console.log('BoletaMax QR: frontend unavailable', {
                        ticketId,
                        status: payload.ticket?.status,
                        message: payload.message,
                    });
                    updateQrPanelState(panel, {
                        state: 'blocked',
                        ...payload,
                    });
                }
                panel.dataset.expiresIn = String(payload.active ? (payload.expiresInSec || 30) : 0);
            } catch (error) {
                console.error('BoletaMax QR: frontend failed', {
                    ticketId,
                    message: error.message || 'No se pudo actualizar el QR.',
                });
                updateQrPanelState(panel, {
                    state: 'error',
                    message: error.message || 'No se pudo actualizar el QR.',
                });
            }
        }

        function startDynamicQrLoop() {
            const panels = Array.from(document.querySelectorAll('.qr-panel[data-ticket-id]'));
            if (!panels.length) return;

            const viewportObserver = 'IntersectionObserver' in window
                ? new IntersectionObserver(entries => {
                    entries.forEach(entry => {
                        entry.target.dataset.inViewport = entry.isIntersecting ? 'true' : 'false';
                        if (entry.isIntersecting && !document.hidden && entry.target.dataset.active !== 'false') {
                            refreshDynamicQr(entry.target);
                        }
                    });
                }, { threshold: 0.2 })
                : null;

            panels.forEach(panel => {
                panel.dataset.inViewport = 'true';
                panel.dataset.expiresIn = '30';
                if (viewportObserver) viewportObserver.observe(panel);
                refreshDynamicQr(panel);
            });

            if (window.dynamicQrInterval) clearInterval(window.dynamicQrInterval);
            window.dynamicQrInterval = setInterval(() => {
                if (document.hidden) return;
                panels.forEach(panel => {
                    if (panel.dataset.active === 'false' || panel.dataset.inViewport === 'false') return;
                    const next = Math.max(0, Number(panel.dataset.expiresIn || '0') - 1);
                    panel.dataset.expiresIn = String(next);
                    const countdown = panel.querySelector('.qr-countdown');
                    if (countdown) countdown.textContent = `${next}s`;
                    updateQrCountdownVisual(panel, next);
                    if (next <= 0) refreshDynamicQr(panel);
                });
            }, 1000);

            document.addEventListener('visibilitychange', () => {
                if (document.hidden) return;
                panels.forEach(panel => {
                    if (panel.dataset.inViewport !== 'false' && panel.dataset.active !== 'false') {
                        refreshDynamicQr(panel);
                    }
                });
            });
        }

        async function copyQrPayload(button) {
            const ticketId = button.dataset.ticketId;
            const panel = document.querySelector(`.qr-panel[data-ticket-id="${ticketId}"]`);
            if (!panel) return;

            const dynamicToken = panel.dataset.dynamicToken || '';
            const windowValue = panel.dataset.window || '';
            const eventId = panel.dataset.eventId || button.dataset.eventId || '';
            const readyPayload = panel.dataset.qrPayload || '';

            if ((!readyPayload && (!dynamicToken || !windowValue)) || panel.dataset.active !== 'true') {
                button.textContent = 'QR no listo';
                window.setTimeout(() => {
                    button.textContent = button.disabled ? 'QR no disponible' : 'Copiar contenido QR';
                }, 1400);
                return;
            }

            const payload = readyPayload || JSON.stringify({
                ticketId,
                eventId,
                dynamicToken,
                window: Number(windowValue),
            }, null, 2);

            const originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = 'Copiando...';

            try {
                const copied = await writeTextToClipboard(payload);
                if (!copied) throw new Error('El navegador bloqueo la copia.');
                button.textContent = 'Contenido copiado';
                window.setTimeout(() => {
                    button.disabled = false;
                    button.textContent = 'Copiar contenido QR';
                }, 1600);
            } catch (error) {
                console.error('BoletaMax QR: copy failed', {
                    ticketId,
                    message: error?.message || 'No se pudo copiar',
                });
                button.textContent = 'No se pudo copiar';
                window.setTimeout(() => {
                    button.disabled = false;
                    button.textContent = originalLabel === 'Copiando...' ? 'Copiar contenido QR' : originalLabel;
                }, 1600);
            }
        }

        ticketsGrid.addEventListener('click', event => {
            const button = event.target.closest('.copy-qr-btn');
            if (!button) return;
            copyQrPayload(button);
        });

        loadTickets();
    
