import { useEffect, useMemo, useState } from 'react';
import { BarChart3, FileText, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { analyticsApi, type SpendingPeriod } from '../api/analytics';
import { PageHeader } from '../components/PageHeader';
import { PeriodFilter } from '../components/insights/PeriodFilter';
import { firstDayOfMonthISO, todayISO } from '../components/insights/shared';
import { OverviewTab } from './insights/OverviewTab';
import { PatternsTab } from './insights/PatternsTab';
import { ReportsTab } from './insights/ReportsTab';
import { BudgetsTab } from './insights/BudgetsTab';
import './SpendingInsightsPage.css';
import './insights/insights.css';

type InsightsTab = 'overview' | 'patterns' | 'reports' | 'budgets';

const DEFAULT_CATEGORIES = [
  'Food and Dining', 'Groceries', 'Transport and Fuel', 'Shopping', 'Bills and Utilities',
  'Mobile Recharge', 'Entertainment', 'Healthcare', 'Education', 'Travel', 'Personal Care',
  'Housing', 'Subscriptions', 'Financial Services', 'Transfers', 'Income', 'Refunds', 'Other',
].map((name) => ({ name }));

const TABS: { key: InsightsTab; label: string; icon: typeof BarChart3; description: string }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3, description: 'Totals, categories, trends and transactions' },
  { key: 'patterns', label: 'Patterns', icon: Sparkles, description: 'Behaviour insights, forecasts and anomalies' },
  { key: 'reports', label: 'Monthly report', icon: FileText, description: 'A plain-language report with CSV export' },
  { key: 'budgets', label: 'Budgets & goals', icon: Target, description: 'Optional limits, warnings and savings goals' },
];

const daysBetween = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
};

export default function SpendingInsightsPage() {
  const [tab, setTab] = useState<InsightsTab>('overview');
  const [period, setPeriod] = useState<SpendingPeriod>('this_month');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthISO);
  const [dateTo, setDateTo] = useState(todayISO);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryOptions, setCategoryOptions] = useState(DEFAULT_CATEGORIES);
  const maxDate = todayISO();

  useEffect(() => {
    let active = true;
    void analyticsApi.meta()
      .then((meta) => { if (active && meta.categories.length) setCategoryOptions(meta.categories); })
      .catch(() => { if (active) setCategoryOptions(DEFAULT_CATEGORIES); });
    return () => { active = false; };
  }, []);

  const rangeValidation = useMemo(() => {
    if (period !== 'custom') return { valid: true, note: '' };
    if (!dateFrom || !dateTo) return { valid: false, note: 'Choose both a start and an end date.' };
    if (dateFrom > dateTo) return { valid: false, note: 'The start date must be on or before the end date.' };
    if (dateTo > maxDate) return { valid: false, note: 'The end date cannot be later than today in Asia/Kolkata.' };
    const days = daysBetween(dateFrom, dateTo);
    if (days > 366) return { valid: false, note: 'Custom ranges can cover at most 366 days. Choose a shorter range.' };
    return { valid: true, note: `${days} calendar day${days === 1 ? '' : 's'} selected. Boundaries use Asia/Kolkata midnight.` };
  }, [period, dateFrom, dateTo, maxDate]);

  const changeCategory = (category: string) => {
    setSelectedCategory(category);
    setTab('overview');
    window.setTimeout(() => {
      const node = document.getElementById('spending-transactions');
      if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  return (
    <div className="spending-insights-page si-page">
      <PageHeader
        eyebrow="YOUR MONEY PATTERNS"
        title="Spending insights"
        description="Turn recorded OnePay payments into transparent spending analysis, behavioural observations, monthly reports, and optional budgets. Everything is calculated from your own eligible transactions."
        action={<span className="si-demo-tag"><Sparkles size={14} /> Local, explainable analysis</span>}
      />

      <div className="si-privacy-strip" role="note">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          <strong>Privacy first.</strong> Categorization runs locally and analytics never send notes or payment details to an external AI service without your explicit consent. Demo records are clearly separated from verified data.
        </span>
      </div>

      <nav className="si-tabs" aria-label="Spending analysis sections">
        <div role="tablist" aria-label="Analysis views">
          {TABS.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`si-tab-${item.key}`}
                aria-selected={selected}
                aria-controls={`si-panel-${item.key}`}
                tabIndex={selected ? 0 : -1}
                className={`si-tab ${selected ? 'active' : ''}`}
                onClick={() => setTab(item.key)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const index = TABS.findIndex((candidate) => candidate.key === tab);
                    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
                    setTab(TABS[nextIndex].key);
                    document.getElementById(`si-tab-${TABS[nextIndex].key}`)?.focus();
                  }
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            );
          })}
        </div>
      </nav>

      {(tab === 'overview' || tab === 'patterns') && (
        <PeriodFilter
          period={period}
          onPeriodChange={(next) => {
            setPeriod(next);
            setSelectedCategory('');
            if (next === 'custom' && !dateFrom) setDateFrom(firstDayOfMonthISO());
          }}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          maxDate={maxDate}
          rangeNote={rangeValidation.note}
          invalidRange={!rangeValidation.valid}
        />
      )}

      <div
        id={`si-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`si-tab-${tab}`}
        className="si-tab-panel"
        tabIndex={0}
      >
        {tab === 'overview' && (
          <OverviewTab
            period={period}
            dateFrom={dateFrom}
            dateTo={dateTo}
            selectedCategory={selectedCategory}
            onSelectedCategoryChange={setSelectedCategory}
            onOpenPatterns={() => setTab('patterns')}
            onOpenBudgets={() => setTab('budgets')}
            categoryOptions={categoryOptions}
            validRange={rangeValidation.valid}
          />
        )}
        {tab === 'patterns' && (
          <PatternsTab
            period={period}
            dateFrom={dateFrom}
            dateTo={dateTo}
            validRange={rangeValidation.valid}
            onViewCategory={changeCategory}
          />
        )}
        {tab === 'reports' && <ReportsTab onViewCategory={changeCategory} />}
        {tab === 'budgets' && <BudgetsTab onViewCategory={changeCategory} />}
      </div>
    </div>
  );
}
