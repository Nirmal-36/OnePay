import { paymentRequest } from './auth';

export type SpendingPeriod = 'this_month' | 'last_month' | 'last_3_months' | 'last_6_months' | 'this_year' | 'custom';

export interface PeriodInfo {
  key: string;
  label: string;
  start_date: string;
  end_date: string;
  days: number;
  is_partial_month: boolean;
}

export interface SpendingSubcategory {
  subcategory: string;
  amount_minor: number;
  transaction_count: number;
}

export interface SpendingCategory {
  category: string;
  amount_minor: number;
  transaction_count: number;
  percentage: number;
  consumption_percentage?: number;
  budgetable?: boolean;
  subcategories?: SpendingSubcategory[];
}

export interface SpendingTransaction {
  reference: string;
  recipient_name: string;
  merchant?: string;
  merchant_key?: string;
  kind: 'transfer' | 'bill' | 'recharge';
  service: string;
  note: string;
  amount_minor: number;
  currency: 'INR';
  status: 'successful';
  direction?: 'debit';
  created_at: string;
  category: string;
  subcategory: string;
  classification_method: 'merchant_rule' | 'metadata_rule' | 'manual_override' | 'configured_classifier' | 'llm_fallback' | 'fallback';
  confidence: number;
  is_consumption?: boolean;
  source: 'simulated';
}

export interface MonthlyTrendPoint {
  month: string;
  label: string;
  amount_minor: number;
  transaction_count: number;
  consumption_minor?: number;
}

export interface MerchantSummary {
  merchant_key: string;
  name: string;
  amount_minor: number;
  transaction_count: number;
  percentage: number;
  category: string;
  last_date: string;
  references: string[];
  is_recurring: boolean;
}

export interface InsightConfidence {
  level: 'low' | 'medium' | 'high';
  score: number;
  sample_size: number;
  data_sufficiency: string;
}

export interface SpendingInsight {
  kind: string;
  title: string;
  explanation: string;
  evidence: Record<string, unknown> & {
    amount_minor?: number;
    category?: string;
    categories?: string[];
    dates?: string[];
    references?: string[];
    merchant?: string;
    merchant_key?: string;
    transaction_count?: number;
  };
  baseline: Record<string, unknown> & { label?: string; amount_minor?: number };
  calculation: string;
  action: string;
  confidence: InsightConfidence;
  severity: 'info' | 'watch' | 'opportunity';
  caveat: string;
  data_type: 'actual';
}

export interface DataQuality {
  transaction_count: number;
  eligible_days: number;
  period_days: number;
  history_days: number;
  first_transaction_date: string | null;
  months_in_period: string[];
  complete_months_with_spending: string[];
  sufficient_for_insights: boolean;
  sufficient_for_forecast: boolean;
  thresholds: {
    insights_min_transactions: number;
    insights_min_history_days: number;
    forecast_min_transactions: number;
    forecast_min_history_days: number;
    forecast_min_complete_months: number;
  };
  notes: string[];
}

export interface BudgetEntry {
  id?: number;
  category: string;
  label?: string;
  limit_minor: number;
  spent_minor: number;
  remaining_minor: number;
  utilization_percent: number;
  status: 'on_track' | 'approaching' | 'exceeded' | 'no_limit';
  warning: string | null;
  is_over: boolean;
}

export interface BudgetWarning {
  scope: 'overall' | 'category';
  category: string;
  status: 'approaching' | 'exceeded';
  message: string;
  utilization_percent: number;
}

export interface BudgetRecommendation {
  available: boolean;
  label: 'Estimate';
  basis: string;
  months_used: string[];
  reason?: string;
  overall_estimate_minor: number | null;
  average_monthly_spending_minor?: number;
  categories: { category: string; average_monthly_minor: number; suggested_limit_minor: number; transaction_count: number }[];
  limitations: string[];
}

