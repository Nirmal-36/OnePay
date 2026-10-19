import { CalendarDays } from 'lucide-react';
import type { SpendingPeriod } from '../../api/analytics';
import { InfoTip } from './shared';

export const PERIOD_OPTIONS: { value: SpendingPeriod; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom date range' },
];

export function PeriodFilter({
  period,
  onPeriodChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  maxDate,
  rangeNote,
  invalidRange,
}: {
  period: SpendingPeriod;
  onPeriodChange: (period: SpendingPeriod) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  maxDate: string;
  rangeNote?: string;
  invalidRange?: boolean;
}) {
  return (
    <section className="card si-filter-card" aria-label="Analysis date range">
      <div className="si-filter-heading">
        <span className="si-filter-icon"><CalendarDays size={17} aria-hidden="true" /></span>
        <div>
          <strong>Analysis period</strong>
          <span>Every figure below uses completed payments in these dates.</span>
        </div>
      </div>
      <div className="si-filter-controls">
        <label className="si-compact-field">
          <span>Period</span>
          <select value={period} onChange={(event) => onPeriodChange(event.target.value as SpendingPeriod)}>
            {PERIOD_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <span className="si-period-tip">
          <InfoTip label="How date ranges are calculated">Custom ranges must include both dates and cover at most 366 days. Date boundaries use Asia/Kolkata local midnight.</InfoTip>
        </span>
        {period === 'custom' && (
          <>
            <label className="si-compact-field">
              <span>From</span>
              <input type="date" value={dateFrom} max={dateTo || maxDate} onChange={(event) => onDateFromChange(event.target.value)} />
            </label>
            <label className="si-compact-field">
              <span>To</span>
              <input type="date" value={dateTo} min={dateFrom} max={maxDate} onChange={(event) => onDateToChange(event.target.value)} />
            </label>
          </>
        )}
      </div>
      {rangeNote && <p className={`si-range-note ${invalidRange ? 'invalid' : ''}`} role={invalidRange ? 'alert' : 'status'}>{rangeNote}</p>}
    </section>
  );
}
