import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Lock, X, AlertTriangle, Info } from 'lucide-react';
import Modal from '../../ui/Modal';
import Spinner from '../../ui/Spinner';
import BrandLogo from './BrandLogo';
import { copyText } from './adsHelpers';
import useToastStore from '../../../store/toastStore';

/**
 * Shared building blocks for the Ads & tracking hub and its dialogs. Colours
 * come from the app tokens (globals.css); the few literal values are the
 * approved design's hairlines / tints that have no token.
 */

export const LINE = '#EFE8DA';
export const MUTED = '#6F675B';

const BRAND_TINT = {
  meta: '#F1F6FF',
  facebook: '#F1F6FF',
  'google-ads': '#F4F7FE',
  'google-g': '#F4F7FE',
  tiktok: '#F2F2F2',
};

/* ------------------------------ Pill ------------------------------ */

const PILL_TONES = {
  ok: { color: 'var(--color-status-done)', bg: 'var(--color-status-done-bg)', dot: 'var(--color-status-done-solid)' },
  warn: { color: 'var(--color-status-working)', bg: 'var(--color-status-working-bg)', dot: 'var(--color-status-working-solid)' },
  error: { color: 'var(--color-status-stuck)', bg: 'var(--color-status-stuck-bg)', dot: 'var(--color-status-stuck-solid)' },
  neutral: { color: 'var(--color-status-notstarted)', bg: 'var(--color-status-notstarted-bg)', dot: 'var(--color-status-notstarted-solid)' },
};

export const Pill = ({ tone = 'neutral', dot = false, children, small = false }) => {
  const s = PILL_TONES[tone] || PILL_TONES.neutral;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-body font-bold whitespace-nowrap"
      style={{ fontSize: small ? 11 : 12, color: s.color, background: s.bg, padding: small ? '3px 8px' : '4px 10px', borderRadius: 999 }}
    >
      {dot && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: s.dot }} />}
      {children}
    </span>
  );
};

/* --------------------------- Small icons --------------------------- */

export const Tick = ({ color = 'var(--color-accent)', size = 16 }) => (
  <Check size={size} strokeWidth={2.8} color={color} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
);

export const LockNote = ({ children }) => (
  <span className="inline-flex items-center gap-1.5 font-body" style={{ fontSize: 12.5, color: MUTED }}>
    <Lock size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
    {children}
  </span>
);

/* ------------------------------ Rich text ------------------------------ */

/**
 * Renders translator-controlled step text with two tiny markers, never HTML:
 * `[[Settings]]` → a UI-label chip, `**All pages**` → bold.
 */
