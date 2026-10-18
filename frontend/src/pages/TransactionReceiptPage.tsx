import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Printer, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { paymentApi, type ApiReceipt } from '../api/payments';
import { apiErrorMessage } from '../api/auth';
import { formatDateTime, formatRupees } from '../types';
import { Button } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

function statusLabel(status: ApiReceipt['transaction']['status']) {
  return status === 'successful' ? 'Successful' : status === 'pending' ? 'Pending' : status === 'failed' ? 'Failed' : 'Reversed';
}

export default function TransactionReceiptPage() {
  const { reference = '' } = useParams();
  const [receipt, setReceipt] = useState<ApiReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReceipt = useCallback(async () => {
    if (!reference) return;
    setLoading(true);
    try {
      setReceipt(await paymentApi.receipt(reference));
      setError('');
    } catch (loadError) {
      setReceipt(null);
      setError(apiErrorMessage(loadError, 'Could not load this OnePay receipt.'));
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => { void loadReceipt(); }, [loadReceipt]);

  const transaction = receipt?.transaction;
  const isCredit = transaction?.kind === 'topup' || transaction?.status === 'reversed';

  return (
    <>
      <PageHeader eyebrow="ONEPAY RECEIPT" title="Transaction receipt" description="A printable record of your simulated ledger activity." action={<Link className="text-link" to={reference ? `/transactions/${encodeURIComponent(reference)}` : '/transactions'}><ArrowLeft size={15} />Transaction details</Link>} />
      {loading ? <section className="card transaction-detail-loading" role="status"><Clock3 size={20} />Loading receipt…</section>
        : error || !receipt || !transaction ? <section className="card transaction-detail-error" role="alert"><CircleAlert size={20} /><div><strong>Receipt unavailable</strong><p>{error || 'This receipt could not be found.'}</p><Button size="sm" variant="secondary" onClick={() => void loadReceipt()}>Retry</Button></div></section>
          : <article className="card transaction-receipt-page">
            <div className={`receipt-page-status status-${transaction.status}`}><span>{transaction.status === 'successful' ? <Check size={21} /> : transaction.status === 'pending' ? <Clock3 size={21} /> : <CircleAlert size={21} />}</span><strong>{statusLabel(transaction.status)}</strong></div>
            <p className="receipt-page-notice">{receipt.notice}</p>
            <div className="receipt-page-amount">{transaction.status === 'failed' ? 'Not debited' : `${isCredit ? '+' : '−'}${formatRupees(transaction.amount_minor)}`}<small>{transaction.currency} · simulated amount</small></div>
            <dl className="receipt-page-details">
              <div><dt>Sender</dt><dd>{transaction.sender_name}</dd></div>
              <div><dt>{transaction.kind === 'topup' ? 'Wallet' : transaction.kind === 'bill' || transaction.kind === 'recharge' ? 'Mock provider / biller' : 'Recipient'}</dt><dd>{transaction.recipient_name}</dd></div>
              {transaction.recipient_identifier && <div><dt>Mock identifier</dt><dd>{transaction.recipient_identifier}</dd></div>}
              <div><dt>Type</dt><dd>{transaction.kind === 'transfer' ? 'Person-to-person demo' : transaction.kind === 'topup' ? 'Demo wallet top-up' : transaction.kind === 'recharge' ? `Demo ${transaction.service} recharge` : `Demo ${transaction.service} bill`}</dd></div>
              {transaction.note && <div><dt>Note</dt><dd>{transaction.note}</dd></div>}
              <div><dt>Status</dt><dd>{statusLabel(transaction.status)}</dd></div>
              <div><dt>Reference</dt><dd className="transaction-reference-value">{transaction.reference}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(transaction.created_at)}</dd></div>
              {transaction.completed_at && <div><dt>Completed</dt><dd>{formatDateTime(transaction.completed_at)}</dd></div>}
            </dl>
            <div className="receipt-page-safety"><ShieldCheck size={18} /><span>{receipt.notice} This receipt is not proof of a bank transfer or utility-provider payment.</span></div>
            <div className="receipt-page-actions"><Button variant="secondary" onClick={() => window.print()} icon={<Printer size={16} />}>Print receipt</Button><Link className="button button-primary button-md" to={`/transactions/${encodeURIComponent(transaction.reference)}`}><ArrowRight size={16} />View transaction</Link></div>
          </article>}
    </>
  );
}
