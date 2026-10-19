import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CalendarRange, ChevronLeft, ChevronRight, Download, FileText,
  LoaderCircle, ReceiptText, ShieldCheck, Sparkles, TrendingDown, TrendingUp, WalletCards,
} from 'lucide-react';
import { apiErrorMessage } from '../../api/auth';
import {
  analyticsApi,
  type Anomaly,
  type MonthlyReport,
  type ReportMonth,
  type SpendingInsight,
} from '../../api/analytics';
import { EmptyState } from '../../components/EmptyState';
import { InsightCard } from '../../components/insights/InsightCard';
import { SpendingTrendChart } from '../../components/insights/SpendingTrendChart';
import {
  DataBadge, ErrorCard, LoadingCard, categoryColor, money, monthLabel, shortDate, shiftMonthValue, todayISO,
} from '../../components/insights/shared';
import { useToast } from '../../context/ToastProvider';

const currentMonthValue = () => todayISO().slice(0, 7);

function normaliseUnusual(item: SpendingInsight | Anomaly): SpendingInsight {
  if ('title' in item) return item;
  const amount = money(item.amount_minor);
  return {
    kind: 'unusual_expense',
    title: `${item.merchant || 'A day of spending'} reached ${amount}`,
    explanation: item.explanation,
    evidence: {
      amount_minor: item.amount_minor,
      category: item.category,
      dates: [item.date],
      references: item.reference ? [item.reference] : [],
    },
    baseline: {
      label: 'Your prior median payment',
      amount_minor: item.baseline_median_minor,
    },
    calculation: `Compared with your own previous 180 days: median completed payment ${money(item.baseline_median_minor)}, median absolute deviation ${money(item.baseline_mad_minor)}. ${item.explanation}`,
    action: 'Check whether this payment or day was expected. If it was not, review the underlying transactions.',
    confidence: {
      level: item.confidence,
      score: item.confidence === 'high' ? 0.85 : 0.65,
      sample_size: 0,
      data_sufficiency: 'Requires at least ten completed payments before the period as a personal baseline.',
    },
    severity: 'watch',
    caveat: 'Large relative to your own history does not mean the payment was wrong or unnecessary.',
    data_type: 'actual',
  };
}

async function downloadCsvFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    let message = 'The CSV export could not be generated.';
    try {
      const payload = await response.json() as {
        detail?: string;
        error?: string | { message?: string };
      };
      message = payload.detail ?? (typeof payload.error === 'string' ? payload.error : payload.error?.message) ?? message;
    } catch {
      // Keep the generic message when the error body is not JSON.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const urlObject = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = urlObject;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(urlObject), 1000);
}

