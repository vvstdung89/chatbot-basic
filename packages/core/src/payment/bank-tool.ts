import type { ChatTool } from '../types';
import { findBank, formatPaymentInfo, normalizeAccountName, type PaymentQrInfo } from './vietqr';

export interface UpdateBankInfoToolOptions {
  /** QR details waiting for confirmation, sent by the browser. */
  pending?: PaymentQrInfo;
  /** Called with the new User Payment text when the tool saves it. */
  onUpdate: (payment: string) => void;
}

/**
 * The `update_bank_info` tool: saves the user's bank info (User Payment) from confirmed QR details
 * (`source: "qr"`, bank and account taken from the QR, never from the model) or from details the
 * user typed (`source: "text"`, bank matched against banks.json). Problems are returned to the
 * model as "Error: ..." results and nothing is saved.
 */
export function updateBankInfoTool({ pending, onUpdate }: UpdateBankInfoToolOptions): ChatTool {
  return {
    name: 'update_bank_info',
    description:
      "Save the user's bank payment info in the app. Call it only when the user clearly asks or " +
      'confirms: (a) the user confirms the pending bank details read from their QR code: use ' +
      'source "qr"; (b) the user asks in text to set or change their bank account and gives the ' +
      'bank and account number: use source "text". If something is missing or unclear, ask the ' +
      'user instead. After it succeeds, show the user the saved details exactly as returned.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['qr', 'text'] },
        bank: {
          type: 'string',
          description: 'For source "text": bank name, short name or code, e.g. "Vietcombank".',
        },
        accountNumber: { type: 'string', description: 'For source "text": the account number.' },
        accountName: { type: 'string', description: 'Account holder name, if the user gave one.' },
      },
      required: ['source'],
    },
    async run(args) {
      const { source, bank, accountNumber, accountName } = (args ?? {}) as Record<string, unknown>;
      const name = typeof accountName === 'string' ? normalizeAccountName(accountName) : '';

      let info: PaymentQrInfo;
      if (source === 'qr') {
        if (!pending) return 'Error: there are no QR bank details waiting for confirmation.';
        info = { ...pending, ...(name && { accountName: name }) };
      } else if (source === 'text') {
        const found = typeof bank === 'string' ? findBank(bank) : undefined;
        if (!found) {
          return `Error: unknown bank "${String(bank ?? '')}". Ask the user which bank it is.`;
        }
        const number = typeof accountNumber === 'string' ? accountNumber.replace(/[\s-]/g, '') : '';
        if (!/^[0-9A-Za-z]{1,32}$/.test(number)) {
          return 'Error: the account number must be 1-32 letters or digits. Ask the user for it.';
        }
        info = {
          bin: found.bin,
          bankCode: found.code,
          bankShortName: found.shortName,
          bankName: found.name,
          accountNumber: number,
          type: 'account',
          ...(name && { accountName: name }),
        };
      } else {
        return 'Error: source must be "qr" or "text".';
      }

      const payment = formatPaymentInfo(info);
      onUpdate(payment);
      return `Saved. The user's payment info is now:\n${payment}`;
    },
  };
}
