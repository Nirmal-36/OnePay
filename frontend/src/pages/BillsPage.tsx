import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, Bolt, Building2, Check, CircleAlert, Flame, Smartphone, Tv, Waves, Wifi } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { billServices, billerOptions, demoRechargePlans, savedBillers, type BillServiceId, type DemoRechargePlan } from '../data/demo';
import { ApiError, apiErrorMessage } from '../api/auth';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { formatRupees, type DemoTransaction } from '../types';
import { Button, SelectInput, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';

const serviceIcon = (service: BillServiceId) => {
  const icons = { mobile: Smartphone, dth: Tv, electricity: Bolt, water: Waves, gas: Flame, broadband: Wifi, other: Building2 };
  const Icon = icons[service];
  return <Icon size={19} strokeWidth={1.8} aria-hidden="true" />;
};

const allowedServices = billServices.map((service) => service.id) as string[];
const readService = (value: string | null): BillServiceId => allowedServices.includes(value ?? '') ? value as BillServiceId : 'mobile';
const newRequestKey = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `onepay-bill-${Date.now()}-${Math.random()}`;

export default function BillsPage() {
  const { balancePaise, recordDemoPayment, paymentDataLoading, paymentDataError, refreshPaymentData } = useDemo();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const firstService = readService(searchParams.get('service'));
  const [service, setService] = useState<BillServiceId>(firstService);
  const [biller, setBiller] = useState(billerOptions[firstService][0]);
  const [subscriber, setSubscriber] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedPlanCode, setSelectedPlanCode] = useState('');
  const [errors, setErrors] = useState<{ subscriber?: string; amount?: string; biller?: string }>({});
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [retryingBalance, setRetryingBalance] = useState(false);
  const [requestUncertain, setRequestUncertain] = useState(false);
  const [requestError, setRequestError] = useState('');
  const requestKey = useRef<string | null>(null);
  const [outcomeTransaction, setOutcomeTransaction] = useState<DemoTransaction | null>(null);

  const serviceInfo = billServices.find((item) => item.id === service)!;
  const amountPaise = Math.round(Number(amount) * 100);
  const isMobile = service === 'mobile';
  const isRecharge = isMobile || service === 'dth';
  const availablePlans = demoRechargePlans.filter((plan) => plan.service === service && plan.provider === biller);
  const selectedPlan = demoRechargePlans.find((plan) => plan.code === selectedPlanCode);

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
    setSubscriber('');
    setAmount('');
    setSelectedPlanCode('');
  };

  const changeProvider = (nextProvider: string) => {
    resetRequest();
    setBiller(nextProvider);
    setAmount('');
    setSelectedPlanCode('');
    setErrors((current) => ({ ...current, biller: undefined, amount: undefined }));
  };

  const fillSavedBiller = (saved: (typeof savedBillers)[number]) => {
    resetRequest();
    setService(saved.service);
    setSearchParams({ service: saved.service }, { replace: true });
    setBiller(saved.biller);
    setSubscriber(saved.identifier);
    setAmount('');
    setSelectedPlanCode('');
    setErrors({});
  };

  const validate = () => {
    const nextErrors: typeof errors = {};
    if (isMobile) {
      let digits = subscriber.replace(/\D/g, '');
      if (!/^\+?[0-9\s().-]+$/.test(subscriber.trim())) nextErrors.subscriber = 'Use digits and common phone-number separators only.';
      else {
        if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
        if (!/^[6-9]\d{9}$/.test(digits)) nextErrors.subscriber = 'Enter a valid 10-digit demo mobile number beginning with 6–9.';
      }
    } else if (!/^[a-zA-Z0-9-]{4,24}$/.test(subscriber.trim())) {
      nextErrors.subscriber = 'Enter a 4–24 character demo consumer or subscriber ID.';
    }
    if (!biller) nextErrors.biller = 'Choose a mock provider.';
    if (paymentDataLoading) nextErrors.amount = 'Wait for the demo wallet balance to finish loading.';
    else if (paymentDataError) nextErrors.amount = 'Retry the wallet check before recording a payment.';
    else if (!Number.isFinite(amountPaise) || amountPaise <= 0) nextErrors.amount = 'Enter an amount greater than ₹0.';
    else if (amountPaise > balancePaise) nextErrors.amount = 'This is more than your available demo balance.';
    else if (amountPaise > 5_000_000) nextErrors.amount = 'For this demo, use an amount of ₹50,000 or less.';
    if (selectedPlan && (selectedPlan.service !== service || selectedPlan.provider !== biller || selectedPlan.amountPaise !== amountPaise)) {
      nextErrors.amount = 'Choose the plan again so its demo amount and provider match.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validate()) setReviewOpen(true);
  };

  const confirmPayment = async () => {
    setProcessing(true);
    requestKey.current ??= newRequestKey();
    try {
      const transaction = await recordDemoPayment({
        kind: isRecharge ? 'recharge' : 'bill',
        service,
        provider: biller,
        ...(selectedPlan ? { planCode: selectedPlan.code } : {}),
        recipientReference: subscriber.trim(),
        amountPaise,
        idempotencyKey: requestKey.current,
      });
      requestKey.current = null;
      setRequestUncertain(false);
      setRequestError('');
      setReviewOpen(false);
      setOutcomeTransaction(transaction);
      setSubscriber('');
      setAmount('');
      setSelectedPlanCode('');
      if (transaction.status === 'failed') showToast('The demo simulator declined this activity; the fictional debit was refunded.', 'error');
      else if (transaction.status === 'pending') showToast('This activity is pending in the local demo simulator.', 'info');
      else showToast('Demo activity recorded. No provider was contacted.', 'success');
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

  const choosePlan = (plan: DemoRechargePlan) => {
    resetRequest();
    setSelectedPlanCode(plan.code);
    setAmount((plan.amountPaise / 100).toFixed(2));
    setErrors((current) => ({ ...current, amount: undefined }));
    setPlanModalOpen(false);
  };

  const retryWallet = async () => {
    setRetryingBalance(true);
    try {
      await refreshPaymentData();
    } catch {
      // The provider exposes the latest safe, user-facing error state.
    } finally {
      setRetryingBalance(false);
    }
  };

  const outcomeTitle = outcomeTransaction?.status === 'failed' ? 'Demo activity failed'
    : outcomeTransaction?.status === 'pending' ? 'Demo activity pending' : 'Demo activity recorded';

  return (
    <>
      <PageHeader eyebrow="EVERYDAY SERVICES · DEMO MODE" title="Recharge & bills" description="Explore mock operators and billers with simulated plans and fictional funds." action={<span className="header-demo-badge"><span className="demo-pulse" />Demo only</span>} />

      <div className="bill-service-tabs" role="tablist" aria-label="Choose a service">
        {billServices.map((item) => <button type="button" role="tab" aria-selected={service === item.id} className={`bill-service-tab ${service === item.id ? 'active' : ''}`} key={item.id} onClick={() => changeService(item.id)}><span>{serviceIcon(item.id)}</span>{item.label}</button>)}
      </div>

      <div className="bills-layout">
        <section className="card bill-form-card">
          <div className="bill-form-heading"><span className={`bill-heading-icon bill-heading-${service}`}>{serviceIcon(service)}</span><div><h2>{serviceInfo.shortLabel}</h2><p>{serviceInfo.detail} · simulated only</p></div></div>
          {paymentDataError && <div className="bill-wallet-error" role="alert"><CircleAlert size={17} /><div><strong>Wallet balance unavailable</strong><p>{paymentDataError}</p><Button size="sm" variant="secondary" busy={retryingBalance} onClick={() => void retryWallet()}>Retry wallet check</Button></div></div>}
          <form onSubmit={onSubmit} noValidate>
            <SelectInput label={isMobile ? 'Mock mobile operator' : service === 'dth' ? 'Mock DTH operator' : 'Mock biller'} id="bill-provider" name="biller" value={biller} error={errors.biller} onChange={(event) => changeProvider(event.target.value)}>
              <option value="">Choose a mock provider</option>
              {billerOptions[service].map((option) => <option key={option} value={option}>{option}</option>)}
            </SelectInput>
            <TextInput label={isMobile ? 'Mobile number' : 'Consumer / subscriber ID'} id="bill-subscriber" name="subscriber" type="tel" inputMode={isMobile ? 'numeric' : 'text'} autoComplete="off" value={subscriber} onChange={(event) => { resetRequest(); setSubscriber(event.target.value); setErrors((current) => ({ ...current, subscriber: undefined })); }} placeholder={isMobile ? '10-digit demo number' : 'e.g. EB-483920'} hint={isMobile ? 'Enter a fictional 10-digit number; an optional +91 prefix is accepted.' : 'Use a fictional 4–24 character demo reference.'} error={errors.subscriber} />
            <div className="bill-amount-label"><span className="field-label">{isRecharge ? 'Recharge amount · mock value' : 'Bill amount · fictional value'}</span>{isRecharge && <button type="button" className="text-link" onClick={() => setPlanModalOpen(true)}>Choose a mock plan <ArrowRight size={14} /></button>}</div>
            <div className="field amount-field">
              <div className="amount-input-wrap"><span>₹</span><input id="bill-amount" name="amount" type="number" inputMode="decimal" min="0.01" max="50000" step="0.01" value={amount} onChange={(event) => { resetRequest(); setAmount(event.target.value); setSelectedPlanCode(''); setErrors((current) => ({ ...current, amount: undefined })); }} placeholder="0.00" aria-label="Amount in rupees" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'bill-amount-error' : 'bill-amount-hint'} />
              </div>
              {errors.amount ? <span className="field-error" id="bill-amount-error">{errors.amount}</span> : <span className="field-hint" id="bill-amount-hint">{selectedPlan ? `${selectedPlan.label} · mock value only.` : 'Enter an illustrative amount; it is not a live bill or provider quote.'} {paymentDataLoading ? 'Loading server balance…' : `Available demo funds: ${formatRupees(balancePaise)}`}</span>}
            </div>
            {isRecharge && <p className="bill-mock-data-note">Plans and values are fictional examples. No operator catalog, availability, or benefits are queried.</p>}
            <div className="demo-inline-notice"><BadgeCheck size={17} /><p><strong>Simulation only.</strong> No provider is contacted and no real recharge or bill payment is made.</p></div>
            <Button type="submit" size="lg" className="button-full" disabled={paymentDataLoading || Boolean(paymentDataError)} icon={<ArrowRight size={17} />}>Review {isRecharge ? 'recharge' : 'bill'}</Button>
          </form>
        </section>

        <aside className="bills-side-column">
          <section className="card saved-billers-card"><div className="section-heading"><div><h2>Saved demo accounts</h2><p>Use a sample ID to fill the form.</p></div></div>
            {savedBillers.map((saved) => <button type="button" className="saved-biller-row" key={saved.label} onClick={() => fillSavedBiller(saved)}>
              <span className={`saved-biller-icon saved-${saved.service}`}>{serviceIcon(saved.service)}</span><span><strong>{saved.label}</strong><small>{saved.identifier}</small></span><ArrowRight size={16} />
            </button>)}
          </section>
          <section className="card bill-balance-card"><span className="eyebrow">DEMO BALANCE</span><strong>{paymentDataLoading ? 'Loading…' : formatRupees(balancePaise)}</strong><p>Fictional funds available for simulated transactions.</p><Link to="/" className="text-link">View dashboard <ArrowRight size={14} /></Link></section>
          <section className="bill-help-note"><span><CircleAlert size={17} /></span><p>Provider names, plans, values, and account details are mock data. No account lookup or provider confirmation occurs.</p></section>
        </aside>
      </div>

      <Modal open={planModalOpen} title="Choose a mock plan" subtitle="Illustrative examples only; these are not live operator plans or benefits." onClose={() => setPlanModalOpen(false)} size="sm">
        {availablePlans.length ? <div className="demo-plan-list">{availablePlans.map((plan) => <button type="button" key={plan.code} className="demo-plan-option" aria-label={`Select ${plan.label} for ${formatRupees(plan.amountPaise)}`} onClick={() => choosePlan(plan)}><span><strong>{plan.label}</strong><small>{plan.description}</small></span><strong>{formatRupees(plan.amountPaise)}</strong><ArrowRight size={16} /></button>)}</div> : <p className="modal-body-copy">No mock plans are configured for this provider. You can enter a fictional amount instead.</p>}
      </Modal>

      <Modal open={reviewOpen} title="Review demo payment" subtitle="Check your details before recording this local simulation." onClose={closeReview} size="sm"
        footer={<><Button variant="secondary" onClick={closeReview} disabled={processing || requestUncertain}>Go back</Button><Button onClick={() => void confirmPayment()} busy={processing} icon={<Check size={16} />}>{processing ? 'Processing…' : requestUncertain ? 'Retry same request' : 'Confirm demo payment'}</Button></>}>
        <div className="demo-warning"><span className="warning-badge">SIMULATION</span><p>No service provider will be contacted. The OnePay backend records only simulated ledger activity.</p></div>
        {requestError && <div className="inline-api-error" role="alert"><CircleAlert size={17} /><span>{requestError}</span></div>}
        <div className="review-bill-details"><div><span>Service</span><strong>{serviceInfo.shortLabel}</strong></div><div><span>Mock provider</span><strong>{biller}</strong></div>{selectedPlan && <div><span>Mock plan</span><strong>{selectedPlan.label} · fictional example</strong></div>}<div><span>Account</span><strong>{isMobile ? `•••• ${subscriber.replace(/\D/g, '').slice(-4)}` : `•••• ${subscriber.slice(-4)}`}</strong></div><div className="review-bill-total"><span>Simulated amount</span><strong>{formatRupees(amountPaise)}</strong></div></div>
      </Modal>

      <Modal open={Boolean(outcomeTransaction)} title={outcomeTitle} subtitle={outcomeTransaction?.status === 'failed' ? 'The local simulator refunded the fictional debit.' : outcomeTransaction?.status === 'pending' ? 'No provider was contacted; the simulated outcome is still pending.' : 'This is not a real recharge or bill payment.'} onClose={() => setOutcomeTransaction(null)} size="sm"
        footer={<><Button variant="secondary" onClick={() => setOutcomeTransaction(null)}>Done</Button><Button onClick={() => { const reference = outcomeTransaction?.reference; setOutcomeTransaction(null); if (reference) navigate(`/transactions/${encodeURIComponent(reference)}`); }} icon={<ArrowRight size={16} />}>View receipt</Button></>}>
        {outcomeTransaction && <div className="success-summary"><span className="success-large-icon">{outcomeTransaction.status === 'failed' ? <CircleAlert size={26} /> : outcomeTransaction.status === 'pending' ? <CircleAlert size={26} /> : <Check size={28} />}</span><strong className="success-summary-amount">{outcomeTransaction.status === 'failed' ? 'Not debited' : outcomeTransaction.status === 'pending' ? 'Pending' : `−${formatRupees(outcomeTransaction.amountPaise)}`}</strong><span className="success-summary-to">{outcomeTransaction.title}{outcomeTransaction.subtitle ? ` · ${outcomeTransaction.subtitle}` : ''}</span><div className="success-demo-label"><CircleAlert size={16} /><span>Simulated only · no provider was contacted</span></div><span className="success-reference">OnePay reference: {outcomeTransaction.reference}</span></div>}
      </Modal>
    </>
  );
}
