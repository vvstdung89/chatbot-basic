import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeQrImage } from './qr-image';

const PAYLOAD =
  '00020101021138540010A00000072701240006970436011001234567890208QRIBFTTA53037045802VN63046A15';

describe('decodeQrImage', () => {
  it('reads the payload of a QR code in a PNG', async () => {
    const png = await QRCode.toBuffer(PAYLOAD, { type: 'png', width: 400 });
    expect(await decodeQrImage(png)).toBe(PAYLOAD);
  });

  it('reads a QR code inside a larger, rotated JPEG photo', async () => {
    const qr = await QRCode.toBuffer(PAYLOAD, { type: 'png', width: 600 });
    const photo = await sharp({
      create: { width: 2400, height: 3200, channels: 3, background: '#d8d4cc' },
    })
      .composite([{ input: qr, left: 900, top: 1300 }])
      .jpeg()
      .withMetadata({ orientation: 6 }) // stored sideways, like many phone photos
      .toBuffer();
    expect(await decodeQrImage(photo)).toBe(PAYLOAD);
  });

  it('returns null when the image has no QR code', async () => {
    const blank = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    expect(await decodeQrImage(blank)).toBeNull();
  });

  it('rejects data that is not an image', async () => {
    await expect(decodeQrImage(Buffer.from('not an image'))).rejects.toThrow();
  });
});
