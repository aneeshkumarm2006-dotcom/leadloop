/**
 * LeadLoop brand mark — same geometry as the app's favicon and
 * site/client/src/components/brand/LeadLoopLogo.jsx: an open ring (the loop)
 * with the lead, a gold dot, sitting where the loop closes.
 */
export function LeadLoopMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="block shrink-0">
      <defs>
        <linearGradient id="ll-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4A7D5C" />
          <stop offset="1" stopColor="#284A36" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#ll-mark-g)" />
      <g transform="translate(40.96 40.96) scale(0.84)">
        <path
          d="M386.7 237.6A132 132 0 1 1 274.4 125.3"
          fill="none"
          stroke="#F6F1E7"
          strokeWidth="58"
          strokeLinecap="round"
        />
        <circle cx="349.3" cy="162.7" r="36" fill="#E7BF62" />
      </g>
    </svg>
  )
}
