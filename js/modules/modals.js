/* BoletaMax – modals.js: apertura/cierre de modales, focus trap y transición a checkout */

let lastFocusedElement = null;

export function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const focusTarget = overlay.querySelector('input, button, a[href], [tabindex]:not([tabindex="-1"])');
  if (focusTarget) focusTarget.focus();
}

export function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (!document.querySelector('.modal-overlay.open') && lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

export function switchModal(from, to) { closeModal(from); setTimeout(() => openModal(to), 200); }

export function showCheckoutTransition() {
  let transition = document.getElementById('checkout-transition');
  if (!transition) {
    transition = document.createElement('div');
    transition.id = 'checkout-transition';
    transition.className = 'checkout-transition';
    transition.innerHTML = `
      <div class="checkout-transition-card">
        <div class="checkout-transition-mark"><i class="fas fa-shield-halved"></i></div>
        <span>Preparando checkout seguro</span>
        <strong>Reservando tus boletos...</strong>
        <div class="checkout-transition-bar"><span></span></div>
      </div>
    `;
    document.body.appendChild(transition);
  }

  requestAnimationFrame(() => {
    transition.classList.add('show');
    document.body.classList.add('is-checkout-transitioning');
  });
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
});

// Focus-trap: mantiene el foco dentro del modal abierto (Tab / Shift+Tab).
// Complementa el guardado/restauración de foco que ya hacen open/closeModal.
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const overlay = document.querySelector('.modal-overlay.open');
  if (!overlay) return;

  const focusables = [...overlay.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null); // solo visibles
  if (!focusables.length) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (!overlay.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
