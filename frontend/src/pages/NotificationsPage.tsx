import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, CheckCheck, CircleHelp, LoaderCircle, LockKeyhole, ReceiptText, Trash2, UsersRound, WalletCards, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../api/auth';
import { safeNotificationPath, type NotificationFilters } from '../api/notifications';
import { Button } from '../components/Controls';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { formatRelativeDate, type NotificationCategory } from '../types';

type NotificationFiltersForm = {
  category: NotificationCategory | 'all';
  read: 'all' | 'true' | 'false';
  dateFrom: string;
  dateTo: string;
};

const DEFAULT_FILTERS: NotificationFiltersForm = { category: 'all', read: 'all', dateFrom: '', dateTo: '' };

function iconForCategory(category: NotificationCategory) {
  if (category === 'security' || category === 'account') return LockKeyhole;
  if (category === 'recipient') return UsersRound;
  if (category === 'wallet') return WalletCards;
  if (category === 'payment' || category === 'bill' || category === 'recharge') return ReceiptText;
  return Bell;
}

function toApiFilters(filters: NotificationFiltersForm): NotificationFilters {
  return {
    category: filters.category,
    ...(filters.read !== 'all' ? { read: filters.read === 'true' } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  };
}

export default function NotificationsPage() {
  const {
    notifications,
    notificationUnreadCount,
    notificationCount,
    notificationPage,
    notificationTotalPages,
    notificationHasNext,
    notificationHasPrevious,
    notificationLoading,
    notificationError,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    dismissAllNotifications,
  } = useDemo();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [busyNotificationId, setBusyNotificationId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    void refreshNotifications(1, {}).catch(() => undefined);
  }, [refreshNotifications]);

  const applyFilters = (nextFilters: NotificationFiltersForm) => {
    setFilters(nextFilters);
    void refreshNotifications(1, toApiFilters(nextFilters)).catch(() => undefined);
  };

  const openNotification = async (id: string, rawTarget: string) => {
    const target = safeNotificationPath(rawTarget);
    setBusyNotificationId(id);
    try {
      await markNotificationRead(id);
      if (target) navigate(target);
      else showToast('This notification destination is no longer available.', 'info');
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not update this notification. Please retry.'), 'error');
    } finally {
      setBusyNotificationId(null);
    }
  };

  const dismissOne = async (id: string, title: string) => {
    setBusyNotificationId(id);
    try {
      await dismissNotification(id);
      showToast(`“${title}” dismissed.`, 'success');
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not dismiss this notification. Please retry.'), 'error');
    } finally {
      setBusyNotificationId(null);
    }
  };

  const markAllRead = async () => {
    setActionBusy(true);
    try {
      await markAllNotificationsRead();
      showToast('All notifications marked as read.', 'success');
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not mark notifications as read. Please retry.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const confirmDismissAll = async () => {
    setActionBusy(true);
    try {
      await dismissAllNotifications();
      setClearConfirmOpen(false);
      showToast('Notifications dismissed.', 'success');
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not dismiss notifications. Please retry.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const clearFilters = () => applyFilters(DEFAULT_FILTERS);
  const hasFilters = filters.category !== 'all' || filters.read !== 'all' || Boolean(filters.dateFrom || filters.dateTo);
  const loadPage = (page: number) => void refreshNotifications(page, toApiFilters(filters)).catch(() => undefined);

  return (
    <>
      <PageHeader
        eyebrow="YOUR UPDATES"
        title="Notifications"
        description="Account activity, simulated payment outcomes, and OnePay service announcements."
        action={(notificationCount > 0 || notificationUnreadCount > 0) ? (
          <div className="notification-actions">
            <Button variant="secondary" size="sm" onClick={() => void markAllRead()} disabled={notificationUnreadCount === 0 || actionBusy} busy={actionBusy} icon={<CheckCheck size={16} />}>
              Mark all read
            </Button>
            <button type="button" className="icon-button subtle-danger" onClick={() => setClearConfirmOpen(true)} aria-label="Dismiss all notifications" disabled={actionBusy}>
              <Trash2 size={17} />
            </button>
          </div>
        ) : undefined}
      />

      <section className="card notifications-filter-card" aria-label="Filter notifications">
        <label className="notification-filter-field">
          <span>Category</span>
          <select aria-label="Filter notifications by category" value={filters.category} onChange={(event) => applyFilters({ ...filters, category: event.target.value as NotificationCategory | 'all' })}>
            <option value="all">All categories</option>
            <option value="payment">Payments</option>
            <option value="wallet">Wallet</option>
            <option value="bill">Bills</option>
            <option value="recharge">Recharges</option>
            <option value="recipient">Recipients</option>
            <option value="account">Account</option>
            <option value="security">Security</option>
            <option value="system">Service announcements</option>
          </select>
        </label>
        <label className="notification-filter-field">
          <span>Read status</span>
          <select aria-label="Filter notifications by read status" value={filters.read} onChange={(event) => applyFilters({ ...filters, read: event.target.value as NotificationFiltersForm['read'] })}>
            <option value="all">All statuses</option>
            <option value="false">Unread</option>
            <option value="true">Read</option>
          </select>
        </label>
        <label className="notification-filter-field">
          <span>From date</span>
          <input aria-label="Notifications from date" type="date" value={filters.dateFrom} onChange={(event) => applyFilters({ ...filters, dateFrom: event.target.value })} />
        </label>
        <label className="notification-filter-field">
          <span>To date</span>
          <input aria-label="Notifications to date" type="date" value={filters.dateTo} onChange={(event) => applyFilters({ ...filters, dateTo: event.target.value })} />
        </label>
        {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
      </section>

      {notificationError && (
        <div className="notification-load-error" role="alert">
          <span>{notificationError}</span>
          <Button variant="secondary" size="sm" onClick={() => loadPage(notificationPage)}>Retry</Button>
        </div>
      )}

      {notificationLoading && notifications.length === 0 ? (
        <section className="card notifications-loading" role="status"><LoaderCircle className="spin" size={20} /><span>Loading your notifications…</span></section>
      ) : notifications.length === 0 ? (
        <section className="card notifications-empty-card">
          <EmptyState
            title={hasFilters ? 'No notifications match these filters' : 'You’re all caught up'}
            description={hasFilters ? 'Try another category, read status, or date range.' : 'New account updates and simulated activity will appear here.'}
            icon={Bell}
            action={hasFilters
              ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
              : <Button variant="secondary" onClick={() => navigate('/')}>Back to dashboard</Button>}
          />
        </section>
      ) : (
        <section className="card notifications-card" aria-label="Notifications list">
          <div className="notifications-list-heading">
            <div>
              <h2>Recent updates</h2>
              <p>{notificationUnreadCount ? `${notificationUnreadCount} unread ${notificationUnreadCount === 1 ? 'update' : 'updates'} in your account` : 'Everything has been read'}</p>
            </div>
            <span className="notification-count-pill">{notificationCount}</span>
          </div>
          <div className="notifications-list">
            {notifications.map((notification) => {
              const Icon = iconForCategory(notification.category);
              const isBusy = busyNotificationId === notification.id;
              return (
                <article className={`notification-row ${notification.read ? 'notification-read' : 'notification-unread'}`} key={notification.id}>
                  <span className={`notification-kind-icon notification-kind-${notification.category}`}><Icon size={18} /></span>
                  <div className="notification-copy">
                    <div className="notification-title-line">
                      <h3>{notification.title}</h3>
                      {!notification.read && <span className="unread-indicator">New</span>}
                    </div>
                    <p>{notification.body}</p>
                    <span className="notification-time">{formatRelativeDate(notification.createdAt)}</span>
                  </div>
                  <div className="notification-row-actions">
                    <button type="button" className="notification-open-button" onClick={() => void openNotification(notification.id, notification.href)} aria-label={`Open notification: ${notification.title}`} disabled={isBusy}>
                      <ArrowRight size={17} />
                    </button>
                    <button type="button" className="notification-dismiss-button" onClick={() => void dismissOne(notification.id, notification.title)} aria-label={`Dismiss notification: ${notification.title}`} disabled={isBusy}>
                      <X size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="notifications-pagination">
            <span>{notificationCount} {notificationCount === 1 ? 'notification' : 'notifications'} · page {notificationPage} of {Math.max(notificationTotalPages, 1)}</span>
            <div>
              <Button variant="secondary" size="sm" onClick={() => loadPage(notificationPage - 1)} disabled={!notificationHasPrevious || notificationLoading} icon={<ArrowLeft size={15} />}>Previous</Button>
              <Button variant="secondary" size="sm" onClick={() => loadPage(notificationPage + 1)} disabled={!notificationHasNext || notificationLoading} icon={<ArrowRight size={15} />}>Next</Button>
            </div>
          </div>
          <div className="notifications-footnote"><LockKeyhole size={15} /><span>These updates are tied to your OnePay account and can be dismissed from your other signed-in sessions.</span></div>
        </section>
      )}

      <div className="notifications-help-link"><span><CircleHelp size={17} /></span><div><strong>Something doesn’t look right?</strong><small>Contact our sample support team.</small></div><Button variant="ghost" size="sm" onClick={() => navigate('/help')} icon={<ArrowRight size={15} />}>Get help</Button></div>

      <Modal open={clearConfirmOpen} title="Dismiss all notifications?" subtitle="This is saved to your OnePay account and applies on all signed-in devices." onClose={() => setClearConfirmOpen(false)} size="sm" footer={<><Button variant="secondary" onClick={() => setClearConfirmOpen(false)} disabled={actionBusy}>Keep them</Button><Button variant="danger" onClick={() => void confirmDismissAll()} busy={actionBusy} icon={<Trash2 size={16} />}>Dismiss all</Button></>}>
        <p className="modal-body-copy">Dismissed updates will no longer appear in your active notification list. New events can still create new account notifications.</p>
      </Modal>
    </>
  );
}
