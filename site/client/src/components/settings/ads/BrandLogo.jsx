import { useId } from 'react';

/**
 * BrandLogo — inline SVG brand marks for the Ads & tracking hub.
 *
 * `name`: meta | facebook | instagram | google-g | google-ads | gtm | tiktok |
 *         wordpress | wix | squarespace | webflow | shopify | linkedin |
 *         microsoft | leadloop
 * `size`: height in px (width follows the mark's aspect ratio)
 * `title`: accessible name. Omit for decorative use (aria-hidden).
 *
 * Gradient / clip ids are made unique per instance so several logos can live
 * on one page without colliding.
 */

const ASPECT = {
  meta: 120 / 80,
  'google-ads': 200 / 180,
  wix: 2,
};

const Mark = ({ name, uid }) => {
  switch (name) {
    case 'meta':
      return (
        <>
          <defs>
            <linearGradient id={`${uid}m`} x1="0" y1="0" x2="1" y2="0.3">
              <stop offset="0" stopColor="#0064E1" />
              <stop offset="0.5" stopColor="#0073EE" />
              <stop offset="1" stopColor="#0082FB" />
            </linearGradient>
          </defs>
          <path
            d="M14 52c0-17 8-34 20-34 9 0 15 7 26 24 11 17 17 26 26 26 10 0 20-12 20-32 0-12-5-18-12-18-10 0-17 13-34 38-9 13-14 12-20 12-9 0-26-2-26-16z"
            fill="none"
            stroke={`url(#${uid}m)`}
            strokeWidth="11"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      );
    case 'facebook':
      return (
        <>
          <defs>
            <clipPath id={`${uid}c`}>
              <circle cx="12" cy="12" r="12" />
            </clipPath>
          </defs>
          <circle cx="12" cy="12" r="12" fill="#0866FF" />
          <path
            clipPath={`url(#${uid}c)`}
            fill="#fff"
            d="M16.7 15.5l.53-3.47h-3.33V9.78c0-.95.47-1.87 1.96-1.87h1.51V4.95s-1.37-.23-2.68-.23c-2.74 0-4.53 1.66-4.53 4.66v2.65H7.12v3.47h3.04V25h3.74v-9.5z"
          />
        </>
      );
    case 'instagram':
      return (
        <>
          <defs>
            <radialGradient id={`${uid}i`} cx="0.3" cy="1.07" r="1.2">
              <stop offset="0" stopColor="#FFDD55" />
              <stop offset="0.1" stopColor="#FFDD55" />
              <stop offset="0.5" stopColor="#FF543E" />
              <stop offset="1" stopColor="#C837AB" />
            </radialGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill={`url(#${uid}i)`} />
          <rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="16.4" cy="7.6" r="1.05" fill="#fff" />
        </>
      );
    case 'google-g':
      return (
        <>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </>
      );
    case 'google-ads':
      return (
        <>
          <line x1="100" y1="34" x2="46" y2="134" stroke="#FBBC04" strokeWidth="52" strokeLinecap="round" />
          <line x1="100" y1="34" x2="154" y2="134" stroke="#4285F4" strokeWidth="52" strokeLinecap="round" />
          <circle cx="46" cy="142" r="28" fill="#34A853" />
        </>
      );
    case 'gtm':
      return (
        <>
          <path fill="#8AB4F8" d="M27.6 44.6l-7.3-7.1 15.7-16 7.6 7.4z" />
          <path fill="#4285F4" d="M27.7 11.4L20.6 4 3.4 21.2c-2.2 2.2-2.2 5.8 0 8.1l17.1 17.2 7-7.4-13.2-13.4z" />
          <path fill="#8AB4F8" d="M44.6 20.4L27.6 3.4c-2.2-2.2-5.9-2.2-8.1 0-2.2 2.2-2.2 5.9 0 8.1l17 17c2.2 2.2 5.9 2.2 8.1 0 2.2-2.2 2.2-5.9 0-8.1z" />
          <circle fill="#246FDB" cx="24.1" cy="40.6" r="5.6" />
        </>
      );
    case 'tiktok':
      return (
        <>
          <rect width="24" height="24" rx="5.5" fill="#000" />
          <path fill="#25F4EE" d="M10.3 10.6v-.8a6 6 0 0 0-.8 0 4.6 4.6 0 0 0-2.6 8.4 4.6 4.6 0 0 1 3.4-7.6z" />
          <path fill="#FE2C55" d="M16.4 8.5a3.4 3.4 0 0 1-1.5-2.3h-1v9.7a2.4 2.4 0 0 1-3.6 2 2.4 2.4 0 0 0 4.4-1.4V6.8h1.4a3.4 3.4 0 0 0 1.8 2.6z" />
          <path fill="#fff" d="M17.3 9a3.4 3.4 0 0 1-2.4-2.8h-1.3v9.4a2.4 2.4 0 1 1-2.4-2.5c.3 0 .5 0 .7.1v-2.5a5 5 0 0 0-.7 0 4.9 4.9 0 1 0 4.9 4.9v-4.8a6 6 0 0 0 3.4 1.1V9.6a3.5 3.5 0 0 1-2.2-.6z" />
        </>
      );
    case 'wordpress':
      return (
        <>
          <circle cx="12" cy="12" r="12" fill="#21759B" />
          <circle cx="12" cy="12" r="9.6" fill="none" stroke="#fff" strokeWidth="1" />
          <path fill="#fff" d="M5.4 8.6h3.1l-.4.5 2.3 6.7 1.3-3.9-.9-2.6-.6-.2-.1-.5h3.1l-.1.5-.6.1 2.3 6.7 1.3-4.2c.4-1.4-.1-2.2-.8-2.6l.1-.5h2.3l-.1.5-.5.1-2.8 8.4h-.6l-2-6-2 6H8.7L5.9 9.2l-.6-.1z" />
        </>
      );
    case 'wix':
      return (
        <>
          <rect width="48" height="24" rx="5" fill="#0C6EFC" />
          <text x="24" y="16.8" textAnchor="middle" fontFamily="Arial Black,Arial,sans-serif" fontWeight="900" fontSize="13" fill="#fff">
            WiX
          </text>
        </>
      );
    case 'squarespace':
      return (
        <>
          <rect width="24" height="24" rx="5.5" fill="#111" />
          <g fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
            <path d="M6.2 13.6l5.2-5.2c1.2-1.2 3-1.2 4.2 0" />
            <path d="M8.4 15.8l6.3-6.3" />
            <path d="M17.8 10.4l-5.2 5.2c-1.2 1.2-3 1.2-4.2 0" />
            <path d="M15.6 8.2l-6.3 6.3" />
          </g>
        </>
      );
    case 'webflow':
      return (
        <>
          <rect width="24" height="24" rx="5.5" fill="#146EF5" />
          <path fill="#fff" d="M19.8 7.2l-2.9 9.6h-2.6l-1.3-4.7-1.4 4.7H9l-3-9.6h2.7l1.6 6 1.5-4.9h2.3l1.4 4.9 1.6-6z" />
        </>
      );
    case 'shopify':
      return (
        <>
          <path fill="#95BF47" d="M18.6 5.6c0-.1-.1-.2-.2-.2l-1.9-.1-1.4-1.4c-.1-.1-.4-.1-.5 0l-.7.2C13.5 3 12.9 2.2 11.7 2.2c-1.6 0-2.4 2-2.7 3.1l-1.5.5c-.5.1-.5.2-.5.6L5.6 18.9l9.6 1.8 5.2-1.1z" />
          <path fill="#5E8E3E" d="M18.4 5.4l-1.9-.1-1.4-1.4-.1 16.8 5.2-1.1-1.6-14c0-.1-.1-.2-.2-.2z" />
          <path fill="#fff" d="M12.9 8.6l-.6 1.9s-.7-.3-1.5-.3c-1.2 0-1.2.7-1.2.9 0 1 2.7 1.4 2.7 3.8 0 1.9-1.2 3.1-2.8 3.1-1.9 0-2.9-1.2-2.9-1.2l.5-1.7s1 .9 1.9.9c.5 0 .8-.4.8-.8 0-1.3-2.2-1.4-2.2-3.6 0-1.8 1.3-3.6 4-3.6 1 0 1.5.3 1.5.3z" />
        </>
      );
    case 'linkedin':
      return (
        <>
          <rect width="24" height="24" rx="4" fill="#0A66C2" />
          <path fill="#fff" d="M5.3 9.3h2.9v9.4H5.3zM6.8 4.6a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM10.1 9.3h2.8v1.3c.4-.7 1.3-1.5 2.8-1.5 3 0 3.5 2 3.5 4.5v5.1h-2.9v-4.5c0-1.1 0-2.5-1.5-2.5s-1.8 1.2-1.8 2.4v4.6h-2.9z" />
        </>
      );
    case 'microsoft':
      return (
        <>
          <path fill="#F35325" d="M1 1h10v10H1z" />
          <path fill="#81BC06" d="M12 1h10v10H12z" />
          <path fill="#05A6F0" d="M1 12h10v10H1z" />
          <path fill="#FFBA08" d="M12 12h10v10H12z" />
        </>
      );
    default:
      return null;
  }
};