export interface BudgetOverview {
  month: string;
  label: string;
  period: PeriodInfo;
  is_current_month: boolean;
  is_future_month: boolean;
  consumption_spending_minor: number;
  total_category_limits_minor: number;
  overall: BudgetEntry | null;
  categories: BudgetEntry[];
  unbudgeted_categories: { category: string; spent_minor: number }[];
  warnings: BudgetWarning[];
  comparison: {
    previous_month: string;
    previous_spending_minor: number;
    change_minor: number;
    change_percent: number | null;
  };
  has_any_budget: boolean;
  calculation_note: string;
  recommendation?: BudgetRecommendation;
  available_categories?: { name: string; subcategories: string[]; budgetable: boolean }[];
}

export interface SavingsGoal {
  id: number;
  name: string;
  target_amount_minor: number;
  saved_amount_minor: number;
  remaining_minor: number;
  target_date: string | null;
  note: string;
  is_archived: boolean;
  progress_percent: number;
  raw_progress_percent: number;
  is_complete: boolean;
  days_remaining: number | null;
  monthly_amount_needed_minor: number;
  status: 'complete' | 'overdue' | 'on_track';
  progress_source: 'user_recorded';
  note_on_progress: string;
}

export interface SpendingSummary {
  period: PeriodInfo;
  generated_at: string;
  total_spending_minor: number;
  consumption_spending_minor: number;
  average_daily_spending_minor: number;
  average_active_day_spending_minor: number;
  active_spending_days: number;
  transaction_count: number;
  money_received_minor: null;
  net_cash_flow_minor: null;
  income_data_available: false;
  income_unavailable_reason: string;
  money_received: {
    available: false;
    verified_income_available: false;
    demo_funds_added_minor: number;
    demo_funds_added_count: number;
    label: string;
    note: string;
  };
  demo_topups_minor: number;
  demo_topup_count: number;
  largest_expense: null | {
    reference: string;
    recipient_name: string;
    merchant: string;
    amount_minor: number;
    created_at: string;
    category: string;
    subcategory: string;
    percentage_of_period: number;
  };
  highest_category: SpendingCategory | null;
  categories: SpendingCategory[];
  daily_trend: { date: string; amount_minor: number; transaction_count: number }[];
  monthly_trend: MonthlyTrendPoint[];
  weekday_weekend: {
    weekday: { amount_minor: number; transaction_count: number; days: number; average_minor: number; share_percent: number };
    weekend: { amount_minor: number; transaction_count: number; days: number; average_minor: number; share_percent: number };
    difference_percent: number | null;
    definition: string;
  };
  top_merchants: MerchantSummary[];
  month_over_month: {
    current_period_start: string;
    current_period_end: string;
    comparison_start: string;
    comparison_end: string;
    current_total_minor: number;
    previous_total_minor: number;
    change_minor: number;
    change_percent: number | null;
    basis: string;
  };
  comparison: {
    start_date: string;
    end_date: string;
    current_total_minor: number;
    previous_total_minor: number;
    change_minor: number;
    change_percent: number | null;
    note: string;
  };
  recent_transactions: SpendingTransaction[];
  recent_insights: SpendingInsight[];
  insights_available: number;
  budget_overview: BudgetOverview;
  budget_warnings: BudgetWarning[];
  excluded_activity: Record<'pending' | 'failed' | 'reversed' | 'internal_transfer', { count: number; amount_minor: number }>;
  data_quality: DataQuality;
  categorization: {
    method: string;
    external_ai_used: boolean;
    external_ai_configured: boolean;
    external_ai_consent: boolean;
    enabled_for_user: boolean;
    configured: boolean;
    consent: boolean;
    data_sent: string;
    user_corrections_stored: number;
    confidence_note: string;
  };
  calculation_notes: string[];
}

export interface SpendingTransactionsPage {
  period: PeriodInfo;
  filters: {
    category: string;
    subcategory: string;
    search: string;
    min_amount_minor: number | null;
    max_amount_minor: number | null;
    sort: TransactionSort;
  };
  count: number;
  filtered_total_minor: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  results: SpendingTransaction[];
}