export function ReportsTab({ onViewCategory }: { onViewCategory: (category: string) => void }) {
  const { showToast } = useToast();
  const [months, setMonths] = useState<ReportMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthError, setMonthError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rangeStart, setRangeStart] = useState(() => `${currentMonthValue()}-01`);
  const [rangeEnd, setRangeEnd] = useState(todayISO());

  useEffect(() => {
    let active = true;
    setLoadingMonths(true);
    setMonthError('');
    void analyticsApi.reportMonths()
      .then((result) => {
        if (!active) return;
        setMonths(result.months);
        if (result.months.length && !result.months.some((month) => month.month === selectedMonth)) {
          const newestWithData = result.months.find((month) => month.has_data) ?? result.months[0];
          setSelectedMonth(newestWithData.month);
        }
      })
      .catch((loadError) => {
        if (active) setMonthError(apiErrorMessage(loadError, 'Could not load report months.'));
      })
      .finally(() => { if (active) setLoadingMonths(false); });
    return () => { active = false; };
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setReport(null);
    void analyticsApi.report(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)))
      .then((result) => { if (active) setReport(result); })
      .catch((loadError) => {
        if (active) setError(apiErrorMessage(loadError, 'Could not load the report for this month.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedMonth, refreshKey]);

  const monthIndex = useMemo(() => months.findIndex((month) => month.month === selectedMonth), [months, selectedMonth]);
  const hasNewer = monthIndex >= 0 && monthIndex < months.length - 1;
  const hasOlder = monthIndex > 0;
  const selectableMonths = useMemo(() => {
    const values = months.map((month) => month.month);
    if (!values.includes(selectedMonth)) values.push(selectedMonth);
    return values.sort();
  }, [months, selectedMonth]);
  const earliestMonth = months[0]?.month ?? selectedMonth;
  const latestMonth = months[months.length - 1]?.month ?? selectedMonth;

  const downloadCsv = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadCsvFile(
        analyticsApi.reportExportUrl(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7))),
        `onepay-spending-report-${selectedMonth}.csv`,
      );
      showToast('Report CSV downloaded. It uses the same figures shown here.', 'success');
    } catch (downloadError) {
      showToast(apiErrorMessage(downloadError, 'Could not download the CSV export.'), 'error');
    } finally {
      setDownloading(false);
    }
  }, [selectedMonth, showToast]);

  const rangeValidation = useMemo(() => {
    if (!rangeStart || !rangeEnd) return 'Choose both a start date and an end date.';
    if (rangeEnd < rangeStart) return 'The end date must be on or after the start date.';
    if (rangeEnd > todayISO()) return 'The end date cannot be in the future.';
    const days = (Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > 366) return 'Choose a date range of 366 days or fewer.';
    return '';
  }, [rangeStart, rangeEnd]);

  const downloadRangeCsv = useCallback(async () => {
    if (rangeValidation) {
      showToast(rangeValidation, 'error');
      return;
    }
    setDownloading(true);
    try {
      await downloadCsvFile(
        analyticsApi.rangeReportExportUrl(rangeStart, rangeEnd),
        `onepay-spending-report-${rangeStart}-to-${rangeEnd}.csv`,
      );
      showToast('Custom-range CSV downloaded using the selected dates.', 'success');
    } catch (downloadError) {
      showToast(apiErrorMessage(downloadError, 'Could not download the custom-range CSV.'), 'error');
    } finally {
      setDownloading(false);
    }
  }, [rangeEnd, rangeStart, rangeValidation, showToast]);

  if (loadingMonths && !months.length) return <LoadingCard label="Loading monthly reports…" />;
  if (monthError && !months.length) return <ErrorCard message={monthError} onRetry={() => setRefreshKey((value) => value + 1)} />;

  const unusual = report ? report.unusual_transactions.map(normaliseUnusual) : [];
  const opportunities = report ? [...report.opportunities, ...unusual] : [];
  const change = report?.month_over_month;
  const changeTone = change && change.change_minor > 0 ? 'up' : change && change.change_minor < 0 ? 'down' : 'flat';

  return (
    <div className="si-tab-content">
      <section className="card si-report-toolbar" aria-label="Monthly report controls">
        <div className="si-report-title">
          <span className="si-panel-icon"><FileText size={18} /></span>
          <div>
            <h2>Your monthly spending report</h2>
            <p>Plain-language summary built from completed, eligible payments. Demo top-ups are never treated as income.</p>
          </div>
        </div>
        <div className="si-report-controls">
          <button type="button" className="button button-secondary button-sm" onClick={() => hasOlder && setSelectedMonth(months[monthIndex - 1].month)} disabled={!hasOlder} aria-label="Previous report month">
            <ChevronLeft size={15} />
          </button>
          <label className="si-month-select">
            <span>Report month</span>
            <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              {selectableMonths.map((value) => {
                const month = months.find((item) => item.month === value);
                return <option key={value} value={value}>{monthLabel(value)}{month && !month.has_data ? ' · no activity' : ''}</option>;
              })}
            </select>
          </label>
          <button type="button" className="button button-secondary button-sm" onClick={() => hasNewer && setSelectedMonth(months[monthIndex + 1].month)} disabled={!hasNewer} aria-label="Next report month">
            <ChevronRight size={15} />
          </button>
          <button type="button" className="button button-primary button-sm" onClick={() => void downloadCsv()} disabled={downloading || !report}>
            {downloading ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />} Export CSV
          </button>
        </div>
      </section>

      <section className="card si-report-toolbar si-range-export" aria-label="Custom date range CSV export">
        <div className="si-report-title">
          <span className="si-panel-icon"><CalendarRange size={18} /></span>
          <div>
            <h2>Export a custom date range</h2>
            <p>Download completed spending for any selected range, up to 366 days. Top-ups are listed separately, not as income.</p>
          </div>
        </div>
        <div className="si-report-controls si-range-controls">
          <label className="si-month-select">
            <span>Start date</span>
            <input type="date" value={rangeStart} max={todayISO()} onChange={(event) => setRangeStart(event.target.value)} aria-label="Custom export start date" />
          </label>
          <label className="si-month-select">
            <span>End date</span>
            <input type="date" value={rangeEnd} min={rangeStart || undefined} max={todayISO()} onChange={(event) => setRangeEnd(event.target.value)} aria-label="Custom export end date" />
          </label>
          <button type="button" className="button button-secondary button-sm" onClick={() => void downloadRangeCsv()} disabled={downloading || Boolean(rangeValidation)}>
            {downloading ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />} Export range CSV
          </button>
          {rangeValidation && <p className="si-range-export-validation" role="alert">{rangeValidation}</p>}
        </div>
      </section>

      {loading && !report && <LoadingCard label={`Building the ${monthLabel(selectedMonth)} report…`} />}
      {error && !report && <ErrorCard message={error} onRetry={() => setRefreshKey((value) => value + 1)} />}

      {report && (
        <>
          <section className="card si-executive-summary" aria-labelledby="si-report-summary-heading">
            <div className="si-executive-top">
              <div>
                <span className="si-kicker"><Sparkles size={14} /> Executive summary · {report.label}</span>
                <h2 id="si-report-summary-heading">{report.is_partial_month ? 'Month to date' : 'Your month in review'}</h2>
                <p>{report.executive_summary}</p>
              </div>
              <div className="si-executive-badges"><DataBadge type="actual" /><span className="si-report-source">{report.is_partial_month ? 'Partial month' : 'Complete month'}</span></div>
            </div>
            <div className="si-report-kpis">
              <div><span>Completed spending</span><strong>{money(report.summary.total_spending_minor)}</strong><small>{report.summary.transaction_count} payments</small></div>
              <div><span>Average per day</span><strong>{money(report.summary.average_daily_spending_minor)}</strong><small>{money(report.summary.average_active_day_spending_minor)} on active days</small></div>
              <div><span>Largest expense</span><strong>{report.summary.largest_expense ? money(report.summary.largest_expense.amount_minor) : '—'}</strong><small>{report.summary.largest_expense ? `${report.summary.largest_expense.category} · ${report.summary.largest_expense.recipient_name}` : 'No completed expense'}</small></div>
              <div><span>Top category</span><strong className="si-category-value">{report.summary.highest_category?.category ?? '—'}</strong><small>{report.summary.highest_category ? `${money(report.summary.highest_category.amount_minor)} · ${report.summary.highest_category.percentage.toFixed(1)}%` : 'No category data'}</small></div>
            </div>
            {change && (
              <div className={`si-report-comparison ${changeTone}`}>
                {change.change_minor >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                <span>
                  {change.change_percent === null
                    ? 'No comparable spending in the previous window.'
                    : `${change.change_percent > 0 ? '+' : ''}${change.change_percent.toFixed(1)}% versus ${money(change.previous_total_minor)} in the comparison window.`}
                </span>
                <small>{change.basis}</small>
              </div>
            )}
          </section>

          <div className="si-report-grid">
            <section className="card si-panel" aria-labelledby="si-report-income-heading">
              <div className="si-panel-heading">
                <div><h2 id="si-report-income-heading">Income and outflow</h2><p>Only verified recorded amounts are shown as income.</p></div>
                <ShieldCheck size={17} className="si-muted-icon" />
              </div>
              <div className="si-income-honest">
                <div className="si-income-unavailable">
                  <span>Verified income</span>
                  <strong>Not available</strong>
                  <p>{report.income_and_outflow.income_unavailable_reason}</p>
                </div>
                <div className="si-income-demo">
                  <span>Demo funds added</span>
                  <strong>{money(report.income_and_outflow.demo_funds_added_minor)}</strong>
                  <small>{report.income_and_outflow.demo_funds_added_count} simulated top-up{report.income_and_outflow.demo_funds_added_count === 1 ? '' : 's'} · excluded from income and spending</small>
                </div>
                <div className="si-income-net">
                  <span>Net cash flow</span>
                  <strong>Not calculated</strong>
                  <small>Requires confirmed incoming funds, which this demo does not record.</small>
                </div>
              </div>
              <h3 className="si-subheading">Outflow by payment type</h3>
              <div className="si-outflow-list">
                {report.income_and_outflow.outflow_by_kind.map((item) => (
                  <div key={item.kind}>
                    <span>{item.label} <small>{item.transaction_count} payment{item.transaction_count === 1 ? '' : 's'}</small></span>
                    <div className="si-progress-track" aria-hidden="true"><span style={{ width: `${item.percentage}%` }} /></div>
                    <strong>{money(item.amount_minor)}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="card si-panel" aria-labelledby="si-report-budget-heading">
              <div className="si-panel-heading">
                <div><h2 id="si-report-budget-heading">Budget performance</h2><p>Limits and progress for this report month.</p></div>
                <ReceiptText size={17} className="si-muted-icon" />
              </div>
              {report.budgets.overall ? (
                <div className="si-report-budget-summary">
                  <div><span>Overall limit</span><strong>{money(report.budgets.overall.limit_minor)}</strong></div>
                  <div><span>Spent</span><strong>{money(report.budgets.overall.spent_minor)}</strong></div>
                  <div><span>Utilization</span><strong>{report.budgets.overall.utilization_percent.toFixed(1)}%</strong></div>
                </div>
              ) : <EmptyState title="No overall budget for this month" description="Budgets are optional; set one from the Budgets tab." />}
              {report.budgets.categories.length > 0 && (
                <div className="si-report-budget-categories">
                  {report.budgets.categories.map((entry) => (
                    <div key={entry.id ?? entry.category}>
                      <span>{entry.category}</span>
                      <div className="si-progress-track" aria-hidden="true"><span className={entry.status === 'exceeded' ? 'over' : entry.status === 'approaching' ? 'warn' : ''} style={{ width: `${Math.min(100, entry.utilization_percent)}%` }} /></div>
                      <strong>{entry.utilization_percent.toFixed(0)}%</strong>
                    </div>
                  ))}
                </div>
              )}
              <p className="si-panel-note">Comparable previous month: {money(report.budgets.comparison.previous_spending_minor)}{report.budgets.comparison.change_percent === null ? '' : ` · ${report.budgets.comparison.change_percent > 0 ? '+' : ''}${report.budgets.comparison.change_percent.toFixed(1)}%`}.</p>
            </section>
          </div>

          <section className="card si-panel" aria-labelledby="si-report-trend-heading">
            <div className="si-panel-heading">
              <div><h2 id="si-report-trend-heading">Six-month spending trend</h2><p>Completed outflow for each of the six months ending with this report month.</p></div>
              <DataBadge type="actual" />
            </div>
            <SpendingTrendChart
              monthly={report.six_month_history}
              mode="monthly"
              label={`Monthly completed spending for the six months ending ${report.label}`}
              description="All values are recorded actuals. No projection is shown in this report."
            />
          </section>

          <section className="card si-panel" aria-labelledby="si-report-categories-heading">
            <div className="si-panel-heading">
              <div><h2 id="si-report-categories-heading">Category totals</h2><p>Share of completed outflow, with the rules used to classify each category.</p></div>
              <DataBadge type="actual" />
            </div>
            {report.categories.length ? (
              <div className="si-report-category-table">
                <table className="si-data-table">
                  <caption className="si-sr-only">Category totals for {report.label}</caption>
                  <thead><tr><th scope="col">Category</th><th scope="col">Payments</th><th scope="col">Amount</th><th scope="col">Share</th></tr></thead>
                  <tbody>
                    {report.categories.map((category) => (
                      <tr key={category.category}>
                        <th scope="row"><button type="button" className="si-category-button" onClick={() => onViewCategory(category.category)}><span className="si-inline-dot" style={{ background: categoryColor(category.category) }} />{category.category}</button></th>
                        <td>{category.transaction_count}</td>
                        <td>{money(category.amount_minor)}</td>
                        <td><div className="si-share-cell"><span>{category.percentage.toFixed(1)}%</span><div className="si-progress-track" aria-hidden="true"><span style={{ width: `${category.percentage}%` }} /></div></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No completed spending this month" description="No eligible payments were recorded, so there are no category totals." />}
          </section>

          <div className="si-report-grid">
            <section className="card si-panel" aria-labelledby="si-report-merchants-heading">
              <div className="si-panel-heading"><div><h2 id="si-report-merchants-heading">Top merchants</h2><p>Recipients grouped consistently across months.</p></div></div>
              {report.top_merchants.length ? (
                <div className="si-merchant-list">
                  {report.top_merchants.slice(0, 6).map((merchant) => (
                    <div className="si-merchant-row" key={merchant.merchant_key}>
                      <div><strong>{merchant.name}</strong><small>{merchant.category} · {merchant.transaction_count} payment{merchant.transaction_count === 1 ? '' : 's'}{merchant.is_recurring ? ' · recurring' : ''}</small></div>
                      <strong>{money(merchant.amount_minor)}</strong>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No merchant activity" description="Merchant totals appear after completed eligible payments." />}
            </section>

            <section className="card si-panel" aria-labelledby="si-report-largest-heading">
              <div className="si-panel-heading"><div><h2 id="si-report-largest-heading">Largest transactions</h2><p>Individual completed payments, largest first.</p></div></div>
              {report.largest_transactions.length ? (
                <div className="si-largest-list">
                  {report.largest_transactions.slice(0, 5).map((transaction) => (
                    <div key={transaction.reference}>
                      <span className="si-inline-dot" style={{ background: categoryColor(transaction.category) }} />
                      <div><strong>{transaction.merchant || transaction.recipient_name}</strong><small>{shortDate(transaction.created_at)} · {transaction.category}</small></div>
                      <strong>{money(transaction.amount_minor)}</strong>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No completed transactions" description="This month has no eligible spending transactions." />}
            </section>
          </div>

          {report.recurring_payments.length > 0 && (
            <section className="card si-panel" aria-labelledby="si-report-recurring-heading">
              <div className="si-panel-heading"><div><h2 id="si-report-recurring-heading">Recurring payments</h2><p>Repeated amounts at the same merchant, based on recorded payments.</p></div></div>
              <div className="si-insight-grid">
                {report.recurring_payments.map((insight: SpendingInsight) => <InsightCard key={insight.title} insight={insight} compact onViewCategory={onViewCategory} />)}
              </div>
            </section>
          )}

          <section className="card si-panel" aria-labelledby="si-report-opportunities-heading">
            <div className="si-panel-heading">
              <div><h2 id="si-report-opportunities-heading">Unusual transactions and opportunities</h2><p>Compared with your own baseline. Suggestions are not facts and assume no automatic saving.</p></div>
              <span className="si-count-pill">{opportunities.length}</span>
            </div>
            {opportunities.length ? (
              <div className="si-insight-grid">
                {opportunities.map((item, index) => <InsightCard key={`${item.title}-${index}`} insight={item} onViewCategory={onViewCategory} />)}
              </div>
            ) : (
              <div className="si-small-empty">
                <ShieldCheck size={19} />
                <div><strong>Nothing unusual to flag</strong><p>Either no payment exceeded your own baseline, or there is not yet enough prior history.</p></div>
              </div>
            )}
          </section>

          <section className="card si-panel si-report-method" aria-labelledby="si-report-method-heading">
            <div className="si-panel-heading"><div><h2 id="si-report-method-heading">Report notes</h2><p>What this report includes, and what it deliberately does not.</p></div><CalendarRange size={17} className="si-muted-icon" /></div>
            <ul className="si-report-limitations">{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
            <p className="si-data-sufficiency">{report.method_note} · Generated {report.generated_at} · Source: {report.source}.</p>
            <p className="si-disclaimer">CSV and on-screen figures are built from the same verified transaction aggregates. This report does not infer a bank balance or unrecorded income.</p>
            <div className="si-report-footer-actions">
              <button type="button" className="button button-secondary button-sm" onClick={() => setSelectedMonth(shiftMonthValue(selectedMonth, -1))} disabled={selectedMonth <= earliestMonth}><ArrowLeft size={14} /> Previous month</button>
              <button type="button" className="text-link" onClick={() => void downloadCsv()}><Download size={13} /> Download CSV</button>
              <button type="button" className="button button-secondary button-sm" onClick={() => setSelectedMonth(shiftMonthValue(selectedMonth, 1))} disabled={selectedMonth >= latestMonth || selectedMonth >= currentMonthValue()}>Next month <ArrowRight size={14} /></button>
            </div>
          </section>
        </>
      )}
      <div className="si-report-demo-note">
        <WalletCards size={15} />
        <span>All transactions are simulated OnePay demo records. The report distinguishes demo top-ups from spending and never presents them as earned income.</span>
      </div>
    </div>
  );
}
