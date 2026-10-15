import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CircleAlert, Clock3, LockKeyhole, Send, ShieldCheck, UsersRound } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { DemoRecipient, DemoTransaction } from '../types';
import { demoRecipients } from '../data/demo';
import { formatRupees, isValidUpiId } from '../types';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { Avatar } from '../components/Avatar';
import { Button, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';

interface SendForm { upiId: string; amount: string; note: string }
interface SendErrors { upiId?: string; amount?: string }

export default function SendMoneyPage() {
  const { balancePaise, recordDemoPayment } = useDemo();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<SendForm>({ upiId: '', amount: '', note: '' });
  const [errors, setErrors] = useState<SendErrors>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [successTransaction, setSuccessTransaction] = useState<DemoTransaction | null>(null);

  useEffect(() => {
    const routeState = location.state as { recipient?: DemoRecipient } | null;
    const recipient = routeState?.recipient;
    const upiFromUrl = searchParams.get('upi');
    if (recipient?.upiId) setForm((current) => ({ ...current, upiId: recipient.upiId }));
    else if (upiFromUrl) setForm((current) => ({ ...current, upiId: upiFromUrl }));
  }, [location.state, searchParams]);

  const selectedRecipient = demoRecipients.find((recipient) => recipient.upiId === form.upiId.trim());
  const amountPaise = Math.round(Number(form.amount) * 100);

  const updateField = (field: keyof SendForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validate = () => {
    const nextErrors: SendErrors = {};
    if (!isValidUpiId(form.upiId)) nextErrors.upiId = 'Enter a UPI ID in the format name@bank. This only checks the format.';
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) nextErrors.amount = 'Enter an amount greater than ₹0.';
    else if (amountPaise > balancePaise) nextErrors.amount = 'This is more than your available demo balance.';
    else if (amountPaise > 10_000_000) nextErrors.amount = 'For this demo, use an amount of ₹1,00,000 or less.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const reviewPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validate()) setReviewOpen(true);
  };

  const confirmPayment = async () => {
    setProcessing(true);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    try {
      const recipientName = selectedRecipient?.name ?? form.upiId.trim();
      const transaction = recordDemoPayment({
        title: recipientName,
        subtitle: `${form.note.trim() || 'Demo payment'} · ${form.upiId.trim()}`,
        amountPaise,
        category: 'transfer',
      });
      setReviewOpen(false);
      setSuccessTransaction(transaction);
      setForm({ upiId: '', amount: '', note: '' });
      showToast('Demo payment recorded. No money was transferred.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not record this demo payment.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleDone = () => {
    setSuccessTransaction(null);
    navigate('/transactions');
  };

  return (
    <>
      <PageHeader eyebrow="PAYMENTS · DEMO MODE" title="Send money" description="Try a thoughtful payment flow. Nothing is sent to a bank or UPI network." />

      <div className="send-page-grid">
        <section className="card send-form-card">
          <div className="form-card-heading">
            <span className="form-heading-icon"><Send size={19} /></span>
            <div><h2>Who are you paying?</h2><p>Use a saved demo contact or enter a UPI ID.</p></div>
          </div>

          <form onSubmit={reviewPayment} noValidate>
            <div className="field recipient-upi-field">
              <label htmlFor="recipient-upi">UPI ID</label>
              <div className="input-with-prefix"><span className="input-prefix">@</span><input id="recipient-upi" name="upiId" type="text" value={form.upiId} onChange={(event) => updateField('upiId', event.target.value)} autoComplete="off" placeholder="name@bank" aria-invalid={Boolean(errors.upiId)} aria-describedby={errors.upiId ? 'upi-error' : 'upi-hint'} /></div>
              {errors.upiId ? <span className="field-error" id="upi-error">{errors.upiId}</span> : <span className="field-hint" id="upi-hint">Format check only; the recipient is not verified.</span>}
            </div>

            <div className="contacts-picker">
              <div className="field-label-row"><span>Recent people</span><span className="field-mini-note">Demo contacts</span></div>
              <div className="contact-chip-list">
                {demoRecipients.slice(0, 4).map((recipient) => (
                  <button type="button" key={recipient.id} className={`contact-chip ${form.upiId === recipient.upiId ? 'selected' : ''}`} onClick={() => updateField('upiId', recipient.upiId)}>
                    <span className={`contact-chip-avatar person-${recipient.color}`}><Avatar name={recipient.name} size="sm" /></span>
                    <span>{recipient.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-divider" />

            <div className="field amount-field">
              <label htmlFor="payment-amount">Amount</label>
              <div className="amount-input-wrap"><span>₹</span><input id="payment-amount" name="amount" type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={form.amount} onChange={(event) => updateField('amount', event.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'amount-error' : 'amount-hint'} /></div>
              {errors.amount ? <span className="field-error" id="amount-error">{errors.amount}</span> : <span className="field-hint" id="amount-hint">Available demo funds: {formatRupees(balancePaise)}</span>}
            </div>
            <div className="amount-suggestions" aria-label="Suggested amounts">
              {[100, 500, 1000].map((amount) => <button type="button" key={amount} onClick={() => updateField('amount', String(amount))}>₹{amount.toLocaleString('en-IN')}</button>)}
            </div>

            <TextInput label="Add a note (optional)" id="payment-note" name="note" type="text" maxLength={50} value={form.note} onChange={(event) => updateField('note', event.target.value)} placeholder="What’s this for?" hint="Keep it short and kind. Max 50 characters." />

            <div className="demo-inline-notice"><ShieldCheck size={17} /><p><strong>Demo only.</strong> This flow updates an in-memory simulated balance; it does not initiate a real transfer.</p></div>
            <Button type="submit" size="lg" className="button-full" icon={<ArrowRight size={17} />}>Review demo payment</Button>
          </form>
        </section>

        <aside className="send-aside">
          <section className="card balance-summary-card">
            <span className="balance-summary-icon"><WalletSummaryIcon /></span>
            <span className="eyebrow">AVAILABLE DEMO FUNDS</span>
            <strong>{formatRupees(balancePaise)}</strong>
            <span className="balance-summary-caption">Simulated only · resets on reload</span>
          </section>
          <section className="card send-info-card">
            <div className="send-info-icon"><LockKeyhole size={19} /></div>
            <h2>Safe by design</h2>
            <p>We only check that the UPI ID looks correctly formatted. This demo does not verify people or reach any payment network.</p>
            <div className="send-info-rule"><BadgeCheck size={16} /><span>No PIN or password fields</span></div>
            <div className="send-info-rule"><Clock3 size={16} /><span>Everything stays in this browser session</span></div>
          </section>
          <section className="card send-help-card">
            <span className="send-help-icon"><UsersRound size={18} /></span>
            <div><strong>Need a hand?</strong><p>Learn how the simulated flow works.</p></div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/help')} icon={<ArrowRight size={15} />}>Help</Button>
          </section>
        </aside>
      </div>

      <Modal open={reviewOpen} title="Review demo payment" subtitle="Please check the details before simulating this activity." onClose={() => setReviewOpen(false)} size="sm"
        footer={<><Button variant="secondary" onClick={() => setReviewOpen(false)} icon={<ArrowLeft size={15} />}>Edit details</Button><Button onClick={confirmPayment} busy={processing} icon={<Check size={16} />}>{processing ? 'Recording…' : 'Confirm demo payment'}</Button></>}>
        <div className="demo-warning"><span className="warning-badge">SIMULATION</span><p>Confirming records a local demo transaction only. No actual money moves.</p></div>
        <div className="review-recipient"><span className="review-avatar"><Avatar name={selectedRecipient?.name ?? form.upiId} size="lg" /></span><div><span>Sending to</span><strong>{selectedRecipient?.name ?? form.upiId}</strong><small>{form.upiId}</small></div></div>
        <div className="review-amount"><span>Demo amount</span><strong>{formatRupees(amountPaise)}</strong></div>
        {form.note.trim() && <div className="review-note"><span>Note</span><strong>{form.note.trim()}</strong></div>}
        <div className="review-balance"><span>Remaining demo funds</span><strong>{formatRupees(balancePaise - amountPaise)}</strong></div>
      </Modal>

      <Modal open={Boolean(successTransaction)} title="Demo payment recorded" subtitle="This was a local simulation—not a bank transfer." onClose={() => setSuccessTransaction(null)} size="sm"
        footer={<><Button variant="secondary" onClick={() => setSuccessTransaction(null)}>Send another</Button><Button onClick={handleDone} icon={<ArrowRight size={16} />}>View activity</Button></>}>
        {successTransaction && <div className="success-summary">
          <span className="success-large-icon"><Check size={28} /></span>
          <strong className="success-summary-amount">−{formatRupees(successTransaction.amountPaise)}</strong>
          <span className="success-summary-to">to {successTransaction.title}</span>
          <div className="success-demo-label"><CircleAlert size={16} /><span>Simulated only · no real money moved</span></div>
          <span className="success-reference">Demo reference: {successTransaction.reference}</span>
        </div>}
      </Modal>
    </>
  );
}

function WalletSummaryIcon() {
  return <span className="wallet-summary-glyph">₹</span>;
}
