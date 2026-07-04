/* Pantalla de verificación de correo */

(function () {
  const card = document.getElementById('card');
  const spinner = document.getElementById('spinner');
  const icon = document.getElementById('icon');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const actions = document.getElementById('actions');
  const loginLink = document.getElementById('login-link');

  function render({ state, iconText, titleText, messageText, showLogin }) {
    card.className = `card state-${state}`;
    spinner.hidden = true;
    icon.hidden = false;
    icon.textContent = iconText;
    title.textContent = titleText;
    message.textContent = messageText;
    actions.hidden = false;
    if (showLogin) {
      // El login vive en el modal del home; lo abrimos al llegar.
      loginLink.hidden = false;
      loginLink.href = '/?login=1';
    }
  }

  const STATES = {
    used: {
      state: 'expired',
      iconText: '↺',
      titleText: 'Este enlace ya fue usado',
      messageText: 'Si ya verificaste tu cuenta, inicia sesión con tu correo y contraseña.',
      showLogin: true,
    },
    expired: {
      state: 'expired',
      iconText: '⌛',
      titleText: 'El enlace expiró',
      messageText: 'Los enlaces de verificación duran 24 horas. Solicita uno nuevo desde el inicio de sesión.',
      showLogin: true,
    },
    invalid: {
      state: 'error',
      iconText: '⚠',
      titleText: 'Enlace no válido',
      messageText: 'Este enlace de verificación no es válido. Revisa que lo hayas copiado completo.',
      showLogin: false,
    },
  };

  async function verify() {
    const token = new URLSearchParams(window.location.search).get('token') || '';

    if (!token) {
      render(STATES.invalid);
      return;
    }

    try {
      const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.ok) {
        render({
          state: 'success',
          iconText: '✓',
          titleText: '¡Correo verificado!',
          messageText: 'Tu cuenta quedó activa. Ya puedes iniciar sesión y ver tus boletos.',
          showLogin: true,
        });
        return;
      }

      render(STATES[payload.code] || STATES.invalid);
    } catch (_) {
      render({
        state: 'error',
        iconText: '⚠',
        titleText: 'Error de red',
        messageText: 'No pudimos verificar tu correo ahora. Revisa tu conexión e intenta de nuevo.',
        showLogin: false,
      });
    }
  }

  verify();
})();
