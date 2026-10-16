import { ArrowRight, Check, Copy, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime, formatRupees, type DemoTransaction } from '../types';
import { Modal } from './Modal';
import { useToast } from '../context/ToastProvider';

export function TransactionReceipt({ transaction, onClose }: { transaction: DemoTransaction | null; onClose: () => void }) {
  const { showToast } = useToast();
  if (!transaction) return null;

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(transaction.reference);
      showToast('Demo reference copied.', 'success');
    } catch {
      showToast(`Demo reference: ${transaction.reference}`, 'info');
    }
  };

  return (
    <Modal open={Boolean(transaction)} title="Demo receipt" subtitle="A record from this local simulation only." onClose={onClose} size="sm">
      <div className="receipt-status">
        <span className="receipt-check"><Check size={22} strokeWidth={2.4} /></span>
        <strong>{transaction.status === 'pending' ? 'Demo activity pending' : transaction.status === 'failed' ? 'Demo activity failed' : transaction.status === 'reversed' ? 'Demo activity reversed' : 'Simulation complete'}</strong>
        <span>No real payment was made.</span>
      </div>
      <div className="receipt-amount">{transaction.status === 'failed' ? 'Not debited' : `${transaction.direction === 'credit' ? '+' : '−'}${formatRupees(transaction.amountPaise)}`}</div>
      <dl className="receipt-details">
        <div><dt>To / from</dt><dd>{transaction.title}</dd></div>
        <div><dt>Details</dt><dd>{transaction.subtitle}</dd></div>
        <div><dt>Demo reference</dt><dd>{transaction.reference}</dd></div>
        <div><dt>Date & time</dt><dd>{formatDateTime(transaction.createdAt)}</dd></div>
      </dl>
      <div className="receipt-safe-note"><ShieldCheck size={17} /><span>Only simulated data is shown. No bank credentials are used.</span></div>
      <button type="button" className="button button-secondary button-full" onClick={copyReference}><Copy size={16} />Copy demo reference</button>
      <div className="receipt-modal-links"><Link to={`/transactions/${encodeURIComponent(transaction.reference)}`}>Transaction details <ArrowRight size={14} /></Link><Link to={`/transactions/${encodeURIComponent(transaction.reference)}/receipt`}>Open receipt page <ArrowRight size={14} /></Link></div>
    </Modal>
  );
}
