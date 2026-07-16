import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { cellWrapperStyle } from './cellShared';
import useBoardStore from '../../../store/boardStore';

/**
 * MirrorCell — read-only badge showing a `mirror` column's computed value.
 *
 * The value is computed server-side from the rows the sibling `connect_boards`
 * column points at, so the cell fetches it via `boardStore.mirrorValue` on
 * mount and whenever the source links change. The initial `value` prop (the
 * embedded value from the task list, or a cache wrapper) renders instantly to
 * avoid a flash. Clicking opens a small detail panel describing the source.
 */

const unwrap = (value) => {
  if (value && typeof value === 'object' && value.__mirror === true) return value.value;
  return value;
};

const displayString = (value) => {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
};

const MirrorCell = ({ value, column, task }) => {
  const { t } = useTranslation();
  const mirrorValueAction = useBoardStore((s) => s.mirrorValue);
  const [display, setDisplay] = useState(() => unwrap(value));
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const settings = column.settings || {};
  const sourceConnectColumnId = settings.sourceConnectColumnId
    ? settings.sourceConnectColumnId.toString()
    : null;
  const aggregation = settings.aggregation || 'first';

  // Linked source rows on this task, read from the sibling connect column —
  // used both to count sources and to re-fetch when links change.
  const links = useMemo(() => {
    if (!task || !task.columnValues || !sourceConnectColumnId) return [];
    const raw = task.columnValues[sourceConnectColumnId];
    return raw && Array.isArray(raw.links) ? raw.links : [];
  }, [task, sourceConnectColumnId]);
  const linksSig = useMemo(() => links.map((l) => l.taskId).join(','), [links]);

  useEffect(() => {
    setDisplay(unwrap(value));
  }, [value]);

  // Fetch the freshly computed value (server resolves aggregation over the
  // linked rows). Re-runs when the linked set changes.
  useEffect(() => {
    if (!task || !task._id) return undefined;
    let cancelled = false;
    mirrorValueAction(task._id, column._id)
      .then((v) => {
        if (!cancelled) setDisplay(v);
      })
      .catch(() => {
        /* leave the embedded value in place on failure */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task && task._id, column._id, linksSig]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (wrapperRef.current && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const text = displayString(display);
  const isEmpty = text === '—';

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <div
        style={{ ...cellWrapperStyle, gap: 6, cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
        title={t('boardMisc.mirroredValueClickForSource')}
      >
        <GitBranch size={12} color="var(--color-text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: isEmpty ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          }}
        >
          {text}
        </span>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 50,
            minWidth: 220,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-text-muted)',
              marginBottom: 6,
            }}
          >
            {t('boardMisc.mirroredValue')}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>
            {text}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {t('boardMisc.aggregationLabel')} <strong>{aggregation}</strong>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {t('boardMisc.sourceLinkedRows', { count: links.length })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MirrorCell;
