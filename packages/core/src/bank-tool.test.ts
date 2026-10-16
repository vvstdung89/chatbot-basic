import { describe, expect, it } from 'vitest';
import { updateBankInfoTool } from './bank-tool';
import type { PaymentQrInfo } from './vietqr';

const pending: PaymentQrInfo = {
  bin: '970436',
  bankCode: 'VCB',
  bankShortName: 'Vietcombank',
  bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
  accountNumber: '0123456789',
  type: 'account',
};

function setup(pendingPayment?: PaymentQrInfo) {
  const updates: string[] = [];
  const tool = updateBankInfoTool({ pending: pendingPayment, onUpdate: (p) => updates.push(p) });
  return { tool, updates };
}

describe('updateBankInfoTool', () => {
  it('is the update_bank_info tool, with source required', () => {
    const { tool } = setup();
    expect(tool.name).toBe('update_bank_info');
    expect(tool.parameters).toMatchObject({ required: ['source'] });
  });

  it('saves the pending QR details, with the name the user gave', async () => {
    const { tool, updates } = setup(pending);
    const result = await tool.run({ source: 'qr', accountName: 'nguyễn văn a' });

    const payment =
      'Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)\n' +
      'Số tài khoản: 0123456789\nChủ tài khoản: NGUYEN VAN A';
    expect(updates).toEqual([payment]);
    expect(result).toBe(`Saved. The user's payment info is now:\n${payment}`);
  });

  it('ignores bank and account arguments for QR details', async () => {
    const { tool, updates } = setup(pending);
    await tool.run({ source: 'qr', bank: 'Techcombank', accountNumber: '999' });
    expect(updates[0]).toContain('Số tài khoản: 0123456789');
    expect(updates[0]).toContain('Vietcombank');
  });

  it('refuses QR source when no QR details are pending', async () => {
    const { tool, updates } = setup();
    expect(await tool.run({ source: 'qr' })).toMatch(/^Error: .*QR/);
    expect(updates).toEqual([]);
  });

  it('saves bank details the user typed, matching the bank in the bank list', async () => {
    const { tool, updates } = setup();
    await tool.run({
      source: 'text',
      bank: 'tcb',
      accountNumber: '1903-1234 567',
      accountName: 'Nguyen Van B',
    });
    expect(updates).toEqual([
      'Ngân hàng: Techcombank (Ngân hàng TMCP Kỹ thương Việt Nam)\n' +
        'Số tài khoản: 19031234567\nChủ tài khoản: NGUYEN VAN B',
    ]);
  });

  it.each([
    ['an unknown bank', { source: 'text', bank: 'Ngân hàng ABC', accountNumber: '123456' }, /bank/],
    ['a missing account number', { source: 'text', bank: 'VCB' }, /account number/],
    [
      'a bad account number',
      { source: 'text', bank: 'VCB', accountNumber: '12#34' },
      /account number/,
    ],
    ['an unknown source', { source: 'email' }, /source/],
  ])('reports %s without saving', async (_, args, message) => {
    const { tool, updates } = setup();
    const result = await tool.run(args);
    expect(result).toMatch(/^Error: /);
    expect(result).toMatch(message);
    expect(updates).toEqual([]);
  });
});