const VIEWBOX = {
  meta: '0 0 120 80',
  'google-g': '0 0 48 48',
  'google-ads': '0 0 200 180',
  gtm: '0 0 48 48',
  wix: '0 0 48 24',
  microsoft: '0 0 23 23',
};

const BRAND_NAMES = [
  'meta', 'facebook', 'instagram', 'google-g', 'google-ads', 'gtm', 'tiktok', 'wordpress',
  'wix', 'squarespace', 'webflow', 'shopify', 'linkedin', 'microsoft', 'leadloop',
];

const BrandLogo = ({ name, size = 24, title, className = '', style }) => {
  const rawId = useId();
  const uid = `bl${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const height = size;
  const width = Math.round(size * (ASPECT[name] || 1));
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  if (name === 'leadloop') {
    return (
      <img
        src="/app-icon.svg"
        alt={title || ''}
        width={size}
        height={size}
        className={className}
        style={{ borderRadius: Math.round(size * 0.24), flexShrink: 0, ...style }}
        {...(title ? {} : { 'aria-hidden': true })}
      />
    );
  }
  if (!BRAND_NAMES.includes(name)) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEWBOX[name] || '0 0 24 24'}
      width={width}
      height={height}
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      focusable="false"
      {...a11y}
    >
      <Mark name={name} uid={uid} />
    </svg>
  );
};

export default BrandLogo;
