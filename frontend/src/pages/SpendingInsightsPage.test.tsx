import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SpendingInsightsPage from './SpendingInsightsPage';
import { analyticsApi } from '../api/analytics';
import { ToastProvider } from '../context/ToastProvider';
import {
  anomaliesFixture,
  budgetsFixture,
  forecastFixture,
  goalsFixture,
  insightsFixture,
  reportFixture,
  summaryFixture,
  transactionsFixture,
} from '../test/analyticsFixtures';

vi.mock('../api/analytics', () => ({
  analyticsApi: {
    summary: vi.fn(),
    transactions: vi.fn(),
    meta: vi.fn(),
    insights: vi.fn(),
    forecast: vi.fn(),
    anomalies: vi.fn(),
    reportMonths: vi.fn(),
    report: vi.fn(),
    reportExportUrl: (year: number, month: number) => `/api/v1/analytics/reports/${year}/${month}/export.csv`,
    budgets: vi.fn(),
    goals: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    categoryDetail: vi.fn(),
    saveCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
}));

const mockedApi = vi.mocked(analyticsApi);

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SpendingInsightsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.summary.mockResolvedValue(summaryFixture);
  mockedApi.transactions.mockResolvedValue(transactionsFixture);
  mockedApi.meta.mockResolvedValue({
    categories: [{ name: 'Food and Dining', subcategories: ['Cafes and restaurants'], budgetable: true }],
    periods: [],
    categorization: {
      configured: false, consent: false, enabled_for_user: false, provider: null,
      data_sent: 'Merchant label with digits masked, payment kind, and amount band only.',
    },
    rules: [],
    privacy: 'Local rules first.',
    money_received: { income_tracking_available: false, reason: 'Incoming funds are not recorded.' },
  });
  mockedApi.insights.mockResolvedValue(insightsFixture);
  mockedApi.forecast.mockResolvedValue(forecastFixture);
  mockedApi.anomalies.mockResolvedValue(anomaliesFixture);
  mockedApi.reportMonths.mockResolvedValue({
    months: [
      { month: '2026-09', label: 'September 2026', has_data: true, transaction_count: 18, is_current: false },
      { month: '2026-10', label: 'October 2026', has_data: true, transaction_count: 3, is_current: true },
    ],
  });
  mockedApi.report.mockResolvedValue(reportFixture);
  mockedApi.budgets.mockResolvedValue(budgetsFixture);
  mockedApi.goals.mockResolvedValue({
    count: 1,
    goals: goalsFixture,
    summary: { active_goal_count: 1, total_target_minor: 10000000, total_saved_minor: 2500000, completed_count: 0 },
    note: 'Goal progress uses amounts you record.',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpendingInsightsPage', () => {
  it('shows actual spending and keeps unverified income clearly separate', async () => {
    renderPage();

    expect(await screen.findByText('Total completed outflow')).toBeInTheDocument();
    expect(screen.getAllByText('₹1,575.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Money received')).toBeInTheDocument();
    expect(screen.getByText('Not tracked')).toBeInTheDocument();
    expect(screen.getByText(/never counted as income/i)).toBeInTheDocument();
    expect(screen.getByText('Net cash flow')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/month-over-month/i)).toBeInTheDocument();
    expect(screen.getByText('+31.3%')).toBeInTheDocument();
    expect(mockedApi.summary).toHaveBeenCalledWith('this_month', expect.any(String), expect.any(String));
  });

  it('requests a fresh analysis when the period changes', async () => {
    renderPage();
    await screen.findByText('Total completed outflow');

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'last_month' } });

    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith('last_month', expect.any(String), expect.any(String)));
    expect(mockedApi.transactions).toHaveBeenCalledWith(expect.objectContaining({ period: 'last_month' }));
  });

  it('drills down from a category chart into filtered transactions', async () => {
    renderPage();
    const category = (await screen.findAllByRole('button', { name: /Food and Dining/i }))[0];
    fireEvent.click(category);

    await waitFor(() => expect(mockedApi.transactions).toHaveBeenCalledWith(expect.objectContaining({
      period: 'this_month',
      category: 'Food and Dining',
    })));
    expect(await screen.findByText(/OPW-FOOD-0001/)).toBeInTheDocument();
    expect(screen.getAllByText(/Food and Dining/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Filtered to/)).toBeInTheDocument();
  });

  it('searches the transaction table and passes the term to the API', async () => {
    renderPage();
    await screen.findByText('Total completed outflow');

    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'Zomato' } });

    await waitFor(() => expect(mockedApi.transactions).toHaveBeenCalledWith(expect.objectContaining({ search: 'Zomato' })), { timeout: 2000 });
  });

  it('renders a clear empty state when no eligible spending exists', async () => {
    mockedApi.summary.mockResolvedValue({
      ...summaryFixture,
      total_spending_minor: 0,
      consumption_spending_minor: 0,
      average_daily_spending_minor: 0,
      transaction_count: 0,
      active_spending_days: 0,
      categories: [],
      highest_category: null,
      largest_expense: null,
      top_merchants: [],
      recent_insights: [],
      recent_transactions: [],
      daily_trend: [{ date: '2026-10-19', amount_minor: 0, transaction_count: 0 }],
      monthly_trend: [],
      budget_overview: { ...budgetsFixture, overall: null, categories: [], warnings: [], consumption_spending_minor: 0, has_any_budget: false },
      budget_warnings: [],
    });
    mockedApi.transactions.mockResolvedValue({ ...transactionsFixture, count: 0, results: [], filtered_total_minor: 0, total_pages: 0 });

    renderPage();

    expect(await screen.findByText('No completed spending in this period')).toBeInTheDocument();
    expect(screen.getByText(/Only completed eligible payments appear here|No payments match these filters/i)).toBeInTheDocument();
  });

  it('loads evidence-backed patterns and a separate forecast', async () => {
    renderPage();
    await screen.findByText('Total completed outflow');
    fireEvent.click(screen.getByRole('tab', { name: /Patterns/i }));

    expect(await screen.findByText('Food and Dining accounts for 63% of spending')).toBeInTheDocument();
    expect(screen.getByText('Projected month total')).toBeInTheDocument();
    expect(screen.getByText('₹13,860.04')).toBeInTheDocument();
    expect(screen.getAllByText('Forecast').length).toBeGreaterThan(0);
    expect(screen.getByText(/Zomato was 4.5×/)).toBeInTheDocument();
    expect(mockedApi.insights).toHaveBeenCalledTimes(1);
    expect(mockedApi.forecast).toHaveBeenCalledTimes(1);
    expect(mockedApi.anomalies).toHaveBeenCalledTimes(1);
  });

  it('shows a monthly report with honest income treatment and a CSV action', async () => {
    renderPage();
    await screen.findByText('Total completed outflow');
    fireEvent.click(screen.getByRole('tab', { name: /Monthly report/i }));

    expect(await screen.findByText('Your month in review')).toBeInTheDocument();
    expect(screen.getByText(/18 completed payments totalling ₹12,000.00/)).toBeInTheDocument();
    expect(screen.getByText('Verified income')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.getByText('Demo funds added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
    expect(mockedApi.report).toHaveBeenCalledWith(2026, 10);
  });

  it('downloads the report CSV using the selected month', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['section,label'], { type: 'text/csv' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:report') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    await screen.findByText('Total completed outflow');
    fireEvent.click(screen.getByRole('tab', { name: /Monthly report/i }));
    await screen.findByText('Your month in review');

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/analytics/reports/2026/10/export.csv',
      expect.objectContaining({ credentials: 'same-origin' }),
    ));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('shows budget utilization, warnings and savings goal progress', async () => {
    mockedApi.budgets.mockResolvedValue({
      ...budgetsFixture,
      warnings: [{
        scope: 'overall', category: '', status: 'approaching',
        message: 'Overall budget: 80% of this limit is used.', utilization_percent: 81,
      }],
      overall: { ...budgetsFixture.overall!, utilization_percent: 81, status: 'approaching', warning: '81% of this limit is used.' },
    });
    renderPage();
    await screen.findByText('Total completed outflow');
    fireEvent.click(screen.getByRole('tab', { name: /Budgets & goals/i }));

    expect(await screen.findByText('Monthly budgets and savings goals')).toBeInTheDocument();
    expect(await screen.findByText('Approaching a budget limit')).toBeInTheDocument();
    expect(screen.getByText('81.0%')).toBeInTheDocument();
    expect(screen.getByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(mockedApi.budgets).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
  });

  it('rejects an inverted custom range before requesting analytics', async () => {
    renderPage();
    await screen.findByText('Total completed outflow');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });

    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-10-19' } });
    await waitFor(() => expect(mockedApi.summary.mock.calls.some((call) => call[0] === 'custom')).toBe(true));
    const callsBeforeInvalidRange = mockedApi.summary.mock.calls.length;

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });

    expect(await screen.findByText('The start date must be on or before the end date.')).toBeInTheDocument();
    expect(mockedApi.summary.mock.calls.length).toBe(callsBeforeInvalidRange);
  });
});
