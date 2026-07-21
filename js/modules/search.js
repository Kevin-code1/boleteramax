import { showToast } from './toast.js';
import { openTicketModal } from './seatmap.js';

const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
const SEARCH_DEBOUNCE_MS = 420;
const AI_SEARCH_TIMEOUT_MS = 6000;
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
    .replace(/[̀-ͯ]/g, '')
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
    if (error.name === 'AbortError' && !timedOut) return;

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
