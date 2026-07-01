/* BoletaMax – main.js  (v2 – Full Seat Map Upgrade) */
'use strict';

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
let lastFocusedElement = null;
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

// =================== SEARCH ===================
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
const SEARCH_DEBOUNCE_MS = 420;
const AI_SEARCH_TIMEOUT_MS = 6000; // si /api/ai-search no responde, caemos al fallback local
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CATEGORY_ICONS = {
  musica: 'fas fa-music',
  teatro: 'fas fa-masks-theater',
  deportes: 'fas fa-trophy',
  feria: 'fas fa-ferris-wheel',
  familia: 'fas fa-children',
  comedia: 'fas fa-face-laugh-beam',
};
const SEARCH_SUGGESTIONS = [
  'comedia en Puebla',
  'algo barato en Chihuahua',
  'música en Guadalajara',
];
let localEventsCatalog = [];
let localEventsCatalogPromise = null;
let aiSearchController = null;
let aiSearchTimer = null;
const aiSearchCache = new Map();

function normalizeSearchText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function loadLocalEventsCatalog() {
  if (localEventsCatalog.length) return localEventsCatalog;
  if (localEventsCatalogPromise) return localEventsCatalogPromise;

  localEventsCatalogPromise = (async () => {
    try {
      const response = await fetch('/data/events.json');
      if (!response.ok) return [];
      localEventsCatalog = await response.json();
      return localEventsCatalog;
    } catch (_) {
      localEventsCatalog = [];
      return localEventsCatalog;
    } finally {
      localEventsCatalogPromise = null;
    }
  })();

  return localEventsCatalogPromise;
}

function getCachedAiSearch(queryKey) {
  const cached = aiSearchCache.get(queryKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SEARCH_CACHE_TTL_MS) {
    aiSearchCache.delete(queryKey);
    return null;
  }
  return cached.payload;
}

function setCachedAiSearch(queryKey, payload) {
  aiSearchCache.set(queryKey, {
    timestamp: Date.now(),
    payload,
  });
}

function clearSearchResults() {
  if (!searchResultsEl) return;
  searchResultsEl.replaceChildren();
  searchResultsEl.classList.remove('visible');
}

function openEventFromSearch(eventData) {
  searchInput.value = eventData.name;
  clearSearchResults();

  if (!eventData.available) {
    showToast('Ese evento ya no tiene boletos disponibles.', 'error');
    return;
  }

  openTicketModal(
    eventData.name,
    eventData.date,
    eventData.venue,
    eventData.priceLabel,
    eventData.venueType,
  );
}

function renderSearchNote(message) {
  if (!message) return null;
  const note = document.createElement('div');
  note.className = 'search-results-note';
  note.textContent = message;
  return note;
}

function renderSearchAiLabel() {
  const label = document.createElement('div');
  label.className = 'search-results-ai-label';
  label.innerHTML = '<i class="fas fa-bolt"></i> Búsqueda con IA';
  return label;
}

// Skeleton shimmer mientras la búsqueda IA responde (mejor que texto plano).
// Solo presentación: lo reemplazan renderSearchResults/renderSearchState al resolver.
function renderSearchSkeleton(rows = 3) {
  searchResultsEl.replaceChildren();
  searchResultsEl.appendChild(renderSearchAiLabel());

  const live = document.createElement('span');
  live.className = 'sr-only';
  live.textContent = 'Buscando eventos…';
  searchResultsEl.appendChild(live);

  const wrap = document.createElement('div');
  wrap.className = 'search-results-skeleton';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.className = 'sk-row';
    row.innerHTML =
      '<div class="sk-thumb"></div><div class="sk-lines"><div class="sk-line sk-line-lg"></div><div class="sk-line sk-line-sm"></div></div>';
    wrap.appendChild(row);
  }
  searchResultsEl.appendChild(wrap);
  searchResultsEl.classList.add('visible');
}

function renderSearchState(title, description, suggestions = []) {
  searchResultsEl.replaceChildren();
  searchResultsEl.appendChild(renderSearchAiLabel());

  const state = document.createElement('div');
  state.className = 'search-results-state';

  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = description;

  state.append(heading, text);

  if (suggestions.length) {
    const suggestionWrap = document.createElement('div');
    suggestionWrap.className = 'search-results-suggestions';

    suggestions.forEach(suggestion => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'search-suggestion-chip';
      chip.textContent = suggestion;
      chip.addEventListener('click', () => {
        searchInput.value = suggestion;
        runAiSearch(suggestion);
      });
      suggestionWrap.appendChild(chip);
    });

    state.appendChild(suggestionWrap);
  }

  searchResultsEl.appendChild(state);
  searchResultsEl.classList.add('visible');
}

function createSearchResultButton(eventData) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'search-result-item search-result-card';
  item.setAttribute('role', 'option');
  item.setAttribute('aria-label', `${eventData.name}, ${eventData.city}, ${eventData.priceLabel}`);
  item.disabled = !eventData.available;
  item.addEventListener('click', () => openEventFromSearch(eventData));

  const icon = document.createElement('i');
  icon.className = SEARCH_CATEGORY_ICONS[eventData.category] || 'fas fa-ticket';

  const copy = document.createElement('div');
  copy.className = 'search-result-copy';

  const titleRow = document.createElement('div');
  titleRow.className = 'search-result-title-row';

  const title = document.createElement('strong');
  title.textContent = eventData.name;

  const badge = document.createElement('span');
  badge.className = 'search-result-badge';
  badge.textContent = eventData.available ? eventData.category : 'agotado';

  titleRow.append(title, badge);

  const meta = document.createElement('span');
  meta.className = 'search-result-location';
  meta.textContent = `${eventData.city} · ${eventData.venue}`;

  const detail = document.createElement('span');
  detail.className = 'search-result-detail';
  detail.textContent = eventData.date;

  copy.append(titleRow, meta, detail);

  const price = document.createElement('span');
  price.className = 'search-result-price';
  price.textContent = eventData.priceLabel;

  item.append(icon, copy, price);
  return item;
}

