import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiTransaction } from './api/payments';
import type { ApiNotification } from './api/notifications';
import { BrowserQRCodeReader } from '@zxing/browser';
import { DemoProvider, useDemo } from './context/DemoProvider';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastProvider';
import AppRoutes from './AppRoutes';

const testUser = { id: 1, email: 'ananya@example.test', full_name: 'Ananya Sharma', date_joined: '2026-10-15T12:00:00Z' };
const otherAccountUser = { id: 2, email: 'other@example.test', full_name: 'Other User', date_joined: '2026-10-15T12:00:00Z' };
const now = '2026-10-15T12:00:00Z';
const demoQrContent = 'onepay://pay?v=1&upi=user1%40onepay&currency=INR&mode=demo&sig=test-signature';
const sampleRecipients = [
  ['Rohan Mehta', 'rohan@okaxis'],
  ['Kavya Iyer', 'kavya@okhdfcbank'],
  ['Arjun Rao', 'arjun@okicici'],
  ['Meera Nair', 'meera@oksbi'],
  ['Dev Patel', 'dev@okaxis'],
].map(([display_name, upi_id], index) => ({ id: index + 1, display_name, upi_id, is_default: true, created_at: now, updated_at: now }));

const makeTransaction = (overrides: Partial<ApiTransaction> = {}): ApiTransaction => ({
  id: 'tx-history-rohan',
  reference: 'OPW-HISTORY-ROHAN',
  sender_name: 'Ananya Sharma',
  recipient_id: 1,
  recipient_name: 'Rohan Mehta',
  recipient_identifier: 'rohan@okaxis',
  kind: 'transfer',
  service: '',
  note: 'Lunch',
  amount_minor: 124_000,
  currency: 'INR',
  status: 'successful',
  created_at: now,
  updated_at: now,
  completed_at: now,
  status_history: [
    { from_status: null, to_status: 'pending', reason: 'Accepted by OnePay.', created_at: now },
    { from_status: 'pending', to_status: 'successful', reason: 'Simulated.', created_at: now },
  ],
  ...overrides,
});

const makeNotification = (overrides: Partial<ApiNotification> = {}): ApiNotification => ({
  id: '00000000-0000-4000-8000-000000000001',
  category: 'payment',
  event_type: 'payment.successful',
  title: 'Payment completed',
  message: 'Your simulated payment completed. No real money moved.',
  related_transaction_reference: `OPW-${'A'.repeat(32)}`,
  navigation_target: `/transactions/OPW-${'A'.repeat(32)}`,
  read: false,
  dismissed: false,
  created_at: now,
  ...overrides,
});

const mockTransactions: ApiTransaction[] = [
  makeTransaction(),
  makeTransaction({
    id: 'tx-history-kavya', reference: 'OPW-HISTORY-KAVYA', recipient_id: 2,
    recipient_name: 'Kavya Iyer', recipient_identifier: 'kavya@okhdfcbank',
    status: 'reversed', amount_minor: 500_000,
    status_history: [
      { from_status: null, to_status: 'pending', reason: 'Accepted by OnePay.', created_at: now },
      { from_status: 'pending', to_status: 'successful', reason: 'Simulated.', created_at: now },
      { from_status: 'successful', to_status: 'reversed', reason: 'Reversed.', created_at: now },
    ],
  }),
  makeTransaction({
    id: 'tx-history-bill', reference: 'OPW-HISTORY-BILL', recipient_id: null,
    recipient_name: 'OnePay Mock Electricity', recipient_identifier: 'Ending 3920',
    kind: 'bill', service: 'electricity', note: 'Demo reference only', amount_minor: 35_500,
  }),
];

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => status === 204 ? '' : JSON.stringify(body),
}) as Response;

