import { useEffect, useState } from 'react';
import { LoaderCircle, PiggyBank, Target } from 'lucide-react';
import { apiErrorMessage } from '../../api/auth';
import { analyticsApi, type BudgetEntry, type SavingsGoal } from '../../api/analytics';
import { Modal } from '../Modal';
import { useToast } from '../../context/ToastProvider';
import { money } from './shared';

const parseRupees = (value: string): number | null => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const toRupeeInput = (minor: number) => (minor ? (minor / 100).toFixed(2).replace(/\.00$/, '') : '');

export function BudgetFormModal({
  open,
  month,
  entry,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  month: string;
  entry: BudgetEntry | null;
  categories: { name: string; budgetable?: boolean }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCategory(entry?.category ?? '');
    setAmount(entry ? toRupeeInput(entry.limit_minor) : '');
    setError('');
  }, [open, entry]);

  const save = async () => {
    const limitMinor = parseRupees(amount);
    if (limitMinor === null) {
      setError('Enter a positive amount in rupees, with at most two decimal places.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (entry?.id) {
        await analyticsApi.updateBudget(entry.id, { limit_minor: limitMinor, category, month });
      } else {
        await analyticsApi.createBudget({ month, category, limit_minor: limitMinor });
      }
      showToast(entry ? 'Budget updated.' : 'Budget created. Warnings appear as you approach the limit.', 'success');
      onSaved();
      onClose();
    } catch (saveError) {
      setError(apiErrorMessage(saveError, 'Could not save this budget.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={entry ? 'Edit monthly limit' : 'Set a monthly limit'}
      subtitle="Optional. Budgets compare your consumption spending with limits you choose; they never block payments."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <PiggyBank size={15} />} {entry ? 'Save limit' : 'Create limit'}
          </button>
        </>
      )}
    >
      <div className="si-modal-body">
        {error && <div className="si-inline-error" role="alert">{error}</div>}
        <div className="si-form-grid">
          <div className="field">
            <label htmlFor="si-budget-category">Applies to</label>
            <select id="si-budget-category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={Boolean(entry)}>
              <option value="">Overall monthly spending</option>
              {categories.filter((item) => item.budgetable !== false).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="si-budget-amount">Monthly limit (₹)</label>
            <input
              id="si-budget-amount"
              inputMode="decimal"
              value={amount}
              placeholder="e.g. 25000"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </div>
        <label className="si-compact-field si-month-field">
          <span>Budget month</span>
          <input type="month" value={month} readOnly />
        </label>
        <p className="si-correction-note">Limits are stored as integer paise. Transfers to your own accounts, refunds, and demo top-ups never count against a budget. One limit can exist per scope and month.</p>
      </div>
    </Modal>
  );
}

export function GoalFormModal({
  open,
  goal,
  onClose,
  onSaved,
}: {
  open: boolean;
  goal: SavingsGoal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? '');
    setTarget(goal ? toRupeeInput(goal.target_amount_minor) : '');
    setSaved(goal ? toRupeeInput(goal.saved_amount_minor) : '');
    setTargetDate(goal?.target_date ?? '');
    setNote(goal?.note ?? '');
    setError('');
  }, [open, goal]);

  const save = async () => {
    const targetMinor = parseRupees(target);
    const savedMinor = saved.trim() ? (/^\d+(\.\d{1,2})?$/.test(saved.trim()) ? Math.round(Number(saved) * 100) : null) : 0;
    if (!name.trim()) {
      setError('Give this savings goal a name.');
      return;
    }
    if (targetMinor === null) {
      setError('Enter a positive target amount in rupees.');
      return;
    }
    if (savedMinor === null || savedMinor > targetMinor) {
      setError('Amount already set aside must be a valid amount no greater than the target.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        target_amount_minor: targetMinor,
        saved_amount_minor: savedMinor,
        target_date: targetDate || null,
        note: note.trim(),
      };
      if (goal) await analyticsApi.updateGoal(goal.id, payload);
      else await analyticsApi.createGoal(payload);
      showToast(goal ? 'Savings goal updated.' : 'Savings goal created.', 'success');
      onSaved();
      onClose();
    } catch (saveError) {
      setError(apiErrorMessage(saveError, 'Could not save this savings goal.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={goal ? 'Edit savings goal' : 'Create a savings goal'}
      subtitle="OnePay records progress you enter here. It does not move money or assume unrecorded savings."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Target size={15} />} {goal ? 'Save goal' : 'Create goal'}
          </button>
        </>
      )}
    >
      <div className="si-modal-body">
        {error && <div className="si-inline-error" role="alert">{error}</div>}
        <div className="si-form-grid">
          <div className="field si-full-field">
            <label htmlFor="si-goal-name">Goal name</label>
            <input id="si-goal-name" maxLength={80} value={name} placeholder="e.g. Emergency fund" onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="si-goal-target">Target amount (₹)</label>
            <input id="si-goal-target" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="si-goal-saved">Already set aside (₹)</label>
            <input id="si-goal-saved" inputMode="decimal" value={saved} placeholder="0" onChange={(event) => setSaved(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="si-goal-date">Target date (optional)</label>
            <input id="si-goal-date" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          </div>
          <div className="field si-full-field">
            <label htmlFor="si-goal-note">Note (optional)</label>
            <input id="si-goal-note" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <p className="si-correction-note">Progress is based only on the amount you record. Suggested monthly contributions are estimates derived from the target and date, not financial advice.</p>
      </div>
    </Modal>
  );
}

export function BudgetDeleteConfirm({
  entry,
  onClose,
  onDeleted,
}: {
  entry: BudgetEntry | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    if (!entry?.id) return;
    setDeleting(true);
    setError('');
    try {
      await analyticsApi.deleteBudget(entry.id);
      showToast('Budget removed. Historical spending is unchanged.', 'success');
      onDeleted();
      onClose();
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, 'Could not remove this budget.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={Boolean(entry)}
      title="Remove this budget?"
      subtitle={entry ? `${entry.category ? entry.category : 'Overall budget'} · ${money(entry.limit_minor)}` : undefined}
      onClose={onClose}
      size="sm"
      footer={(
        <>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={deleting}>Keep budget</button>
          <button type="button" className="button button-danger" onClick={() => void remove()} disabled={deleting}>
            {deleting && <LoaderCircle className="spin" size={16} />} Remove
          </button>
        </>
      )}
    >
      {error && <div className="si-inline-error" role="alert">{error}</div>}
      <p className="si-modal-copy">Removing a limit only deletes the budget. Completed payments, category totals, and past reports are not changed.</p>
    </Modal>
  );
}
