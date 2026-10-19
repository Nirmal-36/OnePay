import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, ChartPie, CircleDollarSign,
  LoaderCircle, RotateCcw, Sparkles, WalletCards,
} from 'lucide-react';
import { ApiError, apiErrorMessage } from '../api/auth';
import { analyticsApi, type SpendingCategory, type SpendingPeriod, type SpendingSummary, type SpendingTransaction, type SpendingTransactionsPage } from '../api/analytics';
import { PageHeader } from '../components/PageHeader';
import { formatDateTime, formatRupees } from '../types';
import './SpendingInsightsPage.css';

const PERIOD_OPTIONS: { value: SpendingPeriod; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

const CATEGORY_COLORS: Record<string, string> = {
  'Food and Dining': '#7551e8',
  Groceries: '#35a681',
  'Transport and Fuel': '#e4a04e',
  Shopping: '#5486d8',
  'Bills and Utilities': '#d87088',
  'Mobile Recharge': '#8e6bc8',
  Entertainment: '#e17f54',
  Healthcare: '#4caaa9',
  Education: '#7a91cd',
  Travel: '#5eae75',
  'Personal Care': '#c78eac',
  Housing: '#bc9b4b',
  Subscriptions: '#8d85aa',
  'Financial Services': '#758495',
  Transfers: '#9d8cdb',
  Other: '#c4c0cf',
};

const money = (minor: number) => formatRupees(minor);
const indiaDateISO = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const dateToday = () => indiaDateISO();
const firstDayOfMonth = () => `${indiaDateISO().slice(0, 7)}-01`;
const periodLabel = (key: SpendingPeriod) => PERIOD_OPTIONS.find((option) => option.value === key)?.label ?? 'Selected period';

function CategoryDonut({ categories, total }: { categories: SpendingCategory[]; total: number }) {
  const style = useMemo(() => {
    if (!total || !categories.length) return { background: '#eeedf3' };
    let cursor = 0;
    const segments = categories.map((item) => {
      const end = cursor + (item.amount_minor / total) * 100;
      const segment = `${CATEGORY_COLORS[item.category] ?? '#b9b0d7'} ${cursor}% ${end}%`;
      cursor = end;
      return segment;
    });
    return { background: `conic-gradient(${segments.join(', ')})` };
  }, [categories, total]);

  return (
    <div className="insights-donut-wrap">
      <div className="insights-donut" style={style} role="img" aria-label={`Category chart showing ${categories.length} spending categories`}>
        <div className="insights-donut-center">
          <span>Total outflow</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}

function CategoryLegend({ categories, selectedCategory, onSelect }: {
  categories: SpendingCategory[];
  selectedCategory: string;
  onSelect: (category: string) => void;
}) {
  if (!categories.length) return <p className="insights-muted">No completed spending categories in this period.</p>;
  return (
    <div className="insights-category-list">
      {categories.map((item) => (
        <button
          className={`insights-category-row ${selectedCategory === item.category ? 'selected' : ''}`}
          key={item.category}
          type="button"
          onClick={() => onSelect(selectedCategory === item.category ? '' : item.category)}
          aria-pressed={selectedCategory === item.category}
        >
          <span className="insights-category-dot" style={{ background: CATEGORY_COLORS[item.category] ?? '#b9b0d7' }} />
          <span className="insights-category-copy"><strong>{item.category}</strong><small>{item.transaction_count} transaction{item.transaction_count === 1 ? '' : 's'}</small></span>
          <span className="insights-category-value"><strong>{money(item.amount_minor)}</strong><small>{item.percentage.toFixed(1)}%</small></span>
        </button>
      ))}
    </div>
  );
}

function TransactionRows({ transactions }: { transactions: SpendingTransaction[] }) {
  if (!transactions.length) {
    return <div className="insights-empty"><span><ChartPie size={19} /></span><strong>No completed expenses here yet</strong><p>Eligible successful payments will appear after they are recorded.</p></div>;
  }
  return (
    <div className="insights-transactions-table">
      {transactions.map((item) => (
        <div className="insights-transaction-row" key={item.reference}>
          <div className="insights-transaction-icon" style={{ color: CATEGORY_COLORS[item.category] ?? '#7551e8' }}><CircleDollarSign size={18} /></div>
          <div className="insights-transaction-main">
            <strong>{item.recipient_name}</strong>
            <span>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ''}</span>
            <small>{formatDateTime(item.created_at)} · {item.reference}</small>
          </div>
          <div className="insights-transaction-amount"><strong>−{money(item.amount_minor)}</strong><small>Simulated</small></div>
        </div>
      ))}
    </div>
  );
}

export default function SpendingInsightsPage() {
  const [period, setPeriod] = useState<SpendingPeriod>('this_month');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(dateToday);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [transactionPage, setTransactionPage] = useState<SpendingTransactionsPage | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(true);
  const [transactionError, setTransactionError] = useState('');
  const [page, setPage] = useState(1);
  const validCustomRange = period !== 'custom' || Boolean(dateFrom && dateTo && dateFrom <= dateTo);

  useEffect(() => {
    if (!validCustomRange) {
      setLoading(false);
      setSummary(null);
      setError('Choose a valid start and end date to view your spending.');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void analyticsApi.summary(period, dateFrom, dateTo).then((result) => {
      if (active) setSummary(result);
    }).catch((loadError) => {
      if (active) {
        setSummary(null);
        setError(loadError instanceof ApiError && loadError.status === 401
          ? 'Your session has expired. Sign in again to view spending insights.'
          : apiErrorMessage(loadError, 'Could not load spending insights. Please retry.'));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, dateFrom, dateTo, validCustomRange]);

  useEffect(() => {
    if (!validCustomRange) return;
    let active = true;
    setTransactionLoading(true);
    setTransactionError('');
    void analyticsApi.transactions(period, selectedCategory, dateFrom, dateTo, page).then((result) => {
      if (active) setTransactionPage(result);
    }).catch((loadError) => {
      if (active) {
        setTransactionPage(null);
        setTransactionError(apiErrorMessage(loadError, 'Could not load the transactions for this view.'));
      }
    }).finally(() => { if (active) setTransactionLoading(false); });
    return () => { active = false; };
  }, [period, selectedCategory, dateFrom, dateTo, page, validCustomRange]);

  const trendBars = useMemo(() => {
    const items = summary?.daily_trend.slice(-31) ?? [];
    const max = Math.max(1, ...items.map((item) => item.amount_minor));
    return { items, max };
  }, [summary]);

  const changePeriod = (value: SpendingPeriod) => {
    setPeriod(value);
    setSelectedCategory('');
    setPage(1);
  };

  const retry = () => {
    setLoading(true);
    setError('');
    void analyticsApi.summary(period, dateFrom, dateTo).then(setSummary).catch((loadError) => {
      setError(apiErrorMessage(loadError, 'Could not load spending insights. Please retry.'));
    }).finally(() => setLoading(false));
  };

  return (
    <div className="spending-insights-page">
      <PageHeader
        eyebrow="YOUR MONEY PATTERNS"
        title="Spending insights"
        description="Understand where your simulated OnePay outflow goes, using transparent calculations from your recorded transactions."
        action={<span className="insights-demo-tag"><Sparkles size={14} /> Rules-based analysis</span>}
      />

      <section className="insights-filter-card card" aria-label="Spending date range">
        <div className="insights-filter-heading"><CalendarDays size={17} /><div><strong>Analysis period</strong><span>Choose the dates used in the calculations.</span></div></div>
        <div className="insights-filter-controls">
          <label className="insights-field"><span>Period</span><select value={period} onChange={(event) => changePeriod(event.target.value as SpendingPeriod)}>
            {PERIOD_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select></label>
          {period === 'custom' && <>
            <label className="insights-field"><span>From</span><input type="date" value={dateFrom} max={dateToday()} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
            <label className="insights-field"><span>To</span><input type="date" value={dateTo} min={dateFrom} max={dateToday()} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
          </>}
          {selectedCategory && <button className="button button-secondary insights-clear-filter" type="button" onClick={() => { setSelectedCategory(''); setPage(1); }}><RotateCcw size={14} /> Clear category</button>}
        </div>
        {summary && <p className="insights-period-note">Showing {summary.period.start_date} through {summary.period.end_date} · {summary.period.days} calendar day{summary.period.days === 1 ? '' : 's'}.</p>}
      </section>

      {loading && <div className="card insights-state" role="status"><LoaderCircle className="spin" size={22} /><span>Analyzing your recorded transactions…</span></div>}
      {!loading && error && <div className="card insights-state insights-error" role="alert"><strong>Could not load insights</strong><p>{error}</p><button className="button button-secondary" type="button" onClick={retry}>Retry</button></div>}
      {!loading && summary && <>
        <div className="insights-metrics-grid">
          <section className="card insights-metric-card insights-metric-primary"><div className="insights-metric-top"><span>Total completed outflow</span><span className="insights-metric-icon"><ArrowUpRight size={17} /></span></div><strong>{money(summary.total_spending_minor)}</strong><small>{summary.transaction_count} eligible transaction{summary.transaction_count === 1 ? '' : 's'} · {periodLabel(period)}</small></section>
          <section className="card insights-metric-card"><div className="insights-metric-top"><span>Average daily outflow</span><span className="insights-metric-icon green"><CalendarDays size={17} /></span></div><strong>{money(summary.average_daily_spending_minor)}</strong><small>Average across {summary.period.days} calendar days</small></section>
          <section className="card insights-metric-card"><div className="insights-metric-top"><span>Largest expense</span><span className="insights-metric-icon orange"><ArrowDownRight size={17} /></span></div><strong>{summary.largest_expense ? money(summary.largest_expense.amount_minor) : '—'}</strong><small>{summary.largest_expense ? `${summary.largest_expense.category} · ${summary.largest_expense.recipient_name}` : 'No completed expense found'}</small></section>
          <section className="card insights-metric-card"><div className="insights-metric-top"><span>Top category</span><span className="insights-metric-icon"><ChartPie size={17} /></span></div><strong className="insights-category-metric-value">{summary.highest_category?.category ?? '—'}</strong><small>{summary.highest_category ? `${money(summary.highest_category.amount_minor)} · ${summary.highest_category.percentage.toFixed(1)}% of outflow` : 'No category data yet'}</small></section>
          <section className="card insights-metric-card"><div className="insights-metric-top"><span>Money received</span><span className="insights-metric-icon blue"><WalletCards size={17} /></span></div><strong className="insights-not-tracked">Not tracked</strong><small>Incoming transfers are not recorded in this demo yet.</small></section>
        </div>

        <div className="insights-main-grid">
          <section className="card insights-panel">
            <div className="section-heading"><div><h2>Where your outflow goes</h2><p>Tap a category to filter the transactions below.</p></div><span className="insights-panel-icon"><ChartPie size={17} /></span></div>
            {summary.categories.length ? <div className="insights-category-layout">
              <CategoryDonut categories={summary.categories} total={summary.total_spending_minor} />
              <CategoryLegend categories={summary.categories} selectedCategory={selectedCategory} onSelect={(category) => { setSelectedCategory(category); setPage(1); }} />
            </div> : <div className="insights-empty"><span><ChartPie size={19} /></span><strong>No spending data for this period</strong><p>Completed simulated transfers, bills, and recharges will appear here. Pending, failed, reversed, and wallet top-ups are excluded from spending.</p></div>}
          </section>

          <section className="card insights-panel">
            <div className="section-heading"><div><h2>Daily trend</h2><p>Completed outflow by day · most recent 31 days shown.</p></div><span className="insights-panel-icon green"><CalendarDays size={17} /></span></div>
            {trendBars.items.some((item) => item.amount_minor > 0) ? <>
              <div className="insights-trend-chart" role="img" aria-label="Bar chart of daily completed outflow for the most recent 31 days">
                {trendBars.items.map((item) => <div className="insights-trend-column" key={item.date} title={`${item.date}: ${money(item.amount_minor)}`}><span style={{ height: `${Math.max(item.amount_minor > 0 ? 4 : 1, item.amount_minor / trendBars.max * 100)}%` }} /><small>{item.date.slice(-2)}</small></div>)}
              </div>
              <div className="insights-trend-legend"><span><i />Daily completed outflow</span><strong>{money(summary.total_spending_minor)} total in period</strong></div>
            </> : <div className="insights-empty insights-empty-compact"><strong>No daily outflow yet</strong><p>When completed eligible payments exist, the trend will be shown here.</p></div>}
          </section>
        </div>

        <div className="insights-bottom-grid">
          <section className="card insights-panel">
            <div className="section-heading"><div><h2>{selectedCategory || 'Transactions in this period'}</h2><p>{selectedCategory ? 'Category-filtered completed transactions.' : 'Recent eligible transactions, newest first.'}</p></div><span className="insights-count-pill">{transactionPage?.count ?? 0} records</span></div>
            {transactionLoading && <div className="insights-inline-state" role="status"><LoaderCircle className="spin" size={17} /> Loading transactions…</div>}
            {!transactionLoading && transactionError && <div className="insights-inline-error" role="alert">{transactionError}</div>}
            {!transactionLoading && !transactionError && <TransactionRows transactions={transactionPage?.results ?? []} />}
            {transactionPage && transactionPage.total_pages > 1 && <div className="insights-pagination"><button type="button" className="button button-secondary button-sm" disabled={!transactionPage.has_previous || transactionLoading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {transactionPage.page} of {transactionPage.total_pages}</span><button type="button" className="button button-secondary button-sm" disabled={!transactionPage.has_next || transactionLoading} onClick={() => setPage((value) => value + 1)}>Next <ArrowRight size={13} /></button></div>}
          </section>

          <section className="card insights-panel insights-evidence-panel">
            <div className="section-heading"><div><h2>How to read these figures</h2><p>Transparent data rules, not financial advice.</p></div><span className="insights-panel-icon orange"><Sparkles size={17} /></span></div>
            <div className="insights-evidence-list">
              <div><span className="insights-evidence-marker green"><ArrowUpRight size={15} /></span><div><strong>Counted as spending</strong><p>Successful INR transfers, bills, and recharges in the selected period, excluding transfers to your own OnePay ID.</p></div></div>
              <div><span className="insights-evidence-marker orange"><RotateCcw size={15} /></span><div><strong>Kept separate</strong><p>Pending, failed, and reversed transactions are excluded. Successful demo wallet top-ups are shown separately and are not income.</p></div></div>
              <div><span className="insights-evidence-marker blue"><ChartPie size={15} /></span><div><strong>Locally categorized</strong><p>Merchant text and transaction metadata are classified by local rules. Confidence indicates rule strength, not model probability.</p></div></div>
            </div>
            {summary.month_over_month && <div className="insights-comparison"><span>Selected month vs comparison period</span><strong className={summary.month_over_month.change_minor > 0 ? 'increase' : summary.month_over_month.change_minor < 0 ? 'decrease' : ''}>{summary.month_over_month.change_minor > 0 ? '+' : ''}{money(summary.month_over_month.change_minor)}</strong><small>{summary.month_over_month.change_percent === null ? 'No prior-period base for a percentage comparison.' : `${summary.month_over_month.change_percent > 0 ? '+' : ''}${summary.month_over_month.change_percent.toFixed(1)}% compared with ${summary.month_over_month.comparison_start} to ${summary.month_over_month.comparison_end}.`}</small></div>}
            <div className="insights-topups-note"><WalletCards size={16} /><span><strong>{money(summary.demo_topups_minor)}</strong> in simulated wallet top-ups · excluded from spending and income.</span></div>
            <div className="insights-income-note"><span>Net cash flow</span><strong>Not available because incoming funds are not recorded in this demo.</strong></div>
            <div className="insights-excluded-note"><strong>Excluded activity in selected period</strong><span>Pending: {summary.excluded_activity.pending.count} · Failed: {summary.excluded_activity.failed.count} · Reversed: {summary.excluded_activity.reversed.count}</span></div>
            <p className="insights-disclaimer">This is analysis of OnePay's simulated activity only. It does not represent a verified bank balance, complete financial picture, or guaranteed savings estimate.</p>
          </section>
        </div>
      </>}
    </div>
  );
}
