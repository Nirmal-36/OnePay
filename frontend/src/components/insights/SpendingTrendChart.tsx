import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlyTrendPoint } from '../../api/analytics';
import { compactMoney, money } from './shared';

interface ActualPoint {
  date: string;
  amount_minor: number;
}

interface ProjectedPoint {
  date: string;
  projected_minor: number;
}

interface SpendingTrendChartProps {
  actual?: ActualPoint[];
  monthly?: MonthlyTrendPoint[];
  forecast?: ProjectedPoint[];
  mode?: 'daily' | 'monthly';
  label: string;
  description?: string;
  height?: number;
}

interface ChartRow {
  key: string;
  label: string;
  fullLabel: string;
  actual: number | null;
  forecast: number | null;
}

const formatDay = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date);
};

export function SpendingTrendChart({
  actual = [],
  monthly = [],
  forecast = [],
  mode = 'daily',
  label,
  description,
  height = 245,
}: SpendingTrendChartProps) {
  const rows = useMemo<ChartRow[]>(() => {
    if (mode === 'monthly') {
      return monthly.map((item) => ({
        key: item.month,
        label: item.label.split(' ')[0],
        fullLabel: item.label,
        actual: item.amount_minor,
        forecast: null,
      }));
    }
    const merged = new Map<string, ChartRow>();
    for (const item of actual) {
      merged.set(item.date, {
        key: item.date,
        label: formatDay(item.date),
        fullLabel: item.date,
        actual: item.amount_minor,
        forecast: null,
      });
    }
    for (const item of forecast) {
      const existing = merged.get(item.date);
      merged.set(item.date, {
        key: item.date,
        label: formatDay(item.date),
        fullLabel: item.date,
        actual: existing?.actual ?? null,
        forecast: item.projected_minor,
      });
    }
    return [...merged.values()].sort((left, right) => left.key.localeCompare(right.key));
  }, [actual, forecast, mode]);

  if (!rows.length) {
    return <div className="si-chart-empty">No trend data is available for this period.</div>;
  }

  const hasForecast = rows.some((row) => row.forecast !== null);
  const totalActual = rows.reduce((total, row) => total + (row.actual ?? 0), 0);
  const totalForecast = rows.reduce((total, row) => total + (row.forecast ?? 0), 0);
  const tickInterval = mode === 'daily' ? Math.max(0, Math.ceil(rows.length / 7) - 1) : 0;

  return (
    <div className="si-chart-block">
      <div
        className="si-recharts-wrap"
        role="img"
        aria-label={`${label}. ${actual.length ? `${actual.length} actual points.` : ''}${totalActual ? ` Actual total ${money(totalActual)}.` : ''}${hasForecast ? ` Forecast total ${money(totalForecast)}.` : ''}`}
      >
        <div className="si-recharts" style={{ height }} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="si-area-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7654dc" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="#7654dc" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f0edf5" strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9691a3' }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9691a3' }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(value: number) => compactMoney(value)}
              />
              <Tooltip
                cursor={{ stroke: '#d9d0f4', strokeWidth: 1 }}
                content={({ active, payload, label: chartLabel }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as ChartRow | undefined;
                  if (!row) return null;
                  return (
                    <div className="si-chart-tooltip">
                      <span>{row.fullLabel || String(chartLabel)}</span>
                      {row.actual !== null && <strong>{money(row.actual)} <em>actual</em></strong>}
                      {row.forecast !== null && <strong className="forecast">{money(row.forecast)} <em>forecast</em></strong>}
                    </div>
                  );
                }}
              />
              {mode === 'monthly' ? (
                <Bar
                  dataKey="actual"
                  name="Actual"
                  fill="#7654dc"
                  radius={[6, 6, 2, 2]}
                  maxBarSize={34}
                  isAnimationActive={false}
                />
              ) : (
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="#7654dc"
                  strokeWidth={2.2}
                  fill="url(#si-area-gradient)"
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{ r: 4, fill: '#7654dc', stroke: '#fff', strokeWidth: 2 }}
                />
              )}
              {hasForecast && (
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast"
                  stroke="#2f9079"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{ r: 4, fill: '#2f9079', stroke: '#fff', strokeWidth: 2 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="si-chart-legend" aria-hidden="true">
        <span><i className="actual" /> Actual completed spending</span>
        {hasForecast && <span><i className="forecast" /> Forecast (not guaranteed)</span>}
        {monthly.length > 0 && mode === 'monthly' && <span className="si-chart-legend-note">Calendar months in the selected period</span>}
      </div>
      {description && <p className="si-chart-description">{description}</p>}
      <table className="si-sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">Actual</th><th scope="col">Forecast</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.fullLabel}</th>
              <td>{row.actual === null ? 'No actual value' : money(row.actual)}</td>
              <td>{row.forecast === null ? 'No forecast value' : money(row.forecast)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
