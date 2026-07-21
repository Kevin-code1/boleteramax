import QRCode from 'qrcode';

export function createQrCodeGenerator() {
  return {
    ticketQrDataUrl: payload =>
      QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        color: {
          dark: '#0B1220',
          light: '#F8F3E8',
        },
      }),

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
