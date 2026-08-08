import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, DollarSign, Trophy, Home, Percent, Medal } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
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
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 18,
};

const Kpi = ({ icon: Icon, label, value, sub, tint }) => (
  <div style={{ ...card, padding: 16 }}>
    <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
      <span
        className="inline-flex items-center justify-center"
        style={{ width: 30, height: 30, borderRadius: 8, background: `${tint}1A`, color: tint }}
      >
        <Icon size={16} />
      </span>
      <span
        className="font-body"
        style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
    </div>
    <div className="font-heading" style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
    {sub && (
      <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
        {sub}
      </div>
    )}
  </div>
);

const th = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  textAlign: 'right',
  padding: '8px 10px',
  whiteSpace: 'nowrap',
};
const td = {
  fontSize: 13,
  color: 'var(--color-text-primary)',
  textAlign: 'right',
  padding: '10px',
  fontVariantNumeric: 'tabular-nums',
  borderTop: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
};

const MEDALS = ['#C9A227', '#9AA0A6', '#B06B3C'];

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

  return (
    <PageWrapper>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-subtle, rgba(62,107,78,.14))', color: 'var(--color-accent)' }}
          >
            <TrendingUp size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('production.title', 'Production')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20, maxWidth: 660 }}>
          {t('production.subtitle', 'Closed business, commission income, and which lead sources actually pay for themselves.')}
        </p>

        {/* Controls */}
        <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 20 }}>
          <div style={{ width: 220 }}>
            <Dropdown label={t('production.board', 'Board')} options={boardOptions} value={boardId} onChange={setBoardId} />
          </div>
          <div style={{ width: 170 }}>
            <Dropdown label={t('production.period', 'Period')} options={rangeOptions} value={range} onChange={setRange} />
          </div>
          <div>
            <label className="font-body" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
              {t('production.commissionRate', 'Commission %')}
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="font-body"
              style={{
                width: 110,
                fontSize: 14,
                padding: '8px 11px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-surface, #fff)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>
        </div>

        {error && (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)', marginBottom: 16 }}>
            {error}
          </p>
        )}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 22 }}>
          <Kpi
            icon={DollarSign}
            tint="#4E9068"
            label={t('production.gci', 'GCI')}
            value={loading ? '—' : money(totals?.gci)}
            sub={t('production.gciSub', '{{rate}}% commission', { rate: Number(rate) || 0 })}
          />
          <Kpi
            icon={Home}
            tint="#579BFC"
            label={t('production.volume', 'Volume')}
            value={loading ? '—' : money(totals?.volume)}
            sub={t('production.closings', '{{count}} closings', { count: totals?.closings || 0 })}
          />
          <Kpi
            icon={Percent}
            tint="#B08A3C"
            label={t('production.conversion', 'Conversion')}
            value={loading ? '—' : `${totals?.conversionRate ?? 0}%`}
            sub={t('production.ofLeads', 'of {{count}} leads', { count: totals?.leads || 0 })}
          />
          <Kpi
            icon={TrendingUp}
            tint="#8A5CA6"
            label={t('production.roi', 'Ad ROI')}
            value={loading ? '—' : totals?.roi == null ? '—' : `${totals.roi}%`}
            sub={
              totals?.spend
                ? t('production.spendSub', '{{spend}} ad spend', { spend: money(totals.spend) })
                : t('production.noSpend', 'No campaign spend logged')
            }
          />
        </div>

        {/* Agent leaderboard */}
        <div style={{ ...card, marginBottom: 18 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
            <Trophy size={15} style={{ color: 'var(--color-accent)' }} />
            <h2 className="font-heading" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {t('production.leaderboard', 'Agent leaderboard')}
            </h2>
          </div>
          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 34, borderRadius: 7 }} />)}
            </div>
          ) : agents.length === 0 ? (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('production.noAgents', 'No leads in this period yet.')}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>{t('production.agent', 'Agent')}</th>
                    <th style={th}>{t('production.leads', 'Leads')}</th>
                    <th style={th}>{t('production.closingsCol', 'Closings')}</th>
                    <th style={th}>{t('production.convCol', 'Conv.')}</th>
                    <th style={th}>{t('production.volumeCol', 'Volume')}</th>
                    <th style={th}>{t('production.gci', 'GCI')}</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.agentId}>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <div className="flex items-center gap-2">
                          {a.rank <= 3 ? (
                            <Medal size={15} style={{ color: MEDALS[a.rank - 1], flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: 15, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>{a.rank}</span>
                          )}
                          <span style={{ fontWeight: 600 }}>{a.name}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 3, background: 'var(--color-bg-subtle)', marginTop: 6, overflow: 'hidden', maxWidth: 220 }}>
                          <div style={{ height: '100%', width: `${Math.max(2, (a.gci / maxGci) * 100)}%`, background: 'var(--color-accent)', borderRadius: 3 }} />
                        </div>
                      </td>
                      <td style={td}>{a.leads}</td>
                      <td style={td}>{a.closings}</td>
                      <td style={td}>{a.conversionRate}%</td>
                      <td style={td}>{money(a.volume)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{money(a.gci)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Source ROI */}
        <div style={card}>
          <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
            <TrendingUp size={15} style={{ color: 'var(--color-accent)' }} />
            <h2 className="font-heading" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {t('production.sourceRoi', 'Lead source ROI')}
            </h2>
          </div>
          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 34, borderRadius: 7 }} />)}
            </div>
          ) : sources.length === 0 ? (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('production.noSources', 'No leads in this period yet.')}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>{t('production.source', 'Source')}</th>
                    <th style={th}>{t('production.leads', 'Leads')}</th>
                    <th style={th}>{t('production.closingsCol', 'Closings')}</th>
                    <th style={th}>{t('production.spendCol', 'Ad spend')}</th>
                    <th style={th}>{t('production.gci', 'GCI')}</th>
                    <th style={th}>{t('production.profit', 'Profit')}</th>
                    <th style={th}>{t('production.roiCol', 'ROI')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{s.source}</td>
                      <td style={td}>{s.leads}</td>
                      <td style={td}>{s.closings}</td>
                      <td style={td}>{s.spend ? money(s.spend) : '—'}</td>
                      <td style={td}>{money(s.gci)}</td>
                      <td style={{ ...td, color: s.profit >= 0 ? 'var(--color-status-done)' : 'var(--color-status-stuck)', fontWeight: 600 }}>
                        {money(s.profit)}
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: s.roi == null ? 'var(--color-text-muted)' : s.roi >= 0 ? 'var(--color-status-done)' : 'var(--color-status-stuck)' }}>
                        {s.roi == null ? '—' : `${s.roi}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="font-body" style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.5 }}>
            {t('production.footnote', 'Ad spend comes from your Marketing campaigns, matched to each source. Deals with their own commission value override the rate above.')}
          </p>
        </div>
      </div>
    </PageWrapper>
  );
};

export default ProductionReportPage;