export type TransactionSort = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export interface TransactionQuery {
  period: SpendingPeriod;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  subcategory?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: TransactionSort;
  minAmountMinor?: number;
  maxAmountMinor?: number;
}

export interface InsightsPayload {
  period: PeriodInfo;
  insights: SpendingInsight[];
  total_insights?: number;
  data_quality: DataQuality;
  generated_at: string;
  method: string;
  method_note: string;
  empty_reason: string | null;
}

export interface ForecastMonthProjection {
  month: string;
  label: string;
  actual_to_date_minor: number;
  projected_remaining_minor: number;
  projected_total_minor: number;
  range_minor: [number, number];
  range_method: string;
  days_elapsed: number;
  days_remaining: number;
  daily_rate_minor: number;
  daily_deviation_minor: number;
  daily_rate_basis: string;
  data_type: 'forecast';
  is_estimate: true;
}

export interface NextMonthProjection {
  month: string;
  label: string;
  projected_total_minor: number;
  range_minor: [number, number];
  weighted_months: MonthlyTrendPoint[];
  method: string;
  data_type: 'forecast';
  is_estimate: true;
}

export interface ForecastPayload {
  as_of_date: string;
  eligible: boolean;
  reasons: string[];
  history: {
    first_transaction_date: string | null;
    history_days: number;
    complete_months: MonthlyTrendPoint[];
    complete_months_with_spending: number;
    transactions_last_180_days: number;
    active_days_last_90_days: number;
    period_covered: { start_date: string; end_date: string };
  };
  method: {
    key: string;
    label: string;
    description: string;
    limitations: string[];
  };
  current_month: ForecastMonthProjection | null;
  next_month: NextMonthProjection | null;
  category_projections: {
    category: string;
    projected_total_minor: number;
    range_minor: [number, number];
    monthly_values: number[];
    data_type: 'forecast';
    is_estimate: true;
  }[];
  daily_projection: { date: string; projected_minor: number; data_type: 'forecast'; is_estimate: true }[];
  data_type: 'forecast';
  is_estimate: true;
}

export interface Anomaly {
  type: 'transaction' | 'day';
  reference?: string;
  date: string;
  merchant?: string;
  category?: string;
  amount_minor: number;
  baseline_median_minor: number;
  baseline_mad_minor: number;
  multiple_of_median: number | null;
  explanation: string;
  confidence: 'medium' | 'high';
  data_type: 'actual';
  is_estimate: false;
}

export interface AnomaliesPayload {
  period: PeriodInfo;
  eligible: boolean;
  reasons: string[];
  anomalies: Anomaly[];
  baseline: { transaction_count: number; median_minor: number | null; mad_minor: number | null; active_days?: number };
  method: { key: string; description: string; limitations: string[] };
  data_quality: DataQuality;
}

export interface ReportMonth {
  month: string;
  label: string;
  has_data: boolean;
  transaction_count: number;
  is_current: boolean;
}

export interface MonthlyReport {
  report_type: 'monthly_spending_report';
  month: string;
  label: string;
  period: PeriodInfo;
  generated_at: string;
  source: string;
  is_partial_month: boolean;
  summary: {
    total_spending_minor: number;
    consumption_spending_minor: number;
    transaction_count: number;
    average_daily_spending_minor: number;
    average_active_day_spending_minor: number;
    largest_expense: SpendingSummary['largest_expense'];
    highest_category: SpendingCategory | null;
    demo_topups_minor: number;
    demo_topup_count: number;
  };
  income_and_outflow: {
    income_available: false;
    income_unavailable_reason: string;
    verified_income_minor: null;
    demo_funds_added_minor: number;
    demo_funds_added_count: number;
    outflow_by_kind: { kind: string; label: string; amount_minor: number; transaction_count: number; percentage: number }[];
    net_cash_flow_minor: null;
    money_received_minor: null;
  };
  categories: SpendingCategory[];
  top_merchants: MerchantSummary[];
  largest_transactions: SpendingTransaction[];
  recurring_payments: SpendingInsight[];
  weekday_weekend: SpendingSummary['weekday_weekend'];
  month_over_month: SpendingSummary['month_over_month'];
  six_month_history: MonthlyTrendPoint[];
  daily_trend: SpendingSummary['daily_trend'];
  budgets: BudgetOverview;
  savings_goals: { active_goal_count: number; total_target_minor: number; total_saved_minor: number; total_remaining_minor: number; progress_percent: number };
  unusual_transactions: (SpendingInsight | Anomaly)[];
  opportunities: SpendingInsight[];
  executive_summary: string;
  data_quality: DataQuality;
  method_note: string;
  limitations: string[];
}

