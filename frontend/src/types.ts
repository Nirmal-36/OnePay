export type TransactionCategory = 'transfer' | 'recharge' | 'bill' | 'topup';
export type TransactionDirection = 'debit' | 'credit';
export type DemoTransactionStatus = 'successful' | 'pending' | 'failed' | 'reversed';

export interface DemoTransaction {
  id: string;
  reference: string;
  title: string;
  subtitle: string;
  amountPaise: number;
  direction: TransactionDirection;
  category: TransactionCategory;
  status: DemoTransactionStatus;
  createdAt: string;
  recipientIdentifier?: string;
  currency?: 'INR';
}

export interface DemoRecipient {
  id: string;
  name: string;
  upiId: string;
  initials: string;
  color: string;
  isDefault?: boolean;
}

export interface DemoProfile {
  name: string;
  email: string;
  upiId: string;
}

export interface DemoNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  kind: 'payment' | 'tip' | 'security' | 'service';
  href: string;
}

export interface NewDemoPayment {
  amountPaise: number;
  kind: 'transfer' | 'bill' | 'recharge';
  idempotencyKey: string;
  recipientId?: string;
  upiId?: string;
  note?: string;
  service?: string;
  recipientReference?: string;
}

export const isValidUpiId = (value: string): boolean =>
  /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/.test(value.trim());

export const formatRupees = (amountPaise: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountPaise / 100);

export const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

export const formatRelativeDate = (value: string): string => {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(date);
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);
};
