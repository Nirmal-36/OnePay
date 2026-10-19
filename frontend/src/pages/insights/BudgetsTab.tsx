import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, ChevronLeft, ChevronRight,
  CircleDollarSign, LoaderCircle, Pencil, PiggyBank, Plus, ShieldCheck, Sparkles, Target, Trash2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { apiErrorMessage } from '../../api/auth';
import { analyticsApi, type BudgetEntry, type BudgetOverview, type SavingsGoal } from '../../api/analytics';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { BudgetDeleteConfirm, BudgetFormModal, GoalFormModal } from '../../components/insights/BudgetModals';
import { BudgetProgress } from '../../components/insights/BudgetProgress';
import {
  DataBadge, ErrorCard, InfoTip, LoadingCard, money, monthLabel, shiftMonthValue, statusTone, todayISO,
} from '../../components/insights/shared';
import { useToast } from '../../context/ToastProvider';

const currentMonthValue = () => todayISO().slice(0, 7);

export function BudgetsTab({ onViewCategory }: { onViewCategory: (category: string) => void }) {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonthValue());
  const [overview, setOverview] = useState<BudgetOverview | null>(null);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [goalsNote, setGoalsNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [error, setError] = useState('');
  const [goalsError, setGoalsError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [budgetModal, setBudgetModal] = useState<{ open: boolean; entry: BudgetEntry | null; category?: string }>({ open: false, entry: null });
  const [deleteEntry, setDeleteEntry] = useState<BudgetEntry | null>(null);
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal: SavingsGoal | null }>({ open: false, goal: null });
  const [deleteGoal, setDeleteGoal] = useState<SavingsGoal | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void analyticsApi.budgets(month)
      .then((result) => { if (active) setOverview(result); })
      .catch((loadError) => { if (active) { setOverview(null); setError(apiErrorMessage(loadError, 'Could not load budgets for this month.')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, refreshKey]);

  useEffect(() => {
    let active = true;
    setGoalsLoading(true);
    setGoalsError('');
    void analyticsApi.goals()
      .then((result) => { if (active) { setGoals(result.goals); setGoalsNote(result.note); } })
      .catch((loadError) => { if (active) setGoalsError(apiErrorMessage(loadError, 'Could not load savings goals.')); })
      .finally(() => { if (active) setGoalsLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const categories = useMemo(() => overview?.available_categories?.filter((item) => item.budgetable !== false) ?? [], [overview]);
  const isCurrentOrFuture = month >= currentMonthValue();
  const comparison = overview?.comparison;
  const recommendation = overview?.recommendation;

  const removeGoal = async () => {
    if (!deleteGoal) return;
    try {
      await analyticsApi.deleteGoal(deleteGoal.id);
      showToast('Savings goal removed.', 'success');
      setDeleteGoal(null);
      refresh();
    } catch (deleteError) {
      showToast(apiErrorMessage(deleteError, 'Could not remove this goal.'), 'error');
    }
  };

  const applyRecommendation = async () => {
    if (!recommendation?.available) return;
    try {
      if (recommendation.overall_estimate_minor) {
        const existing = overview?.overall;
        if (existing?.id) await analyticsApi.updateBudget(existing.id, { limit_minor: recommendation.overall_estimate_minor });
        else await analyticsApi.createBudget({ month, category: '', limit_minor: recommendation.overall_estimate_minor });
      }
      for (const item of recommendation.categories.slice(0, 3)) {
        const existing = overview?.categories.find((entry) => entry.category === item.category);
        if (existing?.id) await analyticsApi.updateBudget(existing.id, { limit_minor: item.suggested_limit_minor });
        else await analyticsApi.createBudget({ month, category: item.category, limit_minor: item.suggested_limit_minor });
      }
      showToast('Estimated limits applied. You can edit or remove them at any time.', 'success');
      refresh();
    } catch (applyError) {
      showToast(apiErrorMessage(applyError, 'Could not apply the recommended limits.'), 'error');
    }
  };

  return (
    <div className="si-tab-content">
      <section className="card si-budget-toolbar" aria-label="Budget month controls">
        <div className="si-report-title">
          <span className="si-panel-icon"><PiggyBank size={18} /></span>
          <div>
            <h2>Monthly budgets and savings goals</h2>
            <p>Optional limits you control. OnePay warns near a limit but never blocks a payment or moves money.</p>
          </div>
        </div>
        <div className="si-report-controls">
          <button type="button" className="button button-secondary button-sm" aria-label="Previous budget month" onClick={() => setMonth(shiftMonthValue(month, -1))}><ChevronLeft size={15} /></button>
          <span className="si-month-display">{monthLabel(month)}</span>
          <button type="button" className="button button-secondary button-sm" aria-label="Next budget month" onClick={() => setMonth(shiftMonthValue(month, 1))}><ChevronRight size={15} /></button>
          <button type="button" className="button button-primary button-sm" onClick={() => setBudgetModal({ open: true, entry: null })}><Plus size={14} /> Add limit</button>
        </div>
      </section>

      {loading && !overview && <LoadingCard label="Loading budgets…" />}
      {error && !overview && <ErrorCard message={error} onRetry={refresh} />}

      {overview && (
        <>
          {overview.warnings.length > 0 && (
            <div className="si-alert-banner warn" role="status">
              <AlertTriangle size={18} />
              <div>
                <strong>{overview.warnings.some((item) => item.status === 'exceeded') ? 'A budget limit has been exceeded' : 'Approaching a budget limit'}</strong>
                <span>{overview.warnings.map((item) => item.message).join(' ')}</span>
              </div>
            </div>
          )}

          <div className="si-budget-overview-grid">
            <section className="card si-panel" aria-labelledby="si-overall-budget-heading">
              <div className="si-panel-heading">
                <div><h2 id="si-overall-budget-heading">Overall budget</h2><p>{overview.label} · consumption spending only.</p></div>
                {overview.overall ? (
                  <div className="si-inline-actions">
                    <button type="button" className="button button-secondary button-sm" onClick={() => setBudgetModal({ open: true, entry: overview.overall })}><Pencil size={12} /> Edit</button>
                    <button type="button" className="button button-ghost button-sm" onClick={() => setDeleteEntry(overview.overall)} aria-label="Remove overall budget"><Trash2 size={12} /></button>
                  </div>
                ) : <DataBadge type="actual" />}
              </div>
              {overview.overall ? (
                <BudgetProgress entry={{ ...overview.overall, label: 'Overall monthly spending' }} />
              ) : (
                <EmptyState
                  icon={PiggyBank}
                  title="No overall limit for this month"
                  description="Budgets are entirely optional. Add one to track progress and receive in-app warnings at 80% and 100%."
                  action={<button type="button" className="button button-primary button-sm" onClick={() => setBudgetModal({ open: true, entry: null })}>Set an overall limit</button>}
                />
              )}
              <div className="si-budget-totals">
                <div><span>Consumption</span><strong>{money(overview.consumption_spending_minor)}</strong></div>
                <div><span>Category limits</span><strong>{money(overview.total_category_limits_minor)}</strong></div>
                <div><span>Warnings</span><strong>{overview.warnings.length}</strong></div>
              </div>
              <p className="si-panel-note">{overview.calculation_note}</p>
            </section>

            <section className="card si-panel" aria-labelledby="si-budget-comparison-heading">
              <div className="si-panel-heading"><div><h2 id="si-budget-comparison-heading">Compared with a month ago</h2><p>{monthLabel(overview.comparison.previous_month)} consumption spending.</p></div><TrendingUp size={17} className="si-muted-icon" /></div>
              <div className="si-comparison-numbers">
                <div><span>This month</span><strong>{money(overview.consumption_spending_minor)}</strong></div>
                <div><span>Previous month</span><strong>{money(comparison?.previous_spending_minor ?? 0)}</strong></div>
                <div className={comparison && comparison.change_minor > 0 ? 'up' : comparison && comparison.change_minor < 0 ? 'down' : 'flat'}>
                  <span>Change</span>
                  <strong>{comparison?.change_percent === null || comparison?.change_percent === undefined ? 'No baseline' : `${comparison.change_percent > 0 ? '+' : ''}${comparison.change_percent.toFixed(1)}%`}</strong>
                </div>
              </div>
              <div className="si-comparison-bars" aria-hidden="true">
                <span><i className="current" style={{ width: `${Math.min(100, (overview.consumption_spending_minor / Math.max(overview.consumption_spending_minor, comparison?.previous_spending_minor ?? 0, 1)) * 100)}%` }} /><small>Selected month</small></span>
                <span><i className="previous" style={{ width: `${Math.min(100, ((comparison?.previous_spending_minor ?? 0) / Math.max(overview.consumption_spending_minor, comparison?.previous_spending_minor ?? 0, 1)) * 100)}%` }} /><small>Previous month</small></span>
              </div>
              {!overview.overall && <p className="si-panel-note">Setting a limit makes this comparison more actionable; the spending comparison itself does not require one.</p>}
            </section>
          </div>

          <section className="card si-panel" aria-labelledby="si-category-budgets-heading">
            <div className="si-panel-heading">
              <div><h2 id="si-category-budgets-heading">Category limits</h2><p>One limit per category and month. Category spending uses the same classification as the dashboard.</p></div>
              <button type="button" className="button button-secondary button-sm" onClick={() => setBudgetModal({ open: true, entry: null })}><Plus size={13} /> Add category limit</button>
            </div>
            {overview.categories.length ? (
              <div className="si-budget-category-grid">
                {overview.categories.map((entry) => (
                  <div className={`si-budget-card ${statusTone(entry.status)}`} key={entry.id ?? entry.category}>
                    <div className="si-budget-card-top">
                      <div><strong>{entry.category}</strong><small>{money(entry.spent_minor)} of {money(entry.limit_minor)}</small></div>
                      <div className="si-inline-actions">
                        <button type="button" className="button button-ghost button-sm" aria-label={`Edit ${entry.category} budget`} onClick={() => setBudgetModal({ open: true, entry })}><Pencil size={12} /></button>
                        <button type="button" className="button button-ghost button-sm" aria-label={`Remove ${entry.category} budget`} onClick={() => setDeleteEntry(entry)}><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <BudgetProgress entry={entry} compact />
                    <div className="si-budget-card-foot">
                      <span>{entry.warning ?? (entry.status === 'on_track' ? 'Within limit' : '')}</span>
                      <button type="button" className="text-link" onClick={() => onViewCategory(entry.category)}>View payments <ArrowRight size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CircleDollarSign}
                title="No category limits"
                description="Add limits only for categories you want to watch. Unbudgeted categories remain visible in the table below."
                action={<button type="button" className="button button-secondary button-sm" onClick={() => setBudgetModal({ open: true, entry: null })}>Add a category limit</button>}
              />
            )}
            {overview.unbudgeted_categories.length > 0 && (
              <div className="si-unbudgeted-row">
                <strong>Spending without a category limit</strong>
                <div>{overview.unbudgeted_categories.slice(0, 6).map((item) => <span key={item.category}>{item.category} · {money(item.spent_minor)}</span>)}</div>
              </div>
            )}
          </section>

          {recommendation && (
            <section className="card si-panel si-recommendation-panel" aria-labelledby="si-recommendation-heading">
              <div className="si-panel-heading">
                <div>
                  <h2 id="si-recommendation-heading"><Sparkles size={17} /> Suggested limits</h2>
                  <p>{recommendation.available ? 'Calculated from complete months you have already recorded. Labelled as estimates and fully overridable.' : 'Recommendations need more history.'}</p>
                </div>
                {recommendation.available ? <span className="si-estimate-label">Estimate</span> : <DataBadge type="estimate" />}
              </div>
              {recommendation.available ? (
                <>
                  <div className="si-recommendation-grid">
                    {recommendation.overall_estimate_minor && (
                      <div className="si-recommendation-main">
                        <span>Overall monthly estimate</span>
                        <strong>{money(recommendation.overall_estimate_minor)}</strong>
                        <small>Based on {recommendation.months_used.length} complete month{recommendation.months_used.length === 1 ? '' : 's'} ({recommendation.months_used.join(', ')}), rounded to the nearest ₹100.</small>
                      </div>
                    )}
                    {recommendation.categories.slice(0, 5).map((item) => (
                      <div key={item.category}><span>{item.category}</span><strong>{money(item.suggested_limit_minor)}</strong><small>Average {money(item.average_monthly_minor)}</small></div>
                    ))}
                  </div>
                  <div className="si-recommendation-actions">
                    <button type="button" className="button button-secondary button-sm" onClick={() => void applyRecommendation()}>Apply these estimates</button>
                    <span>Nothing is applied automatically. You can edit every limit afterwards.</span>
                  </div>
                  <details className="si-calculation">
                    <summary>How recommendations are calculated</summary>
                    <p>{recommendation.basis}</p>
                    <ul>{recommendation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
                  </details>
                </>
              ) : (
                <div className="si-small-empty"><CalendarClock size={19} /><div><strong>Not enough complete months</strong><p>{recommendation.reason ?? 'At least two complete months with ten payments are needed before suggesting any limit.'}</p></div></div>
              )}
            </section>
          )}
        </>
      )}

      <section className="card si-panel" aria-labelledby="si-goals-heading">
        <div className="si-panel-heading">
          <div><h2 id="si-goals-heading">Savings goals</h2><p>Targets you record yourself. Progress reflects only the amounts you enter.</p></div>
          <button type="button" className="button button-secondary button-sm" onClick={() => setGoalModal({ open: true, goal: null })}><Plus size={13} /> New goal</button>
        </div>
        {goalsLoading && !goals.length && <div className="si-inline-state" role="status"><LoaderCircle className="spin" size={18} /> Loading goals…</div>}
        {goalsError && <div className="si-inline-error" role="alert">{goalsError}</div>}
        {!goalsLoading && !goalsError && goals.length === 0 && (
          <EmptyState
            icon={Target}
            title="No savings goals yet"
            description="Create a target and record progress as you set money aside. No funds are moved by OnePay."
            action={<button type="button" className="button button-primary button-sm" onClick={() => setGoalModal({ open: true, goal: null })}>Create a savings goal</button>}
          />
        )}
        {goals.length > 0 && (
          <div className="si-goal-grid">
            {goals.map((goal) => {
              const tone = statusTone(goal.status);
              return (
                <article className={`si-goal-card ${tone}`} key={goal.id}>
                  <div className="si-goal-top">
                    <div><strong>{goal.name}</strong><small>{goal.note || 'Savings target'}</small></div>
                    <div className="si-inline-actions">
                      <button type="button" className="button button-ghost button-sm" aria-label={`Edit ${goal.name}`} onClick={() => setGoalModal({ open: true, goal })}><Pencil size={12} /></button>
                      <button type="button" className="button button-ghost button-sm" aria-label={`Remove ${goal.name}`} onClick={() => setDeleteGoal(goal)}><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="si-goal-values"><strong>{money(goal.saved_amount_minor)}</strong><span>of {money(goal.target_amount_minor)}</span><small>{goal.progress_percent.toFixed(1)}%</small></div>
                  <div className="si-progress-track" role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goal.progress_percent)}>
                    <span className={`si-progress-fill ${tone}`} style={{ width: `${Math.min(100, goal.progress_percent)}%` }} />
                  </div>
                  <div className="si-goal-meta">
                    <span>{goal.remaining_minor > 0 ? `${money(goal.remaining_minor)} remaining` : 'Target reached'}</span>
                    <span>{goal.target_date ? (goal.days_remaining !== null && goal.days_remaining >= 0 ? `${goal.days_remaining} days to target` : 'Target date passed') : 'No target date'}</span>
                  </div>
                  {goal.monthly_amount_needed_minor > 0 && goal.status !== 'complete' && (
                    <p className="si-goal-note">About {money(goal.monthly_amount_needed_minor)} per month would be needed to reach the target by the date shown. Estimate only.</p>
                  )}
                  <p className="si-goal-provenance">{goal.note_on_progress}</p>
                </article>
              );
            })}
          </div>
        )}
        {goalsNote && <p className="si-panel-note">{goalsNote}</p>}
      </section>

      <section className="card si-panel si-budget-safety" aria-labelledby="si-budget-safety-heading">
        <div className="si-panel-heading"><div><h2 id="si-budget-safety-heading">Budget rules and privacy</h2><p>What is counted, and what is deliberately excluded.</p></div><ShieldCheck size={17} className="si-muted-icon" /></div>
        <div className="si-safety-grid">
          <div><strong><InfoTip label="Budget counting">Budgets count completed outgoing transfers, bills, and recharges. Internal transfers, pending, failed, reversed, and demo top-ups are excluded.</InfoTip> Counted in budgets</strong><p>Only completed consumption spending. Refunds are not treated as negative spending, because no verified refund ledger is recorded.</p></div>
          <div><strong><InfoTip label="Savings goal caveat">These goals are user-recorded intentions. OnePay does not verify the money is actually set aside.</InfoTip> Savings goals</strong><p>Progress is entered by you and is not inferred from wallet balances or transaction history.</p></div>
          <div><strong><InfoTip label="Recommendation caveat">Recommendations use your own complete months only, never a universal benchmark.</InfoTip> Recommendations</strong><p>Only appear after enough complete history. They are estimates, use your own spending, and can be edited or ignored.</p></div>
        </div>
      </section>

      <BudgetFormModal
        open={budgetModal.open}
        month={month}
        entry={budgetModal.entry}
        categories={categories}
        onClose={() => setBudgetModal({ open: false, entry: null })}
        onSaved={refresh}
      />
      <BudgetDeleteConfirm entry={deleteEntry} onClose={() => setDeleteEntry(null)} onDeleted={refresh} />
      <GoalFormModal open={goalModal.open} goal={goalModal.goal} onClose={() => setGoalModal({ open: false, goal: null })} onSaved={refresh} />
      <Modal
        open={Boolean(deleteGoal)}
        title="Remove this savings goal?"
        subtitle={deleteGoal?.name}
        onClose={() => setDeleteGoal(null)}
        size="sm"
        footer={(
          <>
            <button type="button" className="button button-secondary" onClick={() => setDeleteGoal(null)}>Keep goal</button>
            <button type="button" className="button button-danger" onClick={() => void removeGoal()}>Remove</button>
          </>
        )}
      >
        <p className="si-modal-copy">This removes the goal and its recorded progress. Transaction history and spending analytics are not affected.</p>
      </Modal>

      {isCurrentOrFuture && overview && !overview.has_any_budget && (
        <div className="si-sticky-budget-hint">
          <Target size={15} /> No limits set for {monthLabel(month)}. Budgets are optional.{' '}
          <button type="button" className="text-link" onClick={() => setBudgetModal({ open: true, entry: null })}>Set one <ArrowRight size={12} /></button>
        </div>
      )}
      {!isCurrentOrFuture && <p className="si-sr-only">Viewing a past budget month. Editing past limits affects only how historical months are evaluated.</p>}
      <div className="si-budget-footnote">
        <span><TrendingDown size={14} /> Budgets are a planning tool, not a credit limit.</span>
        <button type="button" className="text-link" onClick={() => setMonth(shiftMonthValue(month, -1))}><ArrowLeft size={13} /> Previous month</button>
      </div>
    </div>
  );
}
