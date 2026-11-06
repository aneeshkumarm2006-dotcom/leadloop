/**
 * LeadLoopLogo — the one LeadLoop brand mark. Same geometry as
 * public/favicon.svg and the app icons: an open ring (the loop) with the lead —
 * a gold dot — sitting in the gap where the loop closes.
 *
 *   <LeadLoopMark size={28} />                tile only (onDark adds a faint edge)
 *   <LeadLoopLogo size={32} />                tile + "LeadLoop" wordmark
 *   <LeadLoopLogo size={36} light />          wordmark for dark/pine backgrounds
 */

import { useId } from 'react';

const RING = 'M386.7 237.6A132 132 0 1 1 274.4 125.3';

export const LeadLoopMark = ({ size = 28, className = '', title, onDark = false }) => {
  const gid = `ll-g-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4A7D5C" />
          <stop offset="1" stopColor="#284A36" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${gid})`} />
      {onDark && (
        <rect x="8" y="8" width="496" height="496" rx="108" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="16" />
      )}
      <g transform="translate(40.96 40.96) scale(0.84)">
        <path d={RING} fill="none" stroke="#F6F1E7" strokeWidth="58" strokeLinecap="round" />
        <circle cx="349.3" cy="162.7" r="36" fill="#E7BF62" />
      </g>
    </svg>
  );
};

const LeadLoopLogo = ({ size = 32, light = false, textSize, className = '' }) => (
  <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <LeadLoopMark size={size} onDark={light} />
    <span
      className="font-display font-extrabold tracking-tight leading-none"
      style={{
        fontSize: textSize || Math.round(size * 0.58),
        color: light ? 'var(--color-pine-text, #fff)' : 'var(--color-text-primary)',
      }}
    >
      LeadLoop
    </span>
  </span>
);

export default LeadLoopLogo;
