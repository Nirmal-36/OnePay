import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Clock3, LoaderCircle, Search, SlidersHorizontal, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, apiErrorMessage } from '../api/auth';
import { paymentApi, type TransactionHistoryPage } from '../api/payments';
import { Button } from '../components/Controls';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { TransactionList } from '../components/TransactionList';
import { TransactionReceipt } from '../components/TransactionReceipt';
import { useDemo } from '../context/DemoProvider';
import { formatRupees, type DemoTransaction } from '../types';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
type HistoryFilters = {
  status: 'all' | DemoTransaction['status'];
  category: 'all' | DemoTransaction['category'];
  direction: 'all' | DemoTransaction['direction'];
  dateFrom: string;
  dateTo: string;
  minAmount: string;
  maxAmount: string;
};
const EMPTY_FILTERS: HistoryFilters = { status: 'all', category: 'all', direction: 'all', dateFrom: '', dateTo: '', minAmount: '', maxAmount: '' };

export default function TransactionsPage() {
  const { balancePaise } = useDemo();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [filters, setFilters] = useState<HistoryFilters>({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [history, setHistory] = useState<TransactionHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [selectedTransaction, setSelectedTransaction] = useState<DemoTransaction | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const minAmountMinor = filters.minAmount === '' ? undefined : Math.round(Number(filters.minAmount) * 100);
    const maxAmountMinor = filters.maxAmount === '' ? undefined : Math.round(Number(filters.maxAmount) * 100);
    void paymentApi.history({
      search: appliedSearch,
      status: filters.status as 'all' | DemoTransaction['status'],
      category: filters.category as 'all' | DemoTransaction['category'],
      direction: filters.direction as 'all' | DemoTransaction['direction'],
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      minAmountMinor,
      maxAmountMinor,
      page,
      pageSize,
    }).then((result) => {
      if (active) setHistory(result);
    }).catch((loadError) => {
      if (active) {
        setHistory(null);
        setError(loadError instanceof ApiError && loadError.status === 401
          ? 'Your session expired. Sign in again to view your transaction history.'
          : apiErrorMessage(loadError, 'Could not load your OnePay transaction history. Check your connection and retry.'));
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [appliedSearch, filters, page, pageSize, retryToken]);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const updateDirection = (value: typeof filters.direction) => {
    setFilters((current) => ({ ...current, direction: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setAppliedSearch('');
    setFilters({ ...EMPTY_FILTERS });
    setPage(1);
    setPageSize(10);
  };

  const activeFilters = Boolean(
    appliedSearch || filters.status !== 'all' || filters.category !== 'all' || filters.direction !== 'all'
    || filters.dateFrom || filters.dateTo || filters.minAmount || filters.maxAmount,
  );
  const resultCount = history?.count ?? 0;
  const startResult = resultCount ? (history!.page - 1) * history!.pageSize + 1 : 0;
  const endResult = history ? Math.min(history.page * history.pageSize, resultCount) : 0;
  const pageCount = history?.totalPages ?? 0;

  return (
    <>
      <PageHeader eyebrow="YOUR ACTIVITY" title="Transaction history" description="Search and filter your account-scoped OnePay simulated ledger." />

      <div className="transaction-summary-grid">
        <div className="card summary-tile"><span className="summary-tile-icon summary-tile-violet"><WalletCards size={18} /></span><span>Demo balance</span><strong>{formatRupees(balancePaise)}</strong><small>Fictional funds only</small></div>
        <div className="card summary-tile"><span className="summary-tile-icon summary-tile-green"><ArrowDownLeft size={18} /></span><span>Matching entries</span><strong>{history ? resultCount : '—'}</strong><small>Server-filtered results</small></div>
        <div className="card summary-tile"><span className="summary-tile-icon summary-tile-orange"><ArrowUpRight size={18} /></span><span>Current page</span><strong>{history && pageCount ? `${history.page} / ${pageCount}` : '—'}</strong><small>Newest activity first</small></div>
      </div>

      <section className="card transaction-history-card">
        <div className="history-toolbar">
          <div><h2>All transactions</h2><p>{loading ? 'Loading account activity…' : `${resultCount} ${resultCount === 1 ? 'entry' : 'entries'} match · most recent first`}</p></div>
          <div className="history-search-wrap"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search transactions" placeholder="Search name, service, or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        </div>

        <div className="transaction-filter-row" aria-label="Filter transaction direction">
          <span className="filter-label"><SlidersHorizontal size={15} />Direction</span>
          {([
            ['all', 'All activity'], ['debit', 'Sent'], ['credit', 'Received'],
          ] as const).map(([value, label]) => <button type="button" key={value} className={`filter-chip ${filters.direction === value ? 'selected' : ''}`} aria-pressed={filters.direction === value} onClick={() => updateDirection(value)}>{label}</button>)}
        </div>

        <div className="history-filter-grid" aria-label="Transaction filters">
          <label>Status<select aria-label="Filter by status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="all">All statuses</option><option value="successful">Successful</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="reversed">Reversed</option>
          </select></label>
          <label>Category<select aria-label="Filter by category" value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}>
            <option value="all">All categories</option><option value="transfer">Transfers</option><option value="recharge">Recharges</option><option value="bill">Bills</option><option value="topup">Demo top-ups</option>
          </select></label>
          <label>From date<input aria-label="From date" type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></label>
          <label>To date<input aria-label="To date" type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></label>
          <label>Minimum amount (₹)<input aria-label="Minimum amount" type="number" min="0" step="0.01" inputMode="decimal" value={filters.minAmount} onChange={(event) => updateFilter('minAmount', event.target.value)} placeholder="Any" /></label>
          <label>Maximum amount (₹)<input aria-label="Maximum amount" type="number" min="0" step="0.01" inputMode="decimal" value={filters.maxAmount} onChange={(event) => updateFilter('maxAmount', event.target.value)} placeholder="Any" /></label>
          <button type="button" className="history-clear-button" onClick={clearFilters} disabled={!activeFilters && !search && pageSize === 10}>Clear filters</button>
        </div>

        {loading ? <div className="history-state-card" role="status"><LoaderCircle className="spin" size={20} /><span>Loading your transaction history…</span></div>
          : error ? <div className="history-state-card history-state-error" role="alert"><Clock3 size={20} /><div><strong>History unavailable</strong><p>{error}</p><Button size="sm" variant="secondary" onClick={() => setRetryToken((value) => value + 1)}>Retry</Button></div></div>
            : resultCount > 0 && history ? <>
              <TransactionList transactions={history.results} onSelect={setSelectedTransaction} />
              <div className="history-pagination">
                <span>Showing {startResult}–{endResult} of {resultCount}</span>
                <div className="history-pagination-controls">
                  <label>Per page<select aria-label="Results per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
                  <Button size="sm" variant="secondary" disabled={!history.hasPrevious} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
                  <span>Page {history.page} of {Math.max(history.totalPages, 1)}</span>
                  <Button size="sm" variant="secondary" disabled={!history.hasNext} onClick={() => setPage((value) => value + 1)}>Next</Button>
                </div>
              </div>
            </> : <EmptyState title={activeFilters ? 'No matching activity' : 'No activity yet'} description={activeFilters ? 'Try adjusting your filters or clear them to see all simulated ledger entries.' : 'Demo activity will appear here when you record a simulated payment.'} icon={Clock3} action={<button type="button" className="text-link" onClick={clearFilters}>Clear filters <span aria-hidden="true">→</span></button>} />}
      </section>

      <div className="history-footnote"><span className="history-footnote-dot" />This is a OnePay simulated ledger, not a bank statement or proof of a real payment.<Link to="/help">Learn more</Link></div>
      <TransactionReceipt transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
    </>
  );
}
