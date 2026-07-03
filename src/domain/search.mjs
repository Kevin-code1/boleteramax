import {
  ALLOWED_CATEGORIES,
  CURRENT_MONTH_INDEX,
  FILTERS_SCHEMA_KEYS,
  MONTHS,
} from '../config/index.mjs';
import { normalizeText } from './text.mjs';

export function inferMonthToken(rawDate) {
  const normalized = normalizeText(rawDate);

  if (!normalized) return null;
  if (normalized.includes('este mes')) return MONTHS[CURRENT_MONTH_INDEX];
  if (normalized.includes('proximo mes') || normalized.includes('próximo mes')) {
    return MONTHS[(CURRENT_MONTH_INDEX + 1) % 12];
  }

  return MONTHS.find(month => normalized.includes(month)) || null;
}

function sanitizeKeywords(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(keyword => normalizeText(keyword))
    .filter(Boolean)
    .slice(0, 6);
}

export function sanitizeFilters(rawFilters = {}) {
  const categoria = normalizeText(rawFilters.categoria || '');
  const city = normalizeText(rawFilters.ciudad || '');
  const fecha = rawFilters.fecha ? String(rawFilters.fecha).trim() : null;
  const rawPrice = Number(rawFilters.precioMax);

  const sanitized = {
    categoria: ALLOWED_CATEGORIES.includes(categoria) ? categoria : null,
    ciudad: city || null,
    fecha: fecha || null,
    precioMax: Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null,
    keywords: sanitizeKeywords(rawFilters.keywords),
  };

  if (sanitized.categoria === null && categoria === 'familiar') {
    sanitized.categoria = 'familia';
  }

  return sanitized;
}

export function isValidFilterShape(rawFilters) {
  if (!rawFilters || typeof rawFilters !== 'object' || Array.isArray(rawFilters)) return false;

  const keys = Object.keys(rawFilters);
  if (keys.some(key => !FILTERS_SCHEMA_KEYS.includes(key))) return false;

  const isNullableString = value => value === null || typeof value === 'string';
  const isNullableNumber = value => value === null || (typeof value === 'number' && Number.isFinite(value));

  return (
    isNullableString(rawFilters.categoria) &&
    isNullableString(rawFilters.ciudad) &&
    isNullableString(rawFilters.fecha) &&
    isNullableNumber(rawFilters.precioMax) &&
    Array.isArray(rawFilters.keywords) &&
    rawFilters.keywords.every(keyword => typeof keyword === 'string')
  );
}

export function inferFiltersFallback(query, eventsCatalog = []) {
  const normalized = normalizeText(query);
  const filters = {
    categoria: null,
    ciudad: null,
    fecha: null,
    precioMax: null,
    keywords: [],
  };

  const categoryMatchers = {
    musica: ['musica', 'música', 'concierto', 'rock', 'banda', 'urbano', 'festival'],
    teatro: ['teatro', 'musical', 'opera', 'ópera', 'escena'],
    deportes: ['deporte', 'deportes', 'lucha', 'arena'],
    feria: ['feria', 'ferias'],
    familia: ['familia', 'familiar', 'ninos', 'niños'],
    comedia: ['comedia', 'humor', 'standup', 'stand up'],
  };

  for (const [category, terms] of Object.entries(categoryMatchers)) {
    if (terms.some(term => normalized.includes(normalizeText(term)))) {
      filters.categoria = category;
      if (category === 'familia') filters.keywords.push('familia');
      break;
    }
  }

  const matchedCity = [...new Set(eventsCatalog.map(event => event.city))].find(city =>
    normalized.includes(normalizeText(city)),
  );
  if (matchedCity) filters.ciudad = matchedCity;

  const explicitPrice = normalized.match(/(?:hasta|menos de|maximo|maximo de|máximo|maximo por|por debajo de)\s*\$?\s*(\d{2,5})/);
  if (explicitPrice) {
    filters.precioMax = Number(explicitPrice[1]);
  } else if (normalized.includes('barato') || normalized.includes('económico') || normalized.includes('economico')) {
    filters.precioMax = 500;
  }

  filters.fecha = inferMonthToken(query);

  const stopwords = new Set([
    'quiero', 'algo', 'eventos', 'evento', 'de', 'del', 'la', 'el', 'en', 'para', 'este', 'mes',
    'una', 'un', 'con', 'por', 'que', 'sea', 'los', 'las', 'barato', 'barata', 'familiares',
  ]);

  filters.keywords = [
    ...new Set(
      normalized
        .split(/[^a-z0-9]+/i)
        .map(token => token.trim())
        .filter(token => token && !stopwords.has(token) && token.length > 2),
    ),
  ].slice(0, 6);

  return filters;
}

function matchesDateFilter(event, dateFilter) {
  if (!dateFilter) return true;
  const requestedMonth = inferMonthToken(dateFilter);
  if (!requestedMonth) return true;
  return normalizeText(event.date).includes(requestedMonth);
}

function matchesKeywords(event, keywords) {
  if (!keywords.length) return true;

  const searchable = normalizeText(
    [event.name, event.city, event.venue, event.description, ...(event.keywords || [])].join(' '),
  );

  return keywords.some(keyword => searchable.includes(normalizeText(keyword)));
}

function matchStrength(sourceValue, targetValue) {
  const source = normalizeText(sourceValue);
  const target = normalizeText(targetValue);

  if (!source || !target) return 0;
  if (source === target) return 3;
  if (source.includes(target) || target.includes(source)) return 2;
  if (source.split(/\s+/).some(token => token && target.includes(token))) return 1;
  return 0;
}

function keywordMatchScore(event, keywords) {
  if (!keywords.length) return 0;

  const searchFields = [
    event.name,
    event.city,
    event.venue,
    event.description,
    ...(event.keywords || []),
  ];

  return keywords.reduce((total, keyword) => {
    let best = 0;
    for (const field of searchFields) {
      best = Math.max(best, matchStrength(field, keyword));
      if (best === 3) break;
    }
    return total + best;
  }, 0);
}

function eventScore(event, filters) {
  let score = 0;

  if (filters.categoria) {
    score += event.category === filters.categoria ? 9 : matchStrength(event.category, filters.categoria) * 2;
  }
  if (filters.ciudad) {
    score += matchStrength(event.city, filters.ciudad) * 8;
  }
  if (filters.fecha && matchesDateFilter(event, filters.fecha)) score += 5;
  if (filters.precioMax !== null && event.price !== null && event.price <= filters.precioMax) score += 4;
  score += keywordMatchScore(event, filters.keywords) * 3;

  return score;
}

export function filterEvents(eventsCatalog, filters) {
  const normalizedCity = filters.ciudad ? normalizeText(filters.ciudad) : null;

  return eventsCatalog
    .filter(event => !filters.categoria || event.category === filters.categoria || (filters.categoria === 'familia' && (event.keywords || []).includes('familia')))
    .filter(event => !normalizedCity || matchStrength(event.city, normalizedCity) > 0)
    .filter(event => !filters.fecha || matchesDateFilter(event, filters.fecha))
    .filter(event => filters.precioMax === null || (event.price !== null && event.price <= filters.precioMax))
    .filter(event => matchesKeywords(event, filters.keywords))
    .sort((left, right) => {
      const scoreDiff = eventScore(right, filters) - eventScore(left, filters);
      if (scoreDiff !== 0) return scoreDiff;

      const leftPrice = left.price ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = right.price ?? Number.MAX_SAFE_INTEGER;
      return leftPrice - rightPrice;
    });
}
