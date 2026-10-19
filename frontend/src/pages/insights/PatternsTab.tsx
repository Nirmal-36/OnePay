import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, CalendarClock, ChartNoAxesCombined, Gauge,
  LoaderCircle, Repeat2, ScanSearch, TrendingUp,
} from 'lucide-react';
import { apiErrorMessage } from '../../api/auth';
import {
  analyticsApi,
  type AnomaliesPayload,
  type ForecastPayload,
  type InsightsPayload,
  type SpendingInsight,
  type SpendingPeriod,
} from '../../api/analytics';
import { EmptyState } from '../../components/EmptyState';
import { InsightCard } from '../../components/insights/InsightCard';
import { DataBadge, ErrorCard, InfoTip, LoadingCard, compactMoney, money, shortDate } from '../../components/insights/shared';

interface PatternsTabProps {
  period: SpendingPeriod;
  dateFrom: string;
  dateTo: string;
  validRange: boolean;
  onViewCategory: (category: string) => void;
}

type LoadState<T> = { data: T | null; loading: boolean; error: string };

const emptyState = <T,>(): LoadState<T> => ({ data: null, loading: true, error: '' });

function InsightSection({
  title,
  description,
  insights,
  emptyTitle,
  emptyDescription,
  onViewCategory,
}: {
  title: string;
  description: string;
  insights: SpendingInsight[];
  emptyTitle: string;
  emptyDescription: string;
  onViewCategory: (category: string) => void;
}) {
  return (
    <section className="card si-panel" aria-labelledby={`si-section-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className="si-panel-heading">
        <div><h2 id={`si-section-${title.replace(/\s+/g, '-').toLowerCase()}`}>{title}</h2><p>{description}</p></div>
        <span className="si-count-pill">{insights.length}</span>
      </div>
      {insights.length ? (
        <div className="si-insight-grid">
          {insights.map((insight, index) => (
            <InsightCard key={`${insight.kind}-${insight.title}-${index}`} insight={insight} onViewCategory={onViewCategory} />
          ))}
        </div>
      ) : (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      )}
    </section>
  );
}

export function PatternsTab({ period, dateFrom, dateTo, validRange, onViewCategory }: PatternsTabProps) {
  const [insights, setInsights] = useState<LoadState<InsightsPayload>>(emptyState);
  const [forecast, setForecast] = useState<LoadState<ForecastPayload>>(emptyState);
  const [anomalies, setAnomalies] = useState<LoadState<AnomaliesPayload>>(emptyState);
  const [refreshKey, setRefreshKey] = useState(0);
  const forecastRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!validRange) {
      setInsights({ data: null, loading: false, error: 'Choose a valid date range.' });
      return;
    }
    let active = true;
    setInsights((current) => ({ ...current, loading: true, error: '' }));
    void analyticsApi.insights(period, dateFrom, dateTo)
      .then((result) => { if (active) setInsights({ data: result, loading: false, error: '' }); })
      .catch((error) => {
        if (active) setInsights({ data: null, loading: false, error: apiErrorMessage(error, 'Could not calculate behavioural insights.') });
      });
    return () => { active = false; };
  }, [period, dateFrom, dateTo, validRange, refreshKey]);

  useEffect(() => {
    let active = true;
    setForecast((current) => ({ ...current, loading: true, error: '' }));
    void analyticsApi.forecast()
      .then((result) => { if (active) setForecast({ data: result, loading: false, error: '' }); })
      .catch((error) => {
        if (active) setForecast({ data: null, loading: false, error: apiErrorMessage(error, 'Could not build a forecast.') });
      });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    if (!validRange) {
      setAnomalies({ data: null, loading: false, error: 'Choose a valid date range.' });
      return;
    }
    let active = true;
    setAnomalies((current) => ({ ...current, loading: true, error: '' }));
    void analyticsApi.anomalies(period, dateFrom, dateTo)
      .then((result) => { if (active) setAnomalies({ data: result, loading: false, error: '' }); })
      .catch((error) => {
        if (active) setAnomalies({ data: null, loading: false, error: apiErrorMessage(error, 'Could not check for unusual expenses.') });
      });
    return () => { active = false; };
  }, [period, dateFrom, dateTo, validRange, refreshKey]);

  const groups = useMemo(() => {
    const items = insights.data?.insights ?? [];
    const opportunities = items.filter((item) => item.severity === 'opportunity');
    const recurring = items.filter((item) => ['recurring_payment', 'repeated_merchant', 'frequent_small', 'subscription'].includes(item.kind));
    const patterns = items.filter((item) => !opportunities.includes(item) && !recurring.includes(item));
    return { opportunities, recurring, patterns };
  }, [insights.data]);

  const forecastData = forecast.data;
  const currentMonth = forecastData?.current_month;
  const nextMonth = forecastData?.next_month;
  const projectedRangeWidth = currentMonth ? Math.max(1, currentMonth.range_minor[1] - currentMonth.range_minor[0]) : 1;

  return (
    <div className="si-tab-content">
      <div className="si-alert-banner info">
        <ScanSearch size={18} aria-hidden="true" />
        <div>
          <strong>Behaviour patterns, not judgments</strong>
          <span>Each observation compares your selected period with your own recorded history. Nothing here is a universal "normal" or a psychological assessment. Avoidable spending is a suggestion for review.</span>
        </div>
        <InfoTip label="How insight eligibility works">Insights require at least three completed eligible payments in the period and enough varied activity. Forecasts have stricter requirements and are withheld until they are met.</InfoTip>
      </div>

      {insights.loading && !insights.data && <LoadingCard label="Looking for patterns in your own history…" />}
      {insights.error && !insights.data && <ErrorCard message={insights.error} onRetry={() => setRefreshKey((value) => value + 1)} />}
      {insights.data && (
        <>
          <section className="si-data-readiness card" aria-label="Data sufficiency">
            <div>
              <span className="si-kicker"><Gauge size={14} /> Data readiness</span>
              <strong>{insights.data.data_quality.sufficient_for_insights ? 'Enough history for these observations' : 'Limited history'}</strong>
              <p>{insights.data.empty_reason ?? insights.data.method_note}</p>
            </div>
            <dl className="si-readiness-stats">
              <div><dt>Eligible payments</dt><dd>{insights.data.data_quality.transaction_count}</dd></div>
              <div><dt>History</dt><dd>{insights.data.data_quality.history_days} days</dd></div>
              <div><dt>Complete months</dt><dd>{insights.data.data_quality.complete_months_with_spending.length}</dd></div>
              <div><dt>Insights</dt><dd>{insights.data.insights.length}</dd></div>
            </dl>
          </section>

          {groups.opportunities.length > 0 && (
            <InsightSection
              title="Opportunities to review"
              description="Suggestions only. OnePay cannot know whether any expense was necessary."
              insights={groups.opportunities}
              emptyTitle="No review suggestions"
              emptyDescription="Repeated activity that may be worth reviewing will appear here."
              onViewCategory={onViewCategory}
            />
          )}
          {groups.recurring.length > 0 && (
            <InsightSection
              title="Recurring and repeated payments"
              description="Repeated merchants, subscriptions, and frequent small payments."
              insights={groups.recurring}
              emptyTitle="No recurring pattern found"
              emptyDescription="At least three similar completed payments across different dates are needed."
              onViewCategory={onViewCategory}
            />
          )}
          <InsightSection
            title="Spending patterns and changes"
            description="Category concentration, weekday structure, trend direction, and comparisons with your own baseline."
            insights={groups.patterns}
            emptyTitle="No pattern crossed its evidence threshold"
            emptyDescription={insights.data.empty_reason ?? 'Add more completed payments to unlock behavioural insights.'}
            onViewCategory={onViewCategory}
          />
        </>
      )}

      <section
        className="card si-panel si-forecast-panel"
        aria-labelledby="si-forecast-heading"
        ref={forecastRef}
      >
        <div className="si-panel-heading">
          <div>
            <h2 id="si-forecast-heading">Spending forecast</h2>
            <p>Projections from your own daily and monthly history, kept separate from actual values.</p>
          </div>
          <DataBadge type="forecast" />
        </div>

        {forecast.loading && !forecastData && <div className="si-inline-state" role="status"><LoaderCircle className="spin" size={18} /> Building forecast…</div>}
        {forecast.error && !forecastData && <div className="si-inline-error" role="alert"><AlertTriangle size={15} /> {forecast.error}</div>}

        {forecastData && !forecastData.eligible && (
          <div className="si-small-empty">
            <CalendarClock size={19} />
            <div>
              <strong>A forecast needs more history</strong>
              <p>{forecastData.reasons[0] ?? 'Complete a few more months of payments to unlock projections.'}</p>
            </div>
          </div>
        )}

        {forecastData?.eligible && currentMonth && (
          <>
            <div className="si-forecast-grid">
              <div className="si-forecast-current">
                <span className="si-kicker"><ChartNoAxesCombined size={14} /> {currentMonth.label} · month to date + estimate</span>
                <div className="si-forecast-value-row">
                  <div><span>Actual so far</span><strong>{money(currentMonth.actual_to_date_minor)}</strong></div>
                  <span className="si-forecast-plus" aria-hidden="true">+</span>
                  <div><span>Projected remaining</span><strong>{money(currentMonth.projected_remaining_minor)}</strong></div>
                  <span className="si-forecast-plus" aria-hidden="true">=</span>
                  <div className="si-forecast-total"><span>Projected month total</span><strong>{money(currentMonth.projected_total_minor)}</strong></div>
                </div>
                <div className="si-range-visual" aria-hidden="true">
                  <span className="si-range-actual" style={{ width: `${Math.min(100, (currentMonth.actual_to_date_minor / Math.max(currentMonth.projected_total_minor, 1)) * 100)}%` }} />
                  <span className="si-range-projected" style={{ width: `${Math.min(100, (currentMonth.projected_remaining_minor / Math.max(currentMonth.projected_total_minor, 1)) * 100)}%` }} />
                </div>
                <div className="si-range-labels">
                  <span>Low {money(currentMonth.range_minor[0])}</span>
                  <span>{currentMonth.days_elapsed} days elapsed · {currentMonth.days_remaining} remaining</span>
                  <span>High {money(currentMonth.range_minor[1])}</span>
                </div>
                <p className="si-forecast-method">
                  Daily rate {money(currentMonth.daily_rate_minor)} from {currentMonth.daily_rate_basis}. Estimated range width {compactMoney(projectedRangeWidth)} based on historical daily variation.
                </p>
              </div>

              {nextMonth && (
                <div className="si-forecast-next">
                  <span className="si-kicker"><TrendingUp size={14} /> {nextMonth.label} · next month</span>
                  <strong>{money(nextMonth.projected_total_minor)}</strong>
                  <p>Weighted average of the last {nextMonth.weighted_months.length} complete months, favouring recent months. Range {money(nextMonth.range_minor[0])} to {money(nextMonth.range_minor[1])}.</p>
                  <div className="si-weighted-months">
                    {nextMonth.weighted_months.map((month) => (
                      <span key={month.month}><small>{month.label}</small><strong>{money(month.amount_minor)}</strong></span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {forecastData.category_projections.length > 0 && (
              <div className="si-forecast-categories">
                <h3>Category projections <span className="si-inline-note">Estimate, not a commitment</span></h3>
                <div className="si-forecast-category-grid">
                  {forecastData.category_projections.map((item) => (
                    <div key={item.category}>
                      <span>{item.category}</span>
                      <strong>{money(item.projected_total_minor)}</strong>
                      <small>{money(item.range_minor[0])} – {money(item.range_minor[1])}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <details className="si-calculation si-calculation-wide">
              <summary>Forecast method, limitations, and evidence</summary>
              <p>{forecastData.method.description}</p>
              <p className="si-data-sufficiency">{forecastData.method.label} · Based on {forecastData.history.transactions_last_180_days} completed payments over {forecastData.history.history_days} days, including {forecastData.history.complete_months_with_spending} complete month{forecastData.history.complete_months_with_spending === 1 ? '' : 's'} with spending.</p>
              <ul>{forecastData.method.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
            </details>
          </>
        )}
        <p className="si-forecast-honesty">Forecasts are estimates from past OnePay activity. They are not guarantees, do not include unrecorded income or bank balances, and cannot predict one-off events.</p>
      </section>

      <section className="card si-panel" aria-labelledby="si-anomalies-heading">
        <div className="si-panel-heading">
          <div>
            <h2 id="si-anomalies-heading">Unusually large expenses</h2>
            <p>Compared with your own previous 180 days, using a robust median-based rule. Not a judgment that a payment is wrong.</p>
          </div>
          <InfoTip label="How unusual expenses are detected">A payment is flagged only when it exceeds twice your median completed payment and has a robust z-score of at least 3.5 against your own prior history. With fewer than ten prior payments, no flags are produced.</InfoTip>
        </div>
        {anomalies.loading && !anomalies.data && <div className="si-inline-state" role="status"><LoaderCircle className="spin" size={18} /> Checking your baseline…</div>}
        {anomalies.error && !anomalies.data && <div className="si-inline-error" role="alert">{anomalies.error}</div>}
        {anomalies.data && (
          <>
            {anomalies.data.eligible ? (
              anomalies.data.anomalies.length ? (
                <div className="si-anomaly-list">
                  {anomalies.data.anomalies.map((anomaly) => (
                    <div className="si-anomaly-row" key={`${anomaly.type}-${anomaly.reference ?? anomaly.date}`}>
                      <span className={`si-anomaly-icon ${anomaly.type}`}><Activity size={16} /></span>
                      <div>
                        <strong>{anomaly.merchant ?? 'Day-level spending'} · {money(anomaly.amount_minor)}</strong>
                        <span>{shortDate(anomaly.date)} · {anomaly.category ?? 'Multiple categories'}</span>
                        <p>{anomaly.explanation}</p>
                      </div>
                      <span className="si-anomaly-multiple">{anomaly.multiple_of_median === null ? '—' : `${anomaly.multiple_of_median.toFixed(1)}× median`}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="si-small-empty">
                  <ScanSearch size={19} />
                  <div><strong>No unusual expense in this period</strong><p>Nothing exceeded more than twice your own median completed payment with strong deviation.</p></div>
                </div>
              )
            ) : (
              <div className="si-small-empty">
                <Repeat2 size={19} />
                <div><strong>Not enough prior history for a baseline</strong><p>{anomalies.data.reasons[0] ?? 'At least ten completed payments before this period are needed.'}</p></div>
              </div>
            )}
            {anomalies.data.anomalies.length > 0 && (
              <p className="si-panel-note">
                Baseline: median {money(anomalies.data.baseline.median_minor)} from {anomalies.data.baseline.transaction_count} prior payments.
                <button type="button" className="text-link si-inline-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top <ArrowRight size={12} /></button>
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