export const RichText = ({ text }) => {
  const parts = String(text || '').split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('[[') && p.endsWith(']]')) {
          return (
            <span key={i} style={{ background: 'var(--color-bg-subtle)', padding: '1px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>
              {p.slice(2, -2)}
            </span>
          );
        }
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
};

/* ------------------------------ Dialog shell ------------------------------ */

/**
 * The approved dialog layout: logo pair + title header, optional stepper,
 * scrolling body and a footer bar. Built on ui/Modal (focus trap, ESC,
 * overlay click, scroll lock, focus restore).
 */
export const DialogShell = ({
  title,
  subtitle,
  logo,
  steps,
  current = 0,
  onClose,
  footer,
  children,
  maxWidth = 760,
  header,
  bare = false,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Modal isOpen onClose={onClose} unstyled maxWidth={maxWidth} ariaLabel={title} closeOnOverlayClick={false}>
      <div className="flex flex-col min-h-0 font-body" style={{ color: 'var(--color-text-primary)', fontSize: 14, maxHeight: 'calc(100vh - 2rem)' }}>
        {header || (
          <div className="flex items-center gap-3 sm:gap-4 px-5 sm:px-7 shrink-0" style={{ paddingTop: 20, paddingBottom: 16, borderBottom: `1px solid ${LINE}` }}>
            {logo && (
              <div className="hidden sm:flex items-center shrink-0">
                <div className="flex items-center justify-center" style={{ width: 42, height: 42, borderRadius: 12, background: BRAND_TINT[logo] || '#F2F2F2' }}>
                  <BrandLogo name={logo} size={logo === 'tiktok' ? 42 : logo === 'meta' ? 19 : 24} style={logo === 'tiktok' ? { borderRadius: 12 } : undefined} />
                </div>
                <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true">
                  <path d="M3 7h22" stroke="var(--color-border-strong)" strokeWidth="2" strokeDasharray="3 3" />
                </svg>
                <BrandLogo name="leadloop" size={42} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 id={titleId} className="font-display font-bold" style={{ fontSize: 20, margin: 0 }}>{title}</h2>
              {subtitle && <p style={{ margin: '2px 0 0', fontSize: 13, color: MUTED }}>{subtitle}</p>}
            </div>
            <CloseButton onClose={onClose} label={t('adsHub.common.close')} />
          </div>
        )}
        {Array.isArray(steps) && steps.length > 0 && <Stepper steps={steps} current={current} />}
        {bare ? (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">{children}</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-5 flex flex-col gap-[18px]">{children}</div>
        )}
        {footer && (
          <div className="flex flex-wrap items-center gap-3 px-5 sm:px-7 shrink-0" style={{ paddingTop: 14, paddingBottom: 14, borderTop: `1px solid ${LINE}` }}>
            {footer}
          </div>
        )}
      </div>
    </Modal>
  );
};

export const CloseButton = ({ onClose, label, dark = false }) => (
  <button
    type="button"
    onClick={onClose}
    aria-label={label}
    className="inline-flex items-center justify-center shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
    style={{
      width: 36,
      height: 36,
      borderRadius: 10,
      border: dark ? '1px solid rgba(237,232,218,.25)' : 'none',
      background: dark ? 'transparent' : 'var(--color-bg-base)',
      color: dark ? 'var(--color-pine-text)' : 'var(--color-text-secondary)',
      cursor: 'pointer',
    }}
  >
    <X size={16} strokeWidth={2.4} aria-hidden="true" />
  </button>
);

export const Stepper = ({ steps, current }) => {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t('adsHub.common.progress')}
      className="flex items-center gap-2 sm:gap-2.5 px-5 sm:px-7 shrink-0 m-0 list-none"
      style={{ paddingTop: 14, paddingBottom: 14, background: 'var(--color-bg-input)', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className={`flex items-center gap-2 sm:gap-2.5 min-w-0 ${i > 0 ? 'flex-1' : ''}`}>
            {i > 0 && (
              <span aria-hidden="true" className="flex-1" style={{ height: 2, minWidth: 10, borderRadius: 2, background: done || active ? 'var(--color-accent)' : 'var(--color-border)' }} />
            )}
            <span
              aria-current={active ? 'step' : undefined}
              className="flex items-center gap-2 whitespace-nowrap"
              style={{ color: done ? 'var(--color-status-done)' : active ? 'var(--color-text-primary)' : MUTED, fontWeight: active ? 700 : done ? 600 : 400 }}
            >
              <span
                className="inline-flex items-center justify-center shrink-0"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  fontSize: 12,
                  boxSizing: 'border-box',
                  background: done ? 'var(--color-accent)' : active ? 'var(--color-text-primary)' : 'transparent',
                  color: done || active ? '#fff' : MUTED,
                  border: done || active ? 'none' : '2px solid var(--color-border-strong)',
                }}
              >
                {done ? <Check size={12} strokeWidth={3.5} aria-hidden="true" /> : i + 1}
              </span>
              <span className={active ? '' : 'sr-only sm:not-sr-only'}>
                {label}
                {done && <span className="sr-only"> ({t('adsHub.common.done')})</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
};

/* ------------------------------ Buttons ------------------------------ */

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]';

export const PrimaryButton = ({ children, loading, disabled, onClick, type = 'button', ...rest }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={`inline-flex items-center justify-center gap-2 font-body font-bold whitespace-nowrap transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed ${focusRing}`}
    style={{ height: 44, padding: '0 22px', borderRadius: 12, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-accent)' }}
    {...rest}
  >
    {loading && <Spinner size="sm" color="#fff" />}
    {children}
  </button>
);

export const SecondaryButton = ({ children, loading, disabled, onClick, size = 'lg', type = 'button', ...rest }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={`inline-flex items-center justify-center gap-2 font-body font-semibold whitespace-nowrap transition-colors hover:bg-[color:var(--color-bg-subtle)] disabled:opacity-60 disabled:cursor-not-allowed ${focusRing}`}
    style={{
      height: size === 'sm' ? 36 : 44,
      padding: size === 'sm' ? '0 14px' : '0 18px',
      borderRadius: size === 'sm' ? 10 : 12,
      border: '1px solid var(--color-border-strong)',
      background: '#fff',
      color: 'var(--color-text-primary)',
      fontSize: size === 'sm' ? 13 : 14,
      cursor: 'pointer',
    }}
    {...rest}
  >
    {loading && <Spinner size="sm" />}
    {children}
  </button>
);

export const LinkButton = ({ children, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`font-body font-semibold underline-offset-2 hover:underline disabled:opacity-60 ${focusRing}`}
    style={{ fontSize: 12.5, color: 'var(--color-accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4 }}
  >
    {children}
  </button>
);

/** Official-style sign-in buttons (Google / Facebook / TikTok). */
export const SignInButton = ({ platform, onClick, loading, disabled }) => {
  const { t } = useTranslation();
  const common = `inline-flex items-center gap-2.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed ${focusRing}`;
  if (platform === 'google') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${common} hover:bg-[#F8F9FA]`}
        style={{ height: 44, padding: '0 18px 0 14px', borderRadius: 999, border: '1px solid #747775', background: '#fff', color: '#1F1F1F', fontFamily: 'Roboto, Arial, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
      >
        {loading ? <Spinner size={18} /> : <BrandLogo name="google-g" size={18} />}
        {t('adsHub.signIn.google')}
      </button>
    );
  }
  if (platform === 'meta') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${common} hover:brightness-95`}
        style={{ height: 44, padding: '0 18px 0 12px', borderRadius: 999, border: 'none', background: '#0866FF', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
      >
        {loading ? (
          <Spinner size={22} color="#fff" />
        ) : (
          <span className="inline-flex items-center justify-center" style={{ width: 24, height: 24, borderRadius: 999, background: '#fff' }}>
            <BrandLogo name="facebook" size={22} />
          </span>
        )}
        {t('adsHub.signIn.meta')}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${common} hover:bg-[#1a1a1a]`}
      style={{ height: 44, padding: '0 18px 0 8px', borderRadius: 999, border: 'none', background: '#000', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
    >
      {loading ? <Spinner size={28} color="#fff" /> : <BrandLogo name="tiktok" size={28} style={{ borderRadius: 999 }} />}
      {t('adsHub.signIn.tiktok')}
    </button>
  );
};

/* ------------------------------ Form fields ------------------------------ */

const fieldStyle = {
  height: 46,
  padding: '0 14px',
  borderRadius: 12,
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-bg-input)',
  fontSize: 14,
  color: 'var(--color-text-primary)',
  width: '100%',
  minWidth: 0,
};
const fieldClass =
  'font-body focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_rgba(62,107,78,0.15)] disabled:opacity-60';

export const SelectField = ({ label, value, onChange, options, hint, disabled, placeholder }) => {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-[7px] min-w-0">
      <label htmlFor={id} className="font-bold" style={{ fontSize: 13.5 }}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className={fieldClass}
        style={fieldStyle}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <span id={hintId} style={{ fontSize: 12.5, color: MUTED }}>{hint}</span>}
    </div>
  );
};

export const TextField = ({ label, value, onChange, hint, error, type = 'text', placeholder, autoComplete, inputRef, srOnlyLabel = false, ...rest }) => {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-[7px] min-w-0 flex-1">
      <label htmlFor={id} className={srOnlyLabel ? 'sr-only' : 'font-bold'} style={{ fontSize: 13.5 }}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? hintId : undefined}
        className={fieldClass}
        style={{ ...fieldStyle, borderColor: error ? 'var(--color-status-stuck)' : fieldStyle.borderColor }}
        {...rest}
      />
      {(error || hint) && (
        <span id={hintId} style={{ fontSize: 12.5, color: error ? 'var(--color-status-stuck)' : MUTED }}>{error || hint}</span>
      )}
    </div>
  );
};

/** Selectable card wrapping a native radio (keyboard: arrow keys within the group). */
export const RadioCard = ({ name, value, checked, onChange, disabled, children, badge, indent = 0, flat = false }) => (
  <label
    className="flex items-center gap-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--color-accent)]"
    style={{
      padding: '12px 14px',
      paddingLeft: 14 + indent,
      borderRadius: flat ? 0 : 12,
      border: flat ? 'none' : checked ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
      borderBottom: flat ? `1px solid ${LINE}` : undefined,
      background: checked ? '#F4F8F2' : '#fff',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled && !flat ? 0.6 : 1,
    }}
  >
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      disabled={disabled}
      onChange={() => onChange(value)}
      style={{ width: 18, height: 18, accentColor: 'var(--color-accent)', margin: 0, flexShrink: 0, visibility: disabled && flat ? 'hidden' : 'visible' }}
    />
    <span className="flex-1 min-w-0">{children}</span>
    {badge}
  </label>
);

export const CheckCard = ({ checked, onChange, children, disabled }) => (
  <label
    className="flex items-center gap-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--color-accent)]"
    style={{ padding: '13px 14px', borderRadius: 12, border: checked ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', background: checked ? '#F4F8F2' : '#fff', cursor: disabled ? 'not-allowed' : 'pointer' }}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: 'var(--color-accent)', margin: 0, flexShrink: 0 }}
    />
    <span className="flex-1 min-w-0">{children}</span>
  </label>
);

/** Toggle switch: a native checkbox with role="switch". */
export const Switch = ({ checked, onChange, label, disabled }) => (
  <label className="relative inline-flex items-center shrink-0" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className="inline-flex items-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--color-accent)] transition-colors"
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        padding: 3,
        boxSizing: 'border-box',
        background: checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ width: 20, height: 20, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </span>
  </label>
);

/* ------------------------------ Copy field ------------------------------ */

export const CopyField = ({ value, label, wrap = false }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onCopy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } else {
      useToastStore.getState().error(t('adsHub.common.copyFailed'));
    }
  };
  return (
    <div className="flex items-center gap-2.5" style={{ borderRadius: 12, background: 'var(--color-pine)', padding: '10px 10px 10px 14px' }}>
      <code
        title={value}
        className="flex-1 min-w-0"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--color-pine-text)',
          whiteSpace: wrap ? 'normal' : 'nowrap',
          wordBreak: wrap ? 'break-all' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label && <span className="sr-only">{label}: </span>}
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        disabled={!value}
        className="inline-flex items-center gap-1.5 shrink-0 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-pine-gold)]"
        style={{ height: 34, padding: '0 12px', borderRadius: 9, border: 'none', background: 'var(--color-pine-gold)', color: 'var(--color-pine)', fontSize: 12.5, cursor: 'pointer' }}
      >
        {copied ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : <Copy size={13} strokeWidth={2.4} aria-hidden="true" />}
        {copied ? t('adsHub.common.copied') : t('adsHub.common.copy')}
        <span className="sr-only" aria-live="polite">{copied ? t('adsHub.common.copiedSr') : ''}</span>
      </button>
    </div>
  );
};

