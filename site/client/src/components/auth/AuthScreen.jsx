import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import useAuthStore from '../../store/authStore';
import * as authService from '../../services/authService';

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

/** Labelled text input matching the card's border/radius tokens. */
const Field = ({ id, label, ...rest }) => (
  <label htmlFor={id} className="block">
    <span className="mb-1.5 block text-[13px] font-semibold text-[color:var(--color-text-secondary)]">
      {label}
    </span>
    <input
      id={id}
      className="h-11 w-full bg-white px-3 font-body text-[14px] text-[color:var(--color-text-primary)] outline-none transition-colors focus:border-[color:var(--color-accent)]"
      style={{
        border: '1.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
      {...rest}
    />
  </label>
);

/** Full-width accent submit button. */
const PrimaryButton = ({ children, ...rest }) => (
  <button
    className="flex h-11 w-full items-center justify-center gap-2 font-body text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    style={{
      background: 'var(--color-accent)',
      borderRadius: 'var(--radius-md)',
    }}
    {...rest}
  >
    {children}
  </button>
);

const STEP = {
  FORM: 'form',
  VERIFY: 'verify',
  FORGOT: 'forgot',
  RESET: 'reset',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shared split-screen auth shell for the login & signup pages. Offers BOTH the
 * existing Google OAuth flow AND an email+password flow with a verification-code
 * step, plus a forgot/reset-password path. `mode` ('login' | 'signup') selects
 * which credential form the FORM step renders.
 */
const AuthScreen = ({ title, subtitle, googleLabel, onGoogle, error, footer, mode = 'login' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);

  const isSignup = mode === 'signup';

  const [step, setStep] = useState(STEP.FORM);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const resetMessages = () => {
    setErr('');
    setInfo('');
  };

  // Read a human error out of an axios failure, preferring the server's message
  // and falling back to a generic i18n string (never leaks internals).
  const errorMessage = (e) =>
    e?.response?.data?.error || t('pages.authGenericError');

  // Mirror AuthCallbackPage: store the token, load the user, route onward.
  const completeLogin = async (token) => {
    login(token);
    const user = await fetchCurrentUser();
    if (!user) {
      setErr(t('pages.signInFailed'));
      return;
    }
    const savedRedirect = sessionStorage.getItem('postLoginRedirect');
    sessionStorage.removeItem('postLoginRedirect');
    if (savedRedirect) {
      navigate(savedRedirect, { replace: true });
      return;
    }
    const hasOrg = Array.isArray(user.organisations) && user.organisations.length > 0;
    navigate(hasOrg ? '/workspace' : '/onboarding', { replace: true });
  };

  const handleCredentialSubmit = async (e) => {
    e.preventDefault();
    resetMessages();
    const emailNorm = email.trim().toLowerCase();

    if (isSignup && !name.trim()) return setErr(t('pages.errNameRequired'));
    if (!EMAIL_RE.test(emailNorm)) return setErr(t('pages.errEmailInvalid'));
    if (isSignup && password.length < 8) return setErr(t('pages.errPasswordShort'));
    if (!password) return setErr(t('pages.errPasswordRequired'));

    setSubmitting(true);
    try {
      if (isSignup) {
        const data = await authService.register({
          name: name.trim(),
          email: emailNorm,
          password,
        });
        if (data?.pendingVerification) {
          setStep(STEP.VERIFY);
          setInfo(t('pages.codeSentTo', { email: emailNorm }));
        }
      } else {
        const data = await authService.loginWithPassword({ email: emailNorm, password });
        if (data?.pendingVerification) {
          setStep(STEP.VERIFY);
          setInfo(t('pages.pendingVerificationInfo'));
        } else if (data?.token) {
          await completeLogin(data.token);
        }
      }
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    resetMessages();
    if (!/^\d{6}$/.test(code.trim())) return setErr(t('pages.errCodeInvalid'));
    setSubmitting(true);
    try {
      const data = await authService.verifyEmail({
        email: email.trim().toLowerCase(),
        code: code.trim(),
      });
      if (data?.token) await completeLogin(data.token);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    resetMessages();
    setSubmitting(true);
    try {
      await authService.resendCode({ email: email.trim().toLowerCase() });
      setInfo(t('pages.resendSent'));
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    resetMessages();
    const emailNorm = email.trim().toLowerCase();
    if (!EMAIL_RE.test(emailNorm)) return setErr(t('pages.errEmailInvalid'));
    setSubmitting(true);
    try {
      await authService.forgotPassword({ email: emailNorm });
      setStep(STEP.RESET);
      setInfo(t('pages.forgotSent'));
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    resetMessages();
    if (!/^\d{6}$/.test(code.trim())) return setErr(t('pages.errCodeInvalid'));
    if (newPassword.length < 8) return setErr(t('pages.errPasswordShort'));
    setSubmitting(true);
    try {
      await authService.resetPassword({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        newPassword,
      });
      setPassword('');
      setNewPassword('');
      setCode('');
      setStep(STEP.FORM);
      setInfo(t('pages.resetSuccess'));
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSubmitting(false);
    }
  };

  const goToStep = (next) => {
    resetMessages();
    setStep(next);
  };

  // Heading copy per step (FORM uses the page-provided title/subtitle).
  const heading =
    step === STEP.VERIFY
      ? t('pages.verifyTitle')
      : step === STEP.FORGOT
        ? t('pages.forgotTitle')
        : step === STEP.RESET
          ? t('pages.resetTitle')
          : title;
  const subheading =
    step === STEP.VERIFY
      ? t('pages.verifySubtitle')
      : step === STEP.FORGOT
        ? t('pages.forgotSubtitle')
        : step === STEP.RESET
          ? t('pages.resetSubtitle')
          : subtitle;

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
              {heading}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--color-text-secondary)]">
              {subheading}
            </p>

            {/* --- FORM step: Google + email/password ------------------------ */}
            {step === STEP.FORM && (
              <>
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

                <div className="my-6 flex items-center gap-3">
                  <span className="h-px flex-1 bg-[color:var(--color-border)]" />
                  <span className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
                    {t('pages.orDivider')}
                  </span>
                  <span className="h-px flex-1 bg-[color:var(--color-border)]" />
                </div>

                <form onSubmit={handleCredentialSubmit} className="space-y-4">
                  {isSignup && (
                    <Field
                      id="auth-name"
                      label={t('pages.nameLabel')}
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('pages.namePlaceholder')}
                    />
                  )}
                  <Field
                    id="auth-email"
                    label={t('pages.emailLabel')}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('pages.emailPlaceholder')}
                  />
                  <Field
                    id="auth-password"
                    label={t('pages.passwordLabel')}
                    type="password"
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('pages.passwordPlaceholder')}
                  />
                  {isSignup && (
                    <p className="text-[12px] text-[color:var(--color-text-muted)]">
                      {t('pages.passwordMinHint')}
                    </p>
                  )}
                  <PrimaryButton type="submit" disabled={submitting}>
                    {isSignup
                      ? t('pages.createAccountButton')
                      : t('pages.signInButton')}
                  </PrimaryButton>
                </form>

                {!isSignup && (
                  <button
                    type="button"
                    onClick={() => goToStep(STEP.FORGOT)}
                    className="mt-4 block w-full text-center text-[13px] font-semibold text-[color:var(--color-accent)] hover:underline"
                  >
                    {t('pages.forgotPassword')}
                  </button>
                )}
              </>
            )}

            {/* --- VERIFY step ---------------------------------------------- */}
            {step === STEP.VERIFY && (
              <form onSubmit={handleVerify} className="mt-8 space-y-4">
                <Field
                  id="auth-code"
                  label={t('pages.codeLabel')}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('pages.codePlaceholder')}
                />
                <PrimaryButton type="submit" disabled={submitting}>
                  {t('pages.verifyButton')}
                </PrimaryButton>
                <div className="flex items-center justify-between text-[13px]">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={submitting}
                    className="font-semibold text-[color:var(--color-accent)] hover:underline disabled:opacity-60"
                  >
                    {t('pages.resendCode')}
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStep(STEP.FORM)}
                    className="font-semibold text-[color:var(--color-text-secondary)] hover:underline"
                  >
                    {t('pages.back')}
                  </button>
                </div>
              </form>
            )}

            {/* --- FORGOT step ---------------------------------------------- */}
            {step === STEP.FORGOT && (
              <form onSubmit={handleForgotSubmit} className="mt-8 space-y-4">
                <Field
                  id="auth-forgot-email"
                  label={t('pages.emailLabel')}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('pages.emailPlaceholder')}
                />
                <PrimaryButton type="submit" disabled={submitting}>
                  {t('pages.sendResetCode')}
                </PrimaryButton>
                <button
                  type="button"
                  onClick={() => goToStep(STEP.FORM)}
                  className="block w-full text-center text-[13px] font-semibold text-[color:var(--color-text-secondary)] hover:underline"
                >
                  {t('pages.backToSignIn')}
                </button>
              </form>
            )}

            {/* --- RESET step ----------------------------------------------- */}
            {step === STEP.RESET && (
              <form onSubmit={handleReset} className="mt-8 space-y-4">
                <Field
                  id="auth-reset-code"
                  label={t('pages.codeLabel')}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('pages.codePlaceholder')}
                />
                <Field
                  id="auth-new-password"
                  label={t('pages.newPasswordLabel')}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('pages.passwordPlaceholder')}
                />
                <p className="text-[12px] text-[color:var(--color-text-muted)]">
                  {t('pages.passwordMinHint')}
                </p>
                <PrimaryButton type="submit" disabled={submitting}>
                  {t('pages.resetButton')}
                </PrimaryButton>
                <button
                  type="button"
                  onClick={() => goToStep(STEP.FORM)}
                  className="block w-full text-center text-[13px] font-semibold text-[color:var(--color-text-secondary)] hover:underline"
                >
                  {t('pages.backToSignIn')}
                </button>
              </form>
            )}

            {/* Inline info / error messaging (shared across steps) */}
            {info && (
              <p className="mt-4 text-center text-xs text-[color:var(--color-text-secondary)]">
                {info}
              </p>
            )}
            {(err || (error && step === STEP.FORM)) && (
              <p className="mt-3 text-center text-xs text-[color:var(--color-status-stuck)]">
                {err || t('pages.signInFailed')}
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