function renderSearchResults(results, meta = {}) {
  searchResultsEl.replaceChildren();
  searchResultsEl.appendChild(renderSearchAiLabel());

  const note = renderSearchNote(meta.warning);
  if (note) searchResultsEl.appendChild(note);

  results.forEach(eventData => {
    searchResultsEl.appendChild(createSearchResultButton(eventData));
  });

  searchResultsEl.classList.add('visible');
}

function fallbackLocalSearch(query) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return localEventsCatalog
    .filter(eventData => {
      const searchable = normalizeSearchText(
        [
          eventData.name,
          eventData.city,
          eventData.venue,
          eventData.category,
          eventData.description,
          ...(eventData.keywords || []),
        ].join(' '),
      );

      return tokens.every(token => searchable.includes(token)) || searchable.includes(normalizedQuery);
    })
    .slice(0, 6);
}

async function runAiSearch(query) {
  if (!searchInput || !searchResultsEl) return;
  const trimmedQuery = query.trim();
  const cacheKey = normalizeSearchText(trimmedQuery);

  if (!trimmedQuery || trimmedQuery.length < 2) {
    clearSearchResults();
    return;
  }

  const cachedPayload = getCachedAiSearch(cacheKey);
  if (cachedPayload) {
    if (cachedPayload.results?.length) {
      renderSearchResults(cachedPayload.results, cachedPayload.meta);
    } else {
      renderSearchState(
        'No encontramos coincidencias',
        'Prueba con otra ciudad, una categoría diferente o un presupuesto más amplio.',
        SEARCH_SUGGESTIONS,
      );
    }
    return;
  }

  if (aiSearchController) aiSearchController.abort();
  aiSearchController = new AbortController();
  // Timeout de red: si /api/ai-search no responde a tiempo, abortamos y
  // caemos al fallback local (evita el skeleton colgado indefinidamente).
  const controller = aiSearchController;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AI_SEARCH_TIMEOUT_MS);
  renderSearchSkeleton();

  try {
    const response = await fetch('/api/ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmedQuery }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI search failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (searchInput.value.trim() !== trimmedQuery) return;
    setCachedAiSearch(cacheKey, payload);

    if (payload.results?.length) {
      renderSearchResults(payload.results, payload.meta);
      return;
    }

    renderSearchState(
      'No encontramos coincidencias',
      'Prueba con otra ciudad, una categoría diferente o un presupuesto más amplio.',
      SEARCH_SUGGESTIONS,
    );
  } catch (error) {
    // AbortError SIN timedOut = otra búsqueda más nueva reemplazó a esta →
    // no hacemos nada. Si fue timeout (o error de red) → fallback local.
    if (error.name === 'AbortError' && !timedOut) return;

    // Aseguramos el catálogo local antes del fallback (por si aún no cargó),
    // así el fallback muestra resultados reales en vez de quedar vacío.
    await loadLocalEventsCatalog();
    const fallbackResults = fallbackLocalSearch(trimmedQuery);
    if (searchInput.value.trim() !== trimmedQuery) return;

    if (fallbackResults.length) {
      const fallbackPayload = {
        results: fallbackResults,
        meta: {
          warning: 'La búsqueda IA no respondió y estamos mostrando coincidencias locales.',
        },
      };
      setCachedAiSearch(cacheKey, fallbackPayload);
      renderSearchResults(fallbackPayload.results, fallbackPayload.meta);
      return;
    }

    renderSearchState(
      'No pudimos completar la búsqueda',
      'Intenta otra frase como “eventos de comedia” o “algo barato en Chihuahua”.',
      SEARCH_SUGGESTIONS,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

if (searchInput && searchResultsEl) {
  const warmSearchAssets = () => {
    void loadLocalEventsCatalog();
    searchInput.removeEventListener('focus', warmSearchAssets);
    searchInput.removeEventListener('pointerdown', warmSearchAssets);
  };

  searchInput.addEventListener('focus', warmSearchAssets, { once: true });
  searchInput.addEventListener('pointerdown', warmSearchAssets, { once: true });
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    clearTimeout(aiSearchTimer);

    if (!query) {
      clearSearchResults();
      return;
    }

    aiSearchTimer = setTimeout(() => {
      runAiSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      const firstResult = searchResultsEl.querySelector('.search-result-item:not(:disabled)');
      if (firstResult) {
        e.preventDefault();
        firstResult.focus();
      }
    }
  });

  // Navegación con flechas ↑/↓ entre resultados (combobox accesible).
  // Enter activa de forma nativa (son <button>); Escape cierra y vuelve al input.
  searchResultsEl.addEventListener('keydown', e => {
    const items = [...searchResultsEl.querySelectorAll('.search-result-item:not(:disabled)')];
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (items[idx + 1] || items[0]).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx <= 0) searchInput.focus();
      else items[idx - 1].focus();
    } else if (e.key === 'Escape') {
      searchResultsEl.classList.remove('visible');
      searchInput.focus();
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#header-search')) searchResultsEl.classList.remove('visible');
  });
}

// =================== MODALS ===================
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const focusTarget = overlay.querySelector('input, button, a[href], [tabindex]:not([tabindex="-1"])');
  if (focusTarget) focusTarget.focus();
}
function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (!document.querySelector('.modal-overlay.open') && lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}
function switchModal(from, to) { closeModal(from); setTimeout(() => openModal(to), 200); }