export interface AnalyticsPreference {
  external_ai_consent: boolean;
  consent_updated_at: string | null;
  status: {
    configured: boolean;
    consent: boolean;
    enabled_for_user: boolean;
    provider: string | null;
    data_sent: string;
  };
  privacy_note: string;
}

export interface AnalyticsMeta {
  categories: { name: string; subcategories: string[]; budgetable: boolean }[];
  periods: { key: SpendingPeriod; label: string }[];
  categorization: AnalyticsPreference['status'];
  rules: string[];
  privacy: string;
  money_received: { income_tracking_available: false; reason: string };
}

export interface CategoryDetail {
  reference: string;
  status: string;
  kind: string;
  amount_minor: number;
  created_at: string;
  merchant: string;
  merchant_key: string;
  category: string;
  subcategory: string;
  classification_method: SpendingTransaction['classification_method'];
  confidence: number;
  is_internal_transfer: boolean;
  is_consumption: boolean;
  eligible_for_spending: boolean;
  correction: null | { id: number; category: string; subcategory: string; apply_to_future: boolean; updated_at: string };
  available_categories: { name: string; subcategories: string[]; budgetable: boolean }[];
}

function periodQuery(period: SpendingPeriod, dateFrom?: string, dateTo?: string) {
  const params = new URLSearchParams({ period });
  if (period === 'custom') {
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
  }
  return params;
}

function periodString(period: SpendingPeriod, dateFrom?: string, dateTo?: string) {
  return periodQuery(period, dateFrom, dateTo).toString();
}

