/* BoletaMax – auth.js: sesión del comprador (registro, login, logout)
   y modal "Mis boletos". La sesión vive en una cookie httpOnly que el
   navegador envía solo; aquí solo se consulta /api/auth/me. */

import { showToast } from './toast.js';
import { openModal, closeModal } from './modals.js';

let currentUser = null;

const $ = id => document.getElementById(id);

function setHidden(id, hidden) {
  const el = $(id);
  if (el) el.hidden = hidden;
}

function updateHeaderUi() {
  const logged = Boolean(currentUser);

  setHidden('btn-login-header', logged);
  setHidden('btn-register-header', logged);
  setHidden('mobile-login-btn', logged);
  setHidden('mobile-register-btn', logged);

  setHidden('btn-my-tickets', !logged);
  setHidden('btn-logout', !logged);
  setHidden('mobile-my-tickets', !logged);
  setHidden('mobile-logout', !logged);

  const nameEl = $('header-user-name');
  if (nameEl) nameEl.textContent = logged ? `Salir (${currentUser.displayName})` : 'Salir';

  const subtitle = $('account-modal-subtitle');
  if (subtitle && logged) subtitle.textContent = `Cuenta: ${currentUser.email}`;
}

async function refreshSession() {
  try {
    const response = await fetch('/api/auth/me');
    if (response.ok) {
      const payload = await response.json();
      currentUser = payload.ok ? payload.user : null;
    } else {
      currentUser = null;
    }
  } catch (_) {
    currentUser = null;
  }
  updateHeaderUi();
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export function handleLogin(e) {
  e.preventDefault();
  (async () => {
    const email = $('login-email')?.value.trim() || '';
    const password = $('login-pass')?.value || '';

    const { response, payload } = await postJson('/api/auth/login', { email, password });
    if (!response.ok || !payload.ok) {
      showToast(payload.message || 'No se pudo iniciar sesión.', 'error');
      return;
    }

    currentUser = payload.user;
    updateHeaderUi();
    closeModal('login-modal');
    e.target.reset?.();
    showToast(`✅ ¡Bienvenido de vuelta, ${currentUser.displayName}!`);
  })().catch(() => showToast('No se pudo iniciar sesión.', 'error'));
}

export function handleRegister(e) {
  e.preventDefault();
  (async () => {
    const name = [$('reg-name')?.value.trim(), $('reg-lastname')?.value.trim()]
      .filter(Boolean)
      .join(' ');
    const email = $('reg-email')?.value.trim() || '';
    const password = $('reg-pass')?.value || '';

    const { response, payload } = await postJson('/api/auth/register', { name, email, password });
    if (!response.ok || !payload.ok) {
      showToast(payload.message || 'No se pudo crear la cuenta.', 'error');
      return;
    }

    currentUser = payload.user;
    updateHeaderUi();
    closeModal('register-modal');
    e.target.reset?.();
    showToast('🎉 ¡Cuenta creada con éxito!');
  })().catch(() => showToast('No se pudo crear la cuenta.', 'error'));
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    // La cookie igual se limpia del lado del servidor en el próximo request.
  }
  currentUser = null;
  updateHeaderUi();
  showToast('Sesión cerrada. ¡Vuelve pronto!');
}

function statusLabel(status) {
  return ({ active: 'Activo', used: 'Usado', cancelled: 'Cancelado' })[status] || status;
}

function renderAccountTickets(tickets) {
  const list = $('account-tickets-list');
  if (!list) return;
  list.replaceChildren();

  if (!tickets.length) {
    const empty = document.createElement('p');
    empty.className = 'account-state';
    empty.textContent = 'Aún no tienes boletos en tu cuenta. Compra con tu sesión iniciada y aparecerán aquí.';
    list.appendChild(empty);
    return;
  }

  tickets.forEach(ticket => {
    const item = document.createElement('article');
    item.className = 'account-ticket-item';

    const head = document.createElement('div');
    head.className = 'ati-head';
    const title = document.createElement('strong');
    title.textContent = ticket.eventName || 'Evento';
    const status = document.createElement('span');
    const statusKey = ['active', 'used', 'cancelled'].includes(ticket.status) ? ticket.status : 'cancelled';
    status.className = `ati-status ${statusKey}`;
    status.textContent = statusLabel(ticket.status);
    head.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'ati-meta';
    meta.textContent = [ticket.seatLabel, ticket.date].filter(Boolean).join(' · ');

    const actions = document.createElement('div');
    actions.className = 'ati-actions';

    const viewQr = document.createElement('a');
    viewQr.className = 'ati-view-qr';
    viewQr.href = `/ticket?mine=1&ticketIds=${encodeURIComponent(ticket.ticketId)}`;
    viewQr.innerHTML = '<i class="fas fa-qrcode"></i> Ver QR de acceso';

    const publicLink = document.createElement('a');
    publicLink.className = 'ati-public-link';
    publicLink.href = ticket.publicPath || `/tickets/${encodeURIComponent(ticket.ticketId)}`;
    publicLink.target = '_blank';
    publicLink.rel = 'noopener noreferrer';
    publicLink.innerHTML = '<i class="fas fa-arrow-up-right-from-square"></i> Página pública';

    actions.append(viewQr, publicLink);
    item.append(head, meta, actions);
    list.appendChild(item);
  });
}

async function openMyTickets() {
  const state = document.createElement('p');
  state.className = 'account-state';
  state.textContent = 'Cargando tus boletos...';
  $('account-tickets-list')?.replaceChildren(state);
  openModal('account-modal');

  try {
    const response = await fetch('/api/account/tickets');
    const payload = await response.json();

    if (response.status === 401) {
      state.textContent = 'Inicia sesión para ver tus boletos.';
      return;
    }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || 'No se pudieron cargar tus boletos.');
    }

    renderAccountTickets(payload.tickets || []);
  } catch (error) {
    state.textContent = error.message || 'No se pudieron cargar tus boletos.';
    $('account-tickets-list')?.replaceChildren(state);
  }
}

$('btn-logout')?.addEventListener('click', logout);
$('mobile-logout')?.addEventListener('click', logout);
$('btn-my-tickets')?.addEventListener('click', openMyTickets);
$('mobile-my-tickets')?.addEventListener('click', openMyTickets);

refreshSession();
