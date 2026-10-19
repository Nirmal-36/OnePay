import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { BudgetEntry } from '../../api/analytics';
import { money, statusTone } from './shared';

const STATUS_LABEL: Record<string, string> = {
  on_track: 'On track',
  approaching: 'Approaching limit',
  exceeded: 'Limit exceeded',
  no_limit: 'No limit',
  complete: 'Complete',
  overdue: 'Past target date',
};

export function BudgetProgress({
  entry,
  compact = false,
  showLimit = true,
}: {
  entry: BudgetEntry;
  compact?: boolean;
  showLimit?: boolean;
}) {
  const tone = statusTone(entry.status);
  const percent = Math.min(100, Math.max(0, entry.utilization_percent));
  const Icon = tone === 'bad' ? ShieldAlert : tone === 'warn' ? AlertTriangle : CheckCircle2;
  return (
    <div className={`si-budget-progress ${tone} ${compact ? 'compact' : ''}`}>
      <div className="si-budget-progress-top">
        <div>
          <strong>{entry.label || entry.category || 'Overall budget'}</strong>
          {showLimit && <small>{money(entry.spent_minor)} of {money(entry.limit_minor)} used</small>}
        </div>
        <div className="si-budget-progress-value">
          <strong>{entry.utilization_percent.toFixed(1)}%</strong>
          <span className={`si-status-chip ${tone}`}><Icon size={12} aria-hidden="true" /> {STATUS_LABEL[entry.status] ?? entry.status}</span>
        </div>
      </div>
      <div
        className="si-progress-track"
        role="progressbar"
        aria-label={`${entry.label || entry.category || 'Overall'} budget utilization`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={`${entry.utilization_percent.toFixed(1)}% used`}
      >
        <span className={`si-progress-fill ${tone}`} style={{ width: `${percent}%` }} />
        {entry.utilization_percent > 100 && <span className="si-progress-over" />}
      </div>
      {!compact && (
        <div className="si-budget-progress-foot">
          <span>{entry.remaining_minor >= 0 ? `${money(entry.remaining_minor)} remaining` : `${money(Math.abs(entry.remaining_minor))} over limit`}</span>
          {entry.warning && <span className={`si-budget-warning ${tone}`}>{entry.warning}</span>}
        </div>
      )}
    </div>
  );
}
