import { ADMIN_API_KEY, PORT, TURNSTILE_ENABLED } from './src/config/index.mjs';
import { createEventsCatalog } from './src/adapters/catalog/events-catalog.mjs';
import { createTicketStore } from './src/adapters/persistence/ticket-store.mjs';
import { createUserStore } from './src/adapters/persistence/user-store.mjs';
import { createAiFilterInference, hasOpenAIKey } from './src/adapters/ai/openai-filters.mjs';
import { createTurnstileVerifier } from './src/adapters/captcha/turnstile.mjs';
import { createQrCodeGenerator } from './src/adapters/qr/qr-codes.mjs';
import { createEmailService } from './src/adapters/email/email-service.mjs';
import { createSearchEvents } from './src/application/search-events.mjs';
import { createAvailability } from './src/application/availability.mjs';
import { createCheckout } from './src/application/checkout.mjs';
import { createTicketQueries } from './src/application/tickets.mjs';
import { createValidateTicket } from './src/application/validate-ticket.mjs';
import { createAuth } from './src/application/auth.mjs';
import { createAccount } from './src/application/account.mjs';
import { createApp } from './src/adapters/http/app.mjs';

const catalog = createEventsCatalog();
const ticketStore = createTicketStore({ logger: console });
const userStore = await createUserStore();
const aiFilters = createAiFilterInference({ catalog });
const captcha = createTurnstileVerifier();
const qr = createQrCodeGenerator();
const emailService = createEmailService();

ticketStore.ensureTicketsFile();

const services = {
  searchEvents: createSearchEvents({ aiFilters, catalog }),
  availability: createAvailability({ catalog, ticketStore }),
  checkout: createCheckout({ catalog, ticketStore, captcha }),
  ticketQueries: createTicketQueries({ ticketStore, qr }),
  validateTicket: createValidateTicket({ ticketStore }),
  auth: createAuth({ userStore, emailService }),
  account: createAccount({ ticketStore }),
  emailService,
};

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
