import { paymentRequest } from './auth';

export type SpendingPeriod = 'this_month' | 'last_month' | 'last_3_months' | 'last_6_months' | 'this_year' | 'custom';

export interface SpendingCategory {
  category: string;
  amount_minor: number;
  transaction_count: number;
  percentage: number;
}

export interface SpendingTransaction {
  reference: string;
  recipient_name: string;
  kind: 'transfer' | 'bill' | 'recharge';
  service: string;
  note: string;
  amount_minor: number;
  currency: 'INR';
  status: 'successful';
  created_at: string;
  category: string;
  subcategory: string;
  classification_method: 'merchant_rule' | 'metadata_rule';
  confidence: number;
  source: 'simulated';
}

export interface SpendingSummary {
  period: { key: SpendingPeriod; start_date: string; end_date: string; days: number };
  total_spending_minor: number;
  average_daily_spending_minor: number;
  transaction_count: number;
  money_received_minor: number | null;
  net_cash_flow_minor: number | null;
  income_data_available: boolean;
  income_unavailable_reason: string;
  demo_topups_minor: number;
  demo_topup_count: number;
  largest_expense: null | {
    reference: string;
    recipient_name: string;
    amount_minor: number;
    created_at: string;
    category: string;
  };
  highest_category: SpendingCategory | null;
  categories: SpendingCategory[];
  daily_trend: { date: string; amount_minor: number }[];
  excluded_activity: Record<'pending' | 'failed' | 'reversed', { count: number; amount_minor: number }>;
  month_over_month: null | {
    current_period_start: string;
    current_period_end: string;
    comparison_start: string;
    comparison_end: string;
    current_total_minor: number;
    previous_total_minor: number;
    change_minor: number;
    change_percent: number | null;
  };
  recent_transactions: SpendingTransaction[];
  categorization: {
    method: string;
    external_ai_used: false;
    confidence_note: string;
  };
}

export interface SpendingTransactionsPage {
  period: { key: SpendingPeriod; start_date: string; end_date: string };
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  results: SpendingTransaction[];
}

function queryFor(period: SpendingPeriod, dateFrom?: string, dateTo?: string) {
  const params = new URLSearchParams({ period });
  if (period === 'custom') {
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
  }
  return params.toString();
}

export const analyticsApi = {
  summary: (period: SpendingPeriod, dateFrom?: string, dateTo?: string) =>
    paymentRequest<SpendingSummary>(`analytics/summary/?${queryFor(period, dateFrom, dateTo)}`),
  transactions: (period: SpendingPeriod, category?: string, dateFrom?: string, dateTo?: string, page = 1) => {
    const params = new URLSearchParams(queryFor(period, dateFrom, dateTo));
    if (category) params.set('category', category);
    params.set('page', String(page));
    params.set('page_size', '20');
    return paymentRequest<SpendingTransactionsPage>(`analytics/transactions/?${params.toString()}`);
  },
};
