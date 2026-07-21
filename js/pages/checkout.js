        function safeParse(json, fallback) {
            try {
                return JSON.parse(json);
            } catch (_) {
                return fallback;
            }
        }

        const cart = safeParse(sessionStorage.getItem('bm_cart') || '{}', {});
        const eventData = cart.event || {};
        let seats = Array.isArray(cart.seats) ? cart.seats : [];
        let subtotal = Number.isFinite(cart.subtotal) ? cart.subtotal : 0;
        let fee = Number.isFinite(cart.fee) ? cart.fee : 0;
        let total = Number.isFinite(cart.total) ? cart.total : 0;
        let speiTotal = Math.round(total * 0.955);
        let hasValidCart = seats.length > 0 && Boolean(eventData.name);
        let checkoutQuote = null;
        let turnstileToken = '';
        let turnstileWidgetId = null;
        let turnstileRequired = false;

        const alertEl = document.getElementById('checkout-alert');
        const buyerNameInput = document.getElementById('buyer-name');
        const buyerEmailInput = document.getElementById('buyer-email');
        const buyerFieldsEl = document.getElementById('buyer-fields');
        const buyerHintEl = document.getElementById('buyer-hint');
        const buyerSessionEl = document.getElementById('buyer-session');
        const buyerSessionCopyEl = document.getElementById('buyer-session-copy');
        const buyerErrorEl = document.getElementById('buyer-error');
        const seatsList = document.getElementById('co-seats-list');
        const timerEl = document.getElementById('timer-countdown');
        const paymentCards = Array.from(document.querySelectorAll('.pm-card'));
        const paymentButtons = Array.from(document.querySelectorAll('.pm-btn'));
        const confirmOverlay = document.getElementById('confirm-overlay');
        const confirmActionBtn = document.getElementById('confirm-action-btn');
        const speiCard = document.querySelector('.pm-card.featured');
        const securityStatusPill = document.getElementById('security-status-pill');
        const pricingSecurityCopy = document.getElementById('pricing-security-copy');
        const turnstileContainer = document.getElementById('turnstile-container');

        const ZONE_COLORS = {
            fan: '#8da2c4', vip5: '#d4af37', oro5: '#5f7fa8',
            oro: '#415674', gen: '#2d3b52',
        };

        function zoneColor(zoneLabel) {
            const map = {
                'FAN': '#f59e0b', 'VIP': '#ef4444', 'ORO 5': '#38bdf8', 'RINGSIDE': '#f59e0b', 'ORQUESTA': '#f59e0b',
                'ORO': '#f97316', 'GENERAL': '#6366f1', 'GALERÍA': '#6366f1', 'PLATINO': '#38bdf8', 'LUNETA': '#ef4444',
                'MEZZANINE': '#38bdf8', 'PALCO': '#f97316'
            };
            return map[zoneLabel] || '#94a3b8';
        }

        function showCheckoutAlert(message) {
            alertEl.textContent = message;
            alertEl.classList.add('show');
            alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        function setPaymentEnabled(enabled) {
            paymentCards.forEach(card => {
                card.setAttribute('aria-disabled', String(!enabled));
                card.tabIndex = enabled ? 0 : -1;
            });
            paymentButtons.forEach(button => {
                button.disabled = !enabled;
            });
        }

        function formatCurrency(value, options = {}) {
            const amount = Number(value || 0);
            return `$${amount.toLocaleString('es-MX', {
                minimumFractionDigits: options.decimals ?? 2,
                maximumFractionDigits: options.decimals ?? 2,
            })} MXN`;
        }

        function setSecurityStatus(label, tone = 'warning', icon = 'fa-shield-halved') {
            if (!securityStatusPill) return;
            securityStatusPill.classList.remove('ready', 'warning', 'danger');
            securityStatusPill.classList.add(tone);
            securityStatusPill.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
        }

        function syncPricingDisplay() {
            if (!checkoutQuote) {
                document.getElementById('co-subtotal').textContent = 'Verificando';
                document.getElementById('co-fee').textContent = '-';
                document.getElementById('co-total').textContent = 'Servidor';
                document.getElementById('amt-tarjeta').textContent = '0.00';
                document.getElementById('amt-spei').textContent = '0.00';
                document.getElementById('amt-oxxo').textContent = '0.00';
                return;
            }

            document.getElementById('co-subtotal').textContent = formatCurrency(subtotal, { decimals: 0 });
            document.getElementById('co-fee').textContent = formatCurrency(fee, { decimals: 0 });
            document.getElementById('co-total').textContent = formatCurrency(total, { decimals: 0 });
            document.getElementById('amt-tarjeta').textContent = Number(total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
            document.getElementById('amt-spei').textContent = Number(speiTotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
            document.getElementById('amt-oxxo').textContent = Number((checkoutQuote?.paymentTotals?.oxxo) || (total + 17)).toLocaleString('es-MX', { minimumFractionDigits: 2 });
            if (speiCard) {
                speiCard.dataset.savings = Math.max(total - speiTotal, 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
            }
        }

        function loadExternalScript(src) {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) return Promise.resolve();

            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.defer = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error('No fue posible cargar la proteccion Cloudflare.'));
                document.head.appendChild(script);
            });
        }

        async function loadCloudflareSecurity() {
            if (!pricingSecurityCopy) return;

            try {
                const response = await fetch('/api/security-config');
                const payload = await response.json();
                const cloudflare = payload?.cloudflare || {};

                if (!cloudflare.turnstileEnabled || !cloudflare.siteKey) {
                    turnstileRequired = false;
                    pricingSecurityCopy.textContent = 'Los precios se calculan y firman en el servidor antes de habilitar el pago.';
                    return;
                }

                turnstileRequired = true;
                pricingSecurityCopy.textContent = 'Valida la proteccion Cloudflare para continuar con el pago seguro.';
                await loadExternalScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');

                if (!window.turnstile || !turnstileContainer || turnstileWidgetId !== null) return;
                turnstileWidgetId = window.turnstile.render(turnstileContainer, {
                    sitekey: cloudflare.siteKey,
                    callback: token => {
                        turnstileToken = token || '';
                        setSecurityStatus(checkoutQuote ? 'Protegido' : 'Cloudflare listo', 'ready', 'fa-cloud');
                    },
                    'expired-callback': () => {
                        turnstileToken = '';
                        setSecurityStatus('Verifica otra vez', 'warning', 'fa-triangle-exclamation');
                    },
                    'error-callback': () => {
                        turnstileToken = '';
                        setSecurityStatus('Cloudflare error', 'danger', 'fa-triangle-exclamation');
                    },
                });
            } catch (error) {
                console.warn('BoletaMax Checkout: Cloudflare no disponible', error);
                pricingSecurityCopy.textContent = 'No se pudo cargar Cloudflare en este momento; el precio sigue protegido por el servidor.';
            }
        }

        async function loadServerQuote() {
            setSecurityStatus('Verificando', 'warning', 'fa-shield-halved');
            setPaymentEnabled(false);

            const response = await fetch('/api/checkout/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: eventData, seats }),
            });
            const payload = await response.json();

            if (!response.ok || !payload.ok || !payload.quote) {
                throw new Error(payload.message || 'No fue posible validar precios con el servidor.');
            }

            checkoutQuote = payload.quote;
            seats = Array.isArray(checkoutQuote.seats) ? checkoutQuote.seats : seats;
            subtotal = Number(checkoutQuote.subtotal || 0);
            fee = Number(checkoutQuote.fee || 0);
            total = Number(checkoutQuote.paymentTotals?.tarjeta || checkoutQuote.total || 0);
            speiTotal = Number(checkoutQuote.paymentTotals?.spei || Math.round(total * 0.955));
            hasValidCart = seats.length > 0 && total > 0 && Boolean(checkoutQuote.event?.name);
            renderSeatList();
            syncPricingDisplay();
            setSecurityStatus('Precio verificado', 'ready', 'fa-circle-check');
            if (pricingSecurityCopy) {
                pricingSecurityCopy.textContent = `Cotizacion ${checkoutQuote.quoteId} firmada por el servidor. Aunque el navegador cambie precios, el backend cobra el importe autorizado.`;
            }
        }

        function renderSeatList() {
            seatsList.replaceChildren();

            if (!seats.length) {
                const empty = document.createElement('div');
                empty.style.color = 'rgba(255,255,255,0.35)';
                empty.style.fontSize = '.8rem';
                empty.textContent = 'No hay asientos seleccionados.';
                seatsList.appendChild(empty);
                return;
            }

            seats.forEach(seat => {
                const row = document.createElement('div');
                row.className = 'os-seat-row';

                const zone = document.createElement('span');
                zone.className = 'seat-zone';
                const dot = document.createElement('span');
                dot.className = 'seat-dot';
                dot.style.background = zoneColor(seat.zone);
                const label = document.createElement('span');
                label.textContent = seat.tableSize > 1
                    ? `${seat.zone} · Fila ${seat.fila} · Mesa ${seat.mesa} · Lugar ${seat.seatInMesa}`
                    : `${seat.zone} · Fila ${seat.fila} · Asiento ${seat.asiento}`;
                zone.append(dot, label);

                const price = document.createElement('span');
                price.className = 'os-seat-price';
                price.textContent = `$${seat.price.toLocaleString('es-MX')} MXN`;

                row.append(zone, price);
                seatsList.appendChild(row);
            });
        }

        function renderSuccessScreen() {
            const wrapper = document.createElement('div');
            wrapper.style.minHeight = '100vh';
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.justifyContent = 'center';
            wrapper.style.background = '#0d1829';
            wrapper.style.fontFamily = "'Inter',sans-serif";
            wrapper.style.padding = '24px';

            const card = document.createElement('div');
            card.style.textAlign = 'center';
            card.style.padding = '48px 32px';
            card.style.background = '#111827';
            card.style.borderRadius = '24px';
            card.style.maxWidth = '480px';
            card.style.width = '100%';
            card.style.border = '1px solid rgba(255,255,255,0.08)';

            const icon = document.createElement('div');
            icon.style.fontSize = '4rem';
            icon.style.marginBottom = '16px';
            icon.textContent = '🎉';

            const title = document.createElement('h1');
            title.style.fontFamily = "'Space Grotesk',sans-serif";
            title.style.fontSize = '1.6rem';
            title.style.color = '#fff';
            title.style.fontWeight = '800';
            title.style.marginBottom = '10px';
            title.textContent = '¡Compra Exitosa!';

            const description = document.createElement('p');
            description.style.color = 'rgba(255,255,255,0.5)';
            description.style.marginBottom = '24px';
            description.style.lineHeight = '1.65';
            description.style.fontSize = '.9rem';
            description.textContent = 'Tu pedido ha sido procesado correctamente. Tus boletos digitales con código QR ya están disponibles.';

            const summary = document.createElement('div');
            summary.style.background = 'rgba(34,197,94,0.08)';
            summary.style.border = '1px solid rgba(34,197,94,0.2)';
            summary.style.borderRadius = '12px';
            summary.style.padding = '16px 20px';
            summary.style.marginBottom = '28px';
            summary.style.textAlign = 'left';

            const summaryLabel = document.createElement('div');
            summaryLabel.style.fontSize = '.75rem';
            summaryLabel.style.color = 'rgba(255,255,255,0.35)';
            summaryLabel.style.textTransform = 'uppercase';
            summaryLabel.style.letterSpacing = '.5px';
            summaryLabel.style.marginBottom = '8px';
            summaryLabel.textContent = 'Resumen';

            const summaryName = document.createElement('div');
            summaryName.style.fontSize = '.9rem';
            summaryName.style.color = 'rgba(255,255,255,0.75)';
            const summaryStrong = document.createElement('strong');
            summaryStrong.style.color = '#fff';
            summaryStrong.textContent = eventData.name || 'Evento';
            summaryName.appendChild(summaryStrong);

            const summaryMeta = document.createElement('div');
            summaryMeta.style.fontSize = '.8rem';
            summaryMeta.style.color = 'rgba(255,255,255,0.45)';
            summaryMeta.style.marginTop = '4px';
            summaryMeta.textContent = `Fecha: ${eventData.date || 'Por confirmar'} · Venue: ${eventData.venue || 'Por confirmar'}`;

            summary.append(summaryLabel, summaryName, summaryMeta);

            const homeLink = document.createElement('a');
            homeLink.href = 'index.html';
            homeLink.style.display = 'inline-flex';
            homeLink.style.alignItems = 'center';
            homeLink.style.gap = '8px';
            homeLink.style.background = '#f59e0b';
            homeLink.style.color = '#0B1F3A';
            homeLink.style.fontWeight = '800';
            homeLink.style.padding = '14px 32px';
            homeLink.style.borderRadius = '12px';
            homeLink.style.textDecoration = 'none';
            homeLink.style.fontSize = '1rem';
            homeLink.textContent = 'Volver al Inicio';

            card.append(icon, title, description, summary, homeLink);
            wrapper.appendChild(card);
            document.body.replaceChildren(wrapper);
        }

        function setConfirmActionState(isLoading) {
            if (!confirmActionBtn) return;
            confirmActionBtn.disabled = isLoading;
            confirmActionBtn.innerHTML = isLoading
                ? '<i class="fas fa-spinner fa-spin"></i> Generando boleto...'
                : '<i class="fas fa-check"></i> Entendido – Proceder';
        }

        async function createTicketsFromCheckout() {
            const info = PM_INFO[selectedMethod];
            const response = await fetch('/api/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: eventData,
                    seats,
                    totalPaid: info.totalFn(),
                    paymentMethod: selectedMethod,
                    quote: checkoutQuote,
                    turnstileToken,
                    buyer: getBuyerPayload(),
                }),
            });

            const payload = await response.json();
            if (!response.ok || !payload.ok || !Array.isArray(payload.tickets) || !payload.tickets.length) {
                throw new Error(payload.message || 'No se pudieron generar los boletos.');
            }

            return payload;
        }

        document.getElementById('co-event-name').textContent = eventData.name || 'Evento';
        document.getElementById('co-event-date').textContent = eventData.date || '—';
        document.getElementById('co-event-venue').textContent = eventData.venue || '—';
        renderSeatList();

        document.getElementById('co-subtotal').textContent = `$${subtotal.toLocaleString('es-MX')} MXN`;
        document.getElementById('co-fee').textContent = `$${fee.toLocaleString('es-MX')} MXN`;
        document.getElementById('co-total').textContent = `$${total.toLocaleString('es-MX')} MXN`;
        document.getElementById('amt-tarjeta').textContent = total.toLocaleString('es-MX', { minimumFractionDigits: 2 });
        document.getElementById('amt-spei').textContent = speiTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 });
        document.getElementById('amt-oxxo').textContent = (total + 17).toLocaleString('es-MX', { minimumFractionDigits: 2 });
        if (speiCard) speiCard.dataset.savings = Math.max(total - speiTotal, 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
        syncPricingDisplay();

        const PM_INFO = {
            tarjeta: {
                name: 'Tarjeta de Crédito / Débito',
                instructions: 'Método seleccionado: tarjeta de crédito o débito. Al confirmar tu pedido, tus boletos digitales quedan disponibles de inmediato.',
                totalFn: () => total,
            },
            spei: {
                name: 'Transferencia SPEI',
                instructions: 'Método seleccionado: transferencia SPEI. El total ya incluye el ahorro en comisión. Al confirmar tu pedido, tus boletos quedan disponibles de inmediato.',
                totalFn: () => speiTotal,
            },
            oxxo: {
                name: 'OXXO Pay',
                instructions: 'Método seleccionado: pago en efectivo en OXXO. El total incluye la comisión de $17 del establecimiento. Al confirmar tu pedido, tus boletos quedan disponibles de inmediato.',
                totalFn: () => total + 17,
            },
        };

        let selectedMethod = null;
        let timerInterval = null;

        let sessionBuyer = null;
        const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

        function setBuyerError(message) {
            if (!buyerErrorEl) return;
            buyerErrorEl.textContent = message || '';
            buyerErrorEl.hidden = !message;
        }

        async function loadBuyerContext() {
            try {
                const response = await fetch('/api/auth/me');
                if (!response.ok) return;
                const payload = await response.json();
                if (!payload.ok || !payload.user) return;

                sessionBuyer = payload.user;
                if (buyerFieldsEl) buyerFieldsEl.hidden = true;
                if (buyerHintEl) buyerHintEl.textContent = 'Tus boletos quedarán asociados a tu cuenta.';
                if (buyerSessionCopyEl) {
                    buyerSessionCopyEl.textContent =
                        `Comprando con tu cuenta: ${sessionBuyer.displayName} (${sessionBuyer.email})`;
                }
                if (buyerSessionEl) buyerSessionEl.hidden = false;
                setBuyerError('');
            } catch (_) {
            }
        }

        function validateBuyer({ focusInvalid = false } = {}) {
            if (sessionBuyer) return true;

            const name = buyerNameInput?.value.trim() || '';
            const email = buyerEmailInput?.value.trim().toLowerCase() || '';
            const nameValid = Boolean(name) && name.length <= 80;
            const emailValid = email.length <= 254 && EMAIL_PATTERN.test(email);

            buyerNameInput?.setAttribute('aria-invalid', String(!nameValid));
            buyerEmailInput?.setAttribute('aria-invalid', String(!emailValid));

            if (nameValid && emailValid) {
                setBuyerError('');
                return true;
            }

            setBuyerError(!nameValid
                ? 'Escribe el nombre completo del comprador.'
                : 'Escribe un correo electrónico válido para recibir tus boletos.');
            if (focusInvalid) (!nameValid ? buyerNameInput : buyerEmailInput)?.focus();
            return false;
        }

        function getBuyerPayload() {
            if (sessionBuyer) return undefined;
            return {
                name: buyerNameInput?.value.trim() || '',
                email: buyerEmailInput?.value.trim().toLowerCase() || '',
            };
        }

        [buyerNameInput, buyerEmailInput].forEach(input => {
            input?.addEventListener('input', () => {
                input.removeAttribute('aria-invalid');
                setBuyerError('');
            });
        });

        function formatTime(s) {
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return `${m}:${sec.toString().padStart(2, '0')}`;
        }

        function getQuoteSecondsRemaining() {
            const expiresAtMs = Date.parse(checkoutQuote?.expiresAt || '');
            if (!Number.isFinite(expiresAtMs)) return null;
            return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
        }

        function renderTimer(secs) {
            timerEl.textContent = formatTime(secs);
            if (secs <= 60) timerEl.style.color = '#ef4444';
        }

        function handleQuoteExpired() {
            timerEl.textContent = '0:00';
            sessionStorage.removeItem('bm_cart');
            sessionStorage.removeItem('bm_event');
            confirmOverlay.classList.remove('show');
            showCheckoutAlert('Tu cotización expiró. Vuelve a seleccionar tus asientos.');
            setPaymentEnabled(false);
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1800);
        }

        function startTimer() {
            const initialSecs = getQuoteSecondsRemaining();
            if (initialSecs === null) {
                timerEl.textContent = '--:--';
                return;
            }

            renderTimer(initialSecs);
            if (initialSecs <= 0) {
                handleQuoteExpired();
                return;
            }

            timerInterval = setInterval(() => {
                const secs = getQuoteSecondsRemaining();
                if (secs === null) {
                    clearInterval(timerInterval);
                    timerEl.textContent = '--:--';
                    return;
                }
                renderTimer(secs);
                if (secs <= 0) {
                    clearInterval(timerInterval);
                    handleQuoteExpired();
                }
            }, 1000);
        }

        async function initializeCheckout() {
            if (!hasValidCart) {
                timerEl.textContent = '--:--';
                showCheckoutAlert('Tu carrito ya no esta disponible o se abrio el checkout sin asientos. Vuelve al inicio para seleccionar lugares.');
                setSecurityStatus('Sin asientos', 'danger', 'fa-circle-xmark');
                setPaymentEnabled(false);
                return;
            }

            try {
                await loadBuyerContext();
                await loadServerQuote();
                await loadCloudflareSecurity();
                setPaymentEnabled(true);
                startTimer();
            } catch (error) {
                console.error('BoletaMax Checkout: cotizacion segura fallida', error);
                showCheckoutAlert(error.message || 'No fue posible validar tu compra con el servidor.');
                setSecurityStatus('No validado', 'danger', 'fa-triangle-exclamation');
                if (pricingSecurityCopy) {
                    pricingSecurityCopy.textContent = 'No habilitamos el pago porque el servidor no pudo confirmar precios y disponibilidad.';
                }
                setPaymentEnabled(false);
            }
        }

        function syncPaymentSelection(activeCard) {
            paymentCards.forEach(card => {
                const isActive = card === activeCard;
                card.classList.toggle('selected', isActive);
                card.setAttribute('aria-pressed', String(isActive));
            });
        }

        function selectPayment(method, card) {
            if (!hasValidCart) {
                showCheckoutAlert('No encontramos asientos seleccionados. Regresa a la selección de asientos para continuar.');
                return;
            }

            if (!checkoutQuote) {
                showCheckoutAlert('Aun estamos verificando precios con el servidor. Intenta de nuevo en un momento.');
                return;
            }

            if (turnstileRequired && !turnstileToken) {
                showCheckoutAlert('Completa la verificacion Cloudflare antes de seleccionar el metodo de pago.');
                return;
            }

            if (!validateBuyer({ focusInvalid: true })) {
                showCheckoutAlert('Completa tus datos de comprador antes de elegir el método de pago.');
                return;
            }

            const info = PM_INFO[method];
            if (!info) return;

            selectedMethod = method;
            syncPaymentSelection(card || null);
            const payableTotal = info.totalFn();

            document.getElementById('confirm-method-name').textContent = info.name;
            document.getElementById('confirm-instructions').textContent = info.instructions;
            document.getElementById('confirm-total-display').textContent = `$${payableTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
            confirmOverlay.classList.add('show');
        }

        async function finishCheckout() {
            if (!hasValidCart || !selectedMethod) {
                showCheckoutAlert('Selecciona primero tus asientos y un método de pago válido.');
                confirmOverlay.classList.remove('show');
                return;
            }

            if (!checkoutQuote) {
                showCheckoutAlert('La cotizacion segura aun no esta lista. Espera unos segundos y vuelve a intentar.');
                confirmOverlay.classList.remove('show');
                return;
            }

            if (turnstileRequired && !turnstileToken) {
                showCheckoutAlert('Completa la verificacion Cloudflare para continuar con el pago.');
                confirmOverlay.classList.remove('show');
                return;
            }

            if (!validateBuyer({ focusInvalid: true })) {
                showCheckoutAlert('Completa tus datos de comprador para generar los boletos.');
                confirmOverlay.classList.remove('show');
                return;
            }

            try {
                setConfirmActionState(true);
                const payload = await createTicketsFromCheckout();
                const ticketIds = payload.tickets.map(ticket => ticket.ticketId);

                if (timerInterval) clearInterval(timerInterval);

                const ticketsData = payload.tickets.map(t => ({ ticketId: t.ticketId, token: t.token }));
                sessionStorage.setItem('bm_last_tickets', JSON.stringify(ticketsData));
                sessionStorage.setItem('bm_last_ticket_ids', JSON.stringify(ticketIds));

                sessionStorage.removeItem('bm_cart');
                sessionStorage.removeItem('bm_event');
                confirmOverlay.classList.remove('show');
                window.location.href = `ticket.html?ticketIds=${encodeURIComponent(ticketIds.join(','))}`;
            } catch (error) {
                confirmOverlay.classList.remove('show');
                showCheckoutAlert(error.message || 'No fue posible generar los boletos. Intenta nuevamente.');
            } finally {
                setConfirmActionState(false);
            }
        }

        paymentCards.forEach(card => {
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectPayment(card.dataset.paymentMethod, card);
                }
            });
        });

        if (!hasValidCart) {
            timerEl.textContent = '--:--';
            showCheckoutAlert('Tu carrito ya no está disponible o se abrió el checkout sin asientos. Vuelve al inicio para seleccionar lugares.');
            setPaymentEnabled(false);
        } else {
            initializeCheckout();
        }

        window.selectPayment = selectPayment;
        window.finishCheckout = finishCheckout;

