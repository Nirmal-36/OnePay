import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, LoaderCircle, RefreshCw } from 'lucide-react';
import { formatRupees } from '../../types';

export const CATEGORY_COLORS: Record<string, string> = {
  'Food and Dining': '#7654dc',
  Groceries: '#2f9a76',
  'Transport and Fuel': '#d99a45',
  Shopping: '#4d81cf',
  'Bills and Utilities': '#d16f87',
  'Mobile Recharge': '#8b67c7',
  Entertainment: '#dd7a4f',
  Healthcare: '#3fa3a1',
  Education: '#7188c5',
  Travel: '#58a56f',
  'Personal Care': '#c688a7',
  Housing: '#b49545',
  Subscriptions: '#8880a8',
  'Financial Services': '#6f8294',
  Transfers: '#9786d5',
  Income: '#2e9d73',
  Refunds: '#5c9cc9',
  Other: '#b7b2c4',
};

export const categoryColor = (category: string) => CATEGORY_COLORS[category] ?? '#8d7cbf';

export const money = (minor: number | null | undefined) => formatRupees(Number(minor ?? 0));

export const compactMoney = (minor: number): string => {
  const rupees = minor / 100;
  if (Math.abs(rupees) >= 10_00_000) return `₹${(rupees / 10_00_000).toFixed(1)}L`;
  if (Math.abs(rupees) >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
};

export const indiaDateISO = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const todayISO = () => indiaDateISO();
export const firstDayOfMonthISO = () => `${indiaDateISO().slice(0, 7)}-01`;

export const monthLabel = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  if (!year || !month) return monthValue;
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

export const shiftMonthValue = (monthValue: string, offset: number) => {
  const [year, month] = monthValue.split('-').map(Number);
  const next = new Date(year, month - 1 + offset, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
};

export const shortDate = (value: string) => {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date);
};

export function DataBadge({ type = 'actual' }: { type?: 'actual' | 'estimate' | 'forecast' }) {
  return (
    <span className={`si-data-badge ${type}`}>
      {type === 'actual' ? 'Actual' : type === 'estimate' ? 'Estimate' : 'Forecast'}
    </span>
  );
}

export function InfoTip({ children, label }: { children: ReactNode; label: string }) {
  const id = `si-tip-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <span className="si-tip-wrap">
      <button type="button" className="si-tip-button" aria-label={label} aria-describedby={id}>
        <Info size={12} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className="si-tip-bubble">{children}</span>
    </span>
  );
}

export function LoadingCard({ label = 'Loading analysis…' }: { label?: string }) {
  return (
    <div className="card si-state-card" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card si-state-card si-state-error" role="alert">
      <AlertTriangle size={21} aria-hidden="true" />
      <div><strong>Could not load this analysis</strong><p>{message}</p></div>
      <button type="button" className="button button-secondary button-sm" onClick={onRetry}>
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  );
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function confidenceLabel(score: number): string {
  if (score >= 0.8) return 'Strong evidence';
  if (score >= 0.6) return 'Moderate evidence';
  return 'Limited evidence';
}

export function statusTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'on_track' || status === 'complete') return 'good';
  if (status === 'approaching') return 'warn';
  if (status === 'exceeded' || status === 'overdue') return 'bad';
  return 'neutral';
}
