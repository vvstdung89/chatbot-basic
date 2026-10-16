import {
  ChatRequestError,
  parseSessionId,
  parseVietQR,
  paymentReadBack,
  paymentReadFailed,
  PaymentQrError,
  QR_UPLOAD_MESSAGE,
  renderQrUpload,
  type ChatMessage,
  type PaymentQrInfo,
} from '@chatbot/core';
import { decodeQrImage } from '@chatbot/core/qr-image';
import { appendSessionLog, sessionLogDir } from '@/lib/session-log';
import { sessions } from '@/lib/sessions';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/payment-qr
 * Body: multipart form data with "sessionId" and an "image" file (PNG, JPEG or WebP, max 5 MB).
 * Reads the bank QR (VietQR) and makes its details the session's pending bank details (saved only
 * after the user confirms in the chat). "[Ảnh mã QR ngân hàng]" and the read-back (or the failure
 * text) are added to the conversation and returned: 200 { messages }, or 400 / 422
 * { error, messages } when the image is not a readable bank QR.
 * Errors without messages: 400 bad form or session id, 404 unknown session, 409 session busy.
 * The image is processed in memory only.
 */
export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  let id: string;
  try {
    form = await request.formData();
    id = parseSessionId(form.get('sessionId') ?? undefined);
  } catch (err) {
    const error =
      err instanceof ChatRequestError ? err.message : 'Body must be multipart form data';
    return Response.json({ error }, { status: 400 });
  }
  if (!(await sessions.get(id))) {
    return Response.json({ error: 'Unknown or expired session' }, { status: 404 });
  }
  if (!(await sessions.tryLock(id))) {
    return Response.json({ error: 'This conversation is busy' }, { status: 409 });
  }

  try {
    const result = await readQr(form.get('image'));
    const messages: ChatMessage[] = [
      { role: 'user', content: QR_UPLOAD_MESSAGE },
      {
        role: 'assistant',
        content: 'info' in result ? paymentReadBack(result.info) : paymentReadFailed(result.error),
      },
    ];
    const session = (await sessions.get(id))!;
    session.messages.push(...messages);
    if ('info' in result) session.pendingPayment = result.info;
    await sessions.save(session);

    const logDir = sessionLogDir();
    if (logDir) {
      const status = 'info' in result ? 200 : result.status;
      const error = 'info' in result ? undefined : result.error;
      appendSessionLog(logDir, id, renderQrUpload({ time: new Date(), status, error, messages }));
    }

    return 'info' in result
      ? Response.json({ messages })
      : Response.json({ error: result.error, messages }, { status: result.status });
  } finally {
    await sessions.unlock(id);
  }
}

async function readQr(
  image: FormDataEntryValue | null,
): Promise<{ info: PaymentQrInfo } | { error: string; status: number }> {
  if (!(image instanceof File)) return { error: 'Missing "image" file', status: 400 };
  if (!IMAGE_TYPES.has(image.type))
    return { error: 'Image must be PNG, JPEG or WebP', status: 400 };
  if (image.size > MAX_IMAGE_BYTES) return { error: 'Image must be at most 5 MB', status: 400 };

  let payload: string | null;
  try {
    payload = await decodeQrImage(new Uint8Array(await image.arrayBuffer()));
  } catch (err) {
    console.error('[payment-qr] could not read image:', err);
    return { error: 'Could not read the image', status: 422 };
  }
  if (!payload) return { error: 'No QR code found in the image', status: 422 };

  try {
    return { info: parseVietQR(payload) };
  } catch (err) {
    if (err instanceof PaymentQrError) return { error: err.message, status: 422 };
    throw err;
  }
}
