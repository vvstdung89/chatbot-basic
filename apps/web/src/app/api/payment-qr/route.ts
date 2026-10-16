import { parseVietQR, PaymentQrError } from '@chatbot/core';
import { decodeQrImage } from '@chatbot/core/qr-image';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/payment-qr
 * Body: multipart form data with an "image" file (PNG, JPEG or WebP, max 5 MB).
 * Response: PaymentQrInfo read from the bank QR (VietQR) in the image.
 * Errors: { error: string } with 400 (bad upload), 422 (no readable bank QR).
 * The image is processed in memory only.
 */
export async function POST(request: Request): Promise<Response> {
  let image: FormDataEntryValue | null;
  try {
    image = (await request.formData()).get('image');
  } catch {
    return Response.json({ error: 'Body must be multipart form data' }, { status: 400 });
  }
  if (!(image instanceof File)) {
    return Response.json({ error: 'Missing "image" file' }, { status: 400 });
  }
  if (!IMAGE_TYPES.has(image.type)) {
    return Response.json({ error: 'Image must be PNG, JPEG or WebP' }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: 'Image must be at most 5 MB' }, { status: 400 });
  }

  let payload: string | null;
  try {
    payload = await decodeQrImage(new Uint8Array(await image.arrayBuffer()));
  } catch (err) {
    console.error('[payment-qr] could not read image:', err);
    return Response.json({ error: 'Could not read the image' }, { status: 422 });
  }
  if (!payload) {
    return Response.json({ error: 'No QR code found in the image' }, { status: 422 });
  }

  try {
    return Response.json(parseVietQR(payload));
  } catch (err) {
    if (err instanceof PaymentQrError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
