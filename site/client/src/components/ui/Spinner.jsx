/**
 * Spinner — inline loading indicator.
 * Sizes: sm (14px) | default (20px) | lg (32px).
 * See Stage 20.7. Respects prefers-reduced-motion.
 */

const SIZES = {
  sm: 14,
  default: 20,
  lg: 32,
};

const Spinner = ({
  size = 'default',
  color = 'var(--color-accent)',
  label = 'Loading',
  className = '',
}) => {
  const dim = typeof size === 'number' ? size : SIZES[size] || SIZES.default;
  const stroke = Math.max(2, Math.round(dim / 10));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={['inline-block', className].filter(Boolean).join(' ')}
      style={{ width: dim, height: dim, lineHeight: 0 }}
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 50 50"
        aria-hidden="true"
        style={{
          animation: 'macan-spin 800ms linear infinite',
          transformOrigin: 'center',
        }}
      >
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke={color}
          strokeWidth={stroke * 2.5}
          strokeLinecap="round"
          strokeDasharray="90 150"
          opacity="0.9"
        />
      </svg>
      <span className="sr-only">{label}</span>
      <style>{`
        @keyframes macan-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          span[role="status"] svg { animation: none !important; }
        }
      `}</style>
    </span>
  );
};

export default Spinner;
