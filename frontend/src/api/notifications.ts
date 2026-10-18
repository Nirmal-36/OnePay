import { paymentRequest } from './auth';
import type { DemoNotification, NotificationCategory } from '../types';

export interface ApiNotification {
  id: string;
  category: NotificationCategory;
  event_type: string;
  title: string;
  message: string;
  related_transaction_reference: string | null;
  navigation_target: string;
  read: boolean;
  dismissed: boolean;
  created_at: string;
}

export interface NotificationFilters {
  category?: NotificationCategory | 'all';
  read?: boolean;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface NotificationPage {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  results: DemoNotification[];
}

interface ApiNotificationPage {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  results: ApiNotification[];
}

interface ApiUnreadCount {
  unread_count: number;
}

export function mapNotification(notification: ApiNotification): DemoNotification {
  return {
    id: notification.id,
    category: notification.category,
    eventType: notification.event_type,
    title: notification.title,
    body: notification.message,
    createdAt: notification.created_at,
    read: notification.read,
    dismissed: notification.dismissed,
    href: notification.navigation_target,
    relatedReference: notification.related_transaction_reference ?? undefined,
  };
}

const SAFE_NOTIFICATION_ROUTES = new Set([
  '/', '/send', '/scan', '/transactions', '/bills', '/recipients', '/profile', '/notifications', '/help',
]);
const TRANSACTION_NOTIFICATION_ROUTE = /^\/transactions\/OPW-[A-F0-9]{32}(?:\/receipt)?$/;

export function safeNotificationPath(target: string | null | undefined): string | null {
  if (!target || target.length > 255 || target !== target.trim() || target.includes('\\') || target.includes('%')) return null;
  try {
    const parsed = new URL(target, 'https://onepay.invalid');
    if (parsed.origin !== 'https://onepay.invalid' || parsed.pathname !== target || parsed.search || parsed.hash) return null;
  } catch {
    return null;
  }
  return SAFE_NOTIFICATION_ROUTES.has(target) || TRANSACTION_NOTIFICATION_ROUTE.test(target) ? target : null;
}

function notificationPath(path = '') {
  return `notifications/${path.replace(/^\//, '')}`;
}

export const notificationApi = {
  list: async (filters: NotificationFilters = {}): Promise<NotificationPage> => {
    const params = new URLSearchParams();
    if (filters.category && filters.category !== 'all') params.set('category', filters.category);
    if (filters.read !== undefined) params.set('read', String(filters.read));
    if (filters.dateFrom) params.set('date_from', filters.dateFrom);
    if (filters.dateTo) params.set('date_to', filters.dateTo);
    if (filters.page !== undefined) params.set('page', String(filters.page));
    if (filters.pageSize !== undefined) params.set('page_size', String(filters.pageSize));
    const query = params.toString();
    const response = await paymentRequest<ApiNotificationPage>(notificationPath(`${query ? `?${query}` : ''}`));
    return {
      count: response.count,
      page: response.page,
      pageSize: response.page_size,
      totalPages: response.total_pages,
      hasNext: response.has_next,
      hasPrevious: response.has_previous,
      results: response.results.map(mapNotification),
    };
  },
  unreadCount: async () => (await paymentRequest<ApiUnreadCount>(notificationPath('unread-count/'))).unread_count,
  markRead: async (id: string) => {
    const response = await paymentRequest<{ notification: ApiNotification; unread_count: number }>(
      notificationPath(`${encodeURIComponent(id)}/read/`),
      { method: 'POST', body: {} },
    );
    return { notification: mapNotification(response.notification), unreadCount: response.unread_count };
  },
  markAllRead: () => paymentRequest<{ updated: number; unread_count: number }>(
    notificationPath('read-all/'),
    { method: 'POST', body: {} },
  ),
  dismiss: (id: string) => paymentRequest<{ dismissed: boolean; unread_count: number }>(
    notificationPath(`${encodeURIComponent(id)}/dismiss/`),
    { method: 'POST', body: {} },
  ),
  dismissAll: () => paymentRequest<{ updated: number; unread_count: number }>(
    notificationPath('dismiss-all/'),
    { method: 'POST', body: {} },
  ),
};
