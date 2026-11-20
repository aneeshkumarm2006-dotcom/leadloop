import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
import Dropdown from '../components/ui/Dropdown';
import useOrgStore from '../store/orgStore';
import { getBoards } from '../services/boardService';
import { getProduction } from '../services/marketingService';

/**
 * ProductionReportPage — the brokerage "how did we actually do" report.
 *
 * Three things the pipeline views can't answer:
 *   1. GCI / volume — what the closed business is worth (deal value × rate).
 *   2. Source ROI — revenue vs ad spend per lead source, so you can see which
 *      portal or campaign actually pays for itself (profit + ROI%).
 *   3. Agent leaderboard — production per agent, ranked by GCI.
 *
 * Reads GET /api/reports/production; the server auto-detects the board's
 * source / agent / deal-value columns, so this works on the Real-Estate
 * template with no setup beyond picking a commission rate.
 */

const RANGES = [
  { id: 'ytd', months: null },
  { id: 'm3', months: 3 },
  { id: 'm12', months: 12 },
  { id: 'all', months: 0 },
];

const rangeToDates = (id) => {
  const now = new Date();
  if (id === 'all') return { from: undefined, to: undefined };
  if (id === 'ytd') return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: undefined };
  const r = RANGES.find((x) => x.id === id);
  const from = new Date(now);
  from.setMonth(from.getMonth() - (r?.months || 12));
  return { from: from.toISOString(), to: undefined };
};

const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(2)}M`;
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toFixed(0)}`;
};

const card = {
  background: 'var(--color-bg-surface, #fff)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
};

const Kpi = ({ label, value, sub }) => (
  <div style={{ ...card, padding: '18px 20px' }}>
    <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
      {label}
    </div>
    <div
      className="font-display"
      style={{ fontSize: 30, fontWeight: 750, color: 'var(--color-text-primary)', lineHeight: 1.15, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}
    >
      {value}
    </div>
    {sub && (
      <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>
        {sub}
      </div>
    )}
  </div>
);

const th = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textAlign: 'right',
  padding: '10px 8px',
  whiteSpace: 'nowrap',
};
const td = {
  fontSize: 13.5,
  color: 'var(--color-text-primary)',
  textAlign: 'right',
  padding: '12px 8px',
  fontVariantNumeric: 'tabular-nums',
  borderTop: '1px solid var(--color-bg-subtle)',
  whiteSpace: 'nowrap',
};
// First / last cells get the card's 20px gutter.
const first = { paddingLeft: 20, textAlign: 'left' };
const last = { paddingRight: 20 };

// Gold / silver / bronze rank badges — dark enough for white text (AA).
const MEDALS = ['#8A6A24', '#6B6459', '#94552F'];

const RankBadge = ({ rank }) => {
  const medal = rank <= 3 ? MEDALS[rank - 1] : null;
  return (
    <span
      className="inline-flex items-center justify-center font-body"
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 700,
        background: medal || 'var(--color-bg-subtle)',
        color: medal ? '#FFFFFF' : 'var(--color-text-secondary)',
      }}
    >
      {rank}
    </span>
  );
};

const SectionCard = ({ id, title, children }) => (
  <section aria-labelledby={id} style={{ ...card, overflow: 'hidden', minWidth: 0 }}>
    <h2
      id={id}
      className="font-display"
      style={{ margin: 0, padding: '16px 20px', borderBottom: '1px solid var(--color-bg-subtle)', fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}
    >
      {title}
    </h2>
    {children}
  </section>
);

const TableSkeleton = () => (
  <div className="flex flex-col gap-2" style={{ padding: 20 }} aria-hidden="true">
    {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 34, borderRadius: 7 }} />)}
  </div>
);

