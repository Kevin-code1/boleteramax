import QRCode from 'qrcode';

export function createQrCodeGenerator() {
  return {
    // QR estático impreso en el boleto (apunta a la URL pública).
    ticketQrDataUrl: payload =>
      QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        color: {
          dark: '#0B1220',
          light: '#F8F3E8',
        },
      }),

    // QR dinámico rotativo mostrado en la vista privada del boleto.
    dynamicQrDataUrl: payloadJson =>
      QRCode.toDataURL(payloadJson, {
        errorCorrectionLevel: 'M',
        margin: 1,
        color: {
          dark: '#0B1220',
          light: '#FFFFFF',
        },
      }),
  };
}
