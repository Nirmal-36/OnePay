import { ArrowRight, Eye, Gauge, SearchCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SpendingInsight } from '../../api/analytics';
import { confidenceLabel, DataBadge, money, shortDate } from './shared';

const SEVERITY_LABEL = {
  info: 'Observation',
  watch: 'Worth a look',
  opportunity: 'Opportunity to review',
} as const;

export function InsightCard({
  insight,
  onViewCategory,
  compact = false,
}: {
  insight: SpendingInsight;
  onViewCategory?: (category: string) => void;
  compact?: boolean;
}) {
  const evidence = insight.evidence;
  const references = Array.isArray(evidence.references) ? evidence.references.slice(0, 3) : [];
  const dates = Array.isArray(evidence.dates) ? evidence.dates.slice(0, 3) : [];
  const category = typeof evidence.category === 'string' ? evidence.category : '';
  const amount = typeof evidence.amount_minor === 'number' ? evidence.amount_minor : null;
  const baselineAmount = typeof insight.baseline.amount_minor === 'number' ? insight.baseline.amount_minor : null;
  const confidencePercent = Math.round(insight.confidence.score * 100);

  return (
    <article className={`si-insight-card severity-${insight.severity} ${compact ? 'compact' : ''}`}>
      <div className="si-insight-top">
        <span className={`si-severity-pill ${insight.severity}`}>
          {insight.severity === 'opportunity' ? <SearchCheck size={13} /> : insight.severity === 'watch' ? <Eye size={13} /> : <Sparkles size={13} />}
          {SEVERITY_LABEL[insight.severity]}
        </span>
        <div className="si-insight-badges">
          <DataBadge type="actual" />
          <span className={`si-confidence-chip ${insight.confidence.level}`} title={insight.confidence.data_sufficiency}>
            <Gauge size={12} aria-hidden="true" /> {confidenceLabel(insight.confidence.score)}
          </span>
        </div>
      </div>

      <h3>{insight.title}</h3>
      <p className="si-insight-explanation">{insight.explanation}</p>

      <dl className="si-evidence-grid">
        {amount !== null && (
          <div><dt>Amount observed</dt><dd>{money(amount)}</dd></div>
        )}
        {category && <div><dt>Category</dt><dd>{category}</dd></div>}
        {typeof evidence.transaction_count === 'number' && (
          <div><dt>Payments</dt><dd>{evidence.transaction_count}</dd></div>
        )}
        {baselineAmount !== null && (
          <div><dt>Baseline</dt><dd>{money(baselineAmount)}<small>{String(insight.baseline.label ?? 'Your own history')}</small></dd></div>
        )}
      </dl>

      {dates.length > 0 && (
        <p className="si-insight-dates">
          Dates: {dates.map((date) => shortDate(date)).join(' · ')}
        </p>
      )}

      {!compact && (
        <details className="si-calculation">
          <summary>How this was calculated</summary>
          <p>{insight.calculation}</p>
          <p className="si-data-sufficiency">
            {insight.confidence.data_sufficiency} · Sample {insight.confidence.sample_size} · Confidence {confidencePercent}/100
          </p>
        </details>
      )}

      <div className="si-insight-action">
        <ArrowRight size={14} aria-hidden="true" />
        <span>{insight.action}</span>
      </div>

      {insight.caveat && <p className="si-insight-caveat">{insight.caveat}</p>}

      <div className="si-insight-links">
        {category && onViewCategory && (
          <button type="button" className="text-link" onClick={() => onViewCategory(category)}>
            View {category} transactions <ArrowRight size={13} />
          </button>
        )}
        {references.length > 0 && (
          <Link className="text-link" to={`/transactions/${references[0]}`}>
            Open payment <ArrowRight size={13} />
          </Link>
        )}
      </div>

    </article>
  );
}