function installMockApi(options: {
  historyFailures?: number;
  historyFailureStatus?: number;
  transactions?: ApiTransaction[];
  notifications?: ApiNotification[];
  notificationsByUser?: Record<number, ApiNotification[]>;
  notificationFailures?: number;
  notificationFailureStatus?: number;
} = {}) {
  const transactions = [...(options.transactions ?? mockTransactions)];
  let historyFailuresRemaining = options.historyFailures ?? 0;
  let notificationFailuresRemaining = options.notificationFailures ?? 0;
  const idempotentTransactions = new Map<string, ApiTransaction>();
  const recipientStore = sampleRecipients.map((recipient) => ({ ...recipient }));
  const otherUser = otherAccountUser;
  let currentUser = testUser;
  let authenticated = true;
  let notificationSequence = 1;
  const notificationStores = new Map<number, ApiNotification[]>();
  notificationStores.set(testUser.id, [...(options.notifications ?? [])]);
  Object.entries(options.notificationsByUser ?? {}).forEach(([userId, entries]) => {
    notificationStores.set(Number(userId), [...entries]);
  });
  const getNotifications = () => {
    let store = notificationStores.get(currentUser.id);
    if (!store) {
      store = [];
      notificationStores.set(currentUser.id, store);
    }
    return store;
  };
  const pushNotification = (notice: Omit<ApiNotification, 'id' | 'created_at' | 'read' | 'dismissed'>) => {
    const id = `10000000-0000-4000-8000-${String(notificationSequence++).padStart(12, '0')}`;
    getNotifications().unshift(makeNotification({
      ...notice,
      id,
      created_at: new Date().toISOString(),
      read: false,
      dismissed: false,
    }));
  };
  const recordTransactionNotification = (transaction: ApiTransaction) => {
    const category = transaction.kind === 'topup' ? 'wallet'
      : transaction.kind === 'bill' ? 'bill'
        : transaction.kind === 'recharge' ? 'recharge' : 'payment';
    const event_type = category === 'wallet' ? 'wallet.topup_successful' : `${category}.${transaction.status}`;
    const noun = category === 'wallet' ? 'Demo funds' : category === 'bill' ? 'Bill payment' : category === 'recharge' ? 'Recharge' : 'Payment';
    const title = category === 'wallet' ? 'Demo funds added'
      : `${noun} ${transaction.status === 'successful' ? 'completed' : transaction.status}`;
    const message = transaction.status === 'failed'
      ? 'The local simulation declined it and refunded the demo debit. No provider was contacted.'
      : transaction.status === 'pending'
        ? 'The OnePay local simulator has not returned a final result; this operation remains pending.'
        : category === 'wallet'
          ? 'Simulated funds were added to your OnePay wallet. No money was collected.'
          : 'The simulated operation completed. No real money moved.';
    pushNotification({
      category,
      event_type,
      title,
      message,
      related_transaction_reference: transaction.reference,
      navigation_target: `/transactions/${transaction.reference}`,
    });
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://onepay.test');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/v1/auth/me/') {
      return authenticated
        ? jsonResponse(200, { user: currentUser })
        : jsonResponse(401, { error: { status: 401, message: 'Sign in required.', details: null } });
    }
    if (url.pathname === '/api/v1/auth/csrf/') return jsonResponse(200, { csrfToken: 'test-csrf-token' });
    if (url.pathname === '/api/v1/auth/logout/' && method === 'POST') {
      authenticated = false;
      return jsonResponse(200, { message: 'Signed out.', csrfToken: 'test-csrf-token' });
    }
    if (url.pathname === '/api/v1/auth/login/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { email?: string };
      currentUser = data.email === testUser.email ? testUser : otherUser;
      authenticated = true;
      pushNotification({
        category: 'security', event_type: 'security.login_successful',
        title: 'Successful sign-in to OnePay', message: 'Your OnePay account was signed in successfully.',
        related_transaction_reference: null, navigation_target: '/profile',
      });
      return jsonResponse(200, { user: currentUser, csrfToken: 'test-csrf-token' });
    }
    if (url.pathname === '/api/v1/auth/profile/' && method === 'PATCH') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { full_name?: string };
      const changed = Boolean(data.full_name && data.full_name !== currentUser.full_name);
      currentUser = { ...currentUser, full_name: data.full_name ?? currentUser.full_name };
      if (changed) {
        pushNotification({
          category: 'account', event_type: 'account.profile_updated', title: 'Profile updated',
          message: 'Your OnePay account display name was updated.', related_transaction_reference: null, navigation_target: '/profile',
        });
      }
      return jsonResponse(200, { user: currentUser });
    }
    if (url.pathname === '/api/v1/payments/wallet/') return jsonResponse(200, { balance_minor: 2_458_000, currency: 'INR', updated_at: now });
    if (url.pathname === '/api/v1/payments/recipients/' && method === 'GET') return jsonResponse(200, recipientStore);
    if (url.pathname === '/api/v1/payments/recipients/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { display_name: string; upi_id: string };
      const recipient = { id: 99, display_name: data.display_name, upi_id: data.upi_id, is_default: false, created_at: now, updated_at: now };
      recipientStore.push(recipient);
      pushNotification({
        category: 'recipient', event_type: 'recipient.created', title: 'Recipient added',
        message: 'A saved recipient was added to your OnePay account.', related_transaction_reference: null, navigation_target: '/recipients',
      });
      return jsonResponse(201, recipient);
    }
    const recipientRoute = url.pathname.match(/^\/api\/v1\/payments\/recipients\/(\d+)\/$/);
    if (recipientRoute && method === 'PATCH') {
      const recipient = recipientStore.find((item) => item.id === Number(recipientRoute[1]));
      if (!recipient) return jsonResponse(404, { error: { status: 404, message: 'Recipient not found.', details: null } });
      const data = JSON.parse(String(init?.body ?? '{}')) as { display_name?: string; upi_id?: string };
      const changed = Object.entries(data).some(([key, value]) => recipient[key as 'display_name' | 'upi_id'] !== value);
      Object.assign(recipient, data, { updated_at: now });
      if (changed) {
        pushNotification({
          category: 'recipient', event_type: 'recipient.updated', title: 'Recipient updated',
          message: 'A saved recipient in your OnePay account was updated.', related_transaction_reference: null, navigation_target: '/recipients',
        });
      }
      return jsonResponse(200, recipient);
    }
    if (recipientRoute && method === 'DELETE') {
      const index = recipientStore.findIndex((item) => item.id === Number(recipientRoute[1]));
      if (index < 0) return jsonResponse(404, { error: { status: 404, message: 'Recipient not found.', details: null } });
      recipientStore.splice(index, 1);
      pushNotification({
        category: 'recipient', event_type: 'recipient.removed', title: 'Recipient removed',
        message: 'A saved recipient was removed from your active OnePay contacts.', related_transaction_reference: null, navigation_target: '/recipients',
      });
      return jsonResponse(204, null);
    }
    if (url.pathname === '/api/v1/payments/qr/generate/' && method === 'POST') {
      return jsonResponse(200, {
        qr_content: demoQrContent,
        display_name: currentUser.full_name,
        upi_id: `user${currentUser.id}@onepay`,
        currency: 'INR',
        mode: 'demo',
      });
    }
    if (url.pathname === '/api/v1/payments/qr/resolve/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { qr_content?: string };
      if (data.qr_content === demoQrContent) {
        return jsonResponse(200, {
          recipient_id: null,
          display_name: currentUser.full_name,
          upi_id: `user${currentUser.id}@onepay`,
          currency: 'INR',
          mode: 'demo',
          verified: true,
        });
      }
      return jsonResponse(400, { error: { status: 400, message: 'This OnePay QR is malformed, unsupported, or has been changed.', details: null } });
    }
    if (url.pathname === '/api/v1/payments/recipients/lookup/') {
      const upiId = url.searchParams.get('identifier')?.toLowerCase() ?? '';
      const saved = recipientStore.find((recipient) => recipient.upi_id === upiId);
      if (saved) return jsonResponse(200, saved);
      if (upiId === `user${currentUser.id}@onepay`) {
        return jsonResponse(200, { id: null, display_name: currentUser.full_name, upi_id: upiId, is_active: true, is_default: false });
      }
      if (upiId.endsWith('@onepay') || upiId.endsWith('@mock')) {
        const local = upiId.split('@')[0] ?? 'demo';
        return jsonResponse(200, { id: null, display_name: local.replace(/[._-]/g, ' '), upi_id: upiId, is_active: true, is_default: false });
      }
      return jsonResponse(404, { error: { status: 404, message: 'Recipient not found.', details: null } });
    }
    if (url.pathname === '/api/v1/notifications/' && method === 'GET') {
      if (notificationFailuresRemaining > 0) {
        notificationFailuresRemaining -= 1;
        const failureStatus = options.notificationFailureStatus ?? 503;
        return jsonResponse(failureStatus, { error: { status: failureStatus, message: 'Notification service temporarily unavailable.', details: null } });
      }
      const category = url.searchParams.get('category') ?? '';
      const readFilter = url.searchParams.get('read');
      const fromDate = url.searchParams.get('date_from') ?? '';
      const toDate = url.searchParams.get('date_to') ?? '';
      const includeDismissed = url.searchParams.get('include_dismissed') === 'true';
      const matched = getNotifications().filter((notice) => {
        const createdDate = notice.created_at.slice(0, 10);
        return (includeDismissed || !notice.dismissed)
          && (!category || notice.category === category)
          && (readFilter === null || notice.read === (readFilter === 'true'))
          && (!fromDate || createdDate >= fromDate)
          && (!toDate || createdDate <= toDate);
      });
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('page_size') ?? 20);
      const totalPages = matched.length ? Math.ceil(matched.length / pageSize) : 0;
      return jsonResponse(200, {
        count: matched.length, page, page_size: pageSize, total_pages: totalPages,
        has_next: page < totalPages, has_previous: page > 1,
        results: matched.slice((page - 1) * pageSize, page * pageSize),
      });
    }
    if (url.pathname === '/api/v1/notifications/unread-count/' && method === 'GET') {
      return jsonResponse(200, { unread_count: getNotifications().filter((notice) => !notice.read && !notice.dismissed).length });
    }
    if (url.pathname === '/api/v1/notifications/read-all/' && method === 'POST') {
      const store = getNotifications();
      const active = store.filter((notice) => !notice.dismissed);
      active.forEach((notice) => { notice.read = true; });
      return jsonResponse(200, { updated: active.length, unread_count: 0 });
    }
    if (url.pathname === '/api/v1/notifications/dismiss-all/' && method === 'POST') {
      const store = getNotifications();
      const active = store.filter((notice) => !notice.dismissed);
      active.forEach((notice) => { notice.dismissed = true; });
      return jsonResponse(200, { updated: active.length, unread_count: store.filter((notice) => !notice.read && !notice.dismissed).length });
    }
    const notificationAction = url.pathname.match(/^\/api\/v1\/notifications\/([^/]+)\/(read|dismiss)\/$/);
    if (notificationAction && method === 'POST') {
      const notificationId = decodeURIComponent(notificationAction[1] ?? '');
      const notice = getNotifications().find((item) => item.id === notificationId);
      if (!notice) return jsonResponse(404, { error: { status: 404, message: 'Notification not found.', details: null } });
      if (notificationAction[2] === 'read') notice.read = true;
      else notice.dismissed = true;
      return jsonResponse(200, {
        ...(notificationAction[2] === 'read' ? { notification: notice } : { dismissed: true }),
        unread_count: getNotifications().filter((item) => !item.read && !item.dismissed).length,
      });
    }
    if (url.pathname === '/api/v1/payments/transactions/history/' && method === 'GET') {
      if (historyFailuresRemaining > 0) {
        historyFailuresRemaining -= 1;
        const failureStatus = options.historyFailureStatus ?? 503;
        return jsonResponse(failureStatus, { error: { status: failureStatus, message: 'Demo history service temporarily unavailable.', details: null } });
      }
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const statusFilter = url.searchParams.get('status') ?? '';
      const category = url.searchParams.get('category') ?? '';
      const direction = url.searchParams.get('direction') ?? '';
      const fromDate = url.searchParams.get('date_from') ?? '';
      const toDate = url.searchParams.get('date_to') ?? '';
      const minimum = url.searchParams.has('min_amount_minor') ? Number(url.searchParams.get('min_amount_minor')) : undefined;
      const maximum = url.searchParams.has('max_amount_minor') ? Number(url.searchParams.get('max_amount_minor')) : undefined;
      const matched = transactions.filter((transaction) => {
        const text = `${transaction.recipient_name} ${transaction.recipient_identifier} ${transaction.note} ${transaction.service} ${transaction.reference}`.toLowerCase();
        const credit = transaction.kind === 'topup' || transaction.status === 'reversed';
        const createdDate = transaction.created_at.slice(0, 10);
        return (!search || text.includes(search))
          && (!statusFilter || transaction.status === statusFilter)
          && (!category || transaction.kind === category)
          && (!direction || (direction === 'credit' ? credit : !credit))
          && (!fromDate || createdDate >= fromDate)
          && (!toDate || createdDate <= toDate)
          && (minimum === undefined || transaction.amount_minor >= minimum)
          && (maximum === undefined || transaction.amount_minor <= maximum);
      });
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('page_size') ?? 10);
      const totalPages = matched.length ? Math.ceil(matched.length / pageSize) : 0;
      const results = matched.slice((page - 1) * pageSize, page * pageSize);
      return jsonResponse(200, {
        count: matched.length, page, page_size: pageSize, total_pages: totalPages,
        has_next: page < totalPages, has_previous: page > 1, results,
      });
    }
    if (url.pathname === '/api/v1/payments/transactions/' && method === 'GET') return jsonResponse(200, transactions);
    if (url.pathname === '/api/v1/payments/transactions/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { kind: ApiTransaction['kind']; amount_minor: number; recipient_id?: number; upi_id?: string; qr_content?: string; service?: string; provider?: string; plan_code?: string; recipient_reference?: string; note?: string };
      const requestKey = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'] ?? '';
      const existing = idempotentTransactions.get(requestKey);
      if (existing) return jsonResponse(200, existing);
      const isQrTransfer = data.qr_content === demoQrContent;
      const savedRecipient = data.recipient_id ? recipientStore.find((recipient) => recipient.id === data.recipient_id) : undefined;
      const title = data.kind === 'transfer' ? isQrTransfer ? currentUser.full_name : savedRecipient?.display_name ?? recipientStore.find((recipient) => recipient.upi_id === data.upi_id)?.display_name ?? data.upi_id ?? 'Demo recipient'
        : data.kind === 'topup' ? 'OnePay Demo Wallet' : data.provider ?? `OnePay Mock ${data.service ?? 'Utility'}`;
      const identifier = isQrTransfer ? `user${currentUser.id}@onepay` : data.upi_id ?? savedRecipient?.upi_id ?? (data.recipient_reference ? `Ending ${data.recipient_reference.replace(/\D/g, '').slice(-4)}` : '');
      const status: ApiTransaction['status'] = data.kind !== 'transfer' && identifier === 'Ending 0000' ? 'failed'
        : data.kind !== 'transfer' && identifier === 'Ending 9999' ? 'pending' : 'successful';
      const reference = `OPW-${String(transactions.length + 1).padStart(32, '0')}`;
      const created = makeTransaction({
        id: `tx-${transactions.length + 1}`, reference,
        recipient_id: data.kind === 'transfer' ? isQrTransfer ? null : data.recipient_id ?? savedRecipient?.id ?? null : null,
        recipient_name: title,
        recipient_identifier: identifier,
        kind: data.kind, service: data.service ?? '', note: data.note ?? (data.plan_code ? `Mock plan ${data.plan_code.endsWith('b') ? 'B' : 'A'} · illustrative mock plan` : ''), amount_minor: data.amount_minor,
        status, status_history: [
          { from_status: null, to_status: 'pending', reason: 'Accepted for demo processing.', created_at: now },
          ...(status === 'pending' ? [] : [{ from_status: 'pending', to_status: status, reason: status === 'failed' ? 'Local simulator declined it.' : 'Local simulator.', created_at: now }]),
        ] as ApiTransaction['status_history'],
      });
      transactions.unshift(created);
      if (requestKey) idempotentTransactions.set(requestKey, created);
      recordTransactionNotification(created);
      return jsonResponse(200, created);
    }
    if (url.pathname === '/api/v1/payments/wallet/topups/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { amount_minor: number };
      const requestKey = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'] ?? '';
      const existing = idempotentTransactions.get(requestKey);
      if (existing) return jsonResponse(200, existing);
      const topup = makeTransaction({
        id: `tx-topup-${transactions.length}`, reference: `OPW-${String(transactions.length + 10).padStart(32, '0')}`,
        recipient_name: 'OnePay Demo Wallet', recipient_id: null, recipient_identifier: '', kind: 'topup', service: '', amount_minor: data.amount_minor, status: 'successful',
      });
      transactions.unshift(topup);
      if (requestKey) idempotentTransactions.set(requestKey, topup);
      recordTransactionNotification(topup);
      return jsonResponse(200, topup);
    }
    const routeMatch = url.pathname.match(/^\/api\/v1\/payments\/transactions\/([^/]+)\//);
    if (routeMatch) {
      const reference = decodeURIComponent(routeMatch[1] ?? '');
      const current = transactions.find((item) => item.reference === reference) ?? makeTransaction({ reference });
      if (url.pathname.endsWith('/receipt/')) return jsonResponse(200, { transaction: current, notice: 'This is a OnePay simulated transaction receipt. No real money was transferred.' });
      if (url.pathname.endsWith('/status/')) return jsonResponse(200, { reference, status: current.status, updated_at: now, completed_at: current.completed_at });
      return jsonResponse(200, current);
    }
    throw new Error(`Unexpected OnePay API endpoint: ${method} ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <DemoProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </DemoProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function RepeatedPaymentHarness() {
  const { recordDemoPayment, notifications, paymentDataLoading } = useDemo();
  const repeats = async () => {
    const payment = {
      kind: 'bill' as const, service: 'electricity', provider: 'OnePay Mock Electricity',
      recipientReference: 'EB-483920', amountPaise: 5_000, idempotencyKey: 'repeat-bill-key-0001',
    };
    await recordDemoPayment(payment);
    await recordDemoPayment(payment);
  };
  const alertCount = notifications.filter((notification) => notification.eventType === 'bill.successful').length;
  return <><button type="button" disabled={paymentDataLoading} onClick={() => void repeats()}>Repeat same simulated bill</button><p>Outcome notifications: {alertCount}</p></>;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('application routes', () => {
  it.each([
    ['/', /Good (morning|afternoon|evening), Ananya/],
    ['/send', 'Send money'],
    ['/scan', 'Scan QR'],
    ['/transactions', 'Transaction history'],
    ['/transactions/OPW-HISTORY-ROHAN', 'Transaction details'],
    ['/transactions/OPW-HISTORY-ROHAN/receipt', 'Transaction receipt'],
    ['/recipients', 'Manage recipients'],
    ['/bills', 'Recharge & bills'],
    ['/profile', 'Profile & settings'],
    ['/notifications', 'Notifications'],
    ['/help', 'Help & support'],
    ['/route-that-does-not-exist', 'This page took a wrong turn.'],
  ])('renders %s', async (path, heading) => {
    installMockApi();
    renderRoute(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('does not offer customer reversal and keeps the receipt action on completed payments', async () => {
    installMockApi();
    renderRoute('/transactions/OPW-HISTORY-ROHAN');
    expect(await screen.findByRole('heading', { name: 'Transaction details' })).toBeInTheDocument();
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('OPW-HISTORY-ROHAN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reverse demo payment/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }));
    expect(await screen.findByRole('heading', { name: 'Transaction receipt' })).toBeInTheDocument();
    expect(await screen.findByText('This is a OnePay simulated transaction receipt. No real money was transferred.')).toBeInTheDocument();
    expect(screen.getByText('OPW-HISTORY-ROHAN')).toBeInTheDocument();
  });

  it('shows check indicators for successful and internally reversed history events', async () => {
    installMockApi();
    const { container } = renderRoute('/transactions/OPW-HISTORY-KAVYA');
    expect(await screen.findByRole('heading', { name: 'Transaction details' })).toBeInTheDocument();
    const successfulIndicator = container.querySelector('.timeline-event.status-successful .timeline-dot svg');
    const reversedIndicator = container.querySelector('.timeline-event.status-reversed .timeline-dot svg');

    expect(successfulIndicator?.getAttribute('class')).toMatch(/\blucide-check\b/);
    expect(reversedIndicator?.getAttribute('class')).toMatch(/\blucide-check\b/);
    expect(container.querySelector('.transaction-detail-status strong')).toHaveTextContent('Reversed');
  });

  it('navigates to Send money from the main navigation', async () => {
    installMockApi();
    renderRoute('/');
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Ananya/ });
    const mainNav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(mainNav).getByRole('link', { name: /Send money/ }));
    expect(await screen.findByRole('heading', { name: 'Send money' })).toBeInTheDocument();
  });

  it('shows client-side validation before opening payment review', async () => {
    installMockApi();
    renderRoute('/send');
    await screen.findByRole('heading', { name: 'Send money' });
    fireEvent.click(screen.getByRole('button', { name: 'Review demo payment' }));
    expect(screen.getByText(/Enter a mock OnePay UPI ID/)).toBeInTheDocument();
    expect(screen.getByText('Enter an amount greater than ₹0.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves, reviews, and sends a backend-authoritative simulated payment', async () => {
    const fetchMock = installMockApi();
    renderRoute('/send');
    await screen.findByRole('heading', { name: 'Send money' });
    fireEvent.change(screen.getByLabelText('Mock UPI ID'), { target: { value: 'rohan@okaxis' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Review demo payment' })).toBeInTheDocument();
    expect(screen.getByText('Rohan Mehta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo payment recorded' })).toBeInTheDocument();
    expect(screen.getByText(/Simulated only · no real money moved/)).toBeInTheDocument();
    const paymentCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes('/payments/transactions/') && init?.method === 'POST');
    expect(paymentCall).toBeDefined();
    const options = paymentCall?.[1];
    expect(options?.credentials).toBe('include');
    const requestHeaders = options?.headers as Record<string, string>;
    expect(requestHeaders['X-CSRFToken']).toBe('test-csrf-token');
    expect(requestHeaders['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.parse(String(options?.body))).toMatchObject({ kind: 'transfer', recipient_id: 1, amount_minor: 12_500, note: '' });
    expect(JSON.parse(String(options?.body))).not.toHaveProperty('balance_minor');
  });

  it('records a recharge through the backend without persisting a full subscriber ID', async () => {
    const fetchMock = installMockApi();
    renderRoute('/bills');
    await screen.findByRole('heading', { name: 'Recharge & bills' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recharge' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('Amount in rupees'), { target: { value: '199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review recharge' }));
    expect(await screen.findByRole('dialog', { name: 'Review demo payment' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo activity recorded' })).toBeInTheDocument();
    expect(screen.getByText('Simulated only · no provider was contacted')).toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([input, init]) => String(input).includes('/payments/transactions/') && init?.method === 'POST')?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ kind: 'recharge', service: 'mobile', amount_minor: 19_900 });
    expect(screen.getByText(/Ending 3210/)).toBeInTheDocument();
  });

  it('deduplicates backend outcome notifications when the server replays an idempotent request', async () => {
    const fetchMock = installMockApi();
    render(<AuthProvider><DemoProvider><ToastProvider><RepeatedPaymentHarness /></ToastProvider></DemoProvider></AuthProvider>);
    const repeatButton = screen.getByRole('button', { name: 'Repeat same simulated bill' });
    await waitFor(() => expect(repeatButton).toBeEnabled());
    fireEvent.click(repeatButton);
    expect(await screen.findByText('Outcome notifications: 1')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')).toHaveLength(2));
    const posts = fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST');
    const firstHeaders = posts[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = posts[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders['Idempotency-Key']).toBe('repeat-bill-key-0001');
    expect(secondHeaders['Idempotency-Key']).toBe(firstHeaders['Idempotency-Key']);
  });

  it('shows a failed bill outcome and adds an in-app notification', async () => {
    installMockApi();
    renderRoute('/bills');
    await screen.findByRole('heading', { name: 'Recharge & bills' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recharge' })).toBeEnabled());
    fireEvent.click(screen.getByRole('tab', { name: 'Electricity' }));
    fireEvent.change(screen.getByLabelText('Consumer / subscriber ID'), { target: { value: 'EB-0000' } });
    fireEvent.change(screen.getByLabelText('Amount in rupees'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review bill' }));
    const review = await screen.findByRole('dialog', { name: 'Review demo payment' });
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo activity failed' })).toBeInTheDocument();
    expect(screen.getByText('Not debited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getAllByRole('link', { name: /Notifications/ })[0]!);
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('Bill payment failed')).toBeInTheDocument();
    expect(screen.getByText(/local simulation declined it and refunded/)).toBeInTheDocument();
  });

  it('records an additional mock bill type through the shared transaction endpoint', async () => {
    const fetchMock = installMockApi();
    renderRoute('/bills');
    await screen.findByRole('heading', { name: 'Recharge & bills' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recharge' })).toBeEnabled());
    fireEvent.click(screen.getByRole('tab', { name: 'Other' }));
    fireEvent.change(screen.getByLabelText('Consumer / subscriber ID'), { target: { value: 'OTH-4839' } });
    fireEvent.change(screen.getByLabelText('Amount in rupees'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review bill' }));
    const review = await screen.findByRole('dialog', { name: 'Review demo payment' });
    expect(within(review).getByText('Other bill')).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo activity recorded' })).toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      kind: 'bill', service: 'other', provider: 'OnePay Mock Utility', amount_minor: 12_500,
    });
  });

  it('selects a mock mobile operator and server-validated plan before review', async () => {
    const fetchMock = installMockApi();
    renderRoute('/bills');
    await screen.findByRole('heading', { name: 'Recharge & bills' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review recharge' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Mock mobile operator'), { target: { value: 'OnePay Mock Mobile Beta' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: /Choose a mock plan/ }));
    const plans = await screen.findByRole('dialog', { name: 'Choose a mock plan' });
    expect(within(plans).getByText(/Illustrative examples only/)).toBeInTheDocument();
    fireEvent.click(within(plans).getByRole('button', { name: 'Select Mock plan B for ₹499.00' }));
    expect(screen.getByLabelText('Amount in rupees')).toHaveValue(499);
    fireEvent.click(screen.getByRole('button', { name: 'Review recharge' }));
    const review = await screen.findByRole('dialog', { name: 'Review demo payment' });
    expect(within(review).getByText('OnePay Mock Mobile Beta')).toBeInTheDocument();
    expect(within(review).getByText('Mock plan B · fictional example')).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo activity recorded' })).toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      kind: 'recharge', service: 'mobile', provider: 'OnePay Mock Mobile Beta',
      plan_code: 'mobile-beta-example-b', amount_minor: 49_900,
    });
    expect(JSON.stringify(window.localStorage)).not.toContain('9876543210');
  });

  it('adds demo funds through an idempotent backend top-up request', async () => {
    const fetchMock = installMockApi();
    renderRoute('/');
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Ananya/ });
    fireEvent.click(screen.getByRole('button', { name: 'Add demo funds' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add demo funds' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add demo funds' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/wallet/topups/') && init?.method === 'POST')).toBe(true));
    const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/payments/wallet/topups/') && init?.method === 'POST')?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ amount_minor: 100_000 });
    expect((request?.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('verifies a signed demo QR but never starts a payment just by scanning', async () => {
    const fetchMock = installMockApi();
    renderRoute('/scan');
    await screen.findByRole('heading', { name: 'Scan QR' });
    fireEvent.click(screen.getByRole('button', { name: 'Try a verified demo QR' }));
    expect(await screen.findByText('Verified OnePay demo profile · no payment sent')).toBeInTheDocument();
    expect(screen.getAllByText('Ananya Sharma').length).toBeGreaterThan(0);
    expect(screen.getByText('user1@onepay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')).toBe(false);
  });

  it('handles camera permission denial and preserves manual recipient verification', async () => {
    const fetchMock = installMockApi();
    const testNavigator = Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia: vi.fn() } });
    vi.stubGlobal('navigator', testNavigator);
    vi.spyOn(BrowserQRCodeReader.prototype, 'decodeFromVideoDevice').mockRejectedValue(new DOMException('Camera permission denied', 'NotAllowedError'));
    renderRoute('/scan');
    await screen.findByRole('heading', { name: 'Scan QR' });
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(await screen.findByText(/Camera permission was declined/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Recipient identifier'), { target: { value: 'user1@onepay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify recipient' }));
    expect(await screen.findByText('Ananya Sharma')).toBeInTheDocument();
    expect(screen.getByText('user1@onepay')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')).toBe(false);
  });

  it('passes a validated QR through review and submits it only after explicit confirmation', async () => {
    const fetchMock = installMockApi();
    renderRoute('/scan');
    await screen.findByRole('heading', { name: 'Scan QR' });
    fireEvent.click(screen.getByRole('button', { name: 'Try a verified demo QR' }));
    await screen.findByText('Verified OnePay demo profile · no payment sent');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Send money' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review demo payment' }));
    const review = await screen.findByRole('dialog', { name: 'Review demo payment' });
    expect(within(review).getByText('Verified OnePay demo profile')).toBeInTheDocument();
    expect(within(review).getByText('Ananya Sharma')).toBeInTheDocument();
    expect(within(review).getByText('user1@onepay')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')).toBe(false);

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm demo payment' }));
    expect(await screen.findByRole('dialog', { name: 'Demo payment recorded' })).toBeInTheDocument();
    const paymentCall = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST');
    const payload = JSON.parse(String(paymentCall?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ kind: 'transfer', qr_content: demoQrContent, amount_minor: 5_000 });
    expect(payload).not.toHaveProperty('upi_id');
    expect(payload).not.toHaveProperty('recipient_id');
  });

  it('allows cancelling a reviewed payment without initiating a simulator request', async () => {
    const fetchMock = installMockApi();
    renderRoute('/send');
    await screen.findByRole('heading', { name: 'Send money' });
    fireEvent.change(screen.getByLabelText('Mock UPI ID'), { target: { value: 'rohan@okaxis' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review demo payment' }));
    const review = await screen.findByRole('dialog', { name: 'Review demo payment' });
    fireEvent.click(within(review).getByRole('button', { name: 'Cancel payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review demo payment' })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/transactions/') && init?.method === 'POST')).toBe(false);
  });

  it('can filter the server-backed transaction history to credits and reversals', async () => {
    installMockApi();
    renderRoute('/transactions');
    await screen.findByRole('heading', { name: 'Transaction history' });
    await screen.findByRole('button', { name: /Rohan Mehta/ });
    fireEvent.click(screen.getByRole('button', { name: 'Received' }));
    expect(await screen.findByRole('button', { name: /Kavya Iyer/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Rohan Mehta/ })).not.toBeInTheDocument());
  });

  it('filters transaction history by status, category, dates, amount, and search text', async () => {
    installMockApi();
    renderRoute('/transactions');
    await screen.findByRole('button', { name: /OnePay Mock Electricity/ });

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'reversed' } });
    expect(await screen.findByRole('button', { name: /Kavya Iyer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rohan Mehta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /OnePay Mock Electricity/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'bill' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-15' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-15' } });
    fireEvent.change(screen.getByLabelText('Minimum amount'), { target: { value: '300' } });
    expect(await screen.findByRole('button', { name: /OnePay Mock Electricity/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rohan Mehta/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transactions' }), { target: { value: 'OPW-HISTORY-BILL' } });
    expect(await screen.findByText('1 entry match · most recent first')).toBeInTheDocument();
  });

  it('paginates server history', async () => {
    const entries = Array.from({ length: 11 }, (_, index) => makeTransaction({
      id: `tx-page-${index}`, reference: `OPW-PAGE-${index}`, recipient_name: `History User ${index}`,
      created_at: new Date(Date.UTC(2026, 9, 15, 12, index)).toISOString(),
    }));
    installMockApi({ transactions: entries });
    renderRoute('/transactions');
    expect(await screen.findByText('Showing 1–10 of 11')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /History User 10/ })).toBeInTheDocument();
  });

  it('shows an empty-history state when the account has no transactions', async () => {
    installMockApi({ transactions: [] });
    renderRoute('/transactions');
    expect(await screen.findByRole('heading', { name: 'No activity yet' })).toBeInTheDocument();
    expect(screen.getByText(/Demo activity will appear here/)).toBeInTheDocument();
  });

  it('shows a retry action when transaction history cannot be loaded', async () => {
    const retryMock = installMockApi({ historyFailures: 1 });
    renderRoute('/transactions');
    const error = await screen.findByRole('alert');
    expect(within(error).getByText('History unavailable')).toBeInTheDocument();
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Rohan Mehta/ })).toBeInTheDocument();
    expect(retryMock.mock.calls.filter(([input]) => String(input).includes('/transactions/history/')).length).toBeGreaterThanOrEqual(2);
  });

  it('does not render history entries when the history API denies access', async () => {
    installMockApi({ historyFailures: 1, historyFailureStatus: 401 });
    renderRoute('/transactions');
    expect(await screen.findByText('Your session expired. Sign in again to view your transaction history.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rohan Mehta|Kavya Iyer/ })).not.toBeInTheDocument();
  });

  it('creates a saved recipient through the account API', async () => {
    const fetchMock = installMockApi();
    renderRoute('/recipients');
    await screen.findByRole('heading', { name: 'Manage recipients' });
    expect(screen.queryByRole('button', { name: 'Choose from contacts' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Lee Morgan' } });
    fireEvent.change(screen.getByLabelText('Mock UPI ID'), { target: { value: 'lee@onepay' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add a demo recipient' })).getByRole('button', { name: 'Add recipient' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/recipients/') && init?.method === 'POST')).toBe(true));
    expect(await screen.findByText('lee@onepay')).toBeInTheDocument();
  });

  it('opens browser Contacts only after the user opts in and keeps the ID editable', async () => {
    const fetchMock = installMockApi();
    const select = vi.fn().mockResolvedValue([{ name: ['Lee Morgan'], email: ['lee@onepay'] }]);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { contacts: { select } }));
    renderRoute('/recipients');
    await screen.findByRole('heading', { name: 'Manage recipients' });
    const chooseContact = screen.getByRole('button', { name: 'Choose from contacts' });
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(chooseContact);
    const dialog = await screen.findByRole('dialog', { name: 'Add a demo recipient' });
    expect(select).toHaveBeenCalledWith(['name', 'email'], { multiple: false });
    expect(screen.getByLabelText('Display name')).toHaveValue('Lee Morgan');
    expect(screen.getByLabelText('Mock UPI ID')).toHaveValue('lee@onepay');
    expect(screen.getByText(/Review them before saving/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Mock UPI ID'), { target: { value: 'lee.manual@onepay' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add recipient' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/recipients/') && init?.method === 'POST')).toBe(true));
    const creation = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/payments/recipients/') && init?.method === 'POST')?.[1];
    expect(JSON.parse(String(creation?.body))).toEqual({ display_name: 'Lee Morgan', upi_id: 'lee.manual@onepay' });
  });

  it('loads persisted notifications, displays the unread count, saves reads, and navigates internally', async () => {
    const notification = makeNotification({ title: 'Persisted payment update' });
    const alreadyRead = makeNotification({
      id: '00000000-0000-4000-8000-000000000002',
      event_type: 'security.login_successful', category: 'security', title: 'Previous sign-in',
      navigation_target: '/profile', related_transaction_reference: null, read: true,
    });
    const fetchMock = installMockApi({ notifications: [notification, alreadyRead] });
    const view = renderRoute('/notifications');

    expect(await screen.findByText('Persisted payment update')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Notifications, 1 unread' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open notification: Persisted payment update' }));
    expect(await screen.findByRole('heading', { name: 'Transaction details' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Notifications' })[0]!).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith(`/${notification.id}/read/`) && init?.method === 'POST')).toBe(true);

    view.unmount();
    renderRoute('/notifications');
    expect(await screen.findByText('Persisted payment update')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Notifications' })[0]!).toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('persists mark-all-read and single/all dismissal through the notification API', async () => {
    const first = makeNotification({ title: 'First stored update' });
    const second = makeNotification({ id: '00000000-0000-4000-8000-000000000002', title: 'Second stored update' });
    const fetchMock = installMockApi({ notifications: [first, second] });
    renderRoute('/notifications');
    expect(await screen.findByText('First stored update')).toBeInTheDocument();
    expect(screen.getByText('Second stored update')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/notifications/read-all/') && init?.method === 'POST')).toBe(true));
    expect(await screen.findByText('Everything has been read')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification: First stored update' }));
    await waitFor(() => expect(screen.queryByText('First stored update')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith(`/${first.id}/dismiss/`) && init?.method === 'POST')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all notifications' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dismiss all notifications?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss all' }));
    expect(await screen.findByRole('heading', { name: 'You’re all caught up' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/notifications/dismiss-all/') && init?.method === 'POST')).toBe(true);
  });

  it('filters and paginates notifications using backend query parameters', async () => {
    const notices = Array.from({ length: 22 }, (_, index) => makeNotification({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: `Stored update ${String(index + 1).padStart(2, '0')}`,
      category: index === 21 ? 'system' : 'payment',
      event_type: index === 21 ? 'system.announcement' : 'payment.successful',
      navigation_target: index === 21 ? '/help' : `/transactions/OPW-${'A'.repeat(32)}`,
      related_transaction_reference: index === 21 ? null : `OPW-${'A'.repeat(32)}`,
    }));
    const fetchMock = installMockApi({ notifications: notices });
    renderRoute('/notifications');
    expect(await screen.findByText('22 notifications · page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Stored update 01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('22 notifications · page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Stored update 22')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter notifications by category'), { target: { value: 'system' } });
    expect(await screen.findByText('Stored update 22')).toBeInTheDocument();
    expect(await screen.findByText('1 notification · page 1 of 1')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('category=system'))).toBe(true);
  });

  it('shows a retry state when persisted notifications fail to load', async () => {
    const fetchMock = installMockApi({ notificationFailures: 1 });
    renderRoute('/notifications');
    const error = await screen.findByRole('alert');
    expect(within(error).getByText('Notification service temporarily unavailable.')).toBeInTheDocument();
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'You’re all caught up' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/v1/notifications/?')).length).toBeGreaterThanOrEqual(2);
  });

  it('does not navigate to an untrusted notification URL', async () => {
    const unsafe = makeNotification({
      title: 'Untrusted destination', navigation_target: 'https://attacker.example/collect',
      related_transaction_reference: null,
    });
    installMockApi({ notifications: [unsafe] });
    renderRoute('/notifications');
    expect(await screen.findByText('Untrusted destination')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open notification: Untrusted destination' }));
    expect(await screen.findByText('This notification destination is no longer available.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows a backend notification after a real profile change', async () => {
    installMockApi();
    renderRoute('/profile');
    expect(await screen.findByRole('heading', { name: 'Profile & settings' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ananya New Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Account name saved · UPI ID kept in session')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('link', { name: 'Notifications, 1 unread' })[0]!);
    expect(await screen.findByText('Profile updated')).toBeInTheDocument();
    expect(screen.getByText('Your OnePay account display name was updated.')).toBeInTheDocument();
  });

  it('clears one account’s notifications after logout and account switch', async () => {
    const privateNotice = makeNotification({ title: 'Private account one update' });
    installMockApi({ notifications: [privateNotice], notificationsByUser: { 2: [] } });
    renderRoute('/notifications');
    expect(await screen.findByText('Private account one update')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to OnePay' })).toBeInTheDocument();
    expect(screen.queryByText('Private account one update')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: otherAccountUser.email } });
    fireEvent.change(screen.getByLabelText('OnePay account password'), { target: { value: 'OnePay!SecurePass2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findAllByRole('link', { name: 'Notifications, 1 unread' })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('link', { name: 'Notifications, 1 unread' })[0]!);
    expect(await screen.findByText('Successful sign-in to OnePay')).toBeInTheDocument();
    expect(screen.queryByText('Private account one update')).not.toBeInTheDocument();
  });
});