function showCheckoutTransition() {
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

// =================== LOGIN / REGISTER ===================
function handleLogin(e) { e.preventDefault(); closeModal('login-modal'); showToast('✅ ¡Bienvenido de vuelta!'); }
function handleRegister(e) { e.preventDefault(); closeModal('register-modal'); showToast('🎉 ¡Cuenta creada con éxito!'); }
function togglePass(id) { const input = document.getElementById(id); input.type = input.type === 'password' ? 'text' : 'password'; }

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

// ===================================================================
//  INTERACTIVE SEAT MAP ENGINE  v2
// ===================================================================

/* ---- ZONE COLOUR PALETTE ---- */
const ZONE_COLORS = {
  fan: '#e2c46f',
  vip5: '#c99b3a',
  oro5: '#7492be',
  oro: '#516c95',
  gen: '#293a55',
};

/* ---- VENUE CONFIGS ---- */
// Each venue defines zones with arc geometry:
//   r       – base radius from center (SVG units)
//   rows    – number of row arcs
//   rowGap  – px between rows
//   nSeats  – seats in first row (increments by +2 per row)
//   startDeg / endDeg – arc span in degrees
//   tableSize – seats grouped per mesa (2 or 4)
const VENUE_CONFIGS = {

  /* ---- PALENQUE 360° — Escenario circular central ---- */
  palenque: {
    cx: 360, cy: 310,        // Centro exacto del viewport
    viewBox: '0 0 720 640',
    stageR: 80,              // Radio del escenario circular
    stageLabel: 'ESCENARIO',
    stageSubLabel: '360°',
    layoutLabel: 'Palenque 360°',
    bgR: 310,                // Radio del fondo oscuro
    zones: [
      { key: 'fan', label: 'FAN', r: 117, rows: 3, rowGap: 14, nSeats: 28, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1700 },
      { key: 'vip5', label: 'VIP', r: 161, rows: 3, rowGap: 14, nSeats: 38, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1150 },
      { key: 'oro5', label: 'ORO 5', r: 205, rows: 3, rowGap: 14, nSeats: 48, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1000 },
      { key: 'oro', label: 'ORO', r: 249, rows: 3, rowGap: 14, nSeats: 56, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 750 },
      { key: 'gen', label: 'GENERAL', r: 291, rows: 2, rowGap: 14, nSeats: 64, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 480 },
    ],
  },

  /* ---- ARENA 360° — Ring central ---- */
  arena: {
    cx: 360, cy: 310,
    viewBox: '0 0 720 640',
    stageR: 75,
    stageLabel: 'RING',
    stageSubLabel: 'CENTRAL',
    layoutLabel: 'Arena circular',
    bgR: 305,
    zones: [
      { key: 'fan', label: 'RINGSIDE', r: 112, rows: 2, rowGap: 14, nSeats: 24, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 2000 },
      { key: 'vip5', label: 'VIP', r: 148, rows: 3, rowGap: 14, nSeats: 32, startDeg: 0, endDeg: 359, tableSize: 4, priceBase: 1400 },
      { key: 'oro5', label: 'PLATINO', r: 190, rows: 3, rowGap: 13, nSeats: 40, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 900 },
      { key: 'oro', label: 'ORO', r: 229, rows: 3, rowGap: 13, nSeats: 48, startDeg: 0, endDeg: 359, tableSize: 2, priceBase: 650 },
      { key: 'gen', label: 'GENERAL', r: 268, rows: 3, rowGap: 13, nSeats: 56, startDeg: 0, endDeg: 359, tableSize: 1, priceBase: 350 },
    ],
  },

  /* ---- TEATRO — Semicírculo frente al escenario ---- */
  teatro: {
    cx: 360, cy: 430,
    viewBox: '0 0 720 580',
    stageR: 68,
    stageRx: 150,
    stageRy: 42,
    stageLabel: 'ESCENARIO',
    stageSubLabel: 'FRONTAL',
    layoutLabel: 'Teatro frontal',
    bgR: 0,                  // Sin fondo circular para el teatro
    zones: [
      { key: 'fan', label: 'ORQUESTA', r: 108, rows: 3, rowGap: 14, nSeats: 20, startDeg: 195, endDeg: 345, tableSize: 4, priceBase: 1800 },
      { key: 'vip5', label: 'LUNETA', r: 152, rows: 4, rowGap: 13, nSeats: 28, startDeg: 192, endDeg: 348, tableSize: 2, priceBase: 1100 },
      { key: 'oro5', label: 'MEZZANINE', r: 198, rows: 3, rowGap: 13, nSeats: 34, startDeg: 190, endDeg: 350, tableSize: 2, priceBase: 800 },
      { key: 'oro', label: 'PALCO', r: 238, rows: 2, rowGap: 13, nSeats: 38, startDeg: 188, endDeg: 352, tableSize: 2, priceBase: 600 },
      { key: 'gen', label: 'GALERÍA', r: 274, rows: 3, rowGap: 13, nSeats: 42, startDeg: 186, endDeg: 354, tableSize: 1, priceBase: 380 },
    ],
  },

  /* ---- ESTADIO — escenario frontal amplio ---- */
  estadio: {
    cx: 360, cy: 505,
    viewBox: '0 0 720 640',
    stageR: 58,
    stageRx: 190,
    stageRy: 46,
    stageLabel: 'ESCENARIO',
    stageSubLabel: 'FRONTAL',
    layoutLabel: 'Estadio frontal',
    bgR: 0,
    zones: [
      { key: 'fan', label: 'FAN PIT', r: 112, rows: 3, rowGap: 15, nSeats: 20, startDeg: 205, endDeg: 335, tableSize: 2, priceBase: 1900 },
      { key: 'vip5', label: 'VIP', r: 158, rows: 3, rowGap: 15, nSeats: 28, startDeg: 198, endDeg: 342, tableSize: 2, priceBase: 1450 },
      { key: 'oro5', label: 'PREFERENTE', r: 204, rows: 3, rowGap: 15, nSeats: 36, startDeg: 193, endDeg: 347, tableSize: 1, priceBase: 980 },
      { key: 'oro', label: 'PLATEA', r: 249, rows: 3, rowGap: 15, nSeats: 42, startDeg: 188, endDeg: 352, tableSize: 1, priceBase: 720 },
      { key: 'gen', label: 'GRADA', r: 294, rows: 2, rowGap: 16, nSeats: 52, startDeg: 184, endDeg: 356, tableSize: 1, priceBase: 520 },
    ],
  },

  /* ---- FESTIVAL — campo abierto con escenario principal ---- */
  festival: {
    cx: 360, cy: 500,
    viewBox: '0 0 720 640',
    stageR: 54,
    stageRx: 170,
    stageRy: 44,
    stageLabel: 'MAIN STAGE',
    stageSubLabel: 'FESTIVAL',
    layoutLabel: 'Festival general',
    bgR: 0,
    zones: [
      { key: 'fan', label: 'FRONT STAGE', r: 104, rows: 3, rowGap: 15, nSeats: 20, startDeg: 208, endDeg: 332, tableSize: 2, priceBase: 1600 },
      { key: 'vip5', label: 'VIP DECK', r: 150, rows: 3, rowGap: 15, nSeats: 26, startDeg: 202, endDeg: 338, tableSize: 4, priceBase: 1180 },
      { key: 'oro5', label: 'PREFERENTE', r: 196, rows: 3, rowGap: 15, nSeats: 34, startDeg: 196, endDeg: 344, tableSize: 2, priceBase: 900 },
      { key: 'oro', label: 'GENERAL A', r: 242, rows: 3, rowGap: 15, nSeats: 42, startDeg: 190, endDeg: 350, tableSize: 1, priceBase: 650 },
      { key: 'gen', label: 'GENERAL B', r: 288, rows: 2, rowGap: 16, nSeats: 50, startDeg: 185, endDeg: 355, tableSize: 1, priceBase: 430 },
    ],
  },
};

/* ---- Event → venue mapping ---- */
const EVENT_VENUE_MAP = {
  'Gran Festival de Banda': 'palenque',
  'El Fantasma de la Ópera': 'teatro',
  'Noche Urbana GDL': 'palenque',
  'Feria del Estado CHH': 'palenque',
  'Comedy Night Puebla': 'teatro',
  'Lucha Libre CMLL': 'arena',
  'Noche de Rock Épica 2025': 'estadio',
  'Festival SolMaX 2025': 'festival',
  'Festival SolMaX': 'festival',
};

/* ---- State ---- */
const FEE_RATE = 0.14;
const SOLD_RATIO = 0.21;
let selectedSeats = [];
let seatData = {};       // id → seat object
let currentVenueKey = 'palenque';
let _idCounter = 0;

// Zoom/pan state
let svgScale = 1;
let svgTx = 0, svgTy = 0;
let _panLock = false; // prevent re-init

/* ---- Degree → Radian ---- */
const toRad = deg => (deg / 180) * Math.PI;

/* ---- SVG Namespace shorthand ---- */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function describeArc(cx, cy, r, startDeg, endDeg) {
  const start = { x: cx + r * Math.cos(toRad(startDeg)), y: cy + r * Math.sin(toRad(startDeg)) };
  const end = { x: cx + r * Math.cos(toRad(endDeg)), y: cy + r * Math.sin(toRad(endDeg)) };
  const largeArcFlag = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function renderMapLegend(prices = {}) {
  const legend = document.querySelector('.map-legend');
  const cfg = VENUE_CONFIGS[currentVenueKey];
  if (!legend || !cfg) return;

  const items = cfg.zones.map(zone => {
    const price = prices[zone.key] ?? zone.priceBase;
    return `<span class="ml-item"><span class="ml-dot" style="background:${ZONE_COLORS[zone.key]}"></span>${zone.label} · $${price.toLocaleString('es-MX')}</span>`;
  });
  items.push('<span class="ml-item"><span class="ml-dot ml-dot-selected"></span>Seleccionado</span>');
  items.push('<span class="ml-item"><span class="ml-dot ml-dot-sold"></span>Ocupado</span>');
  legend.innerHTML = items.join('');
}

/* =============================================================
   generateSeats()
   Builds all <g> (group per seat) elements inside #svg-pan-group
   ============================================================= */
function generateSeats(prices) {
  const group = document.getElementById('svg-pan-group');
  // Remove old seats, labels and separators
  group.querySelectorAll('.seat-group, .row-label, .zone-label, .zone-sep, .zone-band').forEach(el => el.remove());

  seatData = {};
  selectedSeats = [];
  _idCounter = 0;

  const cfg = VENUE_CONFIGS[currentVenueKey];
  const isFullCircle = z => z.endDeg >= 355;

  cfg.zones.forEach(zone => {
    const price = prices[zone.key] !== undefined ? prices[zone.key] : zone.priceBase;
    const color = ZONE_COLORS[zone.key];
    const full = isFullCircle(zone);

    let globalSeatInZone = 0;

    const bandR = zone.r + ((zone.rows - 1) * zone.rowGap) / 2;
    const bandWidth = Math.max(zone.rows * zone.rowGap + 7, 18);
    const bandAttrs = {
      fill: 'none',
      stroke: color,
      'stroke-width': bandWidth.toFixed(1),
      'stroke-opacity': full ? '0.075' : '0.095',
      'stroke-linecap': 'round',
      class: `zone-band zone-band-${zone.key}`,
      'pointer-events': 'none',
    };
    const zoneBand = full
      ? svgEl('circle', { ...bandAttrs, cx: cfg.cx, cy: cfg.cy, r: bandR.toFixed(1) })
      : svgEl('path', { ...bandAttrs, d: describeArc(cfg.cx, cfg.cy, bandR, zone.startDeg, zone.endDeg) });
    group.insertBefore(zoneBand, group.firstChild);

    // ── Zone separator ring (subtle) ────────────────────────────
    const sepR = zone.r - zone.rowGap * 0.5; // between this zone and previous
    if (zone !== cfg.zones[0]) {
      const sep = svgEl('circle', {
        cx: cfg.cx, cy: cfg.cy, r: sepR.toFixed(1),
        fill: 'none', stroke: 'rgba(255,255,255,0.06)',
        'stroke-width': '1.5', class: 'zone-sep',
        'pointer-events': 'none',
      });
      group.insertBefore(sep, group.firstChild);
    }

    // ── Zone label (one per zone, outside outermost row) ─────────
    const outerR = zone.r + (zone.rows - 1) * zone.rowGap + 12;
    let labelAngle;
    if (full) {
      // Place at 90° (below center, clear of seats on the ring)
      labelAngle = Math.PI / 2;
    } else {
      // Place outside the midpoint of the arc
      const midDeg = (zone.startDeg + zone.endDeg) / 2;
      labelAngle = toRad(midDeg + 180); // opposite side → outside arc
    }
    const zLx = (cfg.cx + outerR * Math.cos(labelAngle)).toFixed(1);
    const zLy = (cfg.cy + outerR * Math.sin(labelAngle)).toFixed(1);
    const zoneLbl = svgEl('text', {
      x: zLx, y: zLy,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: color, 'fill-opacity': '0.7',
      'font-size': '6.5', 'font-family': 'Manrope,sans-serif',
      'font-weight': '700', 'letter-spacing': '0.5',
      'pointer-events': 'none', class: 'zone-label',
    }, zone.label);
    group.appendChild(zoneLbl);

    // ── Seat rows ────────────────────────────────────────────────
    for (let row = 0; row < zone.rows; row++) {
      const r = zone.r + row * zone.rowGap;
      const rowLabel = String.fromCharCode(65 + row); // A, B, C …
      const startRad = toRad(zone.startDeg);
      const endRad = toRad(zone.endDeg);
      const totalAngle = endRad - startRad;
      const n = zone.nSeats + row * 2; // widen each row slightly

      for (let i = 0; i < n; i++) {
        // For last seat of full-circle arcs, use n (not n-1) so the last
        // seat doesn't land on top of the first seat.
        const divisor = full ? n : Math.max(n - 1, 1);
        const theta = startRad + (i / divisor) * totalAngle;
        const cx = cfg.cx + r * Math.cos(theta);
        const cy = cfg.cy + r * Math.sin(theta);
        const sold = Math.random() < SOLD_RATIO;

        const id = ++_idCounter;
        globalSeatInZone++;

        /* Mesa calculation */
        const mesaNum = Math.ceil(globalSeatInZone / zone.tableSize);
        const seatInMesa = ((globalSeatInZone - 1) % zone.tableSize) + 1;

        /* The seat group: circle + number label */
        const seatLabel = zone.tableSize > 1
          ? `${zone.label}, fila ${rowLabel}, mesa ${mesaNum}, lugar ${seatInMesa}`
          : `${zone.label}, fila ${rowLabel}, asiento ${i + 1}`;
        const gAttrs = {
          class: 'seat-group',
          'data-id': id,
          role: sold ? 'img' : 'button',
          tabindex: sold ? '-1' : '0',
          'aria-label': sold ? `${seatLabel}, ocupado` : `${seatLabel}, $${price.toLocaleString('es-MX')} MXN`,
        };
        if (!sold) gAttrs['aria-pressed'] = 'false';
        const g = svgEl('g', gAttrs);

        const circle = svgEl('circle', {
          cx: cx.toFixed(2), cy: cy.toFixed(2), r: 3.75,
          fill: sold ? '#1e293b' : color,
          class: 'svg-seat' + (sold ? ' sold' : ''),
        });
        g.appendChild(circle);

        // Store seat data
        seatData[id] = {
          id, zone: zone.key, zoneLabel: zone.label, color,
          fila: rowLabel, asiento: i + 1,
          mesaNum, seatInMesa, tableSize: zone.tableSize,
          price, sold, el: g, circle,
        };

        if (!sold) {
          g.style.cursor = 'pointer';
          g.addEventListener('mouseenter', e => onSeatHover(e, id));
          g.addEventListener('mouseleave', hideSeatTooltip);
          g.addEventListener('click', () => onSeatClick(id));
          g.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSeatClick(id);
            }
          });
        } else {
          g.style.cursor = 'not-allowed';
          // Show "Ocupado" on hover for sold seats
          g.addEventListener('mouseenter', () => showSoldTooltip(g, cx, cy));
          g.addEventListener('mouseleave', hideSeatTooltip);
        }

        group.appendChild(g);
      }
    }
  });
}


