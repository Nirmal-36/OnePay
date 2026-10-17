import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiTransaction } from './api/payments';
import { DemoProvider } from './context/DemoProvider';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastProvider';
import AppRoutes from './AppRoutes';

const testUser = { id: 1, email: 'ananya@example.test', full_name: 'Ananya Sharma', date_joined: '2026-10-15T12:00:00Z' };
const now = '2026-10-15T12:00:00Z';
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
];

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => status === 204 ? '' : JSON.stringify(body),
}) as Response;

function installMockApi() {
  const transactions = [...mockTransactions];
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
    if (url.pathname === '/api/v1/payments/recipients/lookup/') {
      const upiId = url.searchParams.get('identifier')?.toLowerCase() ?? '';
      const saved = recipientStore.find((recipient) => recipient.upi_id === upiId);
      if (saved) return jsonResponse(200, saved);
      if (upiId.endsWith('@onepay') || upiId.endsWith('@mock')) {
        const local = upiId.split('@')[0] ?? 'demo';
        return jsonResponse(200, { id: null, display_name: local.replace(/[._-]/g, ' '), upi_id: upiId, is_active: true, is_default: false });
      }
      return jsonResponse(404, { error: { status: 404, message: 'Recipient not found.', details: null } });
    }
    if (url.pathname === '/api/v1/payments/transactions/' && method === 'GET') return jsonResponse(200, transactions);
    if (url.pathname === '/api/v1/payments/transactions/' && method === 'POST') {
      const data = JSON.parse(String(init?.body ?? '{}')) as { kind: ApiTransaction['kind']; amount_minor: number; upi_id?: string; service?: string; recipient_reference?: string; note?: string };
      const title = data.kind === 'transfer' ? recipientStore.find((recipient) => recipient.upi_id === data.upi_id)?.display_name ?? data.upi_id ?? 'Demo recipient'
        : data.kind === 'topup' ? 'OnePay Demo Wallet' : data.service === 'mobile' ? 'Demo Mobile' : `Demo ${data.service ?? 'bill'}`;
      const created = makeTransaction({
        id: `tx-${transactions.length + 1}`, reference: `OPW-TEST-${transactions.length + 1}`,
        recipient_id: data.kind === 'transfer' ? 1 : null,
        recipient_name: title,
        recipient_identifier: data.upi_id ?? (data.recipient_reference ? `Ending ${data.recipient_reference.replace(/\D/g, '').slice(-4)}` : ''),
        kind: data.kind, service: data.service ?? '', note: data.note ?? '', amount_minor: data.amount_minor,
        status: 'successful', status_history: [
          { from_status: null, to_status: 'pending', reason: 'Accepted for demo processing.', created_at: now },
          { from_status: 'pending', to_status: 'successful', reason: 'Local simulator.', created_at: now },
        ],
      });
      transactions.unshift(created);
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

afterEach(() => { vi.unstubAllGlobals(); });

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

  it('offers a working demo QR scan result', async () => {
    installMockApi();
    renderRoute('/scan');
    await screen.findByRole('heading', { name: 'Scan QR' });
    fireEvent.click(screen.getByRole('button', { name: 'Try a demo QR' }));
    expect(screen.getByText('QR details read')).toBeInTheDocument();
    expect(screen.getByText('arjun@okicici')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('can filter the server-backed transaction history to credits and reversals', async () => {
    installMockApi();
    renderRoute('/transactions');
    await screen.findByRole('heading', { name: 'Transaction history' });
    await screen.findByRole('button', { name: /Rohan Mehta/ });
    fireEvent.click(screen.getByRole('button', { name: 'Received' }));
    expect(screen.getByRole('button', { name: /Kavya Iyer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rohan Mehta/ })).not.toBeInTheDocument();
  });

  it('creates a saved recipient through the account API', async () => {
    const fetchMock = installMockApi();
    renderRoute('/recipients');
    await screen.findByRole('heading', { name: 'Manage recipients' });
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Lee Morgan' } });
    fireEvent.change(screen.getByLabelText('Mock UPI ID'), { target: { value: 'lee@onepay' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add a demo recipient' })).getByRole('button', { name: 'Add recipient' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/payments/recipients/') && init?.method === 'POST')).toBe(true));
    expect(await screen.findByText('lee@onepay')).toBeInTheDocument();
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
