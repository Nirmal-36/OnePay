import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BadgeIndianRupee, CalendarDays,
  ChartPie, CircleDollarSign, Gauge, Landmark, PiggyBank, ReceiptText, Sparkles, TrendingUp, WalletCards,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, apiErrorMessage } from '../../api/auth';
import {
  analyticsApi,
  type SpendingPeriod,
  type SpendingSummary,
  type SpendingTransaction,
  type SpendingTransactionsPage,
  type TransactionSort,
} from '../../api/analytics';
import { CategoryDonut } from '../../components/insights/CategoryDonut';
import { BudgetProgress } from '../../components/insights/BudgetProgress';
import { CategoryCorrectionModal } from '../../components/insights/CategoryCorrectionModal';
import { InsightCard } from '../../components/insights/InsightCard';
import { SpendingTrendChart } from '../../components/insights/SpendingTrendChart';
import { TransactionsPanel } from '../../components/insights/TransactionsPanel';
import {
  DataBadge, ErrorCard, InfoTip, LoadingCard, categoryColor, compactMoney, money,
  useDebouncedValue,
} from '../../components/insights/shared';
import { EmptyState } from '../../components/EmptyState';

interface OverviewTabProps {
  period: SpendingPeriod;
  dateFrom: string;
  dateTo: string;
  selectedCategory: string;
  onSelectedCategoryChange: (category: string) => void;
  onOpenPatterns: () => void;
  onOpenBudgets: () => void;
  categoryOptions: { name: string }[];
  validRange: boolean;
}