/* =============================================================
   TOOLTIP
   ============================================================= */
const tooltip = document.getElementById('seat-tooltip');
const mapContainer = document.getElementById('seat-map-container');

function onSeatHover(e, id) {
  const s = seatData[id];
  if (!s || s.sold) return;

  const mesaLabel = s.tableSize > 1 ? `Mesa ${s.mesaNum}` : `Asiento ${s.asiento}`;
  document.getElementById('st-area').textContent = s.zoneLabel;
  document.getElementById('st-fila').textContent = `Fila ${s.fila}`;
  document.getElementById('st-asiento').textContent = mesaLabel;
  document.getElementById('st-precio').textContent =
    `$${s.price.toLocaleString('es-MX')} + $${Math.round(s.price * FEE_RATE).toLocaleString('es-MX')} servicio`;

  tooltip.style.display = 'block';
  moveTooltip(e);
  e.currentTarget.addEventListener('mousemove', moveTooltip, { passive: true });
}

function moveTooltip(e) {
  if (!mapContainer) return;
  const rect = mapContainer.getBoundingClientRect();
  let left = e.clientX - rect.left + 15;
  let top = e.clientY - rect.top - 12;
  const tw = tooltip.offsetWidth || 178;
  const th = tooltip.offsetHeight || 92;
  if (left + tw > mapContainer.clientWidth - 8) left = e.clientX - rect.left - tw - 12;
  if (top + th > mapContainer.clientHeight - 8) top = e.clientY - rect.top - th - 8;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function hideSeatTooltip(e) {
  tooltip.style.display = 'none';
  if (e) e.currentTarget.removeEventListener('mousemove', moveTooltip);
}

function showSoldTooltip(g, cx, cy) {
  document.getElementById('st-area').textContent = 'Asiento';
  document.getElementById('st-fila').textContent = '—';
  document.getElementById('st-asiento').textContent = 'OCUPADO';
  document.getElementById('st-precio').textContent = 'No disponible';
  tooltip.style.display = 'block';
  // Position near the seat group element
  const rect = mapContainer.getBoundingClientRect();
  const svg = document.getElementById('venue-svg');
  const svgRect = svg.getBoundingClientRect();
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const scaleX = svgRect.width / vb[2];
  const scaleY = svgRect.height / vb[3];
  const screenX = svgRect.left + (cx * svgScale + svgTx) * scaleX - rect.left + 16;
  const screenY = svgRect.top + (cy * svgScale + svgTy) * scaleY - rect.top - 12;
  tooltip.style.left = Math.max(0, Math.min(screenX, mapContainer.clientWidth - 190)) + 'px';
  tooltip.style.top = Math.max(0, screenY) + 'px';
}

/* =============================================================
   SEAT SELECTION
   ============================================================= */
function onSeatClick(id) {
  const s = seatData[id];
  if (!s || s.sold) return;

  const idx = selectedSeats.findIndex(x => x.id === id);
  if (idx >= 0) {
    // Deselect
    selectedSeats.splice(idx, 1);
    s.circle.setAttribute('fill', s.color);
    s.circle.classList.remove('seat-selected');
    s.el.setAttribute('aria-pressed', 'false');
  } else {
    if (selectedSeats.length >= 10) {
      showToast('Máximo 10 boletos por compra', 'error');
      return;
    }
    selectedSeats.push({ ...s });
    s.circle.setAttribute('fill', '#d4af37');
    s.circle.classList.add('seat-selected');
    s.el.setAttribute('aria-pressed', 'true');
  }
  renderCart();
}

/* =============================================================
   CART
   ============================================================= */
function renderEmptyCart(list) {
  const empty = document.createElement('div');
  empty.className = 'cart-empty-msg';
  empty.id = 'cart-empty-msg';

  const icon = document.createElement('i');
  icon.className = 'fas fa-ticket';
  const text = document.createElement('p');
  text.textContent = 'Selecciona asientos en el mapa';

  empty.append(icon, text);
  list.replaceChildren(empty);
}

function renderCart() {
  const list = document.getElementById('cart-items-list');
  const totals = document.getElementById('cart-totals');
  const badge = document.getElementById('cart-count-badge');
  const btn = document.getElementById('btn-comprar');

  badge.textContent = `${selectedSeats.length} boleto${selectedSeats.length !== 1 ? 's' : ''}`;

  if (!selectedSeats.length) {
    renderEmptyCart(list);
    totals.style.display = 'none';
    btn.disabled = true;
    return;
  }

  list.replaceChildren();
  selectedSeats.forEach(s => {
    const item = document.createElement('div');
    item.className = 'cart-ticket-item';

    const zone = document.createElement('div');
    zone.className = 'cti-zone';
    const dot = document.createElement('span');
    dot.className = 'cti-dot';
    dot.style.background = s.color;
    zone.append(dot, document.createTextNode(s.zoneLabel));

    const detail = document.createElement('div');
    detail.className = 'cti-detail';
    detail.textContent = s.tableSize > 1
      ? `Fila ${s.fila} · Mesa ${s.mesaNum} · Lugar ${s.seatInMesa}`
      : `Fila ${s.fila} · Asiento ${s.asiento}`;

    const price = document.createElement('div');
    price.className = 'cti-price';
    price.textContent = `$${s.price.toLocaleString('es-MX')} MXN`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cti-remove';
    remove.setAttribute('aria-label', `Eliminar ${detail.textContent} del carrito`);
    remove.addEventListener('click', () => removeSeat(s.id));

    const removeIcon = document.createElement('i');
    removeIcon.className = 'fas fa-times';
    remove.appendChild(removeIcon);

    item.append(zone, detail, price, remove);
    list.appendChild(item);
  });

  const subtotal = selectedSeats.reduce((a, s) => a + s.price, 0);
  const fee = Math.round(subtotal * FEE_RATE);
  const total = subtotal + fee;

  document.getElementById('ct-subtotal').textContent = `$${subtotal.toLocaleString('es-MX')} MXN`;
  document.getElementById('ct-fee').textContent = `$${fee.toLocaleString('es-MX')} MXN`;
  document.getElementById('ct-total').textContent = `$${total.toLocaleString('es-MX')} MXN`;
  totals.style.display = 'block';
  btn.disabled = false;
}

window.removeSeat = function (id) {
  const s = seatData[id];
  if (s) {
    s.circle.setAttribute('fill', s.color);
    s.circle.classList.remove('seat-selected');
    s.el.setAttribute('aria-pressed', 'false');
  }
  selectedSeats = selectedSeats.filter(x => x.id !== id);
  renderCart();
};

/* =============================================================
   ZOOM + PAN  (Fixed: centered transform, wheel on cursor)
   ============================================================= */
function initZoomPan() {
  if (_panLock) return;
  _panLock = true;

  const svg = document.getElementById('venue-svg');
  const group = document.getElementById('svg-pan-group');
  svgScale = 1; svgTx = 0; svgTy = 0;

  function applyTransform() {
    group.setAttribute('transform', `translate(${svgTx.toFixed(2)},${svgTy.toFixed(2)}) scale(${svgScale.toFixed(4)})`);
    // Show seat numbers at high zoom
    group.classList.toggle('zoom-labels', svgScale >= 2.2);
  }

  function zoomAt(factor, originX, originY) {
    const newScale = Math.max(0.55, Math.min(5.5, svgScale * factor));
    if (newScale === svgScale) return;
    // Adjust translation so the zoom is centred on (originX, originY) in svg coords
    const r = newScale / svgScale;
    svgTx = originX - r * (originX - svgTx);
    svgTy = originY - r * (originY - svgTy);
    svgScale = newScale;
    applyTransform();
  }

  // Button controls — zoom around SVG centre
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const vcx = vb[2] / 2, vcy = vb[3] / 2;

  document.getElementById('btn-map-in').onclick = () => zoomAt(1.35, vcx, vcy);
  document.getElementById('btn-map-out').onclick = () => zoomAt(1 / 1.35, vcx, vcy);
  document.getElementById('btn-map-home').onclick = () => {
    svgScale = 1; svgTx = 0; svgTy = 0; applyTransform();
  };

  // Mouse-wheel zoom (centered on cursor)
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    // Convert mouse position to SVG coordinate space
    const mouseX = (e.clientX - rect.left) / rect.width * vb[2];
    const mouseY = (e.clientY - rect.top) / rect.height * vb[3];
    // cursor in group coordinate space
    const gx = (mouseX - svgTx) / svgScale;
    const gy = (mouseY - svgTy) / svgScale;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.55, Math.min(5.5, svgScale * factor));
    svgTx = mouseX - gx * newScale;
    svgTy = mouseY - gy * newScale;
    svgScale = newScale;
    applyTransform();
  }, { passive: false });

  // Mouse drag to pan
  let dragging = false, dragSX, dragSY, dragTX, dragTY;
  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    dragSX = e.clientX; dragSY = e.clientY;
    dragTX = svgTx; dragTY = svgTy;
    svg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = vb[2] / rect.width;
    const scaleY = vb[3] / rect.height;
    svgTx = dragTX + (e.clientX - dragSX) * scaleX;
    svgTy = dragTY + (e.clientY - dragSY) * scaleY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; svg.style.cursor = 'grab'; });

  // Touch
  let tc0 = null, tTX, tTY;
  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { tc0 = e.touches[0]; tTX = svgTx; tTY = svgTy; }
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && tc0) {
      const rect = svg.getBoundingClientRect();
      const sx = vb[2] / rect.width, sy = vb[3] / rect.height;
      svgTx = tTX + (e.touches[0].clientX - tc0.clientX) * sx;
      svgTy = tTY + (e.touches[0].clientY - tc0.clientY) * sy;
      applyTransform();
    }
  }, { passive: true });

  // Touch pinch‑zoom
  let lastPinchDist = null;
  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 2) lastPinchDist = null;
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist !== null) {
        const factor = dist / lastPinchDist;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = svg.getBoundingClientRect();
        const ox = (mx - rect.left) / rect.width * vb[2];
        const oy = (my - rect.top) / rect.height * vb[3];
        zoomAt(factor, ox, oy);
      }
      lastPinchDist = dist;
    }
  }, { passive: true });
}

