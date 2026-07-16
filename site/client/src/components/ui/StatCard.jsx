import { useEffect, useRef, useState } from 'react';

/**
 * StatCard — solid-colored dashboard card with an animated count-up number.
 * See Macan_Design.md Section 6.2.
 *
 * Props: icon (Lucide component), label, value (number), subLabel, color
 *   color: 'blue' | 'green' | 'orange' | 'purple' | 'red' | raw CSS color
 */

const COLOR_VARS = {
  blue: 'var(--color-card-blue)',
  green: 'var(--color-card-green)',
  orange: 'var(--color-card-orange)',
  purple: 'var(--color-card-purple)',
  red: '#DC2626',
};

const ANIMATION_DURATION_MS = 800;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const useCountUp = (target, durationMs = ANIMATION_DURATION_MS) => {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    const numeric = typeof target === 'number' ? target : Number(target);
    if (!Number.isFinite(numeric)) {
      setDisplay(target);
      return undefined;
    }

    startRef.current = null;
    cancelAnimationFrame(rafRef.current);

    const step = (timestamp) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = easeOutCubic(progress);
      setDisplay(Math.round(eased * numeric));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return display;
};

/**
 * Optional `trend` prop: { dir: 'up' | 'down', value: string }
 * renders a colored delta chip next to the sub-label.
 */
const StatCard = ({
  icon: Icon,
  label,
  value,
  subLabel,
  color = 'blue',
  suffix,
  trend,
  className = '',
}) => {
  const accent = COLOR_VARS[color] || color;
  const numeric = typeof value === 'number' ? value : Number(value);
  const isNumeric = Number.isFinite(numeric);
  const animated = useCountUp(isNumeric ? numeric : 0);

  const trendUp = trend?.dir !== 'down';

  return (
    <div
      className={[
        'surface-card lift press relative overflow-hidden w-full group',
        className,
      ].join(' ')}
      style={{
        padding: '18px 20px',
        minHeight: 116,
      }}
    >
      {/* Hairline accent stripe down the left edge — the card's tint */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 bottom-0"
        style={{ width: 3, background: accent, opacity: 0.9 }}
      />

      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p
            className="font-body font-semibold uppercase truncate"
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-text-secondary)',
            }}
          >
            {label}
          </p>
          <p
            className="font-display font-extrabold leading-none mt-2.5"
            style={{
              fontSize: 34,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isNumeric ? animated : value}
            {suffix ? (
              <span
                className="ml-0.5 font-bold"
                style={{ fontSize: 18, color: 'var(--color-text-secondary)' }}
              >
                {suffix}
              </span>
            ) : null}
          </p>
        </div>

        {/* Colored icon tile */}
        {Icon && (
          <span
            className="inline-flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105"
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-md)',
              background: `color-mix(in srgb, ${accent} 12%, #fff)`,
              color: accent,
            }}
          >
            <Icon size={20} strokeWidth={2.2} aria-hidden="true" />
          </span>
        )}
      </div>

      {(subLabel || trend) && (
        <div className="flex items-center gap-2 mt-3">
          {trend && (
            <span
              className="inline-flex items-center gap-0.5 font-semibold"
              style={{
                fontSize: 12,
                color: trendUp
                  ? 'var(--color-status-done)'
                  : 'var(--color-status-stuck)',
              }}
            >
              {trendUp ? '▲' : '▼'} {trend.value}
            </span>
          )}
          {subLabel && (
            <p
              className="font-body truncate"
              style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
            >
              {subLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default StatCard;
