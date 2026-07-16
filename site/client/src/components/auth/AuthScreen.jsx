import { useTranslation } from 'react-i18next';

/** Google "G" mark for the OAuth button. */
const GoogleIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
    />
  </svg>
);

/** LeadLoop wordmark + logo tile — reused on the card and the brand panel. */
const Wordmark = ({ light = false }) => (
  <div className="flex items-center gap-2.5">
    <div
      className="flex h-9 w-9 items-center justify-center"
      style={{
        borderRadius: 'var(--radius-md)',
        background: light ? 'rgba(255,255,255,0.16)' : 'var(--color-accent)',
      }}
    >
      {/* Looping arrows — the "loop" in LeadLoop */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d="M17 3v4h-4M7 21v-4h4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
    <span
      className="font-display text-[19px] font-extrabold tracking-tight"
      style={{ color: light ? '#fff' : 'var(--color-text-primary)' }}
    >
      LeadLoop
    </span>
  </div>
);

/**
 * Shared split-screen auth shell for the login & signup pages. The left brand
 * panel is decorative (accent gradient, hidden on small screens); the right
 * side hosts the card. Auth itself is Google OAuth only — both pages funnel to
 * the same backend flow, so this component just varies the framing copy.
 */
const AuthScreen = ({ title, subtitle, googleLabel, onGoogle, error, footer }) => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen w-full flex bg-base">
      {/* Brand panel — decorative, desktop only */}
      <aside
        className="relative hidden w-[46%] max-w-[560px] flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{
          background:
            'linear-gradient(150deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)',
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />
        <div className="relative">
          <Wordmark light />
        </div>
        <div className="relative">
          <h2 className="font-display text-[30px] font-extrabold leading-[1.1] tracking-tight text-white">
            {t('pages.authBrandHeading')}
          </h2>
          <p className="mt-3 max-w-[380px] text-[15px] leading-relaxed text-white/80">
            {t('pages.authBrandSub')}
          </p>
        </div>
        <p className="relative font-body text-[12px] uppercase tracking-[0.14em] text-white/60">
          {t('pages.loginTagline')}
        </p>
      </aside>

      {/* Form side */}
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          {/* Wordmark shown here on mobile (brand panel is hidden) */}
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>

          <div
            className="bg-surface p-8 sm:p-10"
            style={{
              borderRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <h1 className="font-display text-[24px] font-extrabold tracking-tight text-[color:var(--color-text-primary)]">
              {title}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--color-text-secondary)]">
              {subtitle}
            </p>

            <button
              type="button"
              onClick={onGoogle}
              className="mt-8 flex h-11 w-full items-center justify-center gap-3 bg-white font-body text-[14px] font-semibold text-[color:var(--color-text-primary)] transition-colors hover:bg-[color:var(--color-bg-subtle)]"
              style={{
                border: '1.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <GoogleIcon />
              {googleLabel}
            </button>

            {error && (
              <p className="mt-3 text-center text-xs text-[color:var(--color-status-stuck)]">
                {t('pages.signInFailed')}
              </p>
            )}

            <p className="mt-5 text-center text-[11px] leading-relaxed text-[color:var(--color-text-muted)]">
              {t('pages.usageTerms')}
            </p>
          </div>

          <div className="mt-6 text-center text-[13px] text-[color:var(--color-text-secondary)]">
            {footer}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AuthScreen;
