import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { ApiError, apiErrorMessage } from '../api/auth';
import { paymentApi } from '../api/payments';
import { notificationApi, type NotificationFilters } from '../api/notifications';
import { demoProfile } from '../data/demo';
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
  notificationUnreadCount: number;
  notificationCount: number;
  notificationPage: number;
  notificationPageSize: number;
  notificationTotalPages: number;
  notificationHasNext: boolean;
  notificationHasPrevious: boolean;
  notificationLoading: boolean;
  notificationError: string | null;
  preferences: DemoPreferences;
  paymentDataLoading: boolean;
  paymentDataError: string | null;
  refreshPaymentData: () => Promise<void>;
  refreshNotifications: (page?: number, filters?: NotificationFilters) => Promise<void>;
  refreshNotificationCount: () => Promise<void>;
  addDemoFunds: (amountPaise: number, idempotencyKey: string) => Promise<DemoTransaction>;
  recordDemoPayment: (payment: NewDemoPayment) => Promise<DemoTransaction>;
  addRecipient: (data: { name: string; upiId: string }) => Promise<DemoRecipient>;
  updateRecipient: (id: string, data: { name?: string; upiId?: string }) => Promise<DemoRecipient>;
  removeRecipient: (id: string) => Promise<void>;
  updateProfile: (profile: DemoProfile) => void;
  updatePreferences: (updates: Partial<DemoPreferences>) => void;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;
  dismissAllNotifications: () => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);
const NOTIFICATION_PAGE_SIZE = 20;
const DEFAULT_PREFERENCES: DemoPreferences = { inAppAlerts: true, maskBalance: false };

