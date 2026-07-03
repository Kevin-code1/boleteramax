/* BoletaMax – raíz de composición.
   Construye los adaptadores, los inyecta en los casos de uso (application)
   y monta el adaptador HTTP. La lógica vive en src/domain y src/application. */

import { ADMIN_API_KEY, PORT, TURNSTILE_ENABLED } from './src/config/index.mjs';
import { createEventsCatalog } from './src/adapters/catalog/events-catalog.mjs';
import { createTicketStore } from './src/adapters/persistence/ticket-store.mjs';
import { createAiFilterInference, hasOpenAIKey } from './src/adapters/ai/openai-filters.mjs';
import { createTurnstileVerifier } from './src/adapters/captcha/turnstile.mjs';
import { createQrCodeGenerator } from './src/adapters/qr/qr-codes.mjs';
import { createSearchEvents } from './src/application/search-events.mjs';
import { createAvailability } from './src/application/availability.mjs';
import { createCheckout } from './src/application/checkout.mjs';
import { createTicketQueries } from './src/application/tickets.mjs';
import { createValidateTicket } from './src/application/validate-ticket.mjs';
import { createApp } from './src/adapters/http/app.mjs';

// ── Adaptadores (puertos de salida) ──
const catalog = createEventsCatalog();
const ticketStore = createTicketStore({ logger: console });
const aiFilters = createAiFilterInference({ catalog });
const captcha = createTurnstileVerifier();
const qr = createQrCodeGenerator();

ticketStore.ensureTicketsFile();

// ── Casos de uso (application) ──
const services = {
  searchEvents: createSearchEvents({ aiFilters, catalog }),
  availability: createAvailability({ catalog, ticketStore }),
  checkout: createCheckout({ catalog, ticketStore, captcha, qr }),
  ticketQueries: createTicketQueries({ ticketStore, qr }),
  validateTicket: createValidateTicket({ ticketStore }),
};

// ── Adaptador HTTP (puerto de entrada) ──
const app = createApp({ services });

app.listen(PORT, () => {
  console.log(`BoletaMax running at http://localhost:${PORT}`);
  console.log(`BoletaMax AI debug: OPENAI_API_KEY ${hasOpenAIKey ? 'detectada' : 'ausente'}`);
  console.log(hasOpenAIKey ? 'BoletaMax AI: OpenAI habilitado' : 'BoletaMax AI: usando fallback local');
  console.log(`BoletaMax Security: ADMIN_API_KEY ${ADMIN_API_KEY ? 'configurada' : 'NO configurada (admin sin protección)'}`);
  console.log(`BoletaMax Security: Turnstile ${TURNSTILE_ENABLED ? 'activo' : 'desactivado'}`);
  console.log('BoletaMax Security: Rate limiting activo en todos los endpoints API');
  console.log('BoletaMax Security: Archivos sensibles bloqueados (.env, server.mjs, tickets.json)');
});
