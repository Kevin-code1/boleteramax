import {
  APP_BASE_URL,
  IS_PRODUCTION,
  SMTP_CONFIG,
  SMTP_ENABLED,
} from '../../config/index.mjs';

function buildVerificationText({ name, verifyUrl }) {
  return [
    `Hola ${name || ''}`.trim() + ',',
    '',
    'Gracias por crear tu cuenta en BoletaMax. Para activarla, verifica tu correo:',
    '',
    verifyUrl,
    '',
    'El enlace expira en 24 horas. Si no creaste esta cuenta, ignora este mensaje.',
    '',
    'BoletaMax',
  ].join('\n');
}

function buildVerificationHtml({ name, verifyUrl }) {
  const safeName = String(name || '').replace(/[<>&]/g, '');
  return `
    <div style="font-family:Manrope,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c1c1c">
      <h2 style="color:#b98b25">Verifica tu cuenta BoletaMax</h2>
      <p>Hola ${safeName || ''}, gracias por registrarte.</p>
      <p>Para activar tu cuenta y poder iniciar sesión, confirma tu correo:</p>
      <p style="margin:24px 0">
        <a href="${verifyUrl}" style="background:#d4ab68;color:#17191c;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Verificar mi correo</a>
      </p>
      <p style="font-size:13px;color:#666">El enlace expira en 24 horas. Si no creaste esta cuenta, ignora este mensaje.</p>
    </div>
  `;
}

// Consola: imprime el enlace en desarrollo.
function createConsoleEmailService() {
  return {
    async sendVerificationEmail({ to, name, verifyUrl }) {
      console.log('\n──────────────────────────────────────────────────────────────');
      console.log('BoletaMax Email (DEV): verificación de correo');
      console.log(`  Para:  ${to}`);
      console.log(`  Nombre: ${name || '(sin nombre)'}`);
      console.log(`  Enlace: ${verifyUrl}`);
      console.log('  (En producción esto se envía por SMTP, no se imprime.)');
      console.log('──────────────────────────────────────────────────────────────\n');
      return { delivered: true, channel: 'console' };
    },
  };
}

// SMTP: importa nodemailer de forma perezosa.
function createSmtpEmailService() {
  let transporterPromise = null;

  async function getTransporter() {
    if (!transporterPromise) {
      transporterPromise = import('nodemailer').then(({ default: nodemailer }) =>
        nodemailer.createTransport({
          host: SMTP_CONFIG.host,
          port: SMTP_CONFIG.port,
          secure: SMTP_CONFIG.port === 465,
          auth: SMTP_CONFIG.user
            ? { user: SMTP_CONFIG.user, pass: SMTP_CONFIG.pass }
            : undefined,
        }),
      );
    }
    return transporterPromise;
  }

  return {
    async sendVerificationEmail({ to, name, verifyUrl }) {
      const transporter = await getTransporter();
      await transporter.sendMail({
        from: SMTP_CONFIG.from,
        to,
        subject: 'Verifica tu cuenta BoletaMax',
        text: buildVerificationText({ name, verifyUrl }),
        html: buildVerificationHtml({ name, verifyUrl }),
      });
      console.log('BoletaMax Email: verificación enviada por SMTP', { channel: 'smtp' });
      return { delivered: true, channel: 'smtp' };
    },
  };
}

export function createEmailService() {
  const service = SMTP_ENABLED ? createSmtpEmailService() : createConsoleEmailService();

  return {
    ...service,
    buildVerifyUrl(token, req) {
      const base = APP_BASE_URL || inferBaseUrl(req);
      return `${base.replace(/\/+$/, '')}/verify-email.html?token=${encodeURIComponent(token)}`;
    },
    isProduction: IS_PRODUCTION,
  };
}

function inferBaseUrl(req) {
  if (!req) return 'http://localhost:3000';
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get?.('host') || 'localhost:3000'}`;
}
