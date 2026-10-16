import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, Bolt, Check, CircleAlert, Flame, Smartphone, Tv, Waves, Wifi } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { billServices, billerOptions, savedBillers, type BillServiceId } from '../data/demo';
import { ApiError, apiErrorMessage } from '../api/auth';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { formatRupees, type DemoTransaction } from '../types';
import { Button, SelectInput, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';

const serviceIcon = (service: BillServiceId) => {
  const icons = { mobile: Smartphone, dth: Tv, electricity: Bolt, water: Waves, gas: Flame, broadband: Wifi };
  const Icon = icons[service];
  return <Icon size={19} strokeWidth={1.8} aria-hidden="true" />;
};

const allowedServices = billServices.map((service) => service.id) as string[];
const readService = (value: string | null): BillServiceId => allowedServices.includes(value ?? '') ? value as BillServiceId : 'mobile';

export default function BillsPage() {
  const { balancePaise, recordDemoPayment, paymentDataLoading } = useDemo();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const firstService = readService(searchParams.get('service'));
  const [service, setService] = useState<BillServiceId>(firstService);
  const [biller, setBiller] = useState(billerOptions[firstService][0]);
  const [subscriber, setSubscriber] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ subscriber?: string; amount?: string; biller?: string }>({});
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [requestUncertain, setRequestUncertain] = useState(false);
  const [requestError, setRequestError] = useState('');
  const requestKey = useRef<string | null>(null);
  const [successTransaction, setSuccessTransaction] = useState<DemoTransaction | null>(null);

  const serviceInfo = billServices.find((item) => item.id === service)!;
  const amountPaise = Math.round(Number(amount) * 100);
  const isMobile = service === 'mobile';
  const suggestions = isMobile || service === 'dth' ? [199, 299, 499] : [500, 1000, 1500];

  const resetRequest = () => {
    if (requestUncertain) return;
    requestKey.current = null;
    setRequestError('');
  };

  const changeService = (nextService: BillServiceId) => {
    resetRequest();
    setService(nextService);
    setSearchParams({ service: nextService }, { replace: true });
    setBiller(billerOptions[nextService][0]);
    setErrors({});
    setAmount('');
  };

  const fillSavedBiller = (saved: (typeof savedBillers)[number]) => {
    resetRequest();
    changeService(saved.service);
    setSubscriber(saved.identifier);
    setBiller(saved.biller);
  };

  const validate = () => {
    const nextErrors: typeof errors = {};
    if (isMobile) {
      const digits = subscriber.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(digits)) nextErrors.subscriber = 'Enter a valid 10-digit demo mobile number beginning with 6–9.';
    } else if (!/^[a-zA-Z0-9-]{4,24}$/.test(subscriber.trim())) {
      nextErrors.subscriber = 'Enter a 4–24 character demo consumer or subscriber ID.';
    }
    if (!biller) nextErrors.biller = 'Choose a demo provider.';
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) nextErrors.amount = 'Enter an amount greater than ₹0.';
    else if (!paymentDataLoading && amountPaise > balancePaise) nextErrors.amount = 'This is more than your available demo balance.';
    else if (amountPaise > 5_000_000) nextErrors.amount = 'For this demo, use an amount of ₹50,000 or less.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validate()) setReviewOpen(true);
  };

  const confirmPayment = async () => {
    setProcessing(true);
    requestKey.current ??= typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `onepay-bill-${Date.now()}-${Math.random()}`;
    try {
      const transaction = await recordDemoPayment({
        kind: service === 'mobile' || service === 'dth' ? 'recharge' : 'bill',
        service,
        recipientReference: subscriber.trim(),
        amountPaise,
        idempotencyKey: requestKey.current,
      });
      requestKey.current = null;
      setRequestUncertain(false);
      setRequestError('');
      setReviewOpen(false);
      setSuccessTransaction(transaction);
      setSubscriber('');
      setAmount('');
      if (transaction.status === 'failed') showToast('The demo simulator declined this activity; the balance was refunded.', 'error');
      else if (transaction.status === 'pending') showToast('This activity is pending in the demo simulator.', 'info');
      else showToast('Demo bill activity recorded. No provider was contacted.', 'success');
    } catch (error) {
      const uncertain = error instanceof ApiError && error.status === 0;
      setRequestUncertain(uncertain);
      const message = apiErrorMessage(error, 'Could not record this demo activity. Retry the same request.');
      setRequestError(uncertain ? `${message} Retry with the same details to safely check the request.` : message);
      showToast(message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const closeReview = () => {
    if (processing || requestUncertain) return;
    setReviewOpen(false);
    requestKey.current = null;
    setRequestError('');
  };

  const onPlanSelected = (value: number) => {
    resetRequest();
    setAmount(String(value));
    setErrors((current) => ({ ...current, amount: undefined }));
    setPlanModalOpen(false);
  };

  return (
    <>
      <PageHeader eyebrow="EVERYDAY SERVICES · DEMO MODE" title="Recharge & bills" description="Explore mobile recharge and bill-payment screens with simulated providers and funds." action={<span className="header-demo-badge"><span className="demo-pulse" />Demo only</span>} />

      <div className="bill-service-tabs" role="tablist" aria-label="Choose a service">
        {billServices.map((item) => <button type="button" role="tab" aria-selected={service === item.id} className={`bill-service-tab ${service === item.id ? 'active' : ''}`} key={item.id} onClick={() => changeService(item.id)}><span>{serviceIcon(item.id)}</span>{item.label}</button>)}
      </div>

      <div className="bills-layout">
        <section className="card bill-form-card">
          <div className="bill-form-heading"><span className={`bill-heading-icon bill-heading-${service}`}>{serviceIcon(service)}</span><div><h2>{serviceInfo.shortLabel}</h2><p>{serviceInfo.detail} · simulated only</p></div></div>
          <form onSubmit={onSubmit} noValidate>
            <SelectInput label="Demo provider" id="bill-provider" name="biller" value={biller} error={errors.biller} onChange={(event) => { resetRequest(); setBiller(event.target.value); setErrors((current) => ({ ...current, biller: undefined })); }}>
              <option value="">Choose a provider</option>
              {billerOptions[service].map((option) => <option key={option} value={option}>{option}</option>)}
            </SelectInput>
            <TextInput label={isMobile ? 'Mobile number' : 'Consumer / subscriber ID'} id="bill-subscriber" name="subscriber" type="tel" inputMode={isMobile ? 'numeric' : 'text'} autoComplete="off" value={subscriber} onChange={(event) => { resetRequest(); setSubscriber(event.target.value); setErrors((current) => ({ ...current, subscriber: undefined })); }} placeholder={isMobile ? '10-digit demo number' : 'e.g. EB-483920'} hint={isMobile ? 'Enter a fictional 10-digit number for this demo.' : 'Use a fictional demo consumer ID.'} error={errors.subscriber} />
            <div className="bill-amount-label"><span className="field-label">{isMobile || service === 'dth' ? 'Recharge amount' : 'Bill amount'}</span>{(isMobile || service === 'dth') && <button type="button" className="text-link" onClick={() => setPlanModalOpen(true)}>Browse demo plans <ArrowRight size={14} /></button>}</div>
            <div className="field amount-field">
              <div className="amount-input-wrap"><span>₹</span><input id="bill-amount" name="amount" type="number" inputMode="decimal" min="0.01" max="50000" step="0.01" value={amount} onChange={(event) => { resetRequest(); setAmount(event.target.value); setErrors((current) => ({ ...current, amount: undefined })); }} placeholder="0.00" aria-label="Amount in rupees" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'bill-amount-error' : 'bill-amount-hint'} /></div>
              {errors.amount ? <span className="field-error" id="bill-amount-error">{errors.amount}</span> : <span className="field-hint" id="bill-amount-hint">{paymentDataLoading ? 'Loading server balance…' : `Available demo funds: ${formatRupees(balancePaise)}`}</span>}
            </div>
            <div className="amount-suggestions" aria-label="Suggested demo amounts">{suggestions.map((value) => <button type="button" key={value} onClick={() => onPlanSelected(value)}>₹{value.toLocaleString('en-IN')}</button>)}</div>
            <div className="demo-inline-notice"><BadgeCheck size={17} /><p><strong>Demo provider.</strong> No provider is contacted and no real recharge or bill payment is made.</p></div>
            <Button type="submit" size="lg" className="button-full" icon={<ArrowRight size={17} />}>Review {isMobile || service === 'dth' ? 'recharge' : 'bill'}</Button>
          </form>
        </section>

        <aside className="bills-side-column">
          <section className="card saved-billers-card"><div className="section-heading"><div><h2>Saved demo accounts</h2><p>Use a sample ID to fill the form.</p></div></div>
            {savedBillers.map((saved) => <button type="button" className="saved-biller-row" key={saved.label} onClick={() => fillSavedBiller(saved)}>
              <span className={`saved-biller-icon saved-${saved.service}`}>{serviceIcon(saved.service)}</span><span><strong>{saved.label}</strong><small>{saved.identifier}</small></span><ArrowRight size={16} />
            </button>)}
          </section>
          <section className="card bill-balance-card"><span className="eyebrow">DEMO BALANCE</span><strong>{formatRupees(balancePaise)}</strong><p>Fictional funds available for simulated transactions.</p><Link to="/" className="text-link">View dashboard <ArrowRight size={14} /></Link></section>
          <section className="bill-help-note"><span><CircleAlert size={17} /></span><p>Provider names and account details are for demonstration only. No account lookup is performed.</p></section>
        </aside>
      </div>

      <Modal open={planModalOpen} title="Choose a demo plan" subtitle="Sample amounts only. These plans are not provided by a mobile operator." onClose={() => setPlanModalOpen(false)} size="sm">
        <div className="demo-plan-list">{suggestions.map((value, index) => <button type="button" key={value} className="demo-plan-option" onClick={() => onPlanSelected(value)}><span><strong>Demo plan {index + 1}</strong><small>{index === 0 ? 'Everyday essentials' : index === 1 ? 'Extra data & talktime' : 'More room to explore'}</small></span><strong>{formatRupees(value * 100)}</strong><ArrowRight size={16} /></button>)}</div>
      </Modal>

      <Modal open={reviewOpen} title="Review demo payment" subtitle="Check your details before recording this local simulation." onClose={closeReview} size="sm"
        footer={<><Button variant="secondary" onClick={closeReview} disabled={processing || requestUncertain}>Go back</Button><Button onClick={() => void confirmPayment()} busy={processing} icon={<Check size={16} />}>{processing ? 'Processing…' : requestUncertain ? 'Retry same request' : 'Confirm demo payment'}</Button></>}>
        <div className="demo-warning"><span className="warning-badge">SIMULATION</span><p>No service provider will be contacted. The OnePay backend records only simulated ledger activity.</p></div>
        {requestError && <div className="inline-api-error" role="alert"><CircleAlert size={17} /><span>{requestError}</span></div>}
        <div className="review-bill-details"><div><span>Service</span><strong>{serviceInfo.shortLabel}</strong></div><div><span>Demo provider</span><strong>{biller}</strong></div><div><span>Account</span><strong>{isMobile ? `•••• ${subscriber.replace(/\D/g, '').slice(-4)}` : subscriber}</strong></div><div className="review-bill-total"><span>Demo amount</span><strong>{formatRupees(amountPaise)}</strong></div></div>
      </Modal>

      <Modal open={Boolean(successTransaction)} title={successTransaction?.status === 'failed' ? 'Demo activity failed' : successTransaction?.status === 'pending' ? 'Demo activity pending' : 'Demo activity recorded'} subtitle={successTransaction?.status === 'failed' ? 'The simulator refunded the demo debit.' : 'This is not a real recharge or bill payment.'} onClose={() => setSuccessTransaction(null)} size="sm"
        footer={<><Button variant="secondary" onClick={() => setSuccessTransaction(null)}>Done</Button><Button onClick={() => { const reference = successTransaction?.reference; setSuccessTransaction(null); if (reference) navigate(`/transactions/${encodeURIComponent(reference)}`); }} icon={<ArrowRight size={16} />}>View details</Button></>}>
        {successTransaction && <div className="success-summary"><span className="success-large-icon">{successTransaction.status === 'failed' ? <CircleAlert size={26} /> : <Check size={28} />}</span><strong className="success-summary-amount">{successTransaction.status === 'failed' ? 'Not debited' : `−${formatRupees(successTransaction.amountPaise)}`}</strong><span className="success-summary-to">{successTransaction.title}{successTransaction.subtitle ? ` · ${successTransaction.subtitle}` : ''}</span><div className="success-demo-label"><CircleAlert size={16} /><span>Simulated only · no provider was contacted</span></div><span className="success-reference">OnePay reference: {successTransaction.reference}</span></div>}
      </Modal>
    </>
  );
}
