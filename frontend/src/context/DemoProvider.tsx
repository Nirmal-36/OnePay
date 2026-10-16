import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { paymentApi } from '../api/payments';
import { ApiError, apiErrorMessage } from '../api/auth';
import { demoProfile, initialNotifications } from '../data/demo';
import type { DemoNotification, DemoProfile, DemoRecipient, DemoTransaction, NewDemoPayment } from '../types';
import { useAuth } from './AuthContext';

export interface DemoPreferences {
  inAppAlerts: boolean;
  maskBalance: boolean;
}

interface DemoContextValue {
  balancePaise: number;
  transactions: DemoTransaction[];
  recipients: DemoRecipient[];
  profile: DemoProfile;
  notifications: DemoNotification[];
  preferences: DemoPreferences;
  paymentDataLoading: boolean;
  paymentDataError: string | null;
  refreshPaymentData: () => Promise<void>;
  addDemoFunds: (amountPaise: number, idempotencyKey: string) => Promise<DemoTransaction>;
  recordDemoPayment: (payment: NewDemoPayment) => Promise<DemoTransaction>;
  reverseDemoPayment: (reference: string, idempotencyKey: string) => Promise<DemoTransaction>;
  addRecipient: (data: { name: string; upiId: string }) => Promise<DemoRecipient>;
  updateRecipient: (id: string, data: { name?: string; upiId?: string }) => Promise<DemoRecipient>;
  removeRecipient: (id: string) => Promise<void>;
  updateProfile: (profile: DemoProfile) => void;
  updatePreferences: (updates: Partial<DemoPreferences>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

function transactionBalanceDelta(transaction: DemoTransaction, previous?: DemoTransaction): number {
  if (!previous) {
    if (transaction.category === 'topup') return transaction.amountPaise;
    if (transaction.status === 'pending' || transaction.status === 'successful') return -transaction.amountPaise;
    return 0;
  }
  if (previous.status !== 'failed' && transaction.status === 'failed') return transaction.amountPaise;
  if (previous.status !== 'reversed' && transaction.status === 'reversed') return transaction.amountPaise;
  return 0;
}

export function DemoProvider({ children }: PropsWithChildren) {
  const { user, status: authStatus, refreshSession } = useAuth();
  const [balancePaise, setBalancePaise] = useState(0);
  const [transactions, setTransactions] = useState<DemoTransaction[]>([]);
  const [recipients, setRecipients] = useState<DemoRecipient[]>([]);
  const [paymentDataLoading, setPaymentDataLoading] = useState(true);
  const [paymentDataError, setPaymentDataError] = useState<string | null>(null);
  const [demoUpiId, setDemoUpiId] = useState(demoProfile.upiId);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [preferences, setPreferences] = useState<DemoPreferences>({ inAppAlerts: true, maskBalance: false });
  const knownTransactions = useRef(new Map<string, DemoTransaction>());

  const profile = useMemo<DemoProfile>(() => ({
    name: user?.full_name ?? demoProfile.name,
    email: user?.email ?? demoProfile.email,
    upiId: demoUpiId,
  }), [user, demoUpiId]);

  const refreshPaymentData = useCallback(async () => {
    if (!user) return;
    setPaymentDataLoading(true);
    try {
      const [wallet, nextTransactions, nextRecipients] = await Promise.all([
        paymentApi.wallet(),
        paymentApi.transactions(100),
        paymentApi.recipients(),
      ]);
      setBalancePaise(wallet.balance_minor);
      setTransactions(nextTransactions);
      setRecipients(nextRecipients);
      knownTransactions.current = new Map(nextTransactions.map((transaction) => [transaction.id, transaction]));
      setPaymentDataError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setPaymentDataError(apiErrorMessage(error, 'Could not load your OnePay demo wallet. Check your connection and retry.'));
      throw error;
    } finally {
      setPaymentDataLoading(false);
    }
  }, [user, refreshSession]);

  useEffect(() => {
    if (authStatus === 'authenticated' && user) {
      void refreshPaymentData().catch(() => undefined);
    } else if (authStatus === 'anonymous') {
      setBalancePaise(0);
      setTransactions([]);
      setRecipients([]);
      knownTransactions.current.clear();
      setPaymentDataLoading(false);
      setPaymentDataError(null);
    }
  }, [authStatus, user, refreshPaymentData]);

  const upsertTransaction = useCallback((transaction: DemoTransaction) => {
    const previous = knownTransactions.current.get(transaction.id);
    const balanceDelta = transactionBalanceDelta(transaction, previous);
    knownTransactions.current.set(transaction.id, transaction);
    if (balanceDelta) setBalancePaise((current) => current + balanceDelta);
    setTransactions((current) => [transaction, ...current.filter((item) => item.id !== transaction.id)]);
  }, []);

  const addDemoFunds = useCallback(async (amountPaise: number, idempotencyKey: string) => {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Choose a valid demo-funds amount.');
    const transaction = await paymentApi.topup(amountPaise, idempotencyKey);
    upsertTransaction(transaction);
    await refreshPaymentData().catch(() => undefined);
    if (preferences.inAppAlerts) setNotifications((current) => [{
      id: makeId(), title: 'Demo funds added', body: 'The OnePay server credited simulated funds. No money was collected.',
      createdAt: new Date().toISOString(), read: false, kind: 'service', href: '/transactions',
    }, ...current]);
    return transaction;
  }, [preferences.inAppAlerts, refreshPaymentData, upsertTransaction]);

  const recordDemoPayment = useCallback(async (payment: NewDemoPayment) => {
    if (!Number.isInteger(payment.amountPaise) || payment.amountPaise <= 0) {
      throw new Error('Enter an amount greater than zero.');
    }
    const transaction = await paymentApi.initiate(payment);
    upsertTransaction(transaction);
    await refreshPaymentData().catch(() => undefined);
    if (preferences.inAppAlerts) setNotifications((current) => [{
      id: makeId(), title: transaction.status === 'failed' ? 'Demo payment failed' : 'Demo activity recorded',
      body: `${transaction.title} · simulated only. No real payment was made.`,
      createdAt: new Date().toISOString(), read: false, kind: 'payment', href: `/transactions/${transaction.reference}`,
    }, ...current]);
    return transaction;
  }, [preferences.inAppAlerts, refreshPaymentData, upsertTransaction]);

  const reverseDemoPayment = useCallback(async (reference: string, idempotencyKey: string) => {
    const transaction = await paymentApi.reverse(reference, idempotencyKey);
    upsertTransaction(transaction);
    await refreshPaymentData().catch(() => undefined);
    return transaction;
  }, [refreshPaymentData, upsertTransaction]);

  const addRecipient = useCallback(async (data: { name: string; upiId: string }) => {
    const recipient = await paymentApi.createRecipient({ display_name: data.name, upi_id: data.upiId });
    setRecipients((current) => [...current.filter((item) => item.id !== recipient.id), recipient].sort((a, b) => a.name.localeCompare(b.name)));
    return recipient;
  }, []);

  const updateRecipient = useCallback(async (id: string, data: { name?: string; upiId?: string }) => {
    const recipient = await paymentApi.updateRecipient(id, {
      ...(data.name !== undefined ? { display_name: data.name } : {}),
      ...(data.upiId !== undefined ? { upi_id: data.upiId } : {}),
    });
    setRecipients((current) => current.map((item) => item.id === id ? recipient : item).sort((a, b) => a.name.localeCompare(b.name)));
    return recipient;
  }, []);

  const removeRecipient = useCallback(async (id: string) => {
    await paymentApi.deleteRecipient(id);
    setRecipients((current) => current.filter((item) => item.id !== id));
  }, []);

  const updateProfile = useCallback((nextProfile: DemoProfile) => setDemoUpiId(nextProfile.upiId), []);
  const updatePreferences = useCallback((updates: Partial<DemoPreferences>) => {
    setPreferences((current) => ({ ...current, ...updates }));
  }, []);
  const markNotificationRead = useCallback((id: string) => {
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
  }, []);
  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
  }, []);
  const clearNotifications = useCallback(() => setNotifications([]), []);

  const value = useMemo(() => ({
    balancePaise, transactions, recipients, profile, notifications, preferences,
    paymentDataLoading, paymentDataError, refreshPaymentData,
    addDemoFunds, recordDemoPayment, reverseDemoPayment,
    addRecipient, updateRecipient, removeRecipient,
    updateProfile, updatePreferences, markNotificationRead, markAllNotificationsRead, clearNotifications,
  }), [balancePaise, transactions, recipients, profile, notifications, preferences,
    paymentDataLoading, paymentDataError, refreshPaymentData, addDemoFunds, recordDemoPayment, reverseDemoPayment,
    addRecipient, updateRecipient, removeRecipient, updateProfile, updatePreferences,
    markNotificationRead, markAllNotificationsRead, clearNotifications]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo must be used inside DemoProvider.');
  return context;
}
