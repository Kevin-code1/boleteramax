        const scanInput = document.getElementById('scan-input');
        const ticketIdInput = document.getElementById('ticket-id');
        const eventIdInput = document.getElementById('event-id');
        const tokenInput = document.getElementById('token');
        const dynamicTokenInput = document.getElementById('dynamic-token');
        const qrWindowInput = document.getElementById('qr-window');
        const resultState = document.getElementById('result-state');
        const resultDetails = document.getElementById('result-details');
        const validateBtn = document.getElementById('validate-btn');
        const advancedPanel = document.getElementById('advanced-panel');

        function esc(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function hasAdvancedValues() {
            return Boolean(
                ticketIdInput.value.trim() ||
                eventIdInput.value.trim() ||
                tokenInput.value.trim() ||
                dynamicTokenInput.value.trim() ||
                qrWindowInput.value.trim()
            );
        }

        function syncAdvancedPanelVisibility() {
            advancedPanel.open = hasAdvancedValues();
        }

        function fillFromPayload(payload = {}) {
            if (payload.ticketId) ticketIdInput.value = payload.ticketId;
            if (payload.eventId) eventIdInput.value = payload.eventId;
            if (payload.token) tokenInput.value = payload.token;
            if (payload.dynamicToken) dynamicTokenInput.value = payload.dynamicToken;
            if (payload.window !== undefined && payload.window !== null && payload.window !== '') {
                qrWindowInput.value = String(payload.window);
            }
            syncAdvancedPanelVisibility();
        }

        function parseScanInput() {
            const raw = scanInput.value.trim();
            if (!raw) return null;

            try {
                const parsed = JSON.parse(raw);
                fillFromPayload(parsed);
                return parsed;
            } catch (_) {
                // Extrae el ticketId de la URL del QR o de un ID suelto.
                const idMatch = raw.match(/BM-TKT-[A-Za-z0-9]+/);
                if (idMatch) {
                    ticketIdInput.value = idMatch[0];
                    syncAdvancedPanelVisibility();
                    return { ticketId: idMatch[0] };
                }
                return null;
            }
        }

        function getFormPayload() {
            parseScanInput();
            return {
                ticketId: ticketIdInput.value.trim(),
                eventId: eventIdInput.value.trim(),
                token: tokenInput.value.trim(),
                dynamicToken: dynamicTokenInput.value.trim(),
                window: qrWindowInput.value.trim() ? Number(qrWindowInput.value.trim()) : undefined,
            };
        }

        function formatDateTime(value) {
            if (!value) return 'No disponible';
            return new Date(value).toLocaleString('es-MX');
        }

        function getResultDescriptor(payload = {}) {
            const message = String(payload.message || '').toLowerCase();

            if (payload.valid) {
                return {
                    tone: 'success',
                    icon: '✓',
                    title: 'Acceso permitido',
                    detail: payload.message || 'Boleto valido y acceso autorizado.',
                };
            }

            if (message.includes('ya utilizado')) {
                return {
                    tone: 'duplicate',
                    icon: '↺',
                    title: 'Boleto ya utilizado',
                    detail: 'Este acceso ya fue consumido previamente.',
                };
            }

            if (message.includes('cancelado')) {
                return {
                    tone: 'duplicate',
                    icon: '⛔',
                    title: 'Boleto cancelado',
                    detail: 'Este boleto no es válido para permitir acceso.',
                };
            }

            return {
                tone: 'invalid',
                icon: '!',
                title: 'QR invalido o expirado',
                detail: payload.message || 'No fue posible validar este boleto.',
            };
        }

        function renderResult(payload = null) {
            if (!payload) {
                resultState.className = 'result-card neutral';
                resultState.innerHTML = `
                    <div class="result-head">
                        <div class="result-icon">•</div>
                        <div class="result-copy">
                            <h3>Esperando boleto para validar</h3>
                            <p>Escanea o pega un QR para ver el resultado operativo aqui.</p>
                        </div>
                    </div>
                `;
                resultDetails.replaceChildren();
                return;
            }

            const descriptor = getResultDescriptor(payload);
            const ticket = payload.ticket || null;
            const validatedAt = payload.usedAt || new Date().toISOString();

            resultState.className = `result-card ${descriptor.tone}`;
            resultState.innerHTML = `
                <div class="result-head">
                    <div class="result-icon">${esc(descriptor.icon)}</div>
                    <div class="result-copy">
                        <h3>${esc(descriptor.title)}</h3>
                        <p>${esc(descriptor.detail)}</p>
                    </div>
                </div>
            `;

            if (descriptor.tone === 'success') {
                resultState.classList.remove('success-pulse');
                void resultState.offsetWidth;
                resultState.classList.add('success-pulse');
            }

            resultDetails.replaceChildren();
            if (!ticket) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'result-detail-grid';
            wrapper.innerHTML = `
                <div class="result-detail detail-wide">
                    <span>Evento</span>
                    <strong>${esc(ticket.eventName || 'Evento no disponible')}</strong>
                </div>
                <div class="result-detail">
                    <span>Ticket ID</span>
                    <strong class="mono">${esc(ticket.ticketId || 'No disponible')}</strong>
                </div>
                <div class="result-detail">
                    <span>Estado</span>
                    <strong>${esc(ticket.status || 'No disponible')}</strong>
                </div>
                <div class="result-detail detail-wide">
                    <span>Asiento</span>
                    <strong>${esc(ticket.seatLabel || 'No disponible')}</strong>
                </div>
                <div class="result-detail">
                    <span>Hora de validacion</span>
                    <strong>${esc(formatDateTime(validatedAt))}</strong>
                </div>
                <div class="result-detail ${ticket.usedAt ? 'used-highlight' : ''}">
                    <span>Usado el</span>
                    <strong>${esc(ticket.usedAt ? formatDateTime(ticket.usedAt) : 'Aun no usado')}</strong>
                </div>
            `;
            resultDetails.appendChild(wrapper);
        }

        function getAdminApiKey() {
            const stored = sessionStorage.getItem('bm_admin_key') || '';
            if (stored) return stored;

            const entered = window.prompt('Clave de staff/admin') || '';
            const adminKey = entered.trim();
            if (adminKey) sessionStorage.setItem('bm_admin_key', adminKey);
            return adminKey;
        }

        async function validateTicket() {
            const payload = getFormPayload();
            if (!payload.ticketId) {
                renderResult({
                    valid: false,
                    message: 'Debes pegar el contenido del QR o capturar un ticketId.',
                });
                return;
            }

            // Pedir la clave antes de mostrar "Validando..." (prompt es bloqueante).
            const adminKey = getAdminApiKey();
            if (!adminKey) {
                renderResult({
                    valid: false,
                    message: 'Se requiere la clave de staff para validar el acceso.',
                });
                return;
            }

            validateBtn.disabled = true;
            validateBtn.textContent = 'Validando...';

            try {
                const response = await fetch('/api/validate-ticket', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': adminKey
                    },
                    body: JSON.stringify(payload),
                });

                const result = await response.json();
                if (response.status === 401) {
                    // Clave incorrecta: la limpiamos para volver a pedirla.
                    sessionStorage.removeItem('bm_admin_key');
                }
                renderResult(result);
            } catch (error) {
                renderResult({
                    valid: false,
                    message: error.message || 'No se pudo validar el boleto.',
                });
            } finally {
                validateBtn.disabled = false;
                validateBtn.textContent = 'Validar boleto';
            }
        }

        function preloadFromQuery() {
            const params = new URLSearchParams(window.location.search);
            let strippedSecretParams = false;
            ['token', 'dynamicToken', 'window'].forEach(key => {
                if (params.has(key)) {
                    params.delete(key);
                    strippedSecretParams = true;
                }
            });

            if (strippedSecretParams) {
                const cleanQuery = params.toString();
                const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
                window.history.replaceState(null, document.title, cleanUrl);
            }

            fillFromPayload({
                ticketId: params.get('ticketId') || '',
                eventId: params.get('eventId') || '',
            });
        }

        scanInput.addEventListener('input', parseScanInput);
        validateBtn.addEventListener('click', validateTicket);
        [ticketIdInput, eventIdInput, tokenInput, dynamicTokenInput, qrWindowInput].forEach(input => {
            input.addEventListener('input', syncAdvancedPanelVisibility);
        });

        preloadFromQuery();
        renderResult();
    
