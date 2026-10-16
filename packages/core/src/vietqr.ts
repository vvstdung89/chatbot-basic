// No Node imports here: the web UI imports this file via `@chatbot/core/vietqr`.
import banks from './banks.json';

/** Bank details read from a VietQR code. Bank name fields are empty for BINs not in banks.json. */
export interface PaymentQrInfo {
  bin: string;
  bankCode?: string;
  bankShortName?: string;
  bankName?: string;
  /** Account number, or card number when `type` is 'card'. */
  accountNumber: string;
  accountName?: string;
  type: 'account' | 'card';
}

/** Thrown when a QR payload is not a valid VietQR; the message is safe to show the user. */
export class PaymentQrError extends Error {
  override name = 'PaymentQrError';
}

const VIETQR_GUID = 'A000000727';
const CARD_SERVICE = 'QRIBFTTC';

/**
 * Reads a VietQR (EMVCo) payload: bank BIN and account/card number from the merchant account
 * template (GUID A000000727), holder name from tag 59. Amount and note are ignored. The CRC
 * (tag 63) must match.
 */
export function parseVietQR(payload: string): PaymentQrInfo {
  const crc = /6304([0-9A-Fa-f]{4})$/.exec(payload);
  if (!crc) throw new PaymentQrError('Not a bank QR code (VietQR)');
  if (crc16(payload.slice(0, -4)) !== crc[1]!.toUpperCase()) {
    throw new PaymentQrError('QR checksum does not match; the image may be damaged');
  }

  const fields = parseFields(payload);
  // Merchant account templates use IDs 26–51; VietQR normally uses 38.
  const merchant = [...fields]
    .filter(([id]) => Number(id) >= 26 && Number(id) <= 51)
    .map(([, value]) => parseFields(value))
    .find((sub) => sub.get('00') === VIETQR_GUID);
  const beneficiary = parseFields(merchant?.get('01') ?? '');
  const bin = beneficiary.get('00') ?? '';
  const accountNumber = beneficiary.get('01') ?? '';
  if (!/^\d{6}$/.test(bin) || !/^[0-9A-Za-z]{1,32}$/.test(accountNumber)) {
    throw new PaymentQrError('Not a bank QR code (VietQR)');
  }

  const bank = findBank(bin);
  const accountName = fields.get('59')?.trim();
  return {
    bin,
    ...(bank && { bankCode: bank.code, bankShortName: bank.shortName, bankName: bank.name }),
    accountNumber,
    ...(accountName && { accountName }),
    type: merchant?.get('02') === CARD_SERVICE ? 'card' : 'account',
  };
}

export type Bank = (typeof banks)[number];

/**
 * Finds a bank in banks.json by code, short name, full name or BIN, ignoring case, diacritics,
 * spaces and punctuation ("vcb", "Vietcombank", "970436").
 */
export function findBank(query: string): Bank | undefined {
  const key = bankKey(query);
  if (!key) return undefined;
  return banks.find((b) => [b.bin, b.code, b.shortName, b.name].some((v) => bankKey(v) === key));
}

function bankKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Writes a name the way banks print it: upper case, no diacritics, single spaces. */
export function normalizeAccountName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The User Payment text saved when the user confirms. */
export function formatPaymentInfo(info: PaymentQrInfo): string {
  return [
    `Ngân hàng: ${bankLabel(info)}`,
    `${numberLabel(info)}: ${info.accountNumber}`,
    ...(info.accountName ? [`Chủ tài khoản: ${info.accountName}`] : []),
  ].join('\n');
}

/** The assistant chat message that reads the QR back and asks the user to confirm. */
export function paymentReadBack(info: PaymentQrInfo): string {
  return [
    'Dạ em đọc được từ mã QR:',
    `- Ngân hàng: ${bankLabel(info)}`,
    `- ${numberLabel(info)}: ${info.accountNumber}`,
    `- Chủ tài khoản: ${info.accountName ?? 'chưa có trong mã QR'}`,
    '',
    'Anh/chị xác nhận cập nhật thông tin thanh toán này không ạ?',
    ...(info.accountName ? [] : ['Anh/chị cho em xin tên chủ tài khoản ạ.']),
  ].join('\n');
}

/** The user chat message added when a QR image is uploaded. */
export const QR_UPLOAD_MESSAGE = '[Ảnh mã QR ngân hàng]';

/** The assistant chat message when no bank QR could be read from the image. */
export function paymentReadFailed(reason: string): string {
  return (
    `Dạ em chưa đọc được mã QR ngân hàng từ ảnh này ạ (${reason}). ` +
    'Anh/chị gửi lại ảnh rõ nét hơn giúp em nhé.'
  );
}

function bankLabel(info: PaymentQrInfo): string {
  return info.bankShortName ? `${info.bankShortName} (${info.bankName})` : `BIN ${info.bin}`;
}

function numberLabel(info: PaymentQrInfo): string {
  return info.type === 'card' ? 'Số thẻ' : 'Số tài khoản';
}

/** Splits EMVCo "ID (2 digits) + length (2 digits) + value" fields. */
function parseFields(data: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (let i = 0; i < data.length;) {
    const id = data.slice(i, i + 2);
    const length = data.slice(i + 2, i + 4);
    const end = i + 4 + Number(length);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(length) || end > data.length) {
      throw new PaymentQrError('Not a bank QR code (VietQR)');
    }
    fields.set(id, data.slice(i + 4, end));
    i = end;
  }
  return fields;
}

/** CRC-16/CCITT-FALSE over the UTF-8 bytes, as 4 upper-case hex digits. */
function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
