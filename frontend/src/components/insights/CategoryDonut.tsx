import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { SpendingCategory } from '../../api/analytics';
import { categoryColor, money } from './shared';

interface CategoryDonutProps {
  categories: SpendingCategory[];
  total: number;
  selectedCategory: string;
  onSelect: (category: string) => void;
  label?: string;
}

export function CategoryDonut({ categories, total, selectedCategory, onSelect, label = 'Spending by category' }: CategoryDonutProps) {
  if (!categories.length) return null;
  const textSummary = categories
    .map((item) => `${item.category}: ${money(item.amount_minor)} (${item.percentage.toFixed(1)}%)`)
    .join('. ');

  return (
    <div className="si-donut-layout">
      <div
        className="si-donut-chart"
        role="img"
        aria-label={`${label}. Total ${money(total)}. ${textSummary}`}
      >
        <ResponsiveContainer width="100%" height={248}>
          <PieChart>
            <Pie
              data={categories}
              dataKey="amount_minor"
              nameKey="category"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={1.5}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(_, index) => {
                const item = categories[index];
                if (item) onSelect(item.category);
              }}
            >
              {categories.map((item) => (
                <Cell
                  key={item.category}
                  fill={categoryColor(item.category)}
                  opacity={selectedCategory && selectedCategory !== item.category ? 0.38 : 1}
                  cursor="pointer"
                />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload as SpendingCategory;
                return (
                  <div className="si-chart-tooltip">
                    <span>{item.category}</span>
                    <strong>{money(item.amount_minor)}</strong>
                    <small>{item.percentage.toFixed(1)}% · {item.transaction_count} payment{item.transaction_count === 1 ? '' : 's'}</small>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="si-donut-center" aria-hidden="true">
          <span>Completed outflow</span>
          <strong>{money(total)}</strong>
          <small>{categories.length} categor{categories.length === 1 ? 'y' : 'ies'}</small>
        </div>
      </div>
      <div className="si-category-legend" aria-label="Category breakdown">
        {categories.map((item) => {
          const active = selectedCategory === item.category;
          return (
            <button
              key={item.category}
              type="button"
              className={`si-category-row ${active ? 'selected' : ''}`}
              onClick={() => onSelect(active ? '' : item.category)}
              aria-pressed={active}
            >
              <span className="si-category-dot" style={{ background: categoryColor(item.category) }} aria-hidden="true" />
              <span className="si-category-copy">
                <strong>{item.category}</strong>
                <small>{item.transaction_count} payment{item.transaction_count === 1 ? '' : 's'}</small>
              </span>
              <span className="si-category-value">
                <strong>{money(item.amount_minor)}</strong>
                <small>{item.percentage.toFixed(1)}%</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
