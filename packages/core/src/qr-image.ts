// Server only (sharp is a native module): imported via `@chatbot/core/qr-image`.
import jsQR from 'jsqr';
import sharp from 'sharp';

/** Large photos are shrunk before scanning; a QR stays readable and scanning stays fast. */
const MAX_SIDE = 1600;

/**
 * Finds a QR code in an image (PNG, JPEG, WebP, ...) and returns its text, or null when there is
 * none. Applies the photo's EXIF rotation first. Rejects data that is not an image.
 */
export async function decodeQrImage(image: Uint8Array): Promise<string | null> {
  const { data, info } = await sharp(image)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  return jsQR(pixels, info.width, info.height)?.data || null;
}
