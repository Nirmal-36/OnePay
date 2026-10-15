import { Link } from 'react-router-dom';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" role="presentation">
        <path d="M20 7.5c-4.8 0-8.5 3.1-8.5 7.3 0 2.2 1.3 4.1 3.5 5.2-2.2 1.1-3.5 3-3.5 5.2 0 4.2 3.7 7.3 8.5 7.3s8.5-3.1 8.5-7.3c0-2.2-1.3-4.1-3.5-5.2 2.2-1.1 3.5-3 3.5-5.2 0-4.2-3.7-7.3-8.5-7.3Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M14.6 14.2c3.4-.3 6.5 1.9 6.8 5.1.3 3.2-2.3 5.8-5.7 6.1M25.4 25.8c-3.4.3-6.5-1.9-6.8-5.1-.3-3.2 2.3-5.8 5.7-6.1" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <circle cx="20" cy="20" r="1.7" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="OnePay home">
      <BrandMark />
      <span className="brand-wordmark">One<span>Pay</span></span>
    </Link>
  );
}
