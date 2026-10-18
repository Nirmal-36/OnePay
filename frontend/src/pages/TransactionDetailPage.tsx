import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { paymentApi, type ApiTransaction } from '../api/payments';
import { apiErrorMessage } from '../api/auth';
import { formatDateTime, formatRupees } from '../types';
import { Button } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

function statusLabel(status: ApiTransaction['status']) {
  return status === 'successful' ? 'Successful' : status === 'pending' ? 'Pending' : status === 'failed' ? 'Failed' : 'Reversed';
}

export default function TransactionDetailPage() {
  const { reference = '' } = useParams();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState<ApiTransaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTransaction = useCallback(async () => {
    if (!reference) return;
    setLoading(true);
    try {
      const result = await paymentApi.transaction(reference);
      setTransaction(result);
      setError('');
    } catch (loadError) {
      setTransaction(null);
      setError(apiErrorMessage(loadError, 'Could not load this OnePay transaction.'));
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => { void loadTransaction(); }, [loadTransaction]);

  const amountIsCredit = transaction?.kind === 'topup' || transaction?.status === 'reversed';

  return (
    <>
      <PageHeader eyebrow="ONEPAY LEDGER" title="Transaction details" description="A backend-recorded entry from your simulated OnePay wallet." action={<Link className="text-link" to="/transactions"><ArrowLeft size={15} />Back to history</Link>} />
      {loading ? <section className="card transaction-detail-loading" role="status"><Clock3 size={20} />Loading transaction details…</section>
        : error || !transaction ? <section className="card transaction-detail-error" role="alert"><CircleAlert size={20} /><div><strong>Transaction unavailable</strong><p>{error || 'This transaction could not be found.'}</p><Button size="sm" variant="secondary" onClick={() => void loadTransaction()}>Retry</Button></div></section>
          : <div className="transaction-detail-grid">
            <section className="card transaction-detail-main">
              <div className={`transaction-detail-status status-${transaction.status}`}><span>{transaction.status === 'successful' ? <Check size={20} /> : transaction.status === 'pending' ? <Clock3 size={20} /> : <CircleAlert size={20} />}</span><div><strong>{statusLabel(transaction.status)}</strong><small>{transaction.status === 'successful' ? 'Completed by the local OnePay simulator' : transaction.status === 'pending' ? 'Waiting for the local simulator to confirm' : transaction.status === 'failed' ? 'The demo debit was refunded' : 'The demo debit was credited back'}</small></div></div>
              <div className="transaction-detail-amount"><span>{transaction.status === 'failed' ? 'Not debited' : `${amountIsCredit ? '+' : '−'}${formatRupees(transaction.amount_minor)}`}</span><small>Simulated amount · {transaction.currency}</small></div>
              <dl className="transaction-detail-list">
                <div><dt>{transaction.kind === 'topup' ? 'Wallet' : transaction.kind === 'bill' || transaction.kind === 'recharge' ? 'Mock provider / biller' : 'Recipient'}</dt><dd>{transaction.recipient_name}</dd></div>
                {transaction.recipient_identifier && <div><dt>Mock identifier</dt><dd>{transaction.recipient_identifier}</dd></div>}
                <div><dt>Activity type</dt><dd>{transaction.kind === 'transfer' ? 'Person-to-person demo' : transaction.kind === 'topup' ? 'Demo wallet top-up' : transaction.kind === 'recharge' ? `Demo ${transaction.service} recharge` : `Demo ${transaction.service} bill`}</dd></div>
                {transaction.note && <div><dt>Note</dt><dd>{transaction.note}</dd></div>}
                <div><dt>OnePay reference</dt><dd className="transaction-reference-value">{transaction.reference}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(transaction.created_at)}</dd></div>
                {transaction.completed_at && <div><dt>Last completed</dt><dd>{formatDateTime(transaction.completed_at)}</dd></div>}
              </dl>
              <div className="transaction-detail-actions">
                <Button variant="secondary" onClick={() => navigate(`/transactions/${encodeURIComponent(transaction.reference)}/receipt`)} icon={<ArrowRight size={16} />}>View receipt</Button>
              </div>
            </section>

            <aside className="card transaction-timeline-card">
              <div className="section-heading"><div><h2>Status history</h2><p>Auditable state changes</p></div><Clock3 size={18} /></div>
              <ol className="transaction-timeline">
                {transaction.status_history.map((event, index) => <li key={`${event.to_status}-${event.created_at}-${index}`} className={`timeline-event status-${event.to_status}`}>
                  <span className="timeline-dot">{event.to_status === 'successful' || event.to_status === 'reversed' ? <Check size={12} /> : event.to_status === 'failed' ? <CircleAlert size={12} /> : null}</span>
                  <div><strong>{statusLabel(event.to_status)}</strong><small>{formatDateTime(event.created_at)}</small>{event.reason && <p>{event.reason}</p>}</div>
                </li>)}
              </ol>
              <div className="transaction-safety-note"><ShieldCheck size={17} /><span>This transaction and its history are visible only to your authenticated account.</span></div>
            </aside>
          </div>}
    </>
  );
}