function transactionBalanceDelta(transaction: DemoTransaction, previous?: DemoTransaction): number {
  if (!previous) {
    if (transaction.category === 'topup') return transaction.amountPaise;
    if (transaction.status === 'pending' || transaction.status === 'successful') return -transaction.amountPaise;
    return 0;
  }
  if (previous.status !== 'failed' && transaction.status === 'failed') return transaction.amountPaise;
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
  const [notifications, setNotifications] = useState<DemoNotification[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationTotalPages, setNotificationTotalPages] = useState(0);
  const [notificationHasNext, setNotificationHasNext] = useState(false);
  const [notificationHasPrevious, setNotificationHasPrevious] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<DemoPreferences>(DEFAULT_PREFERENCES);
  const knownTransactions = useRef(new Map<string, DemoTransaction>());
  const notificationOwnerId = useRef<number | null>(null);
  const notificationRequestId = useRef(0);
  const notificationCountRequestId = useRef(0);
  const notificationPageRef = useRef(1);
  const notificationFiltersRef = useRef<NotificationFilters>({});

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

  const refreshNotifications = useCallback(async (
    requestedPage = notificationPageRef.current,
    requestedFilters = notificationFiltersRef.current,
  ) => {
    if (!user) return;
    const ownerId = user.id;
    if (notificationOwnerId.current !== ownerId) notificationOwnerId.current = ownerId;
    const requestId = ++notificationRequestId.current;
    const filters = { ...requestedFilters, page: undefined, pageSize: undefined };
    notificationFiltersRef.current = filters;
    notificationPageRef.current = requestedPage;
    setNotificationLoading(true);
    try {
      const [pageData, unreadCount] = await Promise.all([
        notificationApi.list({ ...filters, page: requestedPage, pageSize: NOTIFICATION_PAGE_SIZE }),
        notificationApi.unreadCount(),
      ]);
      if (requestId !== notificationRequestId.current || notificationOwnerId.current !== ownerId) return;
      setNotifications(pageData.results);
      setNotificationCount(pageData.count);
      setNotificationPage(pageData.page);
      setNotificationTotalPages(pageData.totalPages);
      setNotificationHasNext(pageData.hasNext);
      setNotificationHasPrevious(pageData.hasPrevious);
      setNotificationUnreadCount(unreadCount);
      setNotificationError(null);
    } catch (error) {
      if (requestId !== notificationRequestId.current || notificationOwnerId.current !== ownerId) return;
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setNotificationError(apiErrorMessage(error, 'Could not load your OnePay notifications. Check your connection and retry.'));
      throw error;
    } finally {
      if (requestId === notificationRequestId.current && notificationOwnerId.current === ownerId) {
        setNotificationLoading(false);
      }
    }
  }, [user, refreshSession]);

  const refreshNotificationCount = useCallback(async () => {
    if (!user) return;
    const ownerId = user.id;
    if (notificationOwnerId.current !== ownerId) notificationOwnerId.current = ownerId;
    const requestId = ++notificationCountRequestId.current;
    try {
      const unreadCount = await notificationApi.unreadCount();
      if (requestId === notificationCountRequestId.current && notificationOwnerId.current === ownerId) {
        setNotificationUnreadCount(unreadCount);
        setNotificationError(null);
      }
    } catch (error) {
      if (requestId !== notificationCountRequestId.current || notificationOwnerId.current !== ownerId) return;
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setNotificationError(apiErrorMessage(error, 'Could not load your OnePay notifications. Check your connection and retry.'));
    }
  }, [user, refreshSession]);

  const clearUserNotificationState = useCallback(() => {
    notificationOwnerId.current = null;
    notificationRequestId.current += 1;
    notificationCountRequestId.current += 1;
    notificationPageRef.current = 1;
    notificationFiltersRef.current = {};
    setNotifications([]);
    setNotificationUnreadCount(0);
    setNotificationCount(0);
    setNotificationPage(1);
    setNotificationTotalPages(0);
    setNotificationHasNext(false);
    setNotificationHasPrevious(false);
    setNotificationLoading(false);
    setNotificationError(null);
  }, []);

  useEffect(() => {
    if (authStatus === 'authenticated' && user) {
      const userChanged = notificationOwnerId.current !== user.id;
      if (userChanged) {
        notificationOwnerId.current = user.id;
        notificationRequestId.current += 1;
        notificationCountRequestId.current += 1;
        notificationPageRef.current = 1;
        notificationFiltersRef.current = {};
        setNotifications([]);
        setNotificationUnreadCount(0);
        setNotificationCount(0);
        setNotificationPage(1);
        setNotificationTotalPages(0);
        setNotificationHasNext(false);
        setNotificationHasPrevious(false);
        setNotificationError(null);
      }
      void refreshPaymentData().catch(() => undefined);
      void refreshNotificationCount();
    } else {
      clearUserNotificationState();
      if (authStatus === 'anonymous' || authStatus === 'error') {
        setBalancePaise(0);
        setTransactions([]);
        setRecipients([]);
        knownTransactions.current.clear();
        setDemoUpiId(demoProfile.upiId);
        setPreferences(DEFAULT_PREFERENCES);
        setPaymentDataLoading(false);
        setPaymentDataError(null);
      }
    }
  }, [authStatus, user, refreshPaymentData, refreshNotificationCount, clearUserNotificationState]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && notificationOwnerId.current !== null) {
        void refreshNotifications().catch(() => undefined);
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshNotifications]);

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
    await Promise.all([
      refreshPaymentData().catch(() => undefined),
      refreshNotifications(1, {}).catch(() => undefined),
    ]);
    return transaction;
  }, [refreshNotifications, refreshPaymentData, upsertTransaction]);

  const recordDemoPayment = useCallback(async (payment: NewDemoPayment) => {
    if (!Number.isInteger(payment.amountPaise) || payment.amountPaise <= 0) {
      throw new Error('Enter an amount greater than zero.');
    }
    const transaction = await paymentApi.initiate(payment);
    upsertTransaction(transaction);
    await Promise.all([
      refreshPaymentData().catch(() => undefined),
      refreshNotifications(1, {}).catch(() => undefined),
    ]);
    return transaction;
  }, [refreshNotifications, refreshPaymentData, upsertTransaction]);

  const addRecipient = useCallback(async (data: { name: string; upiId: string }) => {
    const recipient = await paymentApi.createRecipient({ display_name: data.name, upi_id: data.upiId });
    setRecipients((current) => [...current.filter((item) => item.id !== recipient.id), recipient].sort((a, b) => a.name.localeCompare(b.name)));
    await refreshNotifications(1, {}).catch(() => undefined);
    return recipient;
  }, [refreshNotifications]);

  const updateRecipient = useCallback(async (id: string, data: { name?: string; upiId?: string }) => {
    const recipient = await paymentApi.updateRecipient(id, {
      ...(data.name !== undefined ? { display_name: data.name } : {}),
      ...(data.upiId !== undefined ? { upi_id: data.upiId } : {}),
    });
    setRecipients((current) => current.map((item) => item.id === id ? recipient : item).sort((a, b) => a.name.localeCompare(b.name)));
    await refreshNotifications(1, {}).catch(() => undefined);
    return recipient;
  }, [refreshNotifications]);

  const removeRecipient = useCallback(async (id: string) => {
    await paymentApi.deleteRecipient(id);
    setRecipients((current) => current.filter((item) => item.id !== id));
    await refreshNotifications(1, {}).catch(() => undefined);
  }, [refreshNotifications]);

  const updateProfile = useCallback((nextProfile: DemoProfile) => {
    setDemoUpiId(nextProfile.upiId);
    void refreshNotifications(1, {}).catch(() => undefined);
  }, [refreshNotifications]);
  const updatePreferences = useCallback((updates: Partial<DemoPreferences>) => {
    setPreferences((current) => ({ ...current, ...updates }));
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    if (!user) return;
    try {
      const result = await notificationApi.markRead(id);
      if (notificationOwnerId.current !== user.id) return;
      const readOnlyFilter = notificationFiltersRef.current.read === false;
      const needsPreviousPage = readOnlyFilter && notifications.length === 1 && notificationPageRef.current > 1;
      const nextPage = needsPreviousPage ? notificationPageRef.current - 1 : notificationPageRef.current;
      setNotifications((current) => readOnlyFilter
        ? current.filter((item) => item.id !== id)
        : current.map((item) => item.id === id ? result.notification : item));
      if (readOnlyFilter) setNotificationCount((current) => Math.max(0, current - 1));
      setNotificationUnreadCount(result.unreadCount);
      setNotificationError(null);
      void refreshNotifications(nextPage).catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setNotificationError(apiErrorMessage(error, 'Could not update this notification. Please retry.'));
      throw error;
    }
  }, [user, notifications, refreshNotifications, refreshSession]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!user) return;
    try {
      const result = await notificationApi.markAllRead();
      if (notificationOwnerId.current !== user.id) return;
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      setNotificationUnreadCount(result.unread_count);
      setNotificationError(null);
      if (notificationFiltersRef.current.read === false) {
        void refreshNotifications(1, notificationFiltersRef.current).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setNotificationError(apiErrorMessage(error, 'Could not mark notifications as read. Please retry.'));
      throw error;
    }
  }, [user, refreshNotifications, refreshSession]);

  const dismissNotification = useCallback(async (id: string) => {
    if (!user) return;
    const wasVisible = notifications.some((item) => item.id === id);
    try {
      const result = await notificationApi.dismiss(id);
      if (notificationOwnerId.current !== user.id) return;
      setNotifications((current) => current.filter((item) => item.id !== id));
      if (wasVisible) setNotificationCount((current) => Math.max(0, current - 1));
      setNotificationUnreadCount(result.unread_count);
      setNotificationError(null);
      if (wasVisible) {
        const needsPreviousPage = notifications.length === 1 && notificationPageRef.current > 1;
        const nextPage = needsPreviousPage ? notificationPageRef.current - 1 : notificationPageRef.current;
        void refreshNotifications(nextPage).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setNotificationError(apiErrorMessage(error, 'Could not dismiss this notification. Please retry.'));
      throw error;
    }
  }, [user, notifications, refreshNotifications, refreshSession]);

  const dismissAllNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const result = await notificationApi.dismissAll();
      if (notificationOwnerId.current !== user.id) return;
      setNotifications([]);
      setNotificationCount(0);
      setNotificationPage(1);
      setNotificationTotalPages(0);
      setNotificationHasNext(false);
      setNotificationHasPrevious(false);
      notificationPageRef.current = 1;
      setNotificationUnreadCount(result.unread_count);
      setNotificationError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void refreshSession();
      setNotificationError(apiErrorMessage(error, 'Could not dismiss notifications. Please retry.'));
      throw error;
    }
  }, [user, refreshSession]);

  const value = useMemo(() => ({
    balancePaise,
    transactions,
    recipients,
    profile,
    notifications,
    notificationUnreadCount,
    notificationCount,
    notificationPage,
    notificationPageSize: NOTIFICATION_PAGE_SIZE,
    notificationTotalPages,
    notificationHasNext,
    notificationHasPrevious,
    notificationLoading,
    notificationError,
    preferences,
    paymentDataLoading,
    paymentDataError,
    refreshPaymentData,
    refreshNotifications,
    refreshNotificationCount,
    addDemoFunds,
    recordDemoPayment,
    addRecipient,
    updateRecipient,
    removeRecipient,
    updateProfile,
    updatePreferences,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    dismissAllNotifications,
  }), [
    balancePaise,
    transactions,
    recipients,
    profile,
    notifications,
    notificationUnreadCount,
    notificationCount,
    notificationPage,
    notificationTotalPages,
    notificationHasNext,
    notificationHasPrevious,
    notificationLoading,
    notificationError,
    preferences,
    paymentDataLoading,
    paymentDataError,
    refreshPaymentData,
    refreshNotifications,
    refreshNotificationCount,
    addDemoFunds,
    recordDemoPayment,
    addRecipient,
    updateRecipient,
    removeRecipient,
    updateProfile,
    updatePreferences,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    dismissAllNotifications,
  ]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo must be used inside DemoProvider.');
  return context;
}
