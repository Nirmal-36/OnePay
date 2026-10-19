import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SpendingInsightsPage from './SpendingInsightsPage';
import { analyticsApi, type SpendingSummary, type SpendingTransactionsPage } from '../api/analytics';

vi.mock('../api/analytics', () => ({
  analyticsApi: {
    summary: vi.fn(),
    transactions: vi.fn(),
  },
}));

const summaryFixture: SpendingSummary = {
  period: { key: 'this_month', start_date: '2026-10-01', end_date: '2026-10-19', days: 19 },
  total_spending_minor: 157500,
  average_daily_spending_minor: 8289,
  transaction_count: 3,
  money_received_minor: null,
  net_cash_flow_minor: null,
  income_data_available: false,
  income_unavailable_reason: 'Incoming transfers are not recorded.',
  demo_topups_minor: 100000,
  demo_topup_count: 1,
  largest_expense: {
    reference: 'OPW-FOOD-LARGE', recipient_name: 'Zomato', amount_minor: 90000,
    created_at: '2026-10-14T11:00:00Z', category: 'Food and Dining',
  },
  highest_category: { category: 'Food and Dining', amount_minor: 100000, transaction_count: 2, percentage: 63.5 },
  categories: [
    { category: 'Food and Dining', amount_minor: 100000, transaction_count: 2, percentage: 63.5 },
    { category: 'Bills and Utilities', amount_minor: 57500, transaction_count: 1, percentage: 36.5 },
  ],
  daily_trend: [
    { date: '2026-10-18', amount_minor: 57500 },
    { date: '2026-10-19', amount_minor: 100000 },
  ],
  excluded_activity: {
    pending: { count: 1, amount_minor: 3000 },
    failed: { count: 1, amount_minor: 2000 },
    reversed: { count: 0, amount_minor: 0 },
  },
  month_over_month: {
    current_period_start: '2026-10-01', current_period_end: '2026-10-19',
    comparison_start: '2026-09-01', comparison_end: '2026-09-19',
    current_total_minor: 157500, previous_total_minor: 120000,
    change_minor: 37500, change_percent: 31.3,
  },
  recent_transactions: [],
  categorization: {
    method: 'local_rules_and_transaction_metadata', external_ai_used: false,
    confidence_note: 'Heuristic rule strength only.',
  },
};

const transactionPageFixture: SpendingTransactionsPage = {
  period: { key: 'this_month', start_date: '2026-10-01', end_date: '2026-10-19' },
  count: 1, page: 1, page_size: 20, total_pages: 1, has_next: false, has_previous: false,
  results: [{
    reference: 'OPW-FOOD-0001', recipient_name: 'Local Cafe', kind: 'transfer', service: '', note: 'Coffee',
    amount_minor: 12500, currency: 'INR', status: 'successful', created_at: '2026-10-18T10:00:00Z',
    category: 'Food and Dining', subcategory: 'Food or dining', classification_method: 'merchant_rule',
    confidence: 0.86, source: 'simulated',
  }],
};

const mockedAnalyticsApi = vi.mocked(analyticsApi);

function renderPage() {
  return render(<MemoryRouter><SpendingInsightsPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAnalyticsApi.summary.mockResolvedValue(summaryFixture);
  mockedAnalyticsApi.transactions.mockResolvedValue(transactionPageFixture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpendingInsightsPage', () => {
  it('shows summary metrics and clearly separates unavailable income from spending', async () => {
    renderPage();

    expect(await screen.findByText('Total completed outflow')).toBeInTheDocument();
    expect(screen.getByText('Money received')).toBeInTheDocument();
    expect(screen.getByText('Not tracked')).toBeInTheDocument();
    expect(screen.getByText(/excluded from spending and income/i)).toBeInTheDocument();
    expect(screen.getByText(/Not tracked/i)).toBeInTheDocument();
    expect(mockedAnalyticsApi.summary).toHaveBeenCalledWith('this_month', expect.any(String), expect.any(String));
  });

  it('requests a new summary when the period changes', async () => {
    renderPage();
    await screen.findByText('Total completed outflow');

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'last_month' } });

    await waitFor(() => expect(mockedAnalyticsApi.summary).toHaveBeenCalledWith('last_month', expect.any(String), expect.any(String)));
  });

  it('uses a category click to request a scoped category transaction list', async () => {
    renderPage();
    const category = await screen.findByRole('button', { name: /Food and Dining/i });
    fireEvent.click(category);

    await waitFor(() => expect(mockedAnalyticsApi.transactions).toHaveBeenCalledWith('this_month', 'Food and Dining', expect.any(String), expect.any(String), 1));
    expect(category).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/OPW-FOOD-0001/)).toBeInTheDocument();
  });

  it('renders a clear empty state when the period has no expense activity', async () => {
    mockedAnalyticsApi.summary.mockResolvedValue({
      ...summaryFixture, total_spending_minor: 0, average_daily_spending_minor: 0, transaction_count: 0,
      categories: [], highest_category: null, largest_expense: null,
      daily_trend: [{ date: '2026-10-19', amount_minor: 0 }], recent_transactions: [],
    });
    mockedAnalyticsApi.transactions.mockResolvedValue({ ...transactionPageFixture, count: 0, total_pages: 0, results: [] });
    renderPage();

    expect(await screen.findByText('No spending data for this period')).toBeInTheDocument();
  });
});
