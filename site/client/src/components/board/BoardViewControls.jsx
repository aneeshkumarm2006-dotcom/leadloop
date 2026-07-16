import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, ArrowUpDown, EyeOff, Eye, Check, ChevronDown, ArrowUp, ArrowDown, X,
} from 'lucide-react';

/**
 * BoardViewControls — the Monday-style action toolbar for a flexible board:
 * a primary "New lead" button, a "Sort" popover (pick a column + direction),
 * and a "Hide columns" popover (toggle column visibility). Filtering lives in
 * the separate BoardFilterBar.
 *
 * Props:
 *   board            — current board doc (reads `columns`)
 *   sort             — { columnId, dir } | null
 *   onSortChange     — (next | null) => void
 *   hiddenColumnIds  — Set<string> of hidden column ids
 *   onToggleColumn   — (columnId) => void
 *   onShowAllColumns — () => void
 *   onNewLead        — () => void
 *   creatingLead     — boolean (disables New lead while busy)
 */
const BoardViewControls = ({
  board,
  sort,
  onSortChange,
  hiddenColumnIds,
  onToggleColumn,
  onShowAllColumns,
  onNewLead,
  creatingLead = false,
}) => {
  const { t } = useTranslation();
  const columns = useMemo(
    () => (board?.columns || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    [board?.columns]
  );
  const hideableCols = columns.filter((c) => !c.isPrimary);
  const hiddenCount = hideableCols.filter((c) => hiddenColumnIds?.has?.(c._id?.toString())).length;
  const sortedCol = sort?.columnId ? columns.find((c) => c._id.toString() === sort.columnId) : null;

  return (
    <div className="mt-5 flex items-center gap-2 flex-wrap">
      {/* New lead */}
      {onNewLead && (
      <button
        type="button"
        onClick={onNewLead}
        disabled={creatingLead}
        className="inline-flex items-center gap-1.5 font-body transition-colors duration-150 hover:brightness-95"
        style={{
          height: 34,
          padding: '0 14px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: 'var(--color-accent)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: creatingLead ? 'wait' : 'pointer',
          opacity: creatingLead ? 0.7 : 1,
        }}
      >
        <Plus size={15} aria-hidden="true" />
        {t('boardMisc.newLead')}
      </button>
      )}

      {/* Sort */}
      <Popover
        label={sortedCol ? `${t('boardMisc.sort')} · ${sortedCol.name}` : t('boardMisc.sort')}
        icon={ArrowUpDown}
        active={!!sortedCol}
      >
        {({ close }) => (
          <div style={{ minWidth: 220, padding: 4 }}>
            <div style={headingStyle}>{t('boardMisc.sortBy')}</div>
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {columns.map((col) => {
                const isSel = sort?.columnId === col._id.toString();
                return (
                  <button
                    key={col._id}
                    type="button"
                    onClick={() =>
                      onSortChange?.({ columnId: col._id.toString(), dir: isSel ? sort.dir : 'asc' })
                    }
                    className="w-full flex items-center gap-2 text-left transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
                    style={rowStyle}
                  >
                    {col.color && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {col.name}
                    </span>
                    {isSel && <Check size={14} color="var(--color-accent)" />}
                  </button>
                );
              })}
            </div>

            {sort?.columnId && (
              <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={() => onSortChange?.({ ...sort, dir: 'asc' })}
                  className="w-full flex items-center gap-2 text-left hover:bg-[color:var(--color-bg-subtle)]"
                  style={rowStyle}
                >
                  <ArrowUp size={14} color="var(--color-text-muted)" />
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>{t('boardMisc.ascending')}</span>
                  {sort.dir === 'asc' && <Check size={14} color="var(--color-accent)" />}
                </button>
                <button
                  type="button"
                  onClick={() => onSortChange?.({ ...sort, dir: 'desc' })}
                  className="w-full flex items-center gap-2 text-left hover:bg-[color:var(--color-bg-subtle)]"
                  style={rowStyle}
                >
                  <ArrowDown size={14} color="var(--color-text-muted)" />
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>{t('boardMisc.descending')}</span>
                  {sort.dir === 'desc' && <Check size={14} color="var(--color-accent)" />}
                </button>
                <button
                  type="button"
                  onClick={() => { onSortChange?.(null); close(); }}
                  className="w-full flex items-center gap-2 text-left hover:bg-[color:var(--color-bg-subtle)]"
                  style={{ ...rowStyle, color: 'var(--color-accent)' }}
                >
                  <X size={14} />
                  <span style={{ fontSize: 13 }}>{t('boardMisc.clearSort')}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </Popover>

      {/* Hide columns */}
      <Popover
        label={hiddenCount > 0 ? `${t('boardMisc.hideColumns')} / ${hiddenCount}` : t('boardMisc.hideColumns')}
        icon={EyeOff}
        active={hiddenCount > 0}
      >
        {() => (
          <div style={{ minWidth: 220, padding: 4 }}>
            <div style={headingStyle}>{t('boardMisc.hideColumns')}</div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {hideableCols.length === 0 ? (
                <p style={{ padding: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>{t('boardMisc.noOptions')}</p>
              ) : (
                hideableCols.map((col) => {
                  const hidden = hiddenColumnIds?.has?.(col._id.toString());
                  return (
                    <button
                      key={col._id}
                      type="button"
                      onClick={() => onToggleColumn?.(col._id.toString())}
                      className="w-full flex items-center gap-2 text-left transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
                      style={rowStyle}
                    >
                      {hidden ? (
                        <EyeOff size={14} color="var(--color-text-muted)" />
                      ) : (
                        <Eye size={14} color="var(--color-accent)" />
                      )}
                      <span style={{ flex: 1, fontSize: 13, color: hidden ? 'var(--color-text-muted)' : 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {col.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {hiddenCount > 0 && (
              <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={onShowAllColumns}
                  className="w-full flex items-center gap-2 text-left hover:bg-[color:var(--color-bg-subtle)]"
                  style={{ ...rowStyle, color: 'var(--color-accent)' }}
                >
                  <Eye size={14} />
                  <span style={{ fontSize: 13 }}>{t('boardMisc.showAllColumns')}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
};

const headingStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-muted)',
  padding: '6px 8px 4px',
};

const rowStyle = {
  margin: '1px 0',
  padding: '7px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};

/** A pill button that toggles a dropdown panel. Closes on outside click / Esc. */
const Popover = ({ label, icon: Icon, active = false, children }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={typeof label === 'string' ? label : undefined}
        className="inline-flex items-center gap-1.5 font-body transition-colors duration-150"
        style={{
          height: 34,
          padding: '0 12px',
          fontSize: 13,
          fontWeight: 500,
          color: active ? 'var(--color-accent)' : 'var(--color-text-primary)',
          background: active ? 'var(--color-accent-light)' : 'var(--color-bg-surface, #FFFFFF)',
          border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
        }}
      >
        {Icon && <Icon size={14} aria-hidden="true" />}
        {label}
        <ChevronDown size={13} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />
      </button>
      {open && (
        <div
          className="bg-white"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            animation: 'macan-dropdown-enter 150ms ease-out',
          }}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
};

export default BoardViewControls;