/* =============================================================
   UPDATE SVG VIEWBOX when venue changes
   ============================================================= */
function updateSvgStructure() {
  const cfg = VENUE_CONFIGS[currentVenueKey];
  const svg = document.getElementById('venue-svg');
  svg.setAttribute('viewBox', cfg.viewBox);
  svg.dataset.venue = currentVenueKey;

  const stageEl = svg.querySelector('.stage-ellipse');
  const stageT1 = svg.querySelector('text.stage-text1');
  const stageT2 = svg.querySelector('text.stage-text2');
  const bgEl = svg.querySelector('.bg-ellipse');
  const modal = document.getElementById('ticket-modal');
  const layoutLabel = document.getElementById('map-layout-label');

  if (modal) modal.dataset.venue = currentVenueKey;
  if (layoutLabel) layoutLabel.textContent = cfg.layoutLabel || 'Vista del recinto';

  const scy = cfg.cy; // Stage and arc share the same center

  if (stageEl) {
    stageEl.setAttribute('cx', cfg.cx);
    stageEl.setAttribute('cy', scy);
    stageEl.setAttribute('rx', cfg.stageRx || cfg.stageR);
    stageEl.setAttribute('ry', cfg.stageRy || cfg.stageR);
  }
  if (stageT1) {
    stageT1.setAttribute('x', cfg.cx);
    stageT1.setAttribute('y', scy - 6);
    stageT1.textContent = cfg.stageLabel || 'ESCENARIO';
  }
  if (stageT2) {
    stageT2.setAttribute('x', cfg.cx);
    stageT2.setAttribute('y', scy + 10);
    stageT2.textContent = cfg.stageSubLabel || '360°';
  }
  if (bgEl) {
    if (cfg.bgR && cfg.bgR > 0) {
      bgEl.style.display = '';
      bgEl.setAttribute('cx', cfg.cx);
      bgEl.setAttribute('cy', cfg.cy);
      bgEl.setAttribute('rx', cfg.bgR);
      bgEl.setAttribute('ry', cfg.bgR);
    } else {
      bgEl.style.display = 'none';
    }
  }
}

