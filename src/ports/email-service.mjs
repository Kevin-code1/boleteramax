/* Puerto: contrato del servicio de correo.
   La capa de aplicación depende de este contrato, no de un proveedor concreto.
   Lo implementan los adaptadores en src/adapters/email/. */

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
