import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CircleAlert, Clock3, LockKeyhole, Send, ShieldCheck, UsersRound } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { DemoRecipient, DemoTransaction } from '../types';
import { formatRupees, isValidUpiId } from '../types';
import { paymentApi } from '../api/payments';
import { ApiError, apiErrorMessage } from '../api/auth';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { Avatar } from '../components/Avatar';
import { Button, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';

interface SendForm { upiId: string; amount: string; note: string }
interface SendErrors { upiId?: string; amount?: string }
interface ResolvedRecipient { id: number | null; display_name: string; upi_id: string }

function makeIdempotencyKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `onepay-${Date.now()}-${Math.random()}`;
}

export default function SendMoneyPage() {
  const { balancePaise, recipients, recordDemoPayment, paymentDataLoading } = useDemo();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<SendForm>({ upiId: '', amount: '', note: '' });
  const [errors, setErrors] = useState<SendErrors>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [resolvingRecipient, setResolvingRecipient] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [requestUncertain, setRequestUncertain] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [resolvedRecipient, setResolvedRecipient] = useState<ResolvedRecipient | null>(null);
  const [successTransaction, setSuccessTransaction] = useState<DemoTransaction | null>(null);
  const requestKey = useRef<string | null>(null);

  useEffect(() => {
    const routeState = location.state as { recipient?: DemoRecipient } | null;
    const recipient = routeState?.recipient;
    const upiFromUrl = searchParams.get('upi');
    if (recipient?.upiId) setForm((current) => ({ ...current, upiId: recipient.upiId }));
    else if (upiFromUrl) setForm((current) => ({ ...current, upiId: upiFromUrl }));
  }, [location.state, searchParams]);

  const normalizedUpi = form.upiId.trim().toLowerCase();
  const selectedRecipient = recipients.find((recipient) => recipient.upiId.toLowerCase() === normalizedUpi);
  const amountPaise = Math.round(Number(form.amount) * 100);
  const displayedRecipient = resolvedRecipient ?? (selectedRecipient ? {
    id: Number(selectedRecipient.id), display_name: selectedRecipient.name, upi_id: selectedRecipient.upiId,
  } : null);

  const updateField = (field: keyof SendForm, value: string) => {
    if (!requestUncertain) {
      requestKey.current = null;
      setRequestError('');
    }
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === 'upiId') setResolvedRecipient(null);
  };

  const validate = () => {
    const nextErrors: SendErrors = {};
    if (!isValidUpiId(form.upiId)) nextErrors.upiId = 'Enter a mock OnePay UPI ID such as name@onepay or choose a saved recipient.';
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) nextErrors.amount = 'Enter an amount greater than ₹0.';
    else if (!paymentDataLoading && amountPaise > balancePaise) nextErrors.amount = 'This is more than your available demo balance. The server checks the final balance too.';
    else if (amountPaise > 5_000_000) nextErrors.amount = 'For this demo, use an amount of ₹50,000 or less.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const reviewPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setResolvingRecipient(true);
    try {
      if (selectedRecipient) {
        setResolvedRecipient({ id: Number(selectedRecipient.id), display_name: selectedRecipient.name, upi_id: selectedRecipient.upiId });
      } else {
        const recipient = await paymentApi.lookupRecipient(form.upiId.trim());
        setResolvedRecipient({ id: recipient.id, display_name: recipient.display_name, upi_id: recipient.upi_id });
      }
      setRequestError('');
      setReviewOpen(true);
    } catch (error) {
      setErrors((current) => ({ ...current, upiId: apiErrorMessage(error, 'OnePay could not resolve this demo recipient.') }));
    } finally {
      setResolvingRecipient(false);
    }
  };

  const confirmPayment = async () => {
    if (!displayedRecipient) return;
    setProcessing(true);
    requestKey.current ??= makeIdempotencyKey();
    try {
      const transaction = await recordDemoPayment({
        kind: 'transfer',
        recipientId: displayedRecipient.id === null ? undefined : String(displayedRecipient.id),
        upiId: displayedRecipient.id === null ? displayedRecipient.upi_id : undefined,
        amountPaise,
        note: form.note.trim(),
        idempotencyKey: requestKey.current,
      });
      requestKey.current = null;
      setRequestUncertain(false);
      setRequestError('');
      setReviewOpen(false);
      setSuccessTransaction(transaction);
      setForm({ upiId: '', amount: '', note: '' });
      setResolvedRecipient(null);
      if (transaction.status === 'failed') showToast('The simulator declined this payment. Your demo balance was not changed.', 'error');
      else if (transaction.status === 'pending') showToast('This payment is pending in the demo simulator. You can check its status.', 'info');
      else showToast('Demo payment recorded. No money was transferred.', 'success');
    } catch (error) {
      const uncertain = error instanceof ApiError && error.status === 0;
      setRequestUncertain(uncertain);
      const message = apiErrorMessage(error, 'Could not record this demo payment. Retry the same request.');
      setRequestError(uncertain ? `${message} Retry with the same details to safely check the request.` : message);
      showToast(message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleDone = () => {
    const reference = successTransaction?.reference;
    setSuccessTransaction(null);
    if (reference) navigate(`/transactions/${encodeURIComponent(reference)}`);
    else navigate('/transactions');
  };

  const closeReview = () => {
    if (processing || requestUncertain) return;
    setReviewOpen(false);
    requestKey.current = null;
    setRequestError('');
  };

  const successTitle = successTransaction?.status === 'failed' ? 'Demo payment failed'
    : successTransaction?.status === 'pending' ? 'Demo payment pending'
      : 'Demo payment recorded';

  return (
    <>
      <PageHeader eyebrow="PAYMENTS · DEMO MODE" title="Send money" description="Review a simulated payment. OnePay never contacts a bank or UPI network." action={<Button variant="secondary" size="sm" onClick={() => navigate('/recipients')}>Manage recipients</Button>} />

      <div className="send-page-grid">
        <section className="card send-form-card">
          <div className="form-card-heading">
            <span className="form-heading-icon"><Send size={19} /></span>
            <div><h2>Who are you paying?</h2><p>Choose a saved demo recipient or resolve a mock OnePay UPI ID.</p></div>
          </div>

          <form onSubmit={(event) => void reviewPayment(event)} noValidate>
            <div className="field recipient-upi-field">
              <label htmlFor="recipient-upi">Mock UPI ID</label>
              <div className="input-with-prefix"><span className="input-prefix">@</span><input id="recipient-upi" name="upiId" type="text" value={form.upiId} onChange={(event) => updateField('upiId', event.target.value)} autoComplete="off" placeholder="name@onepay" aria-invalid={Boolean(errors.upiId)} aria-describedby={errors.upiId ? 'upi-error' : 'upi-hint'} /></div>
              {errors.upiId ? <span className="field-error" id="upi-error">{errors.upiId}</span> : <span className="field-hint" id="upi-hint">Only saved mock recipients and OnePay demo handles are supported.</span>}
            </div>

            <div className="contacts-picker">
              <div className="field-label-row"><span>Saved recipients</span><span className="field-mini-note">Server-managed contacts</span></div>
              <div className="contact-chip-list">
                {recipients.slice(0, 5).map((recipient) => (
                  <button type="button" key={recipient.id} className={`contact-chip ${normalizedUpi === recipient.upiId.toLowerCase() ? 'selected' : ''}`} onClick={() => updateField('upiId', recipient.upiId)}>
                    <span className={`contact-chip-avatar person-${recipient.color}`}><Avatar name={recipient.name} size="sm" /></span>
                    <span>{recipient.name.split(' ')[0]}</span>
                  </button>
                ))}
                <button type="button" className="contact-chip contact-chip-manage" onClick={() => navigate('/recipients')}>Manage</button>
              </div>
            </div>

            <div className="form-divider" />

            <div className="field amount-field">
              <label htmlFor="payment-amount">Amount</label>
              <div className="amount-input-wrap"><span>₹</span><input id="payment-amount" name="amount" type="number" inputMode="decimal" min="0.01" max="50000" step="0.01" value={form.amount} onChange={(event) => updateField('amount', event.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'amount-error' : 'amount-hint'} /></div>
              {errors.amount ? <span className="field-error" id="amount-error">{errors.amount}</span> : <span className="field-hint" id="amount-hint">{paymentDataLoading ? 'Loading server balance…' : `Available demo funds: ${formatRupees(balancePaise)}`}</span>}
            </div>
            <div className="amount-suggestions" aria-label="Suggested amounts">
              {[100, 500, 1000].map((amount) => <button type="button" key={amount} onClick={() => updateField('amount', String(amount))}>₹{amount.toLocaleString('en-IN')}</button>)}
            </div>

            <TextInput label="Add a note (optional)" id="payment-note" name="note" type="text" maxLength={80} value={form.note} onChange={(event) => updateField('note', event.target.value)} placeholder="What’s this for?" hint="Keep it short and kind. Max 80 characters." />

            <div className="demo-inline-notice"><ShieldCheck size={17} /><p><strong>Demo only.</strong> The backend validates and records simulated activity; no real transfer is initiated.</p></div>
            <Button type="submit" size="lg" className="button-full" busy={resolvingRecipient} icon={<ArrowRight size={17} />}>{resolvingRecipient ? 'Resolving recipient…' : 'Review demo payment'}</Button>
          </form>
        </section>

        <aside className="send-aside">
          <section className="card balance-summary-card">
            <span className="balance-summary-icon"><WalletSummaryIcon /></span>
            <span className="eyebrow">AVAILABLE DEMO FUNDS</span>
            <strong>{paymentDataLoading ? 'Loading…' : formatRupees(balancePaise)}</strong>
            <span className="balance-summary-caption">Server-backed ledger · simulated only</span>
          </section>
          <section className="card send-info-card">
            <div className="send-info-icon"><LockKeyhole size={19} /></div>
            <h2>Safe by design</h2>
            <p>Recipient handles are resolved only against OnePay’s mock contacts. No external UPI lookup or payment network is used.</p>
            <div className="send-info-rule"><BadgeCheck size={16} /><span>No PIN or password fields</span></div>
            <div className="send-info-rule"><Clock3 size={16} /><span>Activity is stored in your OnePay demo ledger</span></div>
          </section>
          <section className="card send-help-card">
            <span className="send-help-icon"><UsersRound size={18} /></span>
            <div><strong>Need a hand?</strong><p>Learn how the simulated flow works.</p></div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/help')} icon={<ArrowRight size={15} />}>Help</Button>
          </section>
        </aside>
      </div>

      <Modal open={reviewOpen} title="Review demo payment" subtitle="Please check the details before confirmation." onClose={closeReview} size="sm"
        footer={<><Button variant="secondary" onClick={closeReview} disabled={processing || requestUncertain} icon={<ArrowLeft size={15} />}>Edit details</Button><Button onClick={() => void confirmPayment()} busy={processing} icon={<Check size={16} />}>{processing ? 'Processing…' : requestUncertain ? 'Retry same request' : 'Confirm demo payment'}</Button></>}>
        <div className="demo-warning"><span className="warning-badge">SIMULATION</span><p>Confirming sends a request to OnePay’s backend ledger only. No actual money moves.</p></div>
        {requestError && <div className="inline-api-error" role="alert"><CircleAlert size={17} /><span>{requestError}</span></div>}
        <div className="review-recipient"><span className="review-avatar"><Avatar name={displayedRecipient?.display_name ?? form.upiId} size="lg" /></span><div><span>Sending to</span><strong>{displayedRecipient?.display_name ?? form.upiId}</strong><small>{displayedRecipient?.upi_id ?? form.upiId}</small></div></div>
        <div className="review-amount"><span>Demo amount</span><strong>{formatRupees(amountPaise)}</strong></div>
        {form.note.trim() && <div className="review-note"><span>Note</span><strong>{form.note.trim()}</strong></div>}
        <div className="review-balance"><span>Remaining demo funds</span><strong>{formatRupees(Math.max(0, balancePaise - amountPaise))}</strong></div>
      </Modal>

      <Modal open={Boolean(successTransaction)} title={successTitle} subtitle={successTransaction?.status === 'failed' ? 'The simulator returned a failed outcome; your demo balance was refunded.' : successTransaction?.status === 'pending' ? 'The simulator could not confirm the result yet.' : 'This was simulated only—not a bank transfer.'} onClose={() => setSuccessTransaction(null)} size="sm"
        footer={<><Button variant="secondary" onClick={() => setSuccessTransaction(null)}>Send another</Button><Button onClick={handleDone} icon={<ArrowRight size={16} />}>View details</Button></>}>
        {successTransaction && <div className="success-summary">
          <span className="success-large-icon">{successTransaction.status === 'failed' ? <CircleAlert size={26} /> : <Check size={28} />}</span>
          <strong className="success-summary-amount">{successTransaction.status === 'failed' ? 'Not debited' : `−${formatRupees(successTransaction.amountPaise)}`}</strong>
          <span className="success-summary-to">to {successTransaction.title}{successTransaction.subtitle ? ` · ${successTransaction.subtitle}` : ''}</span>
          <div className="success-demo-label"><CircleAlert size={16} /><span>Simulated only · no real money moved</span></div>
          <span className="success-reference">OnePay reference: {successTransaction.reference}</span>
        </div>}
      </Modal>
    </>
  );
}

function WalletSummaryIcon() {
  return <span className="wallet-summary-glyph">₹</span>;
}
