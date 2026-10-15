import { ArrowDownLeft, ArrowUpRight, Bolt, CircleDashed, ReceiptText, Smartphone, WalletCards } from 'lucide-react';
import type { DemoTransaction } from '../types';
import { formatRelativeDate, formatRupees } from '../types';

function TransactionIcon({ transaction }: { transaction: DemoTransaction }) {
  const Icon = transaction.category === 'recharge' ? Smartphone
    : transaction.category === 'bill' ? Bolt
      : transaction.category === 'topup' ? WalletCards
        : transaction.direction === 'credit' ? ArrowDownLeft : ArrowUpRight;
  return <span className={`transaction-icon transaction-icon-${transaction.category}`}><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>;
}

export function TransactionList({ transactions, onSelect, compact = false }: {
  transactions: DemoTransaction[];
  onSelect: (transaction: DemoTransaction) => void;
  compact?: boolean;
}) {
  if (transactions.length === 0) {
    return (
      <div className="transaction-empty-inline">
        <CircleDashed size={20} aria-hidden="true" />
        <span>No demo activity yet. Payments you simulate will appear here.</span>
      </div>
    );
  }

  return (
    <div className={`transaction-list ${compact ? 'transaction-list-compact' : ''}`}>
      {transactions.map((transaction) => (
        <button type="button" key={transaction.id} className="transaction-row" onClick={() => onSelect(transaction)}
          aria-label={`View receipt: ${transaction.title}, ${formatRupees(transaction.amountPaise)}, ${transaction.direction}`}>
          <TransactionIcon transaction={transaction} />
          <span className="transaction-copy">
            <strong>{transaction.title}</strong>
            <span>{transaction.subtitle}</span>
          </span>
          <span className="transaction-meta">
            <strong className={transaction.direction === 'credit' ? 'amount-credit' : ''}>
              {transaction.direction === 'credit' ? '+' : '−'}{formatRupees(transaction.amountPaise)}
            </strong>
            <span>{transaction.status === 'pending' ? 'Demo · pending' : transaction.status === 'failed' ? 'Demo · not completed' : formatRelativeDate(transaction.createdAt)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function TransactionCategoryIcon({ category }: { category: DemoTransaction['category'] }) {
  const Icon = category === 'recharge' ? Smartphone : category === 'bill' ? ReceiptText : category === 'topup' ? WalletCards : ArrowUpRight;
  return <Icon size={17} aria-hidden="true" />;
}
