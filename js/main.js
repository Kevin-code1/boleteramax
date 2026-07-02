/* BoletaMax – main.js: punto de entrada del landing.
   La lógica vive en js/modules/ (toast, modals, ui, seatmap, search).
   Este archivo solo importa los módulos y expone los globals que usan
   los handlers inline (onclick/onsubmit) de index.html. */

import { showToast } from './modules/toast.js';
import { openModal, closeModal, switchModal } from './modules/modals.js';
import {
  handleLogin,
  handleRegister,
  showFurnitureQuickView,
  subscribeNewsletter,
  togglePass,
} from './modules/ui.js';
import { openTicketModal, proceedCheckout, removeSeat } from './modules/seatmap.js';
import './modules/search.js';

// =================== EXPOSE GLOBALS ===================
window.openModal = openModal; window.closeModal = closeModal; window.switchModal = switchModal;
window.handleLogin = handleLogin; window.handleRegister = handleRegister; window.togglePass = togglePass;
window.openTicketModal = openTicketModal; window.proceedCheckout = proceedCheckout;
window.showFurnitureQuickView = showFurnitureQuickView;
window.subscribeNewsletter = subscribeNewsletter;
window.showToast = showToast;
window.removeSeat = removeSeat;
