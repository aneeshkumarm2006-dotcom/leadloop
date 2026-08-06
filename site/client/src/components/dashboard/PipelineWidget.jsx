import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import Dropdown from '../ui/Dropdown';
import { getBoardPipeline } from '../../services/boardService';

/**
 * PipelineWidget — a live "leads by stage" funnel for a chosen board, on the
 * Workspace Home. Reads stage counts from GET /api/boards/:id/pipeline. Bars are
 * sized to the busiest stage; a board picker lets you switch pipelines.
 */

const STAGE_COLORS = ['#8C8578', '#579BFC', '#B08A3C', '#4E9068', '#8A5CA6', '#C4632B', '#2F6B47', '#3E8FA0', '#A63D57'];

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 18,
};

const PipelineWidget = ({ boards = [] }) => {
  const { t } = useTranslation();
  const [boardId, setBoardId] = useState(boards[0]?._id ? String(boards[0]._id) : '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!boardId && boards[0]?._id) setBoardId(String(boards[0]._id));
  }, [boards, boardId]);

  useEffect(() => {
    if (!boardId) { setData(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    getBoardPipeline(boardId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId]);

  if (boards.length === 0) return null;

  const stages = data?.stages || [];
  const total = data?.total ?? 0;
  const max = Math.max(1, ...stages.map((s) => s.count));
  const boardOptions = boards.map((b) => ({ value: String(b._id), label: b.name }));

  return (
    <div style={card}>
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 16 }}>
        <span className="inline-flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
          <GitBranch size={14} /> {t('dashboard.pipelineTitle', 'Pipeline')}
        </span>
        <div style={{ width: 200, marginLeft: 'auto' }}>
          <Dropdown size="sm" options={boardOptions} value={boardId} onChange={setBoardId} />
        </div>
        <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {t('dashboard.pipelineTotal', '{{count}} leads', { count: total })}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 22, borderRadius: 7 }} />)}
        </div>
      ) : stages.length === 0 ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '10px 2px' }}>
          {t('dashboard.pipelineEmpty', 'No stages on this board yet.')}
        </p>
      ) : (
        <div className="flex flex-col" style={{ gap: 10 }}>
          {stages.map((s, i) => {
            const color = STAGE_COLORS[i % STAGE_COLORS.length];
            const pct = Math.round((s.count / max) * 100);
            return (
              <div key={s._id} className="grid items-center" style={{ gridTemplateColumns: '132px 1fr 40px', gap: 12 }}>
                <span className="font-body inline-flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: color, flex: '0 0 auto' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </span>
                <div style={{ height: 24, borderRadius: 7, background: 'var(--color-bg-subtle)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(pct, s.count > 0 ? 6 : 0)}%`, background: color, borderRadius: 7, transition: 'width .5s cubic-bezier(.22,.61,.36,1)' }} />
                </div>
                <span className="font-body" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {s.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PipelineWidget;