const EmptyNote = ({ children }) => (
  <p className="font-body" style={{ margin: 0, padding: 20, fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
    {children}
  </p>
);

const ProductionReportPage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [range, setRange] = useState('ytd');
  const [rate, setRate] = useState('2.5');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;
    getBoards(orgId)
      .then((b) => {
        setBoards(b || []);
        if (!boardId && b && b[0]) setBoardId(String(b[0]._id));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const load = useCallback(() => {
    if (!orgId || !boardId) return;
    setLoading(true);
    setError('');
    const { from, to } = rangeToDates(range);
    getProduction(orgId, { boardId, commissionRate: Number(rate) || 0, from, to })
      .then(setData)
      .catch((e) => {
        setData(null);
        setError(e?.response?.data?.error || t('production.loadError', 'Could not load the report.'));
      })
      .finally(() => setLoading(false));
  }, [orgId, boardId, range, rate, t]);

  useEffect(() => {
    load();
  }, [load]);

  const boardOptions = boards.map((b) => ({ value: String(b._id), label: b.name }));
  const rangeOptions = RANGES.map((r) => ({ value: r.id, label: t(`production.range.${r.id}`, r.id) }));

  const totals = data?.totals;
  const agents = data?.agents || [];
  const sources = data?.sources || [];
  const maxGci = useMemo(() => Math.max(1, ...agents.map((a) => a.gci)), [agents]);

  const filters = (
    <>
      <div style={{ width: 210 }}>
        <Dropdown label={t('production.board', 'Board')} options={boardOptions} value={boardId} onChange={setBoardId} />
      </div>
      <div style={{ width: 170 }}>
        <Dropdown label={t('production.period', 'Period')} options={rangeOptions} value={range} onChange={setRange} />
      </div>
      <div>
        <label
          htmlFor="production-rate"
          className="block mb-2 font-body font-medium text-[color:var(--color-text-secondary)] text-xs uppercase tracking-wide"
        >
          {t('production.commissionRate', 'Commission %')}
        </label>
        <input
          id="production-rate"
          type="number"
          step="0.1"
          min="0"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="font-body"
          style={{
            width: 100,
            height: 38,
            fontSize: 14,
            padding: '0 11px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface, #fff)',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>
    </>
  );

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('production.title', 'Production')}
        subtitle={t('production.subtitle', 'Closed business, commission income, and which lead sources actually pay for themselves.')}
        actions={<div className="flex flex-wrap items-end gap-2.5">{filters}</div>}
      />
      <PageBody className="flex flex-col gap-5">
        {error && (
          <p role="alert" className="font-body" style={{ margin: 0, fontSize: 13.5, color: 'var(--color-status-stuck)' }}>
            {error}
          </p>
        )}

        {/* KPIs */}
        <div aria-busy={loading} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <Kpi
            label={t('production.gci', 'GCI')}
            value={loading ? '—' : money(totals?.gci)}
            sub={t('production.gciSub', '{{rate}}% commission', { rate: Number(rate) || 0 })}
          />
          <Kpi
            label={t('production.volume', 'Volume')}
            value={loading ? '—' : money(totals?.volume)}
            sub={t('production.closings', '{{count}} closings', { count: totals?.closings || 0 })}
          />
          <Kpi
            label={t('production.conversion', 'Conversion')}
            value={loading ? '—' : `${totals?.conversionRate ?? 0}%`}
            sub={t('production.ofLeads', 'of {{count}} leads', { count: totals?.leads || 0 })}
          />
          <Kpi
            label={t('production.roi', 'Ad ROI')}
            value={loading ? '—' : totals?.roi == null ? '—' : `${totals.roi}%`}
            sub={
              totals?.spend
                ? t('production.spendSub', '{{spend}} ad spend', { spend: money(totals.spend) })
                : t('production.noSpend', 'No campaign spend logged')
            }
          />
        </div>

        {/* Leaderboard + source ROI side by side; stack below ~1030px of content. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))', gap: 18, alignItems: 'start' }}>
          <SectionCard id="production-leaderboard" title={t('production.leaderboard', 'Agent leaderboard')}>
            {loading ? (
              <TableSkeleton />
            ) : agents.length === 0 ? (
              <EmptyNote>{t('production.noAgents', 'No leads in this period yet.')}</EmptyNote>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ ...th, ...first }}>{t('production.agent', 'Agent')}</th>
                      <th scope="col" style={th}>{t('production.leads', 'Leads')}</th>
                      <th scope="col" style={th}>{t('production.closingsCol', 'Closings')}</th>
                      <th scope="col" style={th}>{t('production.convCol', 'Conv.')}</th>
                      <th scope="col" style={th}>{t('production.volumeCol', 'Volume')}</th>
                      <th scope="col" style={{ ...th, ...last }}>{t('production.gci', 'GCI')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.agentId}>
                        <th scope="row" style={{ ...td, ...first, fontWeight: 700 }}>
                          <span className="inline-flex items-center gap-2">
                            <RankBadge rank={a.rank} />
                            {a.name}
                          </span>
                        </th>
                        <td style={td}>{a.leads}</td>
                        <td style={td}>{a.closings}</td>
                        <td style={td}>{a.conversionRate}%</td>
                        <td style={td}>{money(a.volume)}</td>
                        <td style={{ ...td, ...last }}>
                          <div style={{ fontWeight: 700 }}>{money(a.gci)}</div>
                          <div aria-hidden="true" style={{ height: 4, borderRadius: 4, background: 'var(--color-accent-light)', marginTop: 5, minWidth: 64 }}>
                            <div style={{ height: 4, width: `${Math.max(2, (a.gci / maxGci) * 100)}%`, background: 'var(--color-accent)', borderRadius: 4 }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard id="production-sources" title={t('production.sourceRoi', 'Lead source ROI')}>
            {loading ? (
              <TableSkeleton />
            ) : sources.length === 0 ? (
              <EmptyNote>{t('production.noSources', 'No leads in this period yet.')}</EmptyNote>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ ...th, ...first }}>{t('production.source', 'Source')}</th>
                      <th scope="col" style={th}>{t('production.leads', 'Leads')}</th>
                      <th scope="col" style={th}>{t('production.closingsCol', 'Closings')}</th>
                      <th scope="col" style={th}>{t('production.spendCol', 'Ad spend')}</th>
                      <th scope="col" style={th}>{t('production.gci', 'GCI')}</th>
                      <th scope="col" style={th}>{t('production.profit', 'Profit')}</th>
                      <th scope="col" style={{ ...th, ...last }}>{t('production.roiCol', 'ROI')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.source}>
                        <th scope="row" style={{ ...td, ...first, fontWeight: 700 }}>{s.source}</th>
                        <td style={td}>{s.leads}</td>
                        <td style={td}>{s.closings}</td>
                        <td style={td}>{s.spend ? money(s.spend) : '—'}</td>
                        <td style={td}>{money(s.gci)}</td>
                        <td style={{ ...td, color: s.profit >= 0 ? 'var(--color-status-done)' : 'var(--color-status-stuck)', fontWeight: 600 }}>
                          {money(s.profit)}
                        </td>
                        <td style={{ ...td, ...last, fontWeight: 700, color: s.roi == null ? 'var(--color-text-secondary)' : s.roi >= 0 ? 'var(--color-status-done)' : 'var(--color-status-stuck)' }}>
                          {s.roi == null ? '—' : `${s.roi}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="font-body" style={{ margin: 0, padding: '12px 20px 16px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {t('production.footnote', 'Ad spend comes from your Marketing campaigns, matched to each source. Deals with their own commission value override the rate above.')}
            </p>
          </SectionCard>
        </div>
      </PageBody>
    </PageWrapper>
  );
};

export default ProductionReportPage;
