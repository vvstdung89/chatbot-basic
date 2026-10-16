import { describe, expect, it } from 'vitest';
import { updateBankInfoTool } from './bank-tool';
import type { PaymentQrInfo } from './vietqr';

const vietcombank: PaymentQrInfo = {
  bin: '970436',
  bankCode: 'VCB',
  bankShortName: 'Vietcombank',
  bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam',
  accountNumber: '0123456789',
  type: 'account',
};

const techcombank: PaymentQrInfo = {
  bin: '970407',
  bankCode: 'TCB',
  bankShortName: 'Techcombank',
  bankName: 'Ngân hàng TMCP Kỹ thương Việt Nam',
  accountNumber: '19031234567',
  type: 'account',
  accountName: 'NGUYEN VAN B',
};

/** The tool for one request, recording what it asked the session to do. */
function setup(pending?: PaymentQrInfo) {
  const calls: {
    proposed: PaymentQrInfo[];
    confirmed: [string, PaymentQrInfo][];
    cancelled: number;
  } = { proposed: [], confirmed: [], cancelled: 0 };
  const tool = updateBankInfoTool({
    pending,
    onPropose: (info) => calls.proposed.push(info),
    onConfirm: (payment, info) => calls.confirmed.push([payment, info]),
    onCancel: () => calls.cancelled++,
  });
  return { tool, calls };
}

const nothing = { proposed: [], confirmed: [], cancelled: 0 };

describe('updateBankInfoTool', () => {
  it('is the update_bank_info tool, with step required', () => {
    const { tool } = setup();
    expect(tool.name).toBe('update_bank_info');
    expect(tool.parameters).toMatchObject({ required: ['step'] });
  });

  describe('propose', () => {
    it('makes typed details pending without saving, and returns them to read back', async () => {
      const { tool, calls } = setup();
      const result = await tool.run({
        step: 'propose',
        bank: 'tcb',
        accountNumber: '1903-1234 567',
        accountName: 'Nguyen Van B',
      });

      expect(calls).toEqual({ ...nothing, proposed: [techcombank] });
      expect(result).toMatch(/^Not saved yet\./);
      expect(result).toContain(
        'Ngân hàng: Techcombank (Ngân hàng TMCP Kỹ thương Việt Nam)\n' +
          'Số tài khoản: 19031234567\nChủ tài khoản: NGUYEN VAN B',
      );
    });

    it.each([
      ['an unknown bank', { bank: 'Ngân hàng ABC', accountNumber: '123456' }, /bank/],
      ['a missing account number', { bank: 'VCB' }, /account number/],
      ['a bad account number', { bank: 'VCB', accountNumber: '12#34' }, /account number/],
    ])('reports %s without proposing', async (_, args, message) => {
      const { tool, calls } = setup(vietcombank);
      const result = await tool.run({ step: 'propose', ...args });
      expect(result).toMatch(/^Error: /);
      expect(result).toMatch(message);
      expect(calls).toEqual(nothing);
    });
  });

  describe('confirm', () => {
    it('saves the details that were pending, adding the name the user gave', async () => {
      const { tool, calls } = setup(vietcombank);
      const result = await tool.run({ step: 'confirm', accountName: 'nguyễn văn a' });

      const payment =
        'Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại Thương Việt Nam)\n' +
        'Số tài khoản: 0123456789\nChủ tài khoản: NGUYEN VAN A';
      expect(calls).toEqual({
        ...nothing,
        confirmed: [[payment, { ...vietcombank, accountName: 'NGUYEN VAN A' }]],
      });
      expect(result).toBe(`Saved. The user's payment info is now:\n${payment}`);
    });

    it('ignores bank and account arguments: only the pending details are saved', async () => {
      const { tool, calls } = setup(vietcombank);
      await tool.run({ step: 'confirm', bank: 'Techcombank', accountNumber: '999' });
      expect(calls.confirmed[0]?.[1]).toEqual(vietcombank);
    });

    it('refuses when nothing is pending', async () => {
      const { tool, calls } = setup();
      expect(await tool.run({ step: 'confirm' })).toMatch(/^Error: .*no pending/);
      expect(calls).toEqual(nothing);
    });

    it.each([
      ['propose', { step: 'propose', bank: 'TCB', accountNumber: '19031234567' }],
      ['cancel', { step: 'cancel' }],
    ])('refuses after a %s in the same turn (the user must reply first)', async (_, first) => {
      const { tool, calls } = setup(vietcombank);
      await tool.run(first);
      expect(await tool.run({ step: 'confirm' })).toMatch(/^Error: .*wait for the user/);
      expect(calls.confirmed).toEqual([]);
    });

    it('saves only once', async () => {
      const { tool, calls } = setup(vietcombank);
      await tool.run({ step: 'confirm' });
      expect(await tool.run({ step: 'confirm' })).toMatch(/^Error: /);
      expect(calls.confirmed).toHaveLength(1);
    });
  });

  describe('cancel', () => {
    it('discards the pending details', async () => {
      const { tool, calls } = setup(vietcombank);
      expect(await tool.run({ step: 'cancel' })).toMatch(/^Discarded\./);
      expect(calls).toEqual({ ...nothing, cancelled: 1 });
    });

    it('does nothing when nothing is pending', async () => {
      const { tool, calls } = setup();
      expect(await tool.run({ step: 'cancel' })).toMatch(/no pending/);
      expect(calls).toEqual(nothing);
    });
  });

  it('rejects an unknown step', async () => {
    const { tool, calls } = setup(vietcombank);
    expect(await tool.run({ step: 'save', source: 'text' })).toMatch(/^Error: .*step/);
    expect(calls).toEqual(nothing);
  });
});
