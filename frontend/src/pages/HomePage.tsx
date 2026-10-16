import { useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Bell, Bolt, CircleHelp, Eye, EyeOff,
  Flame, Plus, QrCode, ReceiptText, ShieldCheck, Smartphone, Sparkles, Tv, WalletCards, Waves, Wifi,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { billServices } from '../data/demo';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { formatRupees, type DemoTransaction } from '../types';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Controls';
import { Modal } from '../components/Modal';
import { TransactionList } from '../components/TransactionList';
import { TransactionReceipt } from '../components/TransactionReceipt';

const serviceIcon = (icon: string) => {
  const icons = { mobile: Smartphone, tv: Tv, bolt: Bolt, water: Waves, flame: Flame, wifi: Wifi };
  const Icon = icons[icon as keyof typeof icons] ?? ReceiptText;
  return <Icon size={19} strokeWidth={1.8} aria-hidden="true" />;
};

const quickActions = [
  { label: 'Send money', detail: 'To a UPI ID or person', icon: ArrowUpRight, to: '/send', tone: 'violet' },
  { label: 'Scan QR', detail: 'Pay with a demo QR', icon: QrCode, to: '/scan', tone: 'blue' },
  { label: 'Recharge', detail: 'Mobile & DTH', icon: Smartphone, to: '/bills?service=mobile', tone: 'orange' },
  { label: 'Pay bills', detail: 'Utilities & more', icon: ReceiptText, to: '/bills', tone: 'green' },
];

export default function HomePage() {
  const { profile, balancePaise, transactions, recipients, addDemoFunds, preferences, updatePreferences, paymentDataLoading } = useDemo();
  const { showToast } = useToast();
  const balanceHidden = preferences.maskBalance;
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [selectedTopUp, setSelectedTopUp] = useState(100_000);
  const [topUpProcessing, setTopUpProcessing] = useState(false);
  const topUpKey = useRef<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<DemoTransaction | null>(null);

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  const confirmTopUp = async () => {
    setTopUpProcessing(true);
    topUpKey.current ??= typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `topup-${Date.now()}-${Math.random()}`;
    try {
      await addDemoFunds(selectedTopUp, topUpKey.current);
      topUpKey.current = null;
      setTopUpOpen(false);
      showToast(`${formatRupees(selectedTopUp)} in simulated funds added.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add demo funds. Retry the same request.', 'error');
    } finally {
      setTopUpProcessing(false);
    }
  };

  return (
    <>
      <div className="dashboard-welcome">
        <div>
          <span className="eyebrow">{todayLabel}</span>
          <h1>{greeting}, {profile.name.split(' ')[0]} <span className="greeting-wave" aria-hidden="true">✦</span></h1>
          <p>Here’s your money, at a glance.</p>
        </div>
        <Link to="/notifications" className="welcome-notice-link">
          <span className="welcome-notice-icon"><Bell size={17} /></span>
          <span><strong>All caught up?</strong><small>Your updates are here</small></span>
          <ArrowRight size={16} />
        </Link>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-column dashboard-column-main">
          <section className="balance-card" aria-label="Demo balance">
            <div className="balance-orb balance-orb-one" />
            <div className="balance-orb balance-orb-two" />
            <div className="balance-card-top">
              <div className="balance-title"><span className="balance-wallet-icon"><WalletCards size={17} /></span><span>Demo wallet balance</span></div>
              <button className="balance-visibility" onClick={() => updatePreferences({ maskBalance: !balanceHidden })} aria-label={balanceHidden ? 'Show demo balance' : 'Hide demo balance'}>
                {balanceHidden ? <Eye size={17} /> : <EyeOff size={17} />}
                <span>{balanceHidden ? 'Show' : 'Hide'}</span>
              </button>
            </div>
            <div className="balance-number">{balanceHidden ? '••••••••' : paymentDataLoading ? 'Loading…' : formatRupees(balancePaise)}</div>
            <p className="balance-caption"><span className="balance-status-dot" />Server-validated simulated funds · no real money</p>
            <div className="balance-card-bottom">
              <span className="balance-footnote">Your OnePay demo balance</span>
              <Button variant="balance-light" size="sm" icon={<Plus size={16} />} onClick={() => setTopUpOpen(true)}>Add demo funds</Button>
            </div>
          </section>

          <section className="card quick-actions-card" aria-labelledby="quick-actions-title">
            <div className="section-heading section-heading-tight">
              <div><h2 id="quick-actions-title">What would you like to do?</h2><p>Every action stays in demo mode.</p></div>
              <span className="section-sparkle"><Sparkles size={17} /></span>
            </div>
            <div className="quick-action-grid">
              {quickActions.map(({ label, detail, icon: Icon, to, tone }) => (
                <Link to={to} key={label} className="quick-action-tile">
                  <span className={`quick-action-icon tone-${tone}`}><Icon size={21} strokeWidth={1.8} /></span>
                  <span className="quick-action-copy"><strong>{label}</strong><small>{detail}</small></span>
                  <ArrowRight className="quick-action-arrow" size={16} />
                </Link>
              ))}
            </div>
          </section>

          <section className="card people-card" aria-labelledby="people-title">
            <div className="section-heading">
              <div><h2 id="people-title">People</h2><p>Send a demo payment to someone you know.</p></div>
              <Link to="/recipients" className="text-link">Manage <ArrowRight size={15} /></Link>
            </div>
            <div className="people-row">
              {recipients.slice(0, 5).map((recipient) => (
                <Link key={recipient.id} to="/send" state={{ recipient }} className="person-item" aria-label={`Send to ${recipient.name}`}>
                  <span className={`person-avatar person-${recipient.color}`}><Avatar name={recipient.name} size="lg" /></span>
                  <span className="person-name">{recipient.name.split(' ')[0]}</span>
                  <span className="person-upi">{recipient.upiId.split('@')[0]}</span>
                </Link>
              ))}
              <Link to="/recipients" className="person-item person-add">
                <span className="person-add-circle"><Plus size={21} /></span><span className="person-name">New</span><span className="person-upi">Recipient</span>
              </Link>
            </div>
          </section>

          <section className="card activity-card" aria-labelledby="recent-title">
            <div className="section-heading">
              <div><h2 id="recent-title">Recent activity</h2><p>Your latest simulated transactions.</p></div>
              <Link to="/transactions" className="text-link">View history <ArrowRight size={15} /></Link>
            </div>
            <TransactionList transactions={transactions.slice(0, 4)} onSelect={setSelectedTransaction} compact />
          </section>
        </div>

        <aside className="dashboard-column dashboard-column-side">
          <section className="card services-card" aria-labelledby="services-title">
            <div className="section-heading">
              <div><h2 id="services-title">Explore services</h2><p>Everyday essentials, all in one place.</p></div>
            </div>
            <div className="services-grid">
              {billServices.map((service) => (
                <Link to={`/bills?service=${service.id}`} className="service-tile" key={service.id}>
                  <span className={`service-icon service-icon-${service.id}`}>{serviceIcon(service.icon)}</span>
                  <span>{service.label}</span>
                </Link>
              ))}
            </div>
            <Link to="/bills" className="services-footer-link">Browse all bill payments <ArrowRight size={15} /></Link>
          </section>

          <section className="security-card">
            <div className="security-card-icon"><ShieldCheck size={20} /></div>
            <span className="security-eyebrow">SAFETY FIRST</span>
            <h2>Your details stay yours.</h2>
            <p>This demo never asks for a banking PIN, password, OTP, or card security code.</p>
            <Link to="/help" className="security-link">Learn about safe use <ArrowRight size={15} /></Link>
          </section>

          <section className="card shortcuts-card" aria-labelledby="shortcuts-title">
            <div className="section-heading section-heading-tight"><h2 id="shortcuts-title">Your shortcuts</h2></div>
            <Link to="/profile" className="shortcut-row"><span className="shortcut-icon shortcut-purple"><WalletCards size={17} /></span><span><strong>Profile & settings</strong><small>Manage your demo profile</small></span><ArrowRight size={16} /></Link>
            <Link to="/notifications" className="shortcut-row"><span className="shortcut-icon shortcut-yellow"><Bell size={17} /></span><span><strong>Notifications</strong><small>See your latest updates</small></span><ArrowRight size={16} /></Link>
            <Link to="/help" className="shortcut-row"><span className="shortcut-icon shortcut-blue"><CircleHelp size={17} /></span><span><strong>Help & support</strong><small>FAQs and demo support</small></span><ArrowRight size={16} /></Link>
          </section>

          <div className="mini-demo-note"><span className="demo-pulse" /><span>Demo mode is on. No real payments are processed.</span></div>
        </aside>
      </div>

      <Modal open={topUpOpen} title="Add demo funds" subtitle="The OnePay server records this as a simulated wallet credit." onClose={() => { if (!topUpProcessing) setTopUpOpen(false); }} size="sm"
        footer={<><Button variant="secondary" onClick={() => setTopUpOpen(false)} disabled={topUpProcessing}>Cancel</Button><Button onClick={confirmTopUp} busy={topUpProcessing} icon={<Plus size={16} />}>{topUpProcessing ? 'Adding…' : 'Add demo funds'}</Button></>}>
        <div className="demo-warning"><span className="warning-badge">DEMO ONLY</span><p>No bank or payment provider is connected. These funds are fictional and stored only in your OnePay demo ledger.</p></div>
        <div className="topup-amount-options" role="group" aria-label="Choose demo funds amount">
          {[10_000, 50_000, 100_000, 250_000].map((amount) => <button type="button" key={amount} disabled={Boolean(topUpKey.current) && selectedTopUp !== amount} className={`amount-option ${selectedTopUp === amount ? 'selected' : ''}`} onClick={() => setSelectedTopUp(amount)}>{formatRupees(amount)}</button>)}
        </div>
      </Modal>
      <TransactionReceipt transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
    </>
  );
}
