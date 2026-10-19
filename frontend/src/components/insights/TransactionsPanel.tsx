import { ArrowRight, LoaderCircle, Pencil, RotateCcw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SpendingTransactionsPage, SpendingTransaction, TransactionSort } from '../../api/analytics';
import { EmptyState } from '../EmptyState';
import { formatDateTime } from '../../types';
import { categoryColor, money } from './shared';

const METHOD_LABEL: Record<string, string> = {
  manual_override: 'Your correction',
  merchant_rule: 'Merchant rule',
  metadata_rule: 'Payment metadata',
  configured_classifier: 'Configured classifier',
  llm_fallback: 'AI fallback (consented)',
  fallback: 'Fallback',
};

interface TransactionsPanelProps {
  data: SpendingTransactionsPage | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  sort: TransactionSort;
  onSortChange: (value: TransactionSort) => void;
  onPageChange: (page: number) => void;
  onEditCategory: (transaction: SpendingTransaction) => void;
  categoryOptions: { name: string }[];
  heading?: string;
}

export function TransactionsPanel({
  data,
  loading,
  error,
  onRetry,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  sort,
  onSortChange,
  onPageChange,
  onEditCategory,
  categoryOptions,
  heading = 'Transactions behind these numbers',
}: TransactionsPanelProps) {
  const hasFilters = Boolean(search || category || sort !== 'newest');

  return (
    <section className="card si-panel si-transactions-panel" id="spending-transactions" aria-labelledby="si-transactions-heading">
      <div className="si-panel-heading">
        <div>
          <h2 id="si-transactions-heading">{heading}</h2>
          <p>Search, filter, and open any payment to correct its category. Amounts are simulated INR.</p>
        </div>
        <span className="si-count-pill">{data?.count ?? 0} payments</span>
      </div>

      <div className="si-table-controls">
        <label className="si-search-field">
          <span className="si-sr-only">Search transactions</span>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search merchant, note, or reference"
            maxLength={100}
          />
        </label>
        <label className="si-compact-field">
          <span>Category</span>
          <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}
          </select>
        </label>
        <label className="si-compact-field">
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as TransactionSort)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount_desc">Amount: high to low</option>
            <option value="amount_asc">Amount: low to high</option>
          </select>
        </label>
        {hasFilters && (
          <button
            type="button"
            className="button button-secondary button-sm si-clear-filters"
            onClick={() => {
              onSearchChange('');
              onCategoryChange('');
              onSortChange('newest');
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {category && (
        <p className="si-active-filter" role="status">
          Filtered to <strong>{category}</strong> · {data ? money(data.filtered_total_minor) : '—'} across {data?.count ?? 0} payments.
        </p>
      )}

      {loading && !data && <div className="si-inline-state" role="status"><LoaderCircle className="spin" size={18} /> Loading transactions…</div>}
      {error && <div className="si-inline-error" role="alert"><span>{error}</span><button type="button" className="button button-secondary button-sm" onClick={onRetry}>Retry</button></div>}
      {data && !error && data.results.length === 0 && (
        <EmptyState
          title="No payments match these filters"
          description={hasFilters ? 'Try a different search, category, or sort order. Only completed eligible payments appear here.' : 'Complete a simulated payment and it will appear in this analysis.'}
        />
      )}
      {data && !error && data.results.length > 0 && (
        <div className="si-table-scroll">
          <table className="si-data-table">
            <caption className="si-sr-only">Completed eligible payments for the selected analysis period</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Merchant</th>
                <th scope="col">Category</th>
                <th scope="col" className="si-amount-column">Amount</th>
                <th scope="col"><span className="si-sr-only">Category correction</span></th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((transaction) => (
                <tr key={transaction.reference}>
                  <td className="si-date-cell">{formatDateTime(transaction.created_at)}</td>
                  <td>
                    <div className="si-merchant-cell">
                      <strong>{transaction.merchant || transaction.recipient_name}</strong>
                      <span>{transaction.reference} · {transaction.kind}</span>
                    </div>
                  </td>
                  <td>
                    <div className="si-category-cell">
                      <span className="si-inline-dot" style={{ background: categoryColor(transaction.category) }} aria-hidden="true" />
                      <div>
                        <strong>{transaction.category}</strong>
                        <small>{transaction.subcategory} · {METHOD_LABEL[transaction.classification_method] ?? transaction.classification_method} · {Math.round(transaction.confidence * 100)}% rule confidence</small>
                      </div>
                    </div>
                  </td>
                  <td className="si-amount-column"><strong>−{money(transaction.amount_minor)}</strong><small>completed</small></td>
                  <td className="si-row-actions">
                    <button
                      type="button"
                      className="button button-secondary button-sm"
                      onClick={() => onEditCategory(transaction)}
                      aria-label={`Correct category for ${transaction.merchant || transaction.recipient_name}`}
                    >
                      <Pencil size={12} /> Fix
                    </button>
                    <Link className="si-row-link" to={`/transactions/${transaction.reference}`} aria-label={`Open ${transaction.reference}`}>
                      <ArrowRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total_pages > 1 && (
        <div className="si-pagination">
          <span>Page {data.page} of {data.total_pages} · {data.count} matching payments</span>
          <div>
            <button type="button" className="button button-secondary button-sm" disabled={!data.has_previous || loading} onClick={() => onPageChange(Math.max(1, data.page - 1))}>Previous</button>
            <button type="button" className="button button-secondary button-sm" disabled={!data.has_next || loading} onClick={() => onPageChange(data.page + 1)}>Next <ArrowRight size={13} /></button>
          </div>
        </div>
      )}
      <p className="si-table-note">Only successful, non-internal outgoing payments are analysed. Pending, failed, reversed, and demo top-ups never appear here.</p>
    </section>
  );
}