/* =============================================================
   OPEN TICKET MODAL (entry point from event cards)
   ============================================================= */
function openTicketModal(name, date, venue, price, venueType) {
  const base = parseInt(String(price).replace(/[^0-9]/g, '')) || 650;

  // Pick venue layout
  currentVenueKey = venueType || EVENT_VENUE_MAP[name] || 'palenque';

  const cfg = VENUE_CONFIGS[currentVenueKey];
  const prices = {};
  cfg.zones.forEach(z => {
    const ratio = z.priceBase / cfg.zones[cfg.zones.length - 1].priceBase;
    prices[z.key] = Math.round(base * ratio);
  });

  // Update header
  document.getElementById('tm-event-name').textContent = name;
  document.getElementById('tm-date-text').textContent = date;
  document.getElementById('tm-venue-text').textContent = venue;

  // Update legend bar
  cfg.zones.forEach(z => {
    const el = document.getElementById(`plb-${z.key}`);
    if (el) el.textContent = `$${prices[z.key].toLocaleString('es-MX')}`;
  });
  renderMapLegend(prices);

  // Save cart info in session for checkout page
  sessionStorage.setItem('bm_event', JSON.stringify({ name, date, venue }));

  // Reset SVG structure
  updateSvgStructure();

  // Reset zoom
  svgScale = 1; svgTx = 0; svgTy = 0;
  const group = document.getElementById('svg-pan-group');
  if (group) {
    group.setAttribute('transform', 'translate(0,0) scale(1)');
    group.classList.remove('zoom-labels');
  }

  // Generate fresh seats
  generateSeats(prices);

  // Reset cart UI
  selectedSeats = [];
  renderEmptyCart(document.getElementById('cart-items-list'));
  document.getElementById('cart-totals').style.display = 'none';
  document.getElementById('cart-count-badge').textContent = '0 boletos';
  const btn = document.getElementById('btn-comprar');
  if (btn) btn.disabled = true;

  // Allow zoom/pan re-init each time modal opens
  _panLock = false;
  openModal('ticket-modal');

  // Init after modal is visible
  requestAnimationFrame(() => initZoomPan());
}

