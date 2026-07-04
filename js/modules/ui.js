/* ui.js: preloader, slider, header, menú, filtros, wishlist, newsletter */

import { showToast } from './toast.js';
import { openModal } from './modals.js';

// =================== PRELOADER ===================
const preloaderEl = document.getElementById('preloader');
window.addEventListener('load', () => {
  setTimeout(() => {
    if (preloaderEl) preloaderEl.classList.add('hidden');
    initCounters();
  }, preloaderEl ? 220 : 0);
});

// =================== HERO SLIDER ===================
let currentSlide = 0;
let sliderTimer = null;
const slides = document.querySelectorAll('.hero-slide');
const dots = document.querySelectorAll('.hero-dot');
const SLIDE_INTERVAL = 5000;
let isSliderEnabled = false;

function updateSliderA11y() {
  slides.forEach((slide, index) => {
    slide.setAttribute('aria-hidden', index === currentSlide ? 'false' : 'true');
  });
  dots.forEach((dot, index) => {
    const isActive = index === currentSlide;
    dot.setAttribute('aria-pressed', String(isActive));
    dot.setAttribute('aria-current', isActive ? 'true' : 'false');
  });
}

function goToSlide(n) {
  if (!slides.length || !dots.length) return;
  slides[currentSlide].classList.remove('active');
  dots[currentSlide].classList.remove('active');
  currentSlide = (n + slides.length) % slides.length;
  slides[currentSlide].classList.add('active');
  dots[currentSlide].classList.add('active');
  updateSliderA11y();
}
function startSlider() {
  if (!isSliderEnabled || document.hidden || slides.length < 2) return;
  clearInterval(sliderTimer);
  sliderTimer = setInterval(() => goToSlide(currentSlide + 1), SLIDE_INTERVAL);
}
function stopSlider() {
  clearInterval(sliderTimer);
  sliderTimer = null;
}
const heroPrevBtn = document.getElementById('hero-prev');
const heroNextBtn = document.getElementById('hero-next');
if (slides.length && dots.length && heroPrevBtn && heroNextBtn) {
  isSliderEnabled = true;
  heroPrevBtn.addEventListener('click', () => { goToSlide(currentSlide - 1); startSlider(); });
  heroNextBtn.addEventListener('click', () => { goToSlide(currentSlide + 1); startSlider(); });
  dots.forEach(dot => dot.addEventListener('click', () => { goToSlide(parseInt(dot.dataset.slide, 10)); startSlider(); }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSlider();
    else startSlider();
  });
  updateSliderA11y();
  startSlider();
}

// =================== STICKY HEADER ===================
const header = document.getElementById('main-header');
const scrollTopBtn = document.getElementById('scroll-top');
let scrollRaf = 0;
function syncScrollUi() {
  scrollRaf = 0;
  if (header) header.classList.toggle('scrolled', window.scrollY > 40);
  if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', window.scrollY > 300);
}
if (header || scrollTopBtn) {
  window.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(syncScrollUi);
  }, { passive: true });
  syncScrollUi();
}
if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// =================== HAMBURGER ===================
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
if (hamburger && mobileMenu) {
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(hamburger.classList.contains('open')));
  });
  mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  }));
}

// =================== CATEGORY FILTERS ===================
const filterBtns = document.querySelectorAll('.filter-btn');
const eventCards = document.querySelectorAll('.event-card');
const eventsGrid = document.getElementById('events-grid');

if (filterBtns.length && eventCards.length) {
  // Create the empty state element
  const emptyState = document.createElement('div');
  emptyState.className = 'filter-empty-state';
  emptyState.innerHTML = `
    <i class="fas fa-calendar-xmark"></i>
    <h3>No hay eventos en esta categoría</h3>
    <p>Intenta con otra categoría o explora todos los eventos disponibles.</p>
    <button class="filter-empty-reset" type="button">
      <i class="fas fa-grip"></i> Ver todos los eventos
    </button>
  `;
  emptyState.style.display = 'none';
  if (eventsGrid) eventsGrid.after(emptyState);

  const resetBtn = emptyState.querySelector('.filter-empty-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const allBtn = document.getElementById('filter-all');
      if (allBtn) allBtn.click();
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      let visibleCount = 0;
      let delay = 0;
      eventCards.forEach(card => {
        const show = filter === 'all' || card.dataset.category === filter;
        card.style.display = show ? 'flex' : 'none';
        if (show) {
          visibleCount++;
          card.style.animation = 'none';
          card.offsetHeight;
          card.style.animation = `fadeInUp 0.4s ease ${delay}s forwards`;
          delay += 0.06;
        }
      });

      emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';

      const eventsSection = document.getElementById('eventos');
      if (eventsSection) {
        const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68;
        const filterH = document.querySelector('.filters-section')?.offsetHeight || 60;
        const targetY = eventsSection.getBoundingClientRect().top + window.scrollY - headerH - filterH - 16;
        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
      }
    });
  });
}

