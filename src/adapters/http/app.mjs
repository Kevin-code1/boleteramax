import express from 'express';
import path from 'path';
import {
  ROOT_DIR,
  EVENTS_PATH,
  TICKETS_STORAGE_MODE,
  TURNSTILE_ENABLED,
  TURNSTILE_SITE_KEY,
} from '../../config/index.mjs';
import {
  apiGeneralLimiter,
  aiSearchLimiter,
  authLimiter,
  blockSensitiveFiles,
  purchaseLimiter,
  requireAdminAuth,
  resendVerificationLimiter,
  securityHeaders,
  ticketQueryLimiter,
  validationLimiter,
} from './middleware.mjs';
import { clearSessionCookie, getSessionCookie, setSessionCookie } from './cookies.mjs';

function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

export function createApp({ services }) {
  const { searchEvents, availability, checkout, ticketQueries, validateTicket, auth, account, emailService } = services;

  const verifyUrlBuilder = req => token => emailService.buildVerifyUrl(token, req);

  // Usuario de la sesión o null.
  async function resolveSessionUser(req) {
    try {
      return await auth.getSessionUser(getSessionCookie(req));
    } catch (error) {
      console.error('BoletaMax Auth: session lookup failed', {
        message: error?.message || 'Error desconocido',
      });
      return null;
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // ── Middleware base ──
  app.use(securityHeaders);
  app.use(blockSensitiveFiles);
  app.use(express.json({ limit: '64kb' }));

  // ── Archivos estáticos ──
  const PUBLIC_HTML_FILES = new Map([
    ['/index.html', 'index.html'],
    ['/checkout.html', 'checkout.html'],
    ['/verify-email.html', 'verify-email.html'],
    ['/ticket.html', 'ticket.html'],
    ['/ticket-public.html', 'ticket-public.html'],
    ['/validate.html', 'validate.html'],
  ]);
  app.get([...PUBLIC_HTML_FILES.keys()], (req, res) => {
    res.sendFile(path.join(ROOT_DIR, PUBLIC_HTML_FILES.get(req.path)));
  });
  app.get('/data/events.json', (req, res) => {
    res.sendFile(EVENTS_PATH);
  });
  app.use('/css', express.static(path.join(ROOT_DIR, 'css'), { index: false }));
  app.use('/js', express.static(path.join(ROOT_DIR, 'js'), { index: false }));
  app.use('/assets', express.static(path.join(ROOT_DIR, 'assets'), { index: false }));

  app.use('/api/', apiGeneralLimiter);

  // ── Búsqueda con IA ──
  app.post('/api/ai-search', aiSearchLimiter, async (req, res) => {
    return res.json(await searchEvents(req.body?.query));
  });

  app.get('/api/security-config', (req, res) => {
    return res.json({
      ok: true,
      cloudflare: {
        turnstileEnabled: TURNSTILE_ENABLED,
        siteKey: TURNSTILE_ENABLED ? TURNSTILE_SITE_KEY : null,
        mode: TURNSTILE_ENABLED ? 'active' : 'demo',
        message: TURNSTILE_ENABLED
          ? 'Cloudflare Turnstile activo.'
          : 'Cloudflare Turnstile listo para activar configurando TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY.',
      },
    });
  });

  // Cuentas de compradores (separadas del staff)
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const result = await auth.register({
        name: req.body?.name,
        email: req.body?.email,
        password: req.body?.password,
        buildVerifyUrl: verifyUrlBuilder(req),
      });

      if (result.outcome === 'invalid') {
        return res.status(400).json({ ok: false, message: result.errors[0], errors: result.errors });
      }
      if (result.outcome === 'email_taken') {
        return res.status(409).json({ ok: false, message: 'Ya existe una cuenta con ese correo.' });
      }

      return res.status(201).json({
        ok: true,
        pendingVerification: true,
        message: 'Cuenta creada. Revisa tu correo para verificar tu cuenta antes de iniciar sesión.',
      });
    } catch (error) {
      console.error('BoletaMax Auth: register failed', {
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible crear la cuenta en este momento.' });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const result = await auth.login({
        email: req.body?.email,
        password: req.body?.password,
      });

      // Credenciales correctas pero correo sin verificar: 403, sin cookie.
      if (result.outcome === 'email_not_verified') {
        return res.status(403).json({
          ok: false,
          code: 'email_not_verified',
          message: 'Verifica tu correo antes de iniciar sesión.',
        });
      }

      if (result.outcome !== 'ok') {
        return res.status(401).json({ ok: false, message: 'Correo o contraseña incorrectos.' });
      }

      setSessionCookie(res, result.sessionToken, result.expiresAt);
      return res.json({ ok: true, user: result.user });
    } catch (error) {
      console.error('BoletaMax Auth: login failed', {
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible iniciar sesión en este momento.' });
    }
  });

  app.post('/api/auth/resend-verification', resendVerificationLimiter, async (req, res) => {
    try {
      await auth.resendVerification({
        email: req.body?.email,
        buildVerifyUrl: verifyUrlBuilder(req),
      });
      // Respuesta genérica igual exista o no el correo (anti-enumeración).
      // No se devuelve el enlace ni el token en ningún entorno.
      return res.json({
        ok: true,
        message: 'Si tu correo está registrado y sin verificar, te enviamos un nuevo enlace.',
      });
    } catch (error) {
      console.error('BoletaMax Auth: resend verification failed', {
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible reenviar el correo en este momento.' });
    }
  });

  app.get('/api/auth/verify-email', async (req, res) => {
    try {
      const result = await auth.verifyEmail(req.query?.token);

      if (result.outcome === 'ok') {
        return res.json({ ok: true, message: 'Tu correo fue verificado. Ya puedes iniciar sesión.' });
      }

      const messages = {
        used: 'Este enlace ya fue utilizado. Si ya verificaste, inicia sesión.',
        expired: 'El enlace de verificación expiró. Solicita uno nuevo.',
        invalid: 'El enlace de verificación no es válido.',
      };
      return res.status(400).json({
        ok: false,
        code: result.outcome,
        message: messages[result.outcome] || messages.invalid,
      });
    } catch (error) {
      console.error('BoletaMax Auth: verify email failed', {
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible verificar el correo en este momento.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      await auth.logout(getSessionCookie(req));
    } catch (error) {
      console.error('BoletaMax Auth: logout failed', {
        message: error?.message || 'Error desconocido',
      });
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'No has iniciado sesión.' });
    }
    return res.json({
      ok: true,
      user: {
        email: user.email,
        displayName: user.displayName,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
    });
  });

  app.get('/api/account/tickets', ticketQueryLimiter, async (req, res) => {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'Inicia sesión para ver tus boletos.' });
    }

    try {
      const result = await account.getMyTickets(user.id);
      return res.json({ ok: true, tickets: result.tickets });
    } catch (error) {
      console.error('BoletaMax Account: tickets read failed', {
        mode: TICKETS_STORAGE_MODE,
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible consultar tus boletos en este momento.' });
    }
  });

  // ── Disponibilidad por descriptor de evento (name/date/venue) ──
  app.post('/api/events/availability', async (req, res) => {
    try {
      const rawEvent = req.body?.event && typeof req.body.event === 'object' ? req.body.event : {};
      const result = await availability.byDescriptor(rawEvent);

      if (result.outcome === 'missing_name') {
        return res.status(400).json({ ok: false, message: 'event.name requerido.' });
      }
      if (result.outcome === 'not_found') {
        return res.status(404).json({ ok: false, message: 'Evento no encontrado en el catalogo.' });
      }
      return res.json(result.body);
    } catch (error) {
      console.error('BoletaMax Availability: read failed', {
        mode: TICKETS_STORAGE_MODE,
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible consultar la disponibilidad en este momento.' });
    }
  });

  // ── Disponibilidad de asientos por eventId ──
  app.get('/api/events/:eventId/availability', async (req, res) => {
    try {
      const result = await availability.byEventId(req.params.eventId);

      if (result.outcome === 'missing_id') {
        return res.status(400).json({ ok: false, message: 'eventId requerido.' });
      }
      return res.json(result.body);
    } catch (error) {
      console.error('BoletaMax Availability: read failed', {
        mode: TICKETS_STORAGE_MODE,
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({ ok: false, message: 'No fue posible consultar la disponibilidad en este momento.' });
    }
  });

  app.post('/api/checkout/quote', purchaseLimiter, (req, res) => {
    try {
      const result = checkout.quote(req.body);

      if (result.outcome === 'invalid') {
        return res.status(400).json({
          ok: false,
          message: result.errors[0],
          errors: result.errors,
        });
      }

      return res.json({
        ok: true,
        quote: result.quote,
      });
    } catch (error) {
      console.warn('BoletaMax Checkout: quote rejected', {
        message: error?.message || 'Cotizacion invalida',
      });
      return res.status(400).json({
        ok: false,
        message: error?.message || 'No fue posible calcular una cotizacion segura.',
      });
    }
  });

  app.post('/api/tickets', purchaseLimiter, async (req, res) => {
    try {
      // La sesión solo asocia la orden; nunca bloquea la compra.
      const sessionUser = await resolveSessionUser(req);
      const result = await checkout.purchase(req.body, {
        publicBaseUrl: getPublicBaseUrl(req),
        requestContext: req,
        userId: sessionUser?.id || null,
      });

      if (result.outcome === 'invalid') {
        return res.status(400).json({
          ok: false,
          message: result.errors[0],
          errors: result.errors,
        });
      }

      if (result.outcome === 'captcha_rejected') {
        return res.status(403).json({
          ok: false,
          message: 'No se pudo verificar la proteccion Cloudflare. Intenta nuevamente.',
        });
      }

      return res.status(201).json(result.body);
    } catch (error) {
      const isClientError = /Cotizacion|cotizacion|asientos|Evento|Zona|expir|disponible|invalida|requerido|maximo|metodo/i.test(error?.message || '');
      console.error('BoletaMax Tickets: error al generar boletos', {
        message: error?.message || 'Error desconocido',
      });
      return res.status(isClientError ? 400 : 500).json({
        ok: false,
        message: isClientError
          ? error.message
          : 'No fue posible generar los boletos en este momento.',
      });
    }
  });

  app.get('/api/tickets', ticketQueryLimiter, async (req, res) => {
    return res.status(410).json({
      ok: false,
      message: 'Este endpoint requiere autenticacion privada. Usa POST /api/tickets/private.',
    });
  });

  app.get('/api/public/tickets/:ticketId', ticketQueryLimiter, async (req, res) => {
    const ticketId = String(req.params.ticketId || '').trim();

    try {
      const result = await ticketQueries.getPublicTicket(ticketId);

      if (result.outcome === 'missing_id') {
        return res.status(400).json({
          ok: false,
          message: 'ticketId requerido.',
        });
      }

      if (result.outcome === 'not_found') {
        return res.status(404).json({
          ok: false,
          message: 'Boleto no encontrado.',
        });
      }

      return res.json({
        ok: true,
        ticket: result.ticket,
      });
    } catch (error) {
      console.error('BoletaMax Tickets: storage read failed', {
        ticketId,
        mode: TICKETS_STORAGE_MODE,
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({
        ok: false,
        message: 'No fue posible consultar los boletos en este momento.',
      });
    }
  });

  app.post('/api/tickets/private', ticketQueryLimiter, async (req, res) => {
    try {
      const result = await ticketQueries.getPrivateTickets(req.body?.tickets);

      if (result.outcome === 'empty_request') {
        return res.status(400).json({
          ok: false,
          message: 'Debes enviar al menos un ticketId con token.',
        });
      }

      return res.json({
        ok: true,
        tickets: result.tickets,
      });
    } catch (error) {
      console.error('BoletaMax Tickets: private storage read failed', {
        mode: TICKETS_STORAGE_MODE,
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({
        ok: false,
        message: 'No fue posible consultar los boletos en este momento.',
      });
    }
  });

  app.get('/api/tickets/:ticketId/dynamic-qr', ticketQueryLimiter, async (req, res) => {
    const token = String(req.headers['x-ticket-token'] || '').trim();
    const sessionUser = await resolveSessionUser(req);
    const result = await ticketQueries.getDynamicQr(req.params.ticketId, token, {
      sessionUserId: sessionUser?.id || null,
    });

    if (result.outcome === 'storage_error') {
      return res.status(500).json({
        ok: false,
        message: 'No se pudo consultar el boleto en este momento.',
      });
    }

    if (result.outcome === 'not_found') {
      return res.status(404).json({
        ok: false,
        message: 'Boleto no encontrado.',
      });
    }

    if (result.outcome === 'unauthorized') {
      return res.status(403).json({
        ok: false,
        message: 'Acceso no autorizado al código de entrada.',
      });
    }

    if (result.outcome === 'inactive') {
      return res.json({
        ok: true,
        active: false,
        ticket: result.ticket,
        message: result.message,
      });
    }

    if (result.outcome === 'active') {
      return res.json({
        ok: true,
        active: true,
        ticket: result.ticket,
        ...result.dynamicQr,
      });
    }

    return res.status(500).json({
      ok: false,
      message: 'No se pudo generar el QR dinámico.',
    });
  });

  app.get('/api/tickets/:ticketId', ticketQueryLimiter, async (req, res) => {
    const ticketId = String(req.params.ticketId || '').trim();
    const token = String(req.headers['x-ticket-token'] || '').trim();

    try {
      const sessionUser = await resolveSessionUser(req);
      const result = await ticketQueries.getTicketDetail(ticketId, token, {
        sessionUserId: sessionUser?.id || null,
      });

      if (result.outcome === 'not_found') {
        return res.status(404).json({
          ok: false,
          message: 'Boleto no encontrado.',
        });
      }

      if (result.outcome === 'unauthorized') {
        return res.status(403).json({
          ok: false,
          message: 'Acceso no autorizado al detalle del boleto.',
        });
      }

      return res.json({
        ok: true,
        ticket: result.ticket,
      });
    } catch (error) {
      console.error('BoletaMax Tickets: storage read failed', {
        ticketId,
        mode: TICKETS_STORAGE_MODE,
        message: error?.message || 'Error desconocido',
      });
      return res.status(500).json({
        ok: false,
        message: 'No fue posible consultar el boleto en este momento.',
      });
    }
  });

  app.post('/api/validate-ticket', validationLimiter, requireAdminAuth, async (req, res) => {
    let result;
    try {
      result = await validateTicket({
        ticketId: req.body?.ticketId,
        eventId: req.body?.eventId,
        token: req.body?.token,
        dynamicToken: req.body?.dynamicToken,
        window: req.body?.window,
      });
    } catch (error) {
      console.error('BoletaMax Validate: storage update failed', {
        mode: TICKETS_STORAGE_MODE,
        message: 'Ticket validation storage operation failed.',
      });
      return res.status(500).json({
        valid: false,
        message: 'No fue posible validar el boleto en este momento.',
      });
    }

    return res.json(result);
  });

  // ── Páginas ──
  app.get('/ticket', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'ticket.html'));
  });

  app.get('/tickets/:ticketId', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'ticket-public.html'));
  });

  app.get('/admin/scan', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'validate.html'));
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
  });

  return app;
}