const SCROLL_TO_TRANSACTIONS = () => {
  const node = document.getElementById('spending-transactions');
  if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export function OverviewTab({
  period,
  dateFrom,
  dateTo,
  selectedCategory,
  onSelectedCategoryChange,
  onOpenPatterns,
  onOpenBudgets,
  categoryOptions,
  validRange,
}: OverviewTabProps) {
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TransactionSort>('newest');
  const [page, setPage] = useState(1);
  const [transactionPage, setTransactionPage] = useState<SpendingTransactionsPage | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(true);
  const [transactionError, setTransactionError] = useState('');
  const [correctionTransaction, setCorrectionTransaction] = useState<SpendingTransaction | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    if (!validRange) {
      setLoading(false);
      setSummary(null);
      setTransactionPage(null);
      setError('Choose a valid start and end date to view spending insights.');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void analyticsApi.summary(period, dateFrom, dateTo)
      .then((result) => { if (active) setSummary(result); })
      .catch((loadError) => {
        if (!active) return;
        setSummary(null);
        setError(
          loadError instanceof ApiError && loadError.status === 401
            ? 'Your session has expired. Sign in again to view spending insights.'
            : apiErrorMessage(loadError, 'Could not load spending insights. Please retry.'),
        );
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, dateFrom, dateTo, validRange, refreshKey]);

  useEffect(() => {
    if (!validRange) {
      setTransactionPage(null);
      setTransactionLoading(false);
      setTransactionError('Choose a valid date range to load transactions.');
      return;
    }
    let active = true;
    setTransactionLoading(true);
    setTransactionError('');
    void analyticsApi.transactions({
      period,
      dateFrom,
      dateTo,
      category: selectedCategory,
      search: debouncedSearch,
      sort,
      page,
    })
      .then((result) => { if (active) setTransactionPage(result); })
      .catch((loadError) => {
        if (!active) return;
        setTransactionPage(null);
        setTransactionError(apiErrorMessage(loadError, 'Could not load the transactions for this view.'));
      })
      .finally(() => { if (active) setTransactionLoading(false); });
    return () => { active = false; };
  }, [period, dateFrom, dateTo, selectedCategory, debouncedSearch, sort, page, validRange, refreshKey]);

  const selectCategory = useCallback((category: string) => {
    onSelectedCategoryChange(category);
    setPage(1);
    window.setTimeout(SCROLL_TO_TRANSACTIONS, 120);
  }, [onSelectedCategoryChange]);

  const refreshAfterCorrection = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const maxMerchant = useMemo(
    () => Math.max(1, ...(summary?.top_merchants.map((merchant) => merchant.amount_minor) ?? [1])),
    [summary],
  );

  if (loading && !summary) return <LoadingCard label="Analyzing completed payments…" />;
  if (error && !summary) return <ErrorCard message={error} onRetry={() => setRefreshKey((value) => value + 1)} />;
  if (!summary) return null;

  const monthChange = summary.month_over_month;
  const changeTone = monthChange.change_minor > 0 ? 'up' : monthChange.change_minor < 0 ? 'down' : 'flat';
  const overallBudget = summary.budget_overview.overall;
  const insights = summary.recent_insights;

  return (
    <div className="si-tab-content">
      <div className="si-metric-grid">
        <section className="card si-metric-card primary">
          <div className="si-metric-top"><span>Total completed outflow</span><InfoTip label="How total spending is calculated">Successful INR transfers, bills, and recharges owned by you. Transfers to your own OnePay handle, pending, failed, reversed, and wallet top-ups are excluded.</InfoTip></div>
          <strong>{money(summary.total_spending_minor)}</strong>
          <small>{summary.transaction_count} completed payment{summary.transaction_count === 1 ? '' : 's'} · <DataBadge type="actual" /></small>
        </section>
        <section className="card si-metric-card">
          <div className="si-metric-top"><span>Money received</span><WalletCards size={16} aria-hidden="true" /></div>
          <strong className="si-muted-value">Not tracked</strong>
          <small>{money(summary.money_received.demo_funds_added_minor)} in demo top-ups, shown separately and never counted as income.</small>
        </section>
        <section className="card si-metric-card">
          <div className="si-metric-top"><span>Net cash flow</span><InfoTip label="Why net cash flow is unavailable">OnePay records outgoing payments and simulated top-ups, not verified incoming funds. A net figure would require inventing income, so it is not shown.</InfoTip></div>
          <strong className="si-muted-value">Unavailable</strong>
          <small>{summary.income_unavailable_reason}</small>
        </section>
        <section className="card si-metric-card">
          <div className="si-metric-top"><span>Average daily spending</span><CalendarDays size={16} aria-hidden="true" /></div>
          <strong>{money(summary.average_daily_spending_minor)}</strong>
          <small>Across {summary.period.days} calendar day{summary.period.days === 1 ? '' : 's'} · {money(summary.average_active_day_spending_minor)} per active day</small>
        </section>
        <section className="card si-metric-card">
          <div className="si-metric-top"><span>Largest expense</span><ArrowDownRight size={16} aria-hidden="true" /></div>
          <strong>{summary.largest_expense ? money(summary.largest_expense.amount_minor) : '—'}</strong>
          <small>{summary.largest_expense ? `${summary.largest_expense.category} · ${summary.largest_expense.recipient_name}` : 'No completed expense in this period'}</small>
          {summary.largest_expense && <Link className="si-card-link" to={`/transactions/${summary.largest_expense.reference}`}>Open payment <ArrowRight size={12} /></Link>}
        </section>
        <section className="card si-metric-card">
          <div className="si-metric-top"><span>Most expensive category</span><ChartPie size={16} aria-hidden="true" /></div>
          <strong className="si-category-value">{summary.highest_category?.category ?? '—'}</strong>
          <small>{summary.highest_category ? `${money(summary.highest_category.amount_minor)} · ${summary.highest_category.percentage.toFixed(1)}% of outflow` : 'No category data yet'}</small>
          {summary.highest_category && <button type="button" className="si-card-link" onClick={() => selectCategory(summary.highest_category!.category)}>View payments <ArrowRight size={12} /></button>}
        </section>
      </div>

      <div className="si-comparison-strip card">
        <div>
          <span className="si-kicker"><TrendingUp size={14} /> Month-over-month</span>
          <strong className={changeTone}>{monthChange.change_percent === null ? 'No prior baseline' : `${monthChange.change_percent > 0 ? '+' : ''}${monthChange.change_percent.toFixed(1)}%`}</strong>
          <p>{monthChange.previous_total_minor ? `${money(monthChange.current_total_minor)} in the latest month versus ${money(monthChange.previous_total_minor)} in ${monthChange.comparison_start} to ${monthChange.comparison_end}.` : 'There is no completed spending in the comparison window yet.'}</p>
        </div>
        <div className="si-comparison-bars" aria-hidden="true">
          <span><i className="current" style={{ width: `${Math.min(100, (monthChange.current_total_minor / Math.max(monthChange.current_total_minor, monthChange.previous_total_minor, 1)) * 100)}%` }} /><small>Selected</small></span>
          <span><i className="previous" style={{ width: `${Math.min(100, (monthChange.previous_total_minor / Math.max(monthChange.current_total_minor, monthChange.previous_total_minor, 1)) * 100)}%` }} /><small>Comparison</small></span>
        </div>
        <InfoTip label="How month-over-month is calculated">{monthChange.basis}</InfoTip>
      </div>

      {summary.budget_warnings.length > 0 && (
        <div className="si-alert-banner warn" role="status">
          <PiggyBank size={18} aria-hidden="true" />
          <div><strong>Budget check</strong><span>{summary.budget_warnings.map((warning) => warning.message).join(' ')}</span></div>
          <button type="button" className="text-link" onClick={onOpenBudgets}>Open budgets <ArrowRight size={13} /></button>
        </div>
      )}

      <div className="si-main-grid">
        <section className="card si-panel si-donut-panel" aria-labelledby="si-categories-heading">
          <div className="si-panel-heading">
            <div><h2 id="si-categories-heading">Where your spending goes</h2><p>Click a slice or category to drill into the matching payments.</p></div>
            <span className="si-panel-icon"><ChartPie size={17} /></span>
          </div>
          {summary.categories.length ? (
            <CategoryDonut
              categories={summary.categories}
              total={summary.total_spending_minor}
              selectedCategory={selectedCategory}
              onSelect={selectCategory}
            />
          ) : (
            <EmptyState
              icon={ChartPie}
              title="No completed spending in this period"
              description="Successful transfers, bills, and recharges will appear here. Pending, failed, reversed, internal transfers, and top-ups are excluded."
            />
          )}
        </section>

        <section className="card si-panel" aria-labelledby="si-daily-heading">
          <div className="si-panel-heading">
            <div><h2 id="si-daily-heading">Daily spending trend</h2><p>Completed outflow by local calendar day.</p></div>
            <DataBadge type="actual" />
          </div>
          <SpendingTrendChart
            actual={summary.daily_trend}
            label="Daily completed spending"
            description="Every bar along the date axis represents one local calendar day, including days with no spending."
          />
          <div className="si-mini-stats">
            <div><span>Active days</span><strong>{summary.active_spending_days}</strong></div>
            <div><span>Average active day</span><strong>{money(summary.average_active_day_spending_minor)}</strong></div>
            <div><span>Weekend share</span><strong>{summary.weekday_weekend.weekend.share_percent.toFixed(0)}%</strong></div>
          </div>
        </section>
      </div>

      <div className="si-main-grid">
        <section className="card si-panel" aria-labelledby="si-monthly-heading">
          <div className="si-panel-heading">
            <div><h2 id="si-monthly-heading">Monthly trend</h2><p>Every calendar month touched by the selected period.</p></div>
            <DataBadge type="actual" />
          </div>
          <SpendingTrendChart
            monthly={summary.monthly_trend}
            mode="monthly"
            label="Monthly completed spending"
            description="Months are shown in the application timezone. The current month is month-to-date."
          />
        </section>

        <section className="card si-panel" aria-labelledby="si-weekday-heading">
          <div className="si-panel-heading">
            <div><h2 id="si-weekday-heading">Weekday vs weekend</h2><p>Average spending per calendar day, using your own data.</p></div>
            <Gauge size={17} className="si-muted-icon" />
          </div>
          <div className="si-split-bars">
            {[
              { key: 'weekday', label: 'Weekdays', data: summary.weekday_weekend.weekday, color: '#7654dc' },
              { key: 'weekend', label: 'Weekends', data: summary.weekday_weekend.weekend, color: '#2f9079' },
            ].map((group) => {
              const max = Math.max(summary.weekday_weekend.weekday.average_minor, summary.weekday_weekend.weekend.average_minor, 1);
              return (
                <div key={group.key} className="si-split-bar">
                  <div><strong>{group.label}</strong><span>{money(group.data.average_minor)} / day</span></div>
                  <div className="si-progress-track" aria-hidden="true"><span style={{ width: `${(group.data.average_minor / max) * 100}%`, background: group.color }} /></div>
                  <small>{money(group.data.amount_minor)} across {group.data.days} day{group.data.days === 1 ? '' : 's'}</small>
                </div>
              );
            })}
          </div>
          <p className="si-panel-note">
            {summary.weekday_weekend.difference_percent === null
              ? 'A comparison needs spending on both weekdays and weekends.'
              : `Weekend daily average is ${summary.weekday_weekend.difference_percent > 0 ? '+' : ''}${summary.weekday_weekend.difference_percent.toFixed(0)}% versus weekdays.`}
          </p>
          <InfoTip label="Weekday and weekend definition">{summary.weekday_weekend.definition}</InfoTip>
        </section>
      </div>

      <div className="si-main-grid si-main-grid-budget">
        <section className="card si-panel" aria-labelledby="si-budget-heading">
          <div className="si-panel-heading">
            <div><h2 id="si-budget-heading">Budget utilization</h2><p>Consumption spending only; transfers and refunds are excluded.</p></div>
            <button type="button" className="text-link" onClick={onOpenBudgets}>Manage <ArrowRight size={13} /></button>
          </div>
          {overallBudget ? (
            <BudgetProgress entry={{ ...overallBudget, label: 'Overall monthly budget' }} />
          ) : (
            <div className="si-small-empty">
              <PiggyBank size={19} />
              <div><strong>No overall budget yet</strong><p>Set a monthly spending limit to see progress and in-app warnings.</p></div>
              <button type="button" className="button button-secondary button-sm" onClick={onOpenBudgets}>Set a budget</button>
            </div>
          )}
          {summary.budget_overview.categories.length > 0 && (
            <div className="si-budget-mini-list">
              {summary.budget_overview.categories.slice(0, 3).map((entry) => (
                <BudgetProgress key={entry.id ?? entry.category} entry={entry} compact />
              ))}
            </div>
          )}
          <p className="si-panel-note">Actual consumption: {money(summary.budget_overview.consumption_spending_minor)} in {summary.budget_overview.label}.</p>
        </section>

        <section className="card si-panel" aria-labelledby="si-merchants-heading">
          <div className="si-panel-heading">
            <div><h2 id="si-merchants-heading">Top merchants</h2><p>Grouped by recipient identifier or normalized merchant name.</p></div>
            <Landmark size={17} className="si-muted-icon" />
          </div>
          {summary.top_merchants.length ? (
            <div className="si-merchant-list">
              {summary.top_merchants.slice(0, 5).map((merchant) => (
                <div className="si-merchant-row" key={merchant.merchant_key}>
                  <span className="si-inline-dot" style={{ background: categoryColor(merchant.category) }} aria-hidden="true" />
                  <div><strong>{merchant.name}</strong><small>{merchant.category} · {merchant.transaction_count} payment{merchant.transaction_count === 1 ? '' : 's'}</small></div>
                  <div className="si-merchant-bar" aria-hidden="true"><span style={{ width: `${(merchant.amount_minor / maxMerchant) * 100}%` }} /></div>
                  <strong>{money(merchant.amount_minor)}</strong>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No merchant data yet" description="Completed eligible payments will be grouped here." />}
        </section>
      </div>

      <section className="card si-panel" aria-labelledby="si-recent-insights-heading">
        <div className="si-panel-heading">
          <div><h2 id="si-recent-insights-heading">Recent spending insights</h2><p>Evidence-backed observations from this period. Open Patterns for the full calculation.</p></div>
          <button type="button" className="text-link" onClick={onOpenPatterns}>All patterns <ArrowRight size={13} /></button>
        </div>
        {insights.length ? (
          <div className="si-insight-grid">
            {insights.map((insight) => (
              <InsightCard key={`${insight.kind}-${insight.title}`} insight={insight} compact onViewCategory={selectCategory} />
            ))}
          </div>
        ) : (
          <div className="si-small-empty">
            <Sparkles size={19} />
            <div><strong>Not enough repeated activity for a pattern yet</strong><p>{summary.data_quality.notes[0] ?? 'Add more completed payments to unlock behavioural insights.'}</p></div>
            <button type="button" className="button button-secondary button-sm" onClick={onOpenPatterns}>See data requirements</button>
          </div>
        )}
      </section>

      <TransactionsPanel
        data={transactionPage}
        loading={transactionLoading}
        error={transactionError}
        onRetry={() => setRefreshKey((value) => value + 1)}
        search={search}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        category={selectedCategory}
        onCategoryChange={(value) => { onSelectedCategoryChange(value); setPage(1); }}
        sort={sort}
        onSortChange={(value) => { setSort(value); setPage(1); }}
        onPageChange={setPage}
        onEditCategory={setCorrectionTransaction}
        categoryOptions={categoryOptions}
      />

      <section className="card si-panel si-method-panel" aria-labelledby="si-method-heading">
        <div className="si-panel-heading">
          <div><h2 id="si-method-heading">How these figures are calculated</h2><p>Transparent rules, actual recorded values, and no invented balances.</p></div>
          <ReceiptText size={17} className="si-muted-icon" />
        </div>
        <div className="si-method-grid">
          <div className="si-method-card">
            <strong><BadgeIndianRupee size={15} /> Included</strong>
            <p>Successful INR transfers, bill payments, and recharges owned by you in the selected period. Amounts are integer paise and displayed in INR.</p>
          </div>
          <div className="si-method-card">
            <strong><CircleDollarSign size={15} /> Excluded</strong>
            <p>Pending, failed, reversed, and own-account transfers. Demo wallet top-ups are reported separately and are not income.</p>
            <span className="si-excluded-row">
              Pending {summary.excluded_activity.pending.count} · Failed {summary.excluded_activity.failed.count} · Reversed {summary.excluded_activity.reversed.count} · Internal transfers {summary.excluded_activity.internal_transfer.count}
            </span>
          </div>
          <div className="si-method-card">
            <strong><Sparkles size={15} /> Categorized locally</strong>
            <p>Local merchant and metadata rules run first. External AI is {summary.categorization.external_ai_used ? 'used for some payments with recorded consent' : 'not used for this analysis'}. Confidence reflects rule strength, not a calibrated probability.</p>
            <span className="si-excluded-row">{summary.categorization.user_corrections_stored} saved correction{summary.categorization.user_corrections_stored === 1 ? '' : 's'} applied.</span>
          </div>
          <div className="si-method-card">
            <strong><ArrowUpRight size={15} /> Data sufficiency</strong>
            <p>{summary.data_quality.sufficient_for_insights ? 'Enough history exists for behavioural observations.' : 'Not enough history for stable behavioural observations.'} {summary.data_quality.sufficient_for_forecast ? 'Forecasting is available.' : 'Forecasting is withheld until enough complete months exist.'}</p>
            <span className="si-excluded-row">{summary.data_quality.transaction_count} eligible payments · {summary.data_quality.history_days} days of recorded history.</span>
          </div>
        </div>
        <details className="si-calculation si-calculation-wide">
          <summary>Read the full calculation notes</summary>
          <ul>{summary.calculation_notes.map((note) => <li key={note}>{note}</li>)}</ul>
          <p className="si-data-sufficiency">{summary.income_unavailable_reason}</p>
        </details>
        <p className="si-disclaimer">This analysis uses simulated OnePay activity only. It does not represent a verified bank balance, complete financial picture, or guaranteed savings.</p>
      </section>

      <div className="si-floating-summary" aria-hidden="true">
        <span><WalletCards size={14} /> {money(summary.total_spending_minor)} outflow</span>
        <span><ArrowUpRight size={14} /> {compactMoney(summary.average_daily_spending_minor)}/day</span>
      </div>

      <CategoryCorrectionModal
        open={Boolean(correctionTransaction)}
        transaction={correctionTransaction}
        onClose={() => setCorrectionTransaction(null)}
        onSaved={refreshAfterCorrection}
      />
    </div>
  );
}
