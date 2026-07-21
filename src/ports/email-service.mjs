/**
 * @typedef {Object} VerificationEmail
 * @property {string} to        Correo destino.
 * @property {string} name      Nombre para el saludo.
 * @property {string} verifyUrl URL absoluta de verificación (con token).
 */

/**
 * @typedef {Object} EmailService
 * @property {(email: VerificationEmail) => Promise<{ delivered: boolean, channel: string }>} sendVerificationEmail
 */

export {};
