import { ApiError, paymentRequest } from './auth';
import type { DemoRecipient, DemoTransaction, NewDemoPayment, TransactionCategory, TransactionDirection, DemoTransactionStatus } from '../types';

export interface WalletSnapshot {
  balance_minor: number;
  currency: 'INR';
  updated_at: string;
}

export interface ApiRecipient {
  id: number;
  display_name: string;
  upi_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiStatusEvent {
  from_status: 'pending' | 'successful' | 'failed' | 'reversed' | null;
  to_status: 'pending' | 'successful' | 'failed' | 'reversed';
  reason: string;
  created_at: string;
}

export interface ApiTransaction {
  id: string;
  reference: string;
  sender_name: string;
  recipient_id: number | null;
  recipient_name: string;
  recipient_identifier: string;
  kind: 'transfer' | 'bill' | 'recharge' | 'topup';
  service: string;
  note: string;
  amount_minor: number;
  currency: 'INR';
  status: 'pending' | 'successful' | 'failed' | 'reversed';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  status_history: ApiStatusEvent[];
}

export interface ApiReceipt {
  transaction: ApiTransaction;
  notice: string;
}

const colorNames = ['lavender', 'peach', 'mint', 'blue', 'rose'];

export function mapRecipient(recipient: ApiRecipient): DemoRecipient {
  const nameParts = recipient.display_name.trim().split(/\s+/).filter(Boolean);
  return {
    id: String(recipient.id),
    name: recipient.display_name,
    upiId: recipient.upi_id,
    initials: nameParts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
    color: colorNames[(recipient.id - 1) % colorNames.length] ?? 'lavender',
    isDefault: recipient.is_default,
  };
}

export function mapTransaction(transaction: ApiTransaction): DemoTransaction {
  const category: TransactionCategory = transaction.kind === 'topup' ? 'topup'
    : transaction.kind === 'bill' ? 'bill'
      : transaction.kind === 'recharge' ? 'recharge' : 'transfer';
  const direction: TransactionDirection = transaction.kind === 'topup' || transaction.status === 'reversed' ? 'credit' : 'debit';
  const status: DemoTransactionStatus = transaction.status;
  const detail = transaction.note || transaction.recipient_identifier || (transaction.kind === 'topup' ? 'Demo funds added' : transaction.kind === 'bill' ? 'Simulated utility bill' : transaction.kind === 'recharge' ? 'Simulated recharge' : transaction.recipient_identifier);
  return {
    id: transaction.id,
    reference: transaction.reference,
    title: transaction.recipient_name,
    subtitle: detail,
    amountPaise: transaction.amount_minor,
    direction,
    category,
    status,
    createdAt: transaction.created_at,
    recipientIdentifier: transaction.recipient_identifier,
    currency: transaction.currency,
  };
}

function paymentPath(path: string) {
  return `payments/${path.replace(/^\//, '')}`;
}

export const paymentApi = {
  wallet: () => paymentRequest<WalletSnapshot>(paymentPath('wallet/')),
  recipients: async () => (await paymentRequest<ApiRecipient[]>(paymentPath('recipients/'))).map(mapRecipient),
  lookupRecipient: (identifier: string) => paymentRequest<ApiRecipient | { id: null; display_name: string; upi_id: string; is_active: boolean; is_default: boolean }>(
    paymentPath(`recipients/lookup/?identifier=${encodeURIComponent(identifier)}`),
  ),
  createRecipient: async (data: { display_name: string; upi_id: string }) => mapRecipient(
    await paymentRequest<ApiRecipient>(paymentPath('recipients/'), { method: 'POST', body: data }),
  ),
  updateRecipient: async (id: string, data: { display_name?: string; upi_id?: string }) => mapRecipient(
    await paymentRequest<ApiRecipient>(paymentPath(`recipients/${encodeURIComponent(id)}/`), { method: 'PATCH', body: data }),
  ),
  deleteRecipient: (id: string) => paymentRequest<void>(paymentPath(`recipients/${encodeURIComponent(id)}/`), { method: 'DELETE' }),
  transactions: async (limit = 100) => (await paymentRequest<ApiTransaction[]>(paymentPath(`transactions/?limit=${limit}`))).map(mapTransaction),
  initiate: async (payment: NewDemoPayment) => {
    if (!payment.idempotencyKey) throw new ApiError('A unique demo request key is required.');
    const body: Record<string, unknown> = {
      kind: payment.kind,
      amount_minor: payment.amountPaise,
      note: payment.note ?? '',
    };
    if (payment.kind === 'transfer') {
      if (payment.recipientId) body.recipient_id = Number(payment.recipientId);
      else if (payment.upiId) body.upi_id = payment.upiId;
    } else {
      body.service = payment.service;
      body.recipient_reference = payment.recipientReference ?? '';
    }
    return mapTransaction(await paymentRequest<ApiTransaction>(paymentPath('transactions/'), {
      method: 'POST', body, headers: { 'Idempotency-Key': payment.idempotencyKey },
    }));
  },
  topup: async (amountPaise: number, idempotencyKey: string) => mapTransaction(
    await paymentRequest<ApiTransaction>(paymentPath('wallet/topups/'), {
      method: 'POST',
      body: { amount_minor: amountPaise },
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  ),
  transaction: async (reference: string) => paymentRequest<ApiTransaction>(
    paymentPath(`transactions/${encodeURIComponent(reference)}/`),
  ),
  status: (reference: string) => paymentRequest<{ reference: string; status: ApiTransaction['status']; updated_at: string; completed_at: string | null }>(
    paymentPath(`transactions/${encodeURIComponent(reference)}/status/`),
  ),
  receipt: (reference: string) => paymentRequest<ApiReceipt>(
    paymentPath(`transactions/${encodeURIComponent(reference)}/receipt/`),
  ),
  reverse: async (reference: string, idempotencyKey: string) => mapTransaction(
    await paymentRequest<ApiTransaction>(paymentPath(`transactions/${encodeURIComponent(reference)}/reverse/`), {
      method: 'POST', body: {}, headers: { 'Idempotency-Key': idempotencyKey },
    }),
  ),
};
