import { useEffect, useRef, useState } from 'react';
import { focusedInputStyle, cellWrapperStyle } from './cellShared';
import CellPlaceholder from './CellPlaceholder';

/**
 * ProgressCell — a 0–100 percentage rendered as a battery/bar (Monday's
 * progress column). Number-backed; the fill colour ramps red → amber → green.
 * Click to edit an inline 0–100 input.
 */

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));
const fillColor = (pct) => {
  if (pct >= 100) return '#00C875';
  if (pct >= 67) return '#4E9068';
  if (pct >= 34) return '#FDAB3D';
  return '#E2445C';
};

const ProgressCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const ref = useRef(null);

  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const commit = () => {
    if (draft === '') {
      if (value != null) onChange?.(null);
    } else {
      const n = Number(draft);
      if (!Number.isNaN(n)) {
        const next = clampPct(n);
        if (next !== value) onChange?.(next);
      }
    }
    setEditing(false);
  };

  if (readOnly || !editing) {
    const pct = value == null ? null : clampPct(Number(value));
    return (
      <div
        style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'pointer' }}
        onClick={() => !readOnly && setEditing(true)}
      >
        {pct == null ? (
          !readOnly ? <CellPlaceholder text="Set progress" /> : null
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--color-bg-subtle)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: fillColor(pct), borderRadius: 99, transition: 'width .25s ease' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <input
      ref={ref}
      type="number"
      min={0}
      max={100}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); setEditing(false); }
      }}
      style={{ ...focusedInputStyle, textAlign: 'right' }}
    />
  );
};

export default ProgressCell;
