import { describe, expect, it } from 'vitest';
import {
  formatPaymentInfo,
  normalizeAccountName,
  parseVietQR,
  paymentReadBack,
  paymentReadFailed,
  PaymentQrError,
  type PaymentQrInfo,
} from './vietqr';

// Built outside this code base; CRCs computed with Python's binascii.crc_hqx(payload, 0xFFFF).
const QR = {
  account:
    '00020101021138540010A00000072701240006970436011001234567890208QRIBFTTA53037045802VN63046A15',
  withName:
    '00020101021238560010A0000007270126000697041501121133666688880208QRIBFTTA53037045405500005802VN5912NGUYEN VAN A62140810thanh toan63049942',
  card: '00020101021138600010A00000072701300006970418011697041800000000010208QRIBFTTC53037045802VN6304B82F',
  unknownBin:
    '00020101021138540010A00000072701240006999999011001234567890208QRIBFTTA53037045802VN63044CC6',
  otherGuid: '00020101021138420010A00000099901240006970436011001234567895802VN6304E26B',
};

const vietcombank: PaymentQrInfo = {
  bin: '970436',
  bankCode: 'VCB',
  bankShortName: 'Vietcombank',
  bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
  accountNumber: '0123456789',
  type: 'account',
};

describe('parseVietQR', () => {
  it('reads the bank and account of an account QR', () => {
    expect(parseVietQR(QR.account)).toEqual(vietcombank);
  });

  it('reads the account holder name and ignores amount and note', () => {
    expect(parseVietQR(QR.withName)).toEqual({
      bin: '970415',
      bankCode: 'ICB',
      bankShortName: 'VietinBank',
      bankName: 'Ngân hàng TMCP Công thương Việt Nam',
      accountNumber: '113366668888',
      accountName: 'NGUYEN VAN A',
      type: 'account',
    });
  });

  it('reads a card QR', () => {
    expect(parseVietQR(QR.card)).toMatchObject({
      bin: '970418',
      bankShortName: 'BIDV',
      accountNumber: '9704180000000001',
      type: 'card',
    });
  });

  it('keeps a BIN that is not in the bank list', () => {
    expect(parseVietQR(QR.unknownBin)).toEqual({
      bin: '999999',
      accountNumber: '0123456789',
      type: 'account',
    });
  });

  it.each([
    ['a wrong checksum', QR.account.slice(0, -1) + '0'],
    ['a non-VietQR EMV code', QR.otherGuid],
    ['a URL', 'https://example.com/pay'],
    ['truncated data', QR.account.slice(0, 30)],
  ])('rejects %s', (_, payload) => {
    expect(() => parseVietQR(payload)).toThrow(PaymentQrError);
  });
});

describe('normalizeAccountName', () => {
  it('writes names like banks do: upper case, no diacritics, single spaces', () => {
    expect(normalizeAccountName('  Nguyễn   Văn Đức ')).toBe('NGUYEN VAN DUC');
  });
});

describe('formatPaymentInfo', () => {
  it('writes the User Payment text', () => {
    expect(formatPaymentInfo({ ...vietcombank, accountName: 'NGUYEN VAN A' })).toBe(
      [
        'Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)',
        'Số tài khoản: 0123456789',
        'Chủ tài khoản: NGUYEN VAN A',
      ].join('\n'),
    );
  });

  it('labels card numbers, unknown banks and leaves out a missing name', () => {
    expect(
      formatPaymentInfo({ bin: '999999', accountNumber: '9704000000000001', type: 'card' }),
    ).toBe(['Ngân hàng: BIN 999999', 'Số thẻ: 9704000000000001'].join('\n'));
  });
});

describe('paymentReadBack', () => {
  it('reads the details back and asks for confirmation', () => {
    expect(paymentReadBack({ ...vietcombank, accountName: 'NGUYEN VAN A' })).toBe(
      [
        'Dạ em đọc được từ mã QR:',
        '- Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)',
        '- Số tài khoản: 0123456789',
        '- Chủ tài khoản: NGUYEN VAN A',
        '',
        'Anh/chị xác nhận cập nhật thông tin thanh toán này không ạ?',
      ].join('\n'),
    );
  });

  it('asks for the account holder name when the QR has none', () => {
    const text = paymentReadBack(vietcombank);
    expect(text).toContain('- Chủ tài khoản: chưa có trong mã QR');
    expect(text).toMatch(/Anh\/chị cho em xin tên chủ tài khoản ạ\.$/);
  });
});

describe('paymentReadFailed', () => {
  it('says the QR could not be read, with the reason', () => {
    expect(paymentReadFailed('No QR code found in the image')).toBe(
      'Dạ em chưa đọc được mã QR ngân hàng từ ảnh này ạ (No QR code found in the image). ' +
        'Anh/chị gửi lại ảnh rõ nét hơn giúp em nhé.',
    );
  });
});
