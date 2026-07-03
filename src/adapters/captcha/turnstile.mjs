import { TURNSTILE_ENABLED, TURNSTILE_SECRET_KEY } from '../../config/index.mjs';

export function createTurnstileVerifier() {
  async function verifyToken(req, token) {
    if (!TURNSTILE_ENABLED) {
      return { ok: true, mode: 'demo', reason: 'turnstile_not_configured' };
    }

    if (!token || typeof token !== 'string' || token.length > 2048) {
      return { ok: false, mode: 'active', reason: 'missing_or_invalid_token' };
    }

    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: req.ip,
        }),
      });
      const payload = await response.json();
      return {
        ok: Boolean(payload.success),
        mode: 'active',
        reason: payload.success ? 'verified' : (payload['error-codes'] || []).join(',') || 'turnstile_failed',
      };
    } catch (error) {
      console.error('BoletaMax Cloudflare: Turnstile verification failed', {
        message: error?.message || 'Error desconocido',
      });
      return { ok: false, mode: 'active', reason: 'turnstile_unavailable' };
    }
  }

  return { verifyToken };
}
