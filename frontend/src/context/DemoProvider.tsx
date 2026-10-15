import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { demoProfile, initialBalancePaise, initialNotifications, initialTransactions } from '../data/demo';
import type { DemoNotification, DemoProfile, DemoTransaction, NewDemoPayment } from '../types';

export interface DemoPreferences {
  inAppAlerts: boolean;
  maskBalance: boolean;
}

interface DemoContextValue {
  balancePaise: number;
  transactions: DemoTransaction[];
  profile: DemoProfile;
  notifications: DemoNotification[];
  preferences: DemoPreferences;
  addDemoFunds: (amountPaise: number) => DemoTransaction;
  recordDemoPayment: (payment: NewDemoPayment) => DemoTransaction;
  updateProfile: (profile: DemoProfile) => void;
  updatePreferences: (updates: Partial<DemoPreferences>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export function DemoProvider({ children }: PropsWithChildren) {
  const [balancePaise, setBalancePaise] = useState(initialBalancePaise);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [profile, setProfile] = useState<DemoProfile>(demoProfile);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [preferences, setPreferences] = useState<DemoPreferences>({ inAppAlerts: true, maskBalance: false });

  const addDemoFunds = useCallback((amountPaise: number) => {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Choose a valid demo-funds amount.');
    const transaction: DemoTransaction = {
      id: makeId(), reference: `ONEPAY-DEMO-${Date.now().toString().slice(-6)}`,
      title: 'Demo funds added', subtitle: 'Simulated wallet top-up', amountPaise,
      direction: 'credit', category: 'topup', status: 'complete', createdAt: new Date().toISOString(),
    };
    setBalancePaise((current) => current + amountPaise);
    setTransactions((current) => [transaction, ...current]);
    if (preferences.inAppAlerts) setNotifications((current) => [{
      id: makeId(), title: 'Demo funds added', body: 'Your simulated balance was updated. No money was transferred.',
      createdAt: new Date().toISOString(), read: false, kind: 'service', href: '/transactions',
    }, ...current]);
    return transaction;
  }, [preferences.inAppAlerts]);

  const recordDemoPayment = useCallback((payment: NewDemoPayment) => {
    if (!Number.isInteger(payment.amountPaise) || payment.amountPaise <= 0) {
      throw new Error('Enter an amount greater than zero.');
    }
    if (payment.amountPaise > balancePaise) {
      throw new Error('That is more than your available demo funds. Try a smaller amount or add demo funds.');
    }
    const transaction: DemoTransaction = {
      id: makeId(), reference: `ONEPAY-DEMO-${Date.now().toString().slice(-6)}`,
      title: payment.title, subtitle: payment.subtitle, amountPaise: payment.amountPaise,
      direction: payment.direction ?? 'debit', category: payment.category, status: 'complete', createdAt: new Date().toISOString(),
    };
    setBalancePaise((current) => current - payment.amountPaise);
    setTransactions((current) => [transaction, ...current]);
    if (preferences.inAppAlerts) setNotifications((current) => [{
      id: makeId(), title: 'Demo activity recorded', body: `${payment.title} · simulated only. No real payment was made.`,
      createdAt: new Date().toISOString(), read: false, kind: 'payment', href: '/transactions',
    }, ...current]);
    return transaction;
  }, [balancePaise, preferences.inAppAlerts]);

  const updateProfile = useCallback((nextProfile: DemoProfile) => setProfile(nextProfile), []);
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
    balancePaise, transactions, profile, notifications, preferences, addDemoFunds, recordDemoPayment,
    updateProfile, updatePreferences, markNotificationRead, markAllNotificationsRead, clearNotifications,
  }), [balancePaise, transactions, profile, notifications, preferences, addDemoFunds, recordDemoPayment,
    updateProfile, updatePreferences, markNotificationRead, markAllNotificationsRead, clearNotifications]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo must be used inside DemoProvider.');
  return context;
}
