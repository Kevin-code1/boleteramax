import OpenAI from 'openai';
import { inferFiltersFallback, isValidFilterShape, sanitizeFilters } from '../../domain/search.mjs';

export const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);

export function logAiFallback(reason) {
  console.warn(`BoletaMax AI debug: fallback local - ${reason}`);
}

function logOpenAIError(error) {
  const responseBody =
    error?.error ??
    error?.response?.data ??
    error?.response?.body ??
    error?.body ??
    null;

  console.error('BoletaMax AI debug: OpenAI fallo', {
    message: error?.message || 'Error sin mensaje',
    status: error?.status ?? null,
    code: error?.code ?? null,
  });

  if (responseBody !== null && responseBody !== undefined) {
    console.error('BoletaMax AI debug: OpenAI response body', responseBody);
  }
}

export function createAiFilterInference({ catalog }) {
  const openai = hasOpenAIKey ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  async function inferFilters(query) {
    if (!openai) {
      logAiFallback('OPENAI_API_KEY no configurada');
      return {
        filters: inferFiltersFallback(query, catalog.events),
        mode: 'fallback',
        warning: 'OPENAI_API_KEY no está configurada. Se usó interpretación local.',
      };
    }

    try {
      console.log('BoletaMax AI debug: intentando llamada a OpenAI');
      const response = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'Convierte búsquedas de usuarios de una boletera en JSON de filtros. Usa solo estas categorías: musica, teatro, deportes, feria, familia, comedia. Si el usuario dice "barato" y no da monto, usa precioMax=500. Si no puedes inferir un valor, usa null. Devuelve JSON válido.',
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: query }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'boletamax_event_filters',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                categoria: { type: ['string', 'null'] },
                ciudad: { type: ['string', 'null'] },
                fecha: { type: ['string', 'null'] },
                precioMax: { type: ['number', 'null'] },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['categoria', 'ciudad', 'fecha', 'precioMax', 'keywords'],
            },
          },
        },
      });

      const rawText =
        response.output_text ||
        response.output?.[0]?.content?.find(item => item.type === 'output_text')?.text ||
        '{}';

      const parsed = JSON.parse(rawText);
      if (!isValidFilterShape(parsed)) {
        logAiFallback('respuesta IA con formato inesperado');
        return {
          filters: inferFiltersFallback(query, catalog.events),
          mode: 'fallback',
          warning: 'La IA respondió con un formato inesperado. Se usó interpretación local.',
        };
      }

      return {
        filters: sanitizeFilters(parsed),
        mode: 'ai',
        warning: null,
      };
    } catch (error) {
      const isParseError = error instanceof SyntaxError;
      logOpenAIError(error);
      logAiFallback(
        isParseError
          ? 'no se pudo interpretar la respuesta de OpenAI'
          : 'fallo la llamada a OpenAI',
      );
      return {
        filters: inferFiltersFallback(query, catalog.events),
        mode: 'fallback',
        warning: isParseError
          ? 'La respuesta IA no pudo interpretarse. Se usó interpretación local.'
          : 'La búsqueda IA no estuvo disponible. Se usó interpretación local.',
      };
    }
  }

  return { inferFilters };
}
