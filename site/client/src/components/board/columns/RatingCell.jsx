import { Star } from 'lucide-react';
import { cellWrapperStyle } from './cellShared';

/**
 * RatingCell — clickable star row. `settings.max` controls the maximum
 * (default 5). Read-only renders the same stars without click handlers.
 */
const RatingCell = ({ value, column, readOnly, onChange }) => {
  const max = column?.settings?.max ?? 5;
  const current = Math.max(0, Math.min(max, Number(value) || 0));
  return (
    <div style={{ ...cellWrapperStyle, gap: 2 }}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < current;
        const next = current === i + 1 ? 0 : i + 1; // clicking the same star clears it
        return (
          <button
            key={i}
            type="button"
            onClick={() => !readOnly && onChange?.(next)}
            disabled={readOnly}
            style={{
              padding: 0,
              background: 'transparent',
              border: 'none',
              cursor: readOnly ? 'default' : 'pointer',
              color: filled ? 'var(--color-warning, #D97706)' : 'var(--color-text-muted)',
              display: 'inline-flex',
            }}
            aria-label={`${i + 1} of ${max}`}
          >
            <Star size={14} fill={filled ? 'currentColor' : 'none'} />
          </button>
        );
      })}
    </div>
  );
};

export default RatingCell;
