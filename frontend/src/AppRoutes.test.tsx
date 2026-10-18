import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiTransaction } from './api/payments';
import { BrowserQRCodeReader } from '@zxing/browser';
import { DemoProvider, useDemo } from './context/DemoProvider';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastProvider';
import AppRoutes from './AppRoutes';

const testUser = { id: 1, email: 'ananya@example.test', full_name: 'Ananya Sharma', date_joined: '2026-10-15T12:00:00Z' };
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

function installMockApi(options: { historyFailures?: number; historyFailureStatus?: number; transactions?: ApiTransaction[] } = {}) {
  const transactions = [...(options.transactions ?? mockTransactions)];
  let historyFailuresRemaining = options.historyFailures ?? 0;
  const idempotentTransactions = new Map<string, ApiTransaction>();
  const recipientStore = sampleRecipients.map((recipient) => ({ ...recipient }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://onepay.test');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/v1/auth/me/') return jsonResponse(200, { user: testUser });
    if (url.pathname === '/api/v1/auth/csrf/') return jsonResponse(200, { csrfToken: 'test-csrf-token' });
    if (url.pathname === '/api/v1/payments/wallet/') return jsonResponse(200, { balance_minor: 2_458_000, currency: 'INR', updated_at: now });
    if (url.pathname === '/api/v1/payments/recipients/' && method === 'GET') return jsonResponse(200, recipientStore);
    if (url.pathname === '/api/v1/payments/recipients/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { display_name: string; upi_id: string };
      const recipient = { id: 99, display_name: data.display_name, upi_id: data.upi_id, is_default: false, created_at: now, updated_at: now };
      recipientStore.push(recipient);
      return jsonResponse(201, recipient);
    }
    if (url.pathname === '/api/v1/payments/qr/generate/' && method === 'POST') {
      return jsonResponse(200, {
        qr_content: demoQrContent,
        display_name: testUser.full_name,
        upi_id: `user${testUser.id}@onepay`,
        currency: 'INR',
        mode: 'demo',
      });
    }
    if (url.pathname === '/api/v1/payments/qr/resolve/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { qr_content?: string };
      if (data.qr_content === demoQrContent) {
        return jsonResponse(200, {
          recipient_id: null,
          display_name: testUser.full_name,
          upi_id: `user${testUser.id}@onepay`,
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
      if (upiId === `user${testUser.id}@onepay`) {
        return jsonResponse(200, { id: null, display_name: testUser.full_name, upi_id: upiId, is_active: true, is_default: false });
      }
      if (upiId.endsWith('@onepay') || upiId.endsWith('@mock')) {
        const local = upiId.split('@')[0] ?? 'demo';
        return jsonResponse(200, { id: null, display_name: local.replace(/[._-]/g, ' '), upi_id: upiId, is_active: true, is_default: false });
      }
      return jsonResponse(404, { error: { status: 404, message: 'Recipient not found.', details: null } });
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
      const title = data.kind === 'transfer' ? isQrTransfer ? testUser.full_name : savedRecipient?.display_name ?? recipientStore.find((recipient) => recipient.upi_id === data.upi_id)?.display_name ?? data.upi_id ?? 'Demo recipient'
        : data.kind === 'topup' ? 'OnePay Demo Wallet' : data.provider ?? `OnePay Mock ${data.service ?? 'Utility'}`;
      const identifier = isQrTransfer ? `user${testUser.id}@onepay` : data.upi_id ?? savedRecipient?.upi_id ?? (data.recipient_reference ? `Ending ${data.recipient_reference.replace(/\D/g, '').slice(-4)}` : '');
      const status: ApiTransaction['status'] = data.kind !== 'transfer' && identifier === 'Ending 0000' ? 'failed'
        : data.kind !== 'transfer' && identifier === 'Ending 9999' ? 'pending' : 'successful';
      const created = makeTransaction({
        id: `tx-${transactions.length + 1}`, reference: `OPW-TEST-${transactions.length + 1}`,
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
      return jsonResponse(200, created);
    }
    if (url.pathname === '/api/v1/payments/wallet/topups/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { amount_minor: number };
      const topup = makeTransaction({ id: `tx-topup-${transactions.length}`, reference: 'OPW-TEST-TOPUP', recipient_name: 'OnePay Demo Wallet', recipient_id: null, recipient_identifier: '', kind: 'topup', service: '', amount_minor: data.amount_minor, status: 'successful' });
      transactions.unshift(topup);
      return jsonResponse(200, topup);
    }
    const routeMatch = url.pathname.match(/^\/api\/v1\/payments\/transactions\/([^/]+)\//);
    if (routeMatch) {
      const reference = decodeURIComponent(routeMatch[1] ?? '');
      const current = transactions.find((item) => item.reference === reference) ?? makeTransaction({ reference });
      if (url.pathname.endsWith('/receipt/')) return jsonResponse(200, { transaction: current, notice: 'This is a OnePay simulated transaction receipt. No real money was transferred.' });
      if (url.pathname.endsWith('/status/')) return jsonResponse(200, { reference, status: current.status, updated_at: now, completed_at: current.completed_at });
      if (url.pathname.endsWith('/reverse/') && method === 'POST') {
        return jsonResponse(403, {
          detail: 'Customer-initiated transaction reversals are not permitted.',
        });
      }
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
  const { recordDemoPayment, notifications } = useDemo();
  const repeats = async () => {
    const payment = {
      kind: 'bill' as const, service: 'electricity', provider: 'OnePay Mock Electricity',
      recipientReference: 'EB-483920', amountPaise: 5_000, idempotencyKey: 'repeat-bill-key-0001',
    };
    await recordDemoPayment(payment);
    await recordDemoPayment(payment);
  };
  const alertCount = notifications.filter((notification) => notification.title === 'Demo bill payment completed').length;
  return <><button type="button" onClick={() => void repeats()}>Repeat same simulated bill</button><p>Outcome alerts: {alertCount}</p></>;
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

  it('deduplicates in-app outcome alerts when the server replays an idempotent request', async () => {
    const fetchMock = installMockApi();
    render(<AuthProvider><DemoProvider><ToastProvider><RepeatedPaymentHarness /></ToastProvider></DemoProvider></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Repeat same simulated bill' }));
    expect(await screen.findByText('Outcome alerts: 1')).toBeInTheDocument();
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
    expect(screen.getByText('Demo bill payment failed')).toBeInTheDocument();
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

  it('does not offer customer-initiated reversal for a transaction', async () => {
    const fetchMock = installMockApi();
    renderRoute('/transactions/OPW-HISTORY-ROHAN');

    await screen.findByRole('heading', { name: 'Transaction details' });

    expect(
      screen.queryByRole('button', { name: /reverse/i }),
    ).not.toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input).includes('/reverse/'),
      ),
    ).toBe(false);
  });
});