/* ------------------------------ Notices ------------------------------ */

export const Notice = ({ tone = 'error', children, action }) => {
  const s = {
    error: { bg: 'var(--color-status-stuck-bg)', color: 'var(--color-status-stuck)', Icon: AlertTriangle },
    warn: { bg: 'var(--color-status-working-bg)', color: 'var(--color-status-working)', Icon: AlertTriangle },
    info: { bg: 'var(--color-accent-light)', color: 'var(--color-accent-text)', Icon: Info },
    ok: { bg: 'var(--color-status-done-bg)', color: 'var(--color-status-done)', Icon: Check },
  }[tone];
  const Icon = s.Icon;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-2.5 flex-wrap"
      style={{ padding: '10px 12px', borderRadius: 12, background: s.bg, color: s.color, fontSize: 13 }}
    >
      <Icon size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span className="flex-1 min-w-[180px]" style={{ color: 'var(--color-text-primary)' }}>{children}</span>
      {action}
    </div>
  );
};

/** "Signed in as …" bar at the top of a choose-accounts step. */
export const SignedInBar = ({ logo, children, action }) => (
  <div className="flex items-center gap-2.5 flex-wrap" style={{ padding: '10px 12px', borderRadius: 12, background: BRAND_TINT[logo] || '#F2F2F2', fontSize: 13 }}>
    <BrandLogo name={logo} size={logo === 'google-g' ? 18 : 22} style={logo === 'tiktok' ? { borderRadius: 6 } : undefined} />
    <span className="flex-1 min-w-0">{children}</span>
    {action}
  </div>
);

/** Pine "What LeadLoop will set up for you" panel. */
export const SetupPanel = ({ title, items }) => (
  <div className="flex flex-col gap-2.5" style={{ borderRadius: 14, background: 'var(--color-pine)', color: 'var(--color-pine-text)', padding: '16px 18px' }}>
    <div className="font-display font-bold" style={{ fontSize: 15 }}>{title}</div>
    <ul className="grid grid-cols-1 sm:grid-cols-2 m-0 p-0 list-none" style={{ gap: '8px 16px', fontSize: 13 }}>
      {items.map((it) => (
        <li key={it} className="flex gap-2">
          <Tick color="var(--color-pine-gold)" size={15} />
          {it}
        </li>
      ))}
    </ul>
  </div>
);

export const LoadingBlock = ({ label }) => (
  <div className="flex items-center justify-center gap-3" style={{ padding: '36px 0', color: MUTED, fontSize: 13 }}>
    <Spinner label={label} />
    <span aria-hidden="true">{label}</span>
  </div>
);

/** Section label used inside dialogs. */
export const FieldLabel = ({ id, children }) => (
  <span id={id} className="font-bold" style={{ fontSize: 13.5 }}>{children}</span>
);