// =================== POINTS OF SALE FILTERS ===================
const posFilters = document.querySelectorAll('.pos-filter');
const salesPointCards = document.querySelectorAll('.sales-point-card');
if (posFilters.length && salesPointCards.length) {
  posFilters.forEach(filter => {
    filter.setAttribute('aria-pressed', String(filter.classList.contains('active')));
  });

  posFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedCity = btn.dataset.city || 'all';

      posFilters.forEach(filter => {
        const isActive = filter === btn;
        filter.classList.toggle('active', isActive);
        filter.setAttribute('aria-pressed', String(isActive));
      });

      salesPointCards.forEach(card => {
        const shouldShow = selectedCity === 'all' || card.dataset.city === selectedCity;
        card.classList.toggle('is-hidden', !shouldShow);
      });
    });
  });
}

// =================== WISHLIST ===================
function bindWishlistButtons(selector, itemLabel) {
  document.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
      const icon = btn.querySelector('i');
      if (btn.classList.contains('active')) {
        icon.className = 'fas fa-heart';
        showToast(`❤ ${itemLabel} guardado en tu lista`);
      } else {
        icon.className = 'far fa-heart';
        showToast(`${itemLabel} eliminado de tu lista`);
      }
    });
  });
}

bindWishlistButtons('.event-wishlist', 'Evento');
bindWishlistButtons('.collab-wishlist', 'Producto');

// =================== STATS COUNTER ===================
function animateCounter(el, target) {
  let start = 0;
  const step = target / (2000 / 16);
  const timer = setInterval(() => {
    start += step;
    if (start >= target) { start = target; clearInterval(timer); }
    el.textContent = Math.floor(start).toLocaleString('es-MX');
  }, 16);
}
function initCounters() {
  document.querySelectorAll('.stat-item').forEach((item, i) => {
    const numEl = document.getElementById(`stat-${i}`);
    if (numEl && item.dataset.count) animateCounter(numEl, parseInt(item.dataset.count));
  });
}

// =================== LOGIN / REGISTER ===================
// handleLogin/handleRegister reales viven en auth.js (sesión con backend).
export function togglePass(id) { const input = document.getElementById(id); input.type = input.type === 'password' ? 'text' : 'password'; }

const regPass = document.getElementById('reg-pass');
const strengthFill = document.getElementById('strength-fill');
if (regPass) {
  regPass.addEventListener('input', () => {
    const v = regPass.value;
    let s = 0;
    if (v.length >= 8) s += 33;
    if (/[A-Z]/.test(v)) s += 33;
    if (/[0-9!@#$%^&*]/.test(v)) s += 34;
    strengthFill.style.width = s + '%';
    strengthFill.style.background = s <= 33 ? '#ef4444' : s <= 66 ? '#f59e0b' : '#10b981';
  });
}

document.querySelectorAll('img[loading="lazy"]').forEach(img => {
  img.decoding = 'async';
  img.fetchPriority = 'low';
});

// =================== FURNITURE QUICK VIEW ===================
export function showFurnitureQuickView(name, desc, price) {
  document.getElementById('fv-name').textContent = name;
  document.getElementById('fv-desc').textContent = desc;
  document.getElementById('fv-price').textContent = price + ' MXN';
  openModal('furniture-modal');
}

// =================== NEWSLETTER ===================
export function subscribeNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('newsletter-email').value;
  showToast(`Suscripción confirmada para ${email}`);
  document.getElementById('newsletter-email').value = '';
}

// =================== FLOATING HELP ===================
document.getElementById('floating-help').addEventListener('click', () => showToast('Abriendo chat de soporte...'));

// =================== SMOOTH SCROLL ===================
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const targetId = a.getAttribute('href');
    if (!targetId || targetId === '#') {
      e.preventDefault();
      return;
    }
    const t = document.querySelector(targetId);
    if (t) {
      e.preventDefault();
      t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// =================== FADE ANIMATIONS ===================
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.event-card, .how-step, .sec-feature').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  observer.observe(el);
});
