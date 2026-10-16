import { PAYMENT_CONFIRM_PROMPT } from './prompt';
import type { ChatProvider } from './types';
import {
  formatPaymentInfo,
  normalizeAccountName,
  type PaymentQrInfo,
  type PaymentStatus,
} from './vietqr';

export interface PaymentReplyDecision {
  decision: 'confirm' | 'decline' | 'unclear';
  /** Account holder name, if the user stated one. */
  accountName?: string;
}

const DECISIONS = new Set(['confirm', 'decline', 'unclear']);

/**
 * Asks the chat provider whether the user's reply confirms or declines saving the pending QR
 * details (PAYMENT_CONFIRM_PROMPT). An answer that is not the expected JSON counts as unclear.
 */
export async function classifyPaymentReply(
  provider: ChatProvider,
  pending: PaymentQrInfo,
  reply: string,
  signal?: AbortSignal,
): Promise<PaymentReplyDecision> {
  let answer = '';
  for await (const chunk of provider.streamChat(
    [
      { role: 'system', content: PAYMENT_CONFIRM_PROMPT },
      {
        role: 'user',
        content: `Pending details:\n${formatPaymentInfo(pending)}\n\nUser reply:\n${reply}`,
      },
    ],
    { signal },
  )) {
    answer += chunk;
  }

  try {
    // Models sometimes wrap the JSON in a code fence or add words around it.
    const json: unknown = JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? '');
    const { decision, accountName } = json as Record<string, unknown>;
    if (typeof decision === 'string' && DECISIONS.has(decision)) {
      const name = typeof accountName === 'string' ? accountName.trim() : '';
      return {
        decision: decision as PaymentReplyDecision['decision'],
        ...(name && { accountName: name }),
      };
    }
  } catch {
    // Not JSON: unclear.
  }
  return { decision: 'unclear' };
}

/**
 * Turns the user's reply into the outcome for the pending QR details. Bank and account always
 * come from the QR; only the holder name may come from the reply.
 */
export async function resolvePendingPayment(
  provider: ChatProvider,
  pending: PaymentQrInfo,
  reply: string,
  signal?: AbortSignal,
): Promise<PaymentStatus> {
  const { decision, accountName } = await classifyPaymentReply(provider, pending, reply, signal);
  if (decision === 'decline') return { status: 'declined' };
  if (decision === 'unclear') return { status: 'pending', payment: formatPaymentInfo(pending) };

  const name = accountName ? normalizeAccountName(accountName) : pending.accountName;
  return {
    status: 'confirmed',
    payment: formatPaymentInfo({ ...pending, ...(name && { accountName: name }) }),
  };
}
