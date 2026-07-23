import QRCode from 'qrcode';

export function createQrCodeGenerator() {
  return {
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
