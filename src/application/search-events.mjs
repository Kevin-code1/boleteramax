import { filterEvents, inferFiltersFallback, sanitizeFilters } from '../domain/search.mjs';
import { logAiFallback } from '../adapters/ai/openai-filters.mjs';

const EMPTY_FILTERS = {
  categoria: null,
  ciudad: null,
  fecha: null,
  precioMax: null,
  keywords: [],
};

export function createSearchEvents({ aiFilters, catalog }) {
  return async function searchEvents(rawQuery) {
    const query = String(rawQuery || '').trim();

    if (!query) {
      return {
        query,
        filters: { ...EMPTY_FILTERS },
        results: [],
        meta: {
          mode: 'empty',
          warning: null,
        },
      };
    }

    const aiResult = await aiFilters.inferFilters(query);
    let filters = sanitizeFilters(aiResult.filters);
    const hasUsefulFilters =
      Boolean(filters.categoria) ||
      Boolean(filters.ciudad) ||
      Boolean(filters.fecha) ||
      filters.precioMax !== null ||
      filters.keywords.length > 0;

    if (!hasUsefulFilters) {
      logAiFallback(
        aiResult.mode === 'ai'
          ? 'OpenAI no devolvio filtros utiles'
          : 'la interpretacion local no devolvio filtros utiles',
      );
      filters = sanitizeFilters(inferFiltersFallback(query, catalog.events));
    }
    const results = filterEvents(catalog.events, filters).slice(0, 6);

    return {
      query,
      filters,
      results,
      meta: {
        mode: aiResult.mode,
        warning: aiResult.warning || null,
      },
    };
  };
}
