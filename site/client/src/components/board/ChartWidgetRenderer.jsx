import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/**
 * ChartWidgetRenderer — the single switch that dispatches a `ChartWidget` + its
 * aggregated `data` payload to the right recharts component (F13.5).
 *
 * **This is the shared rendering path F15 dashboards reuse** — both the per-board
 * Insights tab and the F15 executive/team dashboards render `ChartWidget` rows
 * through here, fed by the same `chartDataService.aggregate` output:
 *
 *   - bar / pie / funnel : `{ series: [{ key, label, color, value }], total }`
 *   - number             : `{ value, label }`
 *   - line               : `{ series: [{ key, label, value }] }`
 *   - stacked_bar        : `{ groups: [{ key, label, values }], stacks: [{ key, label, color }] }`
 *
 * Props: `widget` (for type/title fallback), `data` (aggregate output),
 *        `height` (default 240), `loading`, `error`.
 */

const ACCENT = '#3E6B4E';
const MUTED = 'var(--color-text-muted)';
const FONT = "'Familjen Grotesk', sans-serif";

const Centered = ({ children, height = 240 }) => (
  <div
    className="flex items-center justify-center font-body"
    style={{ height, fontSize: 13, color: MUTED }}
  >
    {children}
  </div>
);

const axisProps = {
  tick: { fontSize: 11, fill: 'var(--color-text-secondary)', fontFamily: FONT },
  stroke: 'var(--color-border)',
};

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    fontFamily: FONT,
    fontSize: 12,
    boxShadow: 'var(--shadow-md)',
  },
};

/** Number KPI — one big figure (count / sum / avg / min / max). */
const NumberCard = ({ data, height }) => {
  const value = data?.value ?? 0;
  const display = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col items-center justify-center" style={{ height }}>
      <span
        className="font-display"
        style={{ fontSize: 44, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1 }}
      >
        {display}
      </span>
      {data?.label && (
        <span className="font-body mt-1" style={{ fontSize: 13, color: MUTED }}>
          {data.label}
        </span>
      )}
    </div>
  );
};

/** Funnel — ordered stages as proportional horizontal bars (every stage shown). */
const FunnelChart = ({ data, height }) => {
  const series = data?.series || [];
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    <div className="flex flex-col justify-center gap-2" style={{ minHeight: height, padding: '4px 0' }}>
      {series.map((s) => (
        <div key={s.key} className="flex items-center gap-3">
          <span
            className="font-body truncate text-right"
            style={{ width: 92, fontSize: 12, color: 'var(--color-text-secondary)' }}
            title={s.label}
          >
            {s.label}
          </span>
          <div className="flex-1" style={{ background: 'var(--color-bg-subtle)', borderRadius: 6, height: 26, position: 'relative' }}>
            <div
              style={{
                width: `${Math.max(2, (s.value / max) * 100)}%`,
                background: s.color || ACCENT,
                height: '100%',
                borderRadius: 6,
                transition: 'width 200ms ease-out',
              }}
            />
            <span
              className="font-body font-semibold"
              style={{ position: 'absolute', right: 8, top: 0, lineHeight: '26px', fontSize: 12, color: 'var(--color-text-primary)' }}
            >
              {s.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

const BarChartView = ({ data, height }) => {
  const rows = (data?.series || []).map((s) => ({ name: s.label, value: s.value, color: s.color }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="name" {...axisProps} interval={0} angle={rows.length > 5 ? -20 : 0} textAnchor={rows.length > 5 ? 'end' : 'middle'} height={rows.length > 5 ? 50 : 30} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--color-bg-subtle)' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.color || ACCENT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const PieChartView = ({ data, height }) => {
  const rows = (data?.series || []).map((s) => ({ name: s.label, value: s.value, color: s.color }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="78%" innerRadius="48%" paddingAngle={2}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.color || ACCENT} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontFamily: FONT, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
};

const LineChartView = ({ data, height }) => {
  const rows = (data?.series || []).map((s) => ({ name: s.label, value: s.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Line type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
};

const StackedBarView = ({ data, height }) => {
  const stacks = data?.stacks || [];
  const rows = (data?.groups || []).map((g) => ({ name: g.label, ...g.values }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--color-bg-subtle)' }} />
        <Legend wrapperStyle={{ fontFamily: FONT, fontSize: 12 }} />
        {stacks.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color || ACCENT} radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};

const isEmptySeries = (data) => {
  if (!data) return true;
  if (data.type === 'number') return false;
  if (data.type === 'stacked_bar') return !(data.groups && data.groups.length);
  return !(data.series && data.series.length);
};

const ChartWidgetRenderer = ({ widget, data, height = 240, loading = false, error = '' }) => {
  const type = data?.type || widget?.type;

  if (loading) return <Centered height={height}>Loading…</Centered>;
  if (error) return <Centered height={height}>{error}</Centered>;
  if (isEmptySeries(data)) return <Centered height={height}>No data for this widget yet.</Centered>;

  switch (type) {
    case 'number':
      return <NumberCard data={data} height={height} />;
    case 'funnel':
      return <FunnelChart data={data} height={height} />;
    case 'bar':
      return <BarChartView data={data} height={height} />;
    case 'pie':
      return <PieChartView data={data} height={height} />;
    case 'line':
      return <LineChartView data={data} height={height} />;
    case 'stacked_bar':
      return <StackedBarView data={data} height={height} />;
    default:
      return <Centered height={height}>Unsupported chart type.</Centered>;
  }
};

export default ChartWidgetRenderer;
