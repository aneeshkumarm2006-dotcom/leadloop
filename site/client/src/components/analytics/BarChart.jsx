import { useEffect, useMemo, useState } from 'react';

/**
 * BarChart — horizontal bar chart used on the Analytics page.
 * See Macan_Design.md Section 7.7.
 *
 * Each row: label (w-28, text-secondary) + progress track (flex-1, h-2,
 * bg-subtle, radius-full) + fill (colored by status/priority) + count.
 * Bars animate in from width 0 → actual %, 500ms ease-out, staggered 50ms.
 *
 * Props:
 *   title:  heading shown above the chart
 *   icon:   optional Lucide icon component
 *   data:   Array<{ key: string, label: string, count: number, color: string }>
 */
const BarChart = ({ title, icon: Icon, data = [] }) => {
  const [mounted, setMounted] = useState(false);

  const maxCount = useMemo(
    () => Math.max(1, ...data.map((d) => d.count || 0)),
    [data]
  );

  useEffect(() => {
    // Delay a tick so the CSS transition runs on mount. After first mount the
    // CSS width transition handles subsequent filter changes smoothly.
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
      {(title || Icon) && (
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon
              size={16}
              color="var(--color-accent)"
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          {title && (
            <h3
              className="font-display font-semibold"
              style={{
                fontSize: 15,
                color: 'var(--color-text-primary)',
              }}
            >
              {title}
            </h3>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col" style={{ gap: 14 }}>
        {data.length === 0 ? (
          <p
            className="font-body"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              padding: '8px 0',
            }}
          >
            No data to display.
          </p>
        ) : (
          data.map((row, i) => {
            const pct =
              maxCount === 0 ? 0 : Math.round((row.count / maxCount) * 100);
            return (
              <div
                key={row.key}
                className="flex items-center"
                style={{ gap: 12 }}
              >
                <span
                  className="font-body truncate"
                  style={{
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                    width: 112,
                    flexShrink: 0,
                  }}
                  title={row.label}
                >
                  {row.label}
                </span>
                <div
                  className="flex-1"
                  style={{
                    position: 'relative',
                    height: 8,
                    background: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                  }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={maxCount}
                  aria-valuenow={row.count}
                  aria-label={`${row.label}: ${row.count}`}
                >
                  <div
                    style={{
                      height: '100%',
                      width: mounted ? `${pct}%` : '0%',
                      background: row.color,
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
                    width: 28,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {row.count}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default BarChart;