export const analyticsApi = {
  summary: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<SpendingSummary>(`analytics/summary/?${periodString(period, dateFrom, dateTo)}`),
  transactions: (query: TransactionQuery) => {
    const params = periodQuery(query.period, query.dateFrom, query.dateTo);
    if (query.category) params.set('category', query.category);
    if (query.subcategory) params.set('subcategory', query.subcategory);
    if (query.search) params.set('search', query.search);
    if (query.sort) params.set('sort', query.sort);
    if (query.minAmountMinor !== undefined) params.set('min_amount_minor', String(query.minAmountMinor));
    if (query.maxAmountMinor !== undefined) params.set('max_amount_minor', String(query.maxAmountMinor));
    params.set('page', String(query.page ?? 1));
    params.set('page_size', String(query.pageSize ?? 20));
    return paymentRequest<SpendingTransactionsPage>(`analytics/transactions/?${params.toString()}`);
  },
  categories: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<{ period: PeriodInfo; total_spending_minor: number; consumption_spending_minor: number; categories: SpendingCategory[]; data_quality: DataQuality }>(
      `analytics/categories/?${periodString(period, dateFrom, dateTo)}`,
    ),
  trends: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<{
      period: PeriodInfo;
      total_spending_minor: number;
      daily: { date: string; amount_minor: number; transaction_count: number }[];
      monthly: MonthlyTrendPoint[];
      weekday_weekend: SpendingSummary['weekday_weekend'];
      comparison: SpendingSummary['comparison'];
    }>(`analytics/trends/?${periodString(period, dateFrom, dateTo)}`),
  merchants: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<{ period: PeriodInfo; merchants: MerchantSummary[]; repeated_merchants: MerchantSummary[] }>(
      `analytics/merchants/?${periodString(period, dateFrom, dateTo)}`,
    ),
  insights: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<InsightsPayload>(`analytics/insights/?${periodString(period, dateFrom, dateTo)}`),
  forecast: () => paymentRequest<ForecastPayload>('analytics/forecast/'),
  anomalies: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<AnomaliesPayload>(`analytics/anomalies/?${periodString(period, dateFrom, dateTo)}`),
  reportMonths: () => paymentRequest<{ months: ReportMonth[] }>('analytics/reports/months/'),
  report: (year: number, month: number) => paymentRequest<MonthlyReport>(`analytics/reports/${year}/${month}/`),
  reportExportUrl: (year: number, month: number) => `/api/v1/analytics/reports/${year}/${month}/export.csv`,
  rangeReportExportUrl: (dateFrom: string, dateTo: string) => {
    const params = new URLSearchParams({ period: 'custom', date_from: dateFrom, date_to: dateTo });
    return `/api/v1/analytics/reports/export.csv?${params.toString()}`;
  },
  budgets: (month?: string) => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return paymentRequest<BudgetOverview>(`analytics/budgets/${suffix}`);
  },
  createBudget: (payload: { month: string; category: string; limit_minor: number }) =>
    paymentRequest<{ budget: { id: number; month: string; category: string; limit_minor: number }; overview: BudgetOverview; created: boolean }>(
      'analytics/budgets/',
      { method: 'POST', body: payload },
    ),
  updateBudget: (id: number, payload: { month?: string; category?: string; limit_minor?: number }) =>
    paymentRequest<{ budget: { id: number; month: string; category: string; limit_minor: number }; overview: BudgetOverview }>(
      `analytics/budgets/${id}/`,
      { method: 'PATCH', body: payload },
    ),
  deleteBudget: (id: number) =>
    paymentRequest<{ deleted: boolean; overview: BudgetOverview }>(`analytics/budgets/${id}/`, { method: 'DELETE' }),
  goals: (includeArchived = false) =>
    paymentRequest<{
      count: number;
      goals: SavingsGoal[];
      summary: { active_goal_count: number; total_target_minor: number; total_saved_minor: number; completed_count: number };
      note: string;
    }>(`analytics/goals/${includeArchived ? '?include_archived=true' : ''}`),
  createGoal: (payload: { name: string; target_amount_minor: number; saved_amount_minor?: number; target_date?: string | null; note?: string }) =>
    paymentRequest<{ goal: SavingsGoal }>('analytics/goals/', { method: 'POST', body: payload }),
  updateGoal: (id: number, payload: Partial<{ name: string; target_amount_minor: number; saved_amount_minor: number; target_date: string | null; note: string; is_archived: boolean }>) =>
    paymentRequest<{ goal: SavingsGoal }>(`analytics/goals/${id}/`, { method: 'PATCH', body: payload }),
  deleteGoal: (id: number) => paymentRequest<void>(`analytics/goals/${id}/`, { method: 'DELETE' }),
  categoryDetail: (reference: string) => paymentRequest<CategoryDetail>(`analytics/transactions/${reference}/category/`),
  saveCategory: (reference: string, payload: { category: string; subcategory: string; apply_to_future: boolean }) =>
    paymentRequest<{ correction: Record<string, unknown>; transaction: CategoryDetail; note: string }>(
      `analytics/transactions/${reference}/category/`,
      { method: 'POST', body: payload },
    ),
  deleteCategory: (reference: string) =>
    paymentRequest<void>(`analytics/transactions/${reference}/category/`, { method: 'DELETE' }),
  corrections: () => paymentRequest<{ count: number; results: Record<string, unknown>[] }>('analytics/corrections/'),
  preferences: () => paymentRequest<AnalyticsPreference>('analytics/preferences/'),
  updatePreferences: (externalAiConsent: boolean) =>
    paymentRequest<AnalyticsPreference>('analytics/preferences/', {
      method: 'PATCH',
      body: { external_ai_consent: externalAiConsent },
    }),
  meta: () => paymentRequest<AnalyticsMeta>('analytics/meta/'),
};
