import type { ChatTool } from '../types';
import { findBank, formatPaymentInfo, normalizeAccountName, type PaymentQrInfo } from './vietqr';

export interface UpdateBankInfoToolOptions {
  /** Bank details that were pending when the request arrived (QR upload or an earlier proposal). */
  pending?: PaymentQrInfo;
  /** Typed details become the pending details; nothing is saved. */
  onPropose: (info: PaymentQrInfo) => void;
  /** The pending details are saved as User Payment (`payment` is its text). */
  onConfirm: (payment: string, info: PaymentQrInfo) => void;
  /** The pending details are discarded. */
  onCancel: () => void;
}

/**
 * The `update_bank_info` tool: bank info is never saved in the turn it first appears.
 * - `propose`: typed details (bank matched against banks.json) become pending; nothing saved.
 * - `confirm`: saves the details that were pending when the request arrived, exactly as they were
 *   read back (the model can only add the holder name). Refused after a propose or cancel in the
 *   same turn, so the user always replies in between.
 * - `cancel`: discards the pending details.
 * Problems go back to the model as "Error: ..." results.
 */
export function updateBankInfoTool({
  pending,
  onPropose,
  onConfirm,
  onCancel,
}: UpdateBankInfoToolOptions): ChatTool {
  let current = pending;
  let changedThisTurn = false;

  return {
    name: 'update_bank_info',
    description:
      "Save the user's bank payment info in two steps; never save without the user's " +
      'confirmation. (1) When the user gives new bank details in a message, call with step ' +
      '"propose" (bank, accountNumber, accountName if given): nothing is saved; show the user the ' +
      'returned details exactly and ask them to confirm. (2) In a later message, when the user ' +
      'confirms the pending details (proposed earlier or read from their QR code), call with step ' +
      '"confirm"; if they decline, call with step "cancel". If something is missing or unclear, ' +
      'ask the user instead.',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: ['propose', 'confirm', 'cancel'] },
        bank: {
          type: 'string',
          description: 'For "propose": bank name, short name or code, e.g. "Vietcombank".',
        },
        accountNumber: { type: 'string', description: 'For "propose": the account number.' },
        accountName: { type: 'string', description: 'Account holder name, if the user gave one.' },
      },
      required: ['step'],
    },
    async run(args) {
      const { step, bank, accountNumber, accountName } = (args ?? {}) as Record<string, unknown>;
      const name = typeof accountName === 'string' ? normalizeAccountName(accountName) : '';

      if (step === 'propose') {
        const found = typeof bank === 'string' ? findBank(bank) : undefined;
        if (!found) {
          return `Error: unknown bank "${String(bank ?? '')}". Ask the user which bank it is.`;
        }
        const number = typeof accountNumber === 'string' ? accountNumber.replace(/[\s-]/g, '') : '';
        if (!/^[0-9A-Za-z]{1,32}$/.test(number)) {
          return 'Error: the account number must be 1-32 letters or digits. Ask the user for it.';
        }
        const info: PaymentQrInfo = {
          bin: found.bin,
          bankCode: found.code,
          bankShortName: found.shortName,
          bankName: found.name,
          accountNumber: number,
          type: 'account',
          ...(name && { accountName: name }),
        };
        onPropose(info);
        current = info;
        changedThisTurn = true;
        return (
          'Not saved yet. Show the user these details exactly as written and ask them to ' +
          `confirm:\n${formatPaymentInfo(info)}`
        );
      }

      if (step === 'confirm') {
        if (changedThisTurn) {
          return (
            'Error: the pending details changed in this turn. Show them to the user and wait for ' +
            'the user to confirm in their next message.'
          );
        }
        if (!current) {
          return 'Error: there are no pending bank details to confirm. Propose them first.';
        }
        const info: PaymentQrInfo = { ...current, ...(name && { accountName: name }) };
        const payment = formatPaymentInfo(info);
        onConfirm(payment, info);
        current = undefined;
        return `Saved. The user's payment info is now:\n${payment}`;
      }

      if (step === 'cancel') {
        if (!current) return 'Nothing to cancel: there are no pending bank details.';
        onCancel();
        current = undefined;
        changedThisTurn = true;
        return 'Discarded. Nothing was saved.';
      }

      return 'Error: step must be "propose", "confirm" or "cancel".';
    },
  };
}
