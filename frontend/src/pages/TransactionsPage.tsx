import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Clock3, Search, SlidersHorizontal, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDemo } from '../context/DemoProvider';
import { formatRupees, type DemoTransaction } from '../types';
import { PageHeader } from '../components/PageHeader';
import { TransactionList } from '../components/TransactionList';
import { TransactionReceipt } from '../components/TransactionReceipt';
import { EmptyState } from '../components/EmptyState';

export default function TransactionsPage() {
  const { transactions, balancePaise } = useDemo();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'sent' | 'received' | 'pending'>('all');
  const [selectedTransaction, setSelectedTransaction] = useState<DemoTransaction | null>(null);

  const filteredTransactions = useMemo(() => transactions.filter((transaction) => {
    const text = `${transaction.title} ${transaction.subtitle} ${transaction.reference}`.toLowerCase();
    const matchesSearch = text.includes(search.trim().toLowerCase());
    const matchesFilter = filter === 'all'
      || (filter === 'sent' && transaction.direction === 'debit')
      || (filter === 'received' && transaction.direction === 'credit')
      || (filter === 'pending' && transaction.status === 'pending');
    return matchesSearch && matchesFilter;
  }), [transactions, search, filter]);

  const clearFilters = () => { setSearch(''); setFilter('all'); };

  return (
    <>
      <PageHeader eyebrow="YOUR ACTIVITY" title="Transaction history" description="A transparent record of this session’s simulated payments and bill activity." />

      <div className="transaction-summary-grid">
        <div className="card summary-tile"><span className="summary-tile-icon summary-tile-violet"><WalletCards size={18} /></span><span>Demo balance</span><strong>{formatRupees(balancePaise)}</strong><small>Fictional funds only</small></div>
        <div className="card summary-tile"><span className="summary-tile-icon summary-tile-green"><ArrowDownLeft size={18} /></span><span>Demo received</span><strong>{formatRupees(transactions.filter((tx) => tx.direction === 'credit').reduce((sum, tx) => sum + tx.amountPaise, 0))}</strong><small>Across this demo session</small></div>
        <div className="card summary-tile"><span className="summary-tile-icon summary-tile-orange"><ArrowUpRight size={18} /></span><span>Demo activity</span><strong>{transactions.length}</strong><small>Simulated entries</small></div>
      </div>

      <section className="card transaction-history-card">
        <div className="history-toolbar">
          <div><h2>All transactions</h2><p>{filteredTransactions.length} {filteredTransactions.length === 1 ? 'entry' : 'entries'} · most recent first</p></div>
          <div className="history-search-wrap"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search transactions" placeholder="Search by name or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        </div>
        <div className="transaction-filter-row" aria-label="Filter transactions">
          <span className="filter-label"><SlidersHorizontal size={15} />Filter</span>
          {([
            ['all', 'All activity'], ['sent', 'Sent'], ['received', 'Received'], ['pending', 'Pending'],
          ] as const).map(([value, label]) => <button type="button" key={value} className={`filter-chip ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        {filteredTransactions.length > 0 ? <TransactionList transactions={filteredTransactions} onSelect={setSelectedTransaction} /> : <EmptyState title="No matching activity" description={transactions.length ? 'Try another search or clear your filters.' : 'Demo activity will appear here when you try a payment.'} icon={Clock3} action={<button type="button" className="text-link" onClick={clearFilters}>Clear filters <span aria-hidden="true">→</span></button>} />}
      </section>

      <div className="history-footnote"><span className="history-footnote-dot" />This history is local demo data. It is not a bank statement or proof of payment.<Link to="/help">Learn more</Link></div>
      <TransactionReceipt transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
    </>
  );
}
