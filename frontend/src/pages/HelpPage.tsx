import { useState, type FormEvent } from 'react';
import { ArrowRight, ChevronDown, CircleHelp, LifeBuoy, Mail, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '../context/ToastProvider';
import { Button, SelectInput, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

const faqs = [
  { id: 'demo', question: 'Are any payments real?', answer: 'No. OnePay account authentication is server-backed, but all balances and payment activity are simulated. Confirming a payment updates fictional funds and an in-memory activity list only. No bank, UPI network, or provider is contacted.' },
  { id: 'upi', question: 'Does a UPI ID check confirm the recipient?', answer: 'No. We only check whether the text resembles a UPI ID, such as name@bank. It does not confirm that the ID exists, belongs to the person shown, or can receive money.' },
  { id: 'qr', question: 'What happens when I scan a QR code?', answer: 'The page reads QR text in your browser and accepts a supported demo payment request or a syntactically valid UPI ID. You can review the details, but nothing is paid automatically.' },
  { id: 'data', question: 'Where is my information saved?', answer: 'Demo profile edits, balance changes, notifications, and transactions live only in the current page session. Reloading the page resets them. Do not enter sensitive or real banking information.' },
  { id: 'secrets', question: 'Does OnePay need my banking PIN, password, OTP, or card security code?', answer: 'No. Never provide those details to this demo—or to anyone claiming to represent it. Those inputs are not requested or stored.' },
];

export default function HelpPage() {
  const { showToast } = useToast();
  const [openFaq, setOpenFaq] = useState<string | null>('demo');
  const [category, setCategory] = useState('Using the demo');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({});
  const [sending, setSending] = useState(false);
  const [ticketId, setTicketId] = useState('');
  const [submittedCategory, setSubmittedCategory] = useState('');

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (subject.trim().length < 4) nextErrors.subject = 'Add a short subject (at least 4 characters).';
    if (message.trim().length < 12) nextErrors.message = 'Please add a little more detail (at least 12 characters).';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSending(true);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    const id = `ONEPAY-${Date.now().toString().slice(-6)}`;
    setTicketId(id);
    setSubmittedCategory(category);
    setSubject('');
    setMessage('');
    setSending(false);
    showToast(`Sample support request created: ${id}.`, 'success');
  };

  const startAnotherRequest = () => setTicketId('');

  return (
    <>
      <PageHeader eyebrow="WE’RE HERE TO HELP" title="Help & support" description="Get to know the demo, read quick answers, or create a sample support request." />
      <div className="help-intro-card"><span className="help-intro-icon"><LifeBuoy size={22} /></span><div><span className="eyebrow">ONEPAY DEMO SUPPORT</span><h2>How can we help?</h2><p>Explore the answers below or send a local sample request. No email or support service is contacted.</p></div><Sparkles className="help-intro-sparkle" size={22} /></div>

      <div className="help-layout">
        <section className="card faq-card" aria-labelledby="faq-heading"><div className="section-heading"><div><h2 id="faq-heading">Frequently asked questions</h2><p>Clear answers about this demo experience.</p></div><span className="faq-heading-icon"><CircleHelp size={18} /></span></div>
          <div className="faq-list">
            {faqs.map((faq) => <article className={`faq-item ${openFaq === faq.id ? 'open' : ''}`} key={faq.id}>
              <h3><button type="button" aria-expanded={openFaq === faq.id} aria-controls={`faq-answer-${faq.id}`} onClick={() => setOpenFaq((current) => current === faq.id ? null : faq.id)}>{faq.question}<ChevronDown size={18} /></button></h3>
              {openFaq === faq.id && <div id={`faq-answer-${faq.id}`} className="faq-answer"><p>{faq.answer}</p></div>}
            </article>)}
          </div>
          <div className="help-safety-note"><ShieldCheck size={18} /><span>OnePay will never ask you for a PIN, password, OTP, or card security code.</span></div>
        </section>

        <aside className="help-contact-column">
          <section className="card support-form-card"><div className="support-form-title"><span className="support-form-icon"><MessageCircle size={18} /></span><div><h2>Send a sample request</h2><p>Form submission stays on this page.</p></div></div>
            {ticketId ? <div className="ticket-success"><span className="ticket-success-icon"><Mail size={21} /></span><strong>Request noted</strong><p>Your sample request about <strong>{submittedCategory.toLowerCase()}</strong> has been created locally. It was not sent to a support team.</p><span className="ticket-number">Reference · {ticketId}</span><Button variant="secondary" size="sm" onClick={startAnotherRequest}>Create another request</Button></div> : <form onSubmit={submitRequest} noValidate>
              <SelectInput label="What do you need help with?" id="support-category" name="category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option>Using the demo</option><option>Payments and activity</option><option>QR scanner</option><option>Profile and settings</option><option>Something else</option>
              </SelectInput>
              <TextInput label="Subject" id="support-subject" name="subject" value={subject} maxLength={80} onChange={(event) => { setSubject(event.target.value); setErrors((current) => ({ ...current, subject: undefined })); }} placeholder="A short summary" error={errors.subject} />
              <div className="field"><label htmlFor="support-message">How can we help?</label><textarea id="support-message" name="message" rows={4} maxLength={500} value={message} onChange={(event) => { setMessage(event.target.value); setErrors((current) => ({ ...current, message: undefined })); }} placeholder="Share a little more detail…" aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'support-message-error' : 'support-message-hint'} />{errors.message ? <span className="field-error" id="support-message-error">{errors.message}</span> : <span className="field-hint" id="support-message-hint">At least 12 characters. Don’t include sensitive information.</span>}</div>
              <Button type="submit" className="button-full" busy={sending} icon={<ArrowRight size={16} />}>{sending ? 'Creating request…' : 'Create sample request'}</Button>
              <p className="support-form-disclaimer">This form has no backend and will not contact customer support.</p>
            </form>}
          </section>
          <section className="card help-shortcuts-card"><h2>Jump to a page</h2><Link to="/send"><span className="shortcut-icon shortcut-purple"><ArrowRight size={16} /></span><span><strong>Try a demo payment</strong><small>See the send-money flow</small></span><ArrowRight size={15} /></Link><Link to="/scan"><span className="shortcut-icon shortcut-blue"><ArrowRight size={16} /></span><span><strong>Explore QR codes</strong><small>Scan or show your demo QR</small></span><ArrowRight size={15} /></Link><Link to="/transactions"><span className="shortcut-icon shortcut-yellow"><ArrowRight size={16} /></span><span><strong>Review activity</strong><small>Open a demo receipt</small></span><ArrowRight size={15} /></Link></section>
        </aside>
      </div>
    </>
  );
}