/* =============================================================
   CHECKOUT REDIRECT
   ============================================================= */
function proceedCheckout() {
  if (!selectedSeats.length) { showToast('⚠️ Selecciona al menos un asiento primero', 'error'); return; }

  // Save cart to session storage
  const subtotal = selectedSeats.reduce((a, s) => a + s.price, 0);
  const fee = Math.round(subtotal * FEE_RATE);
  const total = subtotal + fee;

  const cartPayload = {
    seats: selectedSeats.map(s => ({
      zone: s.zoneLabel, fila: s.fila,
      mesa: s.mesaNum, asiento: s.asiento, seatInMesa: s.seatInMesa,
      tableSize: s.tableSize, price: s.price,
    })),
    subtotal, fee, total,
    event: JSON.parse(sessionStorage.getItem('bm_event') || '{}'),
  };
  sessionStorage.setItem('bm_cart', JSON.stringify(cartPayload));

  showCheckoutTransition();
  setTimeout(() => {
    window.location.href = 'checkout.html';
  }, 720);
}

// =================== FURNITURE QUICK VIEW ===================
function showFurnitureQuickView(name, desc, price) {
  document.getElementById('fv-name').textContent = name;
  document.getElementById('fv-desc').textContent = desc;
  document.getElementById('fv-price').textContent = price + ' MXN';
  openModal('furniture-modal');
}

// =================== NEWSLETTER ===================
function subscribeNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('newsletter-email').value;
  showToast(`Suscripción confirmada para ${email}`);
  document.getElementById('newsletter-email').value = '';
}

// =================== TOAST ===================
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.background = type === 'error' ? '#ef4444' : '#10b981';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
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

// =================== EXPOSE GLOBALS ===================
window.openModal = openModal; window.closeModal = closeModal; window.switchModal = switchModal;
window.handleLogin = handleLogin; window.handleRegister = handleRegister; window.togglePass = togglePass;
window.openTicketModal = openTicketModal; window.proceedCheckout = proceedCheckout;
window.showFurnitureQuickView = showFurnitureQuickView;
window.subscribeNewsletter = subscribeNewsletter;
window.showToast = showToast;
