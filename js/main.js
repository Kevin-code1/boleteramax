import { showToast } from './modules/toast.js';
import { openModal, closeModal, switchModal } from './modules/modals.js';
import {
  showFurnitureQuickView,
  subscribeNewsletter,
  togglePass,
} from './modules/ui.js';
import { handleLogin, handleRegister } from './modules/auth.js';
import { openTicketModal, proceedCheckout, removeSeat } from './modules/seatmap.js';
import './modules/search.js';

window.openModal = openModal; window.closeModal = closeModal; window.switchModal = switchModal;
window.handleLogin = handleLogin; window.handleRegister = handleRegister; window.togglePass = togglePass;
window.openTicketModal = openTicketModal; window.proceedCheckout = proceedCheckout;
window.showFurnitureQuickView = showFurnitureQuickView;
window.subscribeNewsletter = subscribeNewsletter;
window.showToast = showToast;
window.removeSeat = removeSeat;
