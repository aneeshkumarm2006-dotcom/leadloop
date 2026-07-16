import { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';

/**
 * BoardPerformance — per-board completion progress list.
 * See Macan_Design.md Section 7.7.
 *
 * Each row: colored dot + board name (font-600) + progress bar (flex-1, h 6px)
 * + "X%" label. Progress bars animate in on mount.
 *
 * Props:
 *   boards: Array<{ _id, name, total, done, percent }>
 */

// Cycle of accent colors for the board dots
const DOT_COLORS = [
  'var(--color-card-blue)',
  'var(--color-card-green)',
  'var(--color-card-orange)',
  'var(--color-card-purple)',
  'var(--color-status-working)',
  'var(--color-priority-critical)',
];

const BoardPerformance = ({ boards = [] }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Animate bars in once on mount. Filter changes transition smoothly via
    // the CSS `width` transition, no reset needed.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section
      className="bg-surface"
      style={{
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: 24,
      }}
    >
      <div className="flex items-center gap-2">
        <BarChart2
          size={16}
          color="var(--color-accent)"
          strokeWidth={2}
          aria-hidden="true"
        />
        <h3
          className="font-display font-semibold"
          style={{ fontSize: 15, color: 'var(--color-text-primary)' }}
        >
          Board Performance
        </h3>
      </div>

      <div className="mt-4 flex flex-col">
        {boards.length === 0 ? (
          <p
            className="font-body"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              padding: '8px 0',
            }}
          >
            No boards to analyse yet.
          </p>
        ) : (
          boards.map((board, i) => (
            <div
              key={board._id}
              className="flex items-center"
              style={{
                padding: '12px 0',
                gap: 14,
                borderBottom:
                  i === boards.length - 1
                    ? 'none'
                    : '1px solid var(--color-border)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '9999px',
                  background: DOT_COLORS[i % DOT_COLORS.length],
                  flexShrink: 0,
                }}
              />
              <span
                className="font-body font-semibold truncate"
                style={{
                  fontSize: 14,
                  color: 'var(--color-text-primary)',
                  minWidth: 140,
                  flexShrink: 0,
                }}
                title={board.name}
              >
                {board.name}
              </span>
              <div
                className="flex-1"
                style={{
                  position: 'relative',
                  height: 6,
                  background: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden',
                }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={board.percent}
                aria-label={`${board.name}: ${board.percent}% complete`}
              >
                <div
                  style={{
                    height: '100%',
                    width: mounted ? `${board.percent}%` : '0%',
                    background: DOT_COLORS[i % DOT_COLORS.length],
                    borderRadius: 'var(--radius-full)',
                    transition: `width 500ms ease-out ${i * 50}ms`,
                  }}
                />
              </div>
              <span
                className="font-body font-semibold"
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                  width: 44,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {board.percent}%
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default BoardPerformance;
