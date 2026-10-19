import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { apiErrorMessage } from '../../api/auth';
import { analyticsApi, type CategoryDetail, type SpendingTransaction } from '../../api/analytics';
import { Modal } from '../Modal';
import { useToast } from '../../context/ToastProvider';
import { DataBadge, money } from './shared';

const METHOD_LABEL: Record<string, string> = {
  manual_override: 'Your saved correction',
  merchant_rule: 'Local merchant rule',
  metadata_rule: 'Payment metadata',
  configured_classifier: 'Configured classifier',
  llm_fallback: 'Consented AI fallback',
  fallback: 'Fallback rule',
};

export function CategoryCorrectionModal({
  open,
  transaction,
  onClose,
  onSaved,
}: {
  open: boolean;
  transaction: SpendingTransaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [applyToFuture, setApplyToFuture] = useState(true);

  useEffect(() => {
    if (!open || !transaction) return;
    let active = true;
    setLoading(true);
    setError('');
    setDetail(null);
    void analyticsApi.categoryDetail(transaction.reference)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setCategory(result.category);
        setSubcategory(result.subcategory);
        setApplyToFuture(result.correction?.apply_to_future ?? true);
      })
      .catch((loadError) => {
        if (active) setError(apiErrorMessage(loadError, 'Could not load this transaction classification.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, transaction]);

  const selectedCategory = useMemo(
    () => detail?.available_categories.find((item) => item.name === category),
    [category, detail],
  );

  const save = async () => {
    if (!transaction || !detail) return;
    setSaving(true);
    setError('');
    try {
      await analyticsApi.saveCategory(transaction.reference, {
        category,
        subcategory,
        apply_to_future: applyToFuture,
      });
      showToast('Category correction saved. Your analytics were recalculated.', 'success');
      onSaved();
      onClose();
    } catch (saveError) {
      setError(apiErrorMessage(saveError, 'Could not save this correction.'));
    } finally {
      setSaving(false);
    }
  };

  const removeCorrection = async () => {
    if (!transaction || !detail?.correction) return;
    setSaving(true);
    setError('');
    try {
      await analyticsApi.deleteCategory(transaction.reference);
      showToast('Manual correction removed. The automatic category is active again.', 'success');
      onSaved();
      onClose();
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, 'Could not remove this correction.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Correct this category"
      subtitle={transaction ? `${transaction.merchant || transaction.recipient_name} · ${money(transaction.amount_minor)} · ${transaction.reference}` : undefined}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          {detail?.correction && (
            <button type="button" className="button button-ghost" onClick={() => void removeCorrection()} disabled={saving}>
              <RotateCcw size={14} /> Remove correction
            </button>
          )}
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={saving || loading || !detail}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={15} />} Save correction
          </button>
        </>
      )}
    >
      {loading && <div className="si-inline-state" role="status"><LoaderCircle className="spin" size={18} /> Loading classification…</div>}
      {error && <div className="si-inline-error" role="alert"><AlertTriangle size={15} /> {error}</div>}
      {detail && (
        <div className="si-correction-body">
          <div className="si-current-classification">
            <div>
              <span>Automatic classification</span>
              <strong>{detail.category} · {detail.subcategory}</strong>
              <small>{METHOD_LABEL[detail.classification_method] ?? detail.classification_method} · {Math.round(detail.confidence * 100)}% rule confidence</small>
            </div>
            <DataBadge type={detail.eligible_for_spending ? 'actual' : 'estimate'} />
          </div>
          {!detail.eligible_for_spending && (
            <p className="si-field-warning">This payment is not part of completed spending totals (it may be pending, failed, reversed, a top-up, or an internal transfer). A correction is saved for transparency but does not add it to spending.</p>
          )}

          <div className="si-form-grid">
            <div className="field">
              <label htmlFor="si-correction-category">Category</label>
              <select
                id="si-correction-category"
                value={category}
                onChange={(event) => {
                  const next = event.target.value;
                  setCategory(next);
                  const option = detail.available_categories.find((item) => item.name === next);
                  setSubcategory(option?.subcategories[0] ?? '');
                }}
              >
                {detail.available_categories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="si-correction-subcategory">Subcategory</label>
              <select id="si-correction-subcategory" value={subcategory} onChange={(event) => setSubcategory(event.target.value)}>
                {(selectedCategory?.subcategories ?? [subcategory]).map((item) => <option key={item} value={item}>{item}</option>)}
                {subcategory && !(selectedCategory?.subcategories ?? []).includes(subcategory) && <option value={subcategory}>{subcategory}</option>}
              </select>
            </div>
          </div>

          <label className="si-checkbox-row">
            <input type="checkbox" checked={applyToFuture} onChange={(event) => setApplyToFuture(event.target.checked)} />
            <span>
              <strong>Apply to future matching payments</strong>
              <small>OnePay will reuse this category for payments with the same merchant or identifier. You can remove it at any time.</small>
            </span>
          </label>

          <p className="si-correction-note">Corrections change analytics only. They never change the payment, wallet balance, or transaction receipt. Totals are recalculated from recorded transactions.</p>
        </div>
      )}
    </Modal>
  );
}
