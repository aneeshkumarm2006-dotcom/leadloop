import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import useAuthStore from '../../store/authStore';

/**
 * ProductTour — a first-login spotlight walkthrough.
 *
 * Steps target elements by a `data-tour="<id>"` attribute (added to the sidebar
 * nav, search, and account menu). A step with `target: null` renders a centered
 * card (welcome / finish). Missing targets (e.g. non-admin, or mobile where the
 * sidebar is hidden) are skipped gracefully.
 *
 * Shown once per user — a localStorage flag keyed by user id gates it, so it
 * never nags on return visits. Mounted once inside PageWrapper.
 */

const TOUR_VERSION = 'v1';
const seenKey = (userId) => `leadloop:tour:${TOUR_VERSION}:${userId || 'anon'}`;
export const hasSeenTour = (userId) => {
  try { return !!localStorage.getItem(seenKey(userId)); } catch { return true; }
};
export const markTourSeen = (userId) => {
  try { localStorage.setItem(seenKey(userId), '1'); } catch { /* ignore */ }
};

const PAD = 8; // spotlight padding around the target
const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ProductTour = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null); // target rect or null (centered)

  // Steps — copy is real onboarding guidance for a leasing CRM.
  const steps = [
    { target: null, title: t('tour.welcomeTitle', 'Welcome to LeadLoop'), body: t('tour.welcomeBody', 'Let’s take 30 seconds to show you around your new leasing workspace.') },
    { target: 'workspace', placement: 'right', title: t('tour.workspaceTitle', 'Your workspace'), body: t('tour.workspaceBody', 'This is your team’s workspace. Switch teams or create a new one from here.') },
    { target: 'workspace-home', placement: 'right', title: t('tour.homeTitle', 'Home base'), body: t('tour.homeBody', 'Your day at a glance — hot leads, today’s tours, and follow-ups that need you.') },
    { target: 'my-leads', placement: 'right', title: t('tour.leadsTitle', 'My Leads'), body: t('tour.leadsBody', 'Every lead assigned to you, across all your boards, in one list.') },
    { target: 'automations', placement: 'right', title: t('tour.autoTitle', 'Never let a lead go cold'), body: t('tour.autoBody', 'Automate follow-ups by email, SMS and WhatsApp — they fire the moment a lead stalls.') },
    { target: 'booking', placement: 'right', title: t('tour.bookingTitle', 'Tours that book themselves'), body: t('tour.bookingBody', 'Share a link and let clients pick a time — visits land straight on your calendar.') },
    { target: 'search', placement: 'bottom', title: t('tour.searchTitle', 'Find anything fast'), body: t('tour.searchBody', 'Jump to any lead or board in a keystroke.') },
    { target: null, title: t('tour.doneTitle', 'You’re all set'), body: t('tour.doneBody', 'Create your first board — pick the Real-estate CRM template and your pipeline is ready in one click.'), cta: t('tour.doneCta', 'Create your first board') },
  ];

  // Resolve the visible step index, skipping steps whose target is missing.
  const resolveFrom = useCallback((from, dir) => {
    let idx = from;
    while (idx > 0 && idx < steps.length - 1) {
      const s = steps[idx];
      if (!s.target || document.querySelector(`[data-tour="${s.target}"]`)) break;
      idx += dir; // skip missing-target step in the travel direction
    }
    return Math.max(0, Math.min(steps.length - 1, idx));
  }, [steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kick off once, shortly after mount, for a first-time user.
  useEffect(() => {
    if (!user?._id || hasSeenTour(user._id)) return undefined;
    const timer = setTimeout(() => { setI(0); setActive(true); }, 700);
    return () => clearTimeout(timer);
  }, [user?._id]);

  // Measure the current target (and keep it in sync on scroll/resize).
  useLayoutEffect(() => {
    if (!active) return undefined;
    const step = steps[i];
    if (!step || !step.target) { setRect(null); return undefined; }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); return undefined; }
    try { el.scrollIntoView({ block: 'nearest', behavior: prefersReduced() ? 'auto' : 'smooth' }); } catch { /* ignore */ }
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [active, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback((goCreate = false) => {
    if (user?._id) markTourSeen(user._id);
    setActive(false);
    // `?new=1` tells MyBoardsPage to auto-open the template gallery, so the
    // tour drops straight into "pick the Real-estate CRM template".
    if (goCreate) navigate('/boards?new=1');
  }, [user?._id, navigate]);

  const go = useCallback((dir) => {
    setI((cur) => {
      const next = cur + dir;
      if (next < 0) return 0;
      if (next > steps.length - 1) { finish(); return cur; }
      return resolveFrom(next, dir >= 0 ? 1 : -1);
    });
  }, [steps.length, resolveFrom, finish]);

  // Keyboard: Esc skips, arrows navigate.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, go, finish]);

  if (!active) return null;
  const step = steps[i];
  const isLast = i === steps.length - 1;

  // Tooltip position: beside the target (clamped), or centered when no target.
  const CARD_W = 320;
  let cardStyle;
  if (rect) {
    const place = step.placement || 'right';
    let top;
    let left;
    if (place === 'bottom') {
      top = rect.bottom + 12;
      left = Math.min(Math.max(rect.left, 12), window.innerWidth - CARD_W - 12);
    } else {
      left = rect.right + 14;
      if (left + CARD_W > window.innerWidth - 12) left = Math.max(12, rect.left - CARD_W - 14);
      top = Math.min(Math.max(rect.top, 12), window.innerHeight - 220);
    }
    cardStyle = { position: 'fixed', top, left, width: CARD_W, zIndex: 100002 };
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 380, zIndex: 100002 };
  }

  return createPortal(
    <div className="lt-tour" role="dialog" aria-modal="true" aria-label={step.title}>
      {rect ? (
        <div
          className="lt-spot"
          style={{
            position: 'fixed',
            top: rect.top - PAD, left: rect.left - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            borderRadius: 12, zIndex: 100000, pointerEvents: 'none',
            boxShadow: '0 0 0 9999px rgba(20,19,15,.58), 0 0 0 2px var(--color-accent)',
            transition: prefersReduced() ? 'none' : 'top .25s ease, left .25s ease, width .25s ease, height .25s ease',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(20,19,15,.58)', pointerEvents: 'none' }} />
      )}

      {/* click-catcher blocks the app while the tour is up (skip via buttons/Esc) */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 100001 }} onMouseDown={(e) => e.preventDefault()} />

      <div className="lt-card" style={cardStyle}>
        <button type="button" className="lt-skip" onClick={() => finish()} aria-label={t('tour.skip', 'Skip tour')}>
          <X size={15} />
        </button>
        <div className="lt-eyebrow">{t('tour.stepOf', 'Step {{n}} of {{total}}', { n: i + 1, total: steps.length })}</div>
        <h3 className="lt-title">{step.title}</h3>
        <p className="lt-body">{step.body}</p>
        <div className="lt-foot">
          <div className="lt-dots">
            {steps.map((_, n) => <span key={n} className={'lt-dot' + (n === i ? ' on' : '')} />)}
          </div>
          <div className="lt-btns">
            {i > 0 && !isLast && (
              <button type="button" className="lt-btn ghost" onClick={() => go(-1)}><ArrowLeft size={15} />{t('tour.back', 'Back')}</button>
            )}
            {isLast ? (
              <>
                <button type="button" className="lt-btn ghost" onClick={() => finish()}>{t('tour.done', 'Done')}</button>
                <button type="button" className="lt-btn primary" onClick={() => finish(true)}><Check size={15} />{step.cta}</button>
              </>
            ) : (
              <button type="button" className="lt-btn primary" onClick={() => go(1)}>{i === 0 ? t('tour.start', 'Take the tour') : t('tour.next', 'Next')}<ArrowRight size={15} /></button>
            )}
          </div>
        </div>
      </div>

      <style>{`
.lt-card{ background:var(--color-bg-surface,#fff); border:1px solid var(--color-border); border-radius:16px;
  box-shadow:0 24px 60px -18px rgba(20,19,15,.5); padding:18px 18px 14px; animation:ltpop .22s cubic-bezier(.22,.61,.36,1); }
@keyframes ltpop{ from{ opacity:0; transform:translateY(6px) scale(.98); } to{ opacity:1; } }
.lt-tour .lt-card[style*="translate(-50%"]{ animation:ltpopc .22s cubic-bezier(.22,.61,.36,1); }
@keyframes ltpopc{ from{ opacity:0; } to{ opacity:1; } }
.lt-skip{ position:absolute; top:12px; right:12px; width:28px; height:28px; border-radius:8px; border:none; background:transparent;
  color:var(--color-text-muted); cursor:pointer; display:grid; place-items:center; }
.lt-skip:hover{ background:var(--color-bg-subtle); color:var(--color-text-primary); }
.lt-eyebrow{ font-family:var(--font-mono,monospace); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--color-accent); font-weight:700; }
.lt-title{ font-family:var(--font-display,sans-serif); font-weight:800; font-size:18px; letter-spacing:-.01em; color:var(--color-text-primary); margin:7px 0 0; }
.lt-body{ font-size:13.5px; color:var(--color-text-secondary); line-height:1.5; margin:8px 0 0; }
.lt-foot{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:16px; }
.lt-dots{ display:flex; gap:5px; }
.lt-dot{ width:6px; height:6px; border-radius:99px; background:var(--color-border-strong,#D2C7B0); transition:.2s; }
.lt-dot.on{ background:var(--color-accent); width:16px; }
.lt-btns{ display:flex; gap:8px; align-items:center; }
.lt-btn{ height:34px; padding:0 13px; border-radius:9px; font-family:var(--font-body,sans-serif); font-weight:600; font-size:13px;
  display:inline-flex; align-items:center; gap:6px; cursor:pointer; border:1.5px solid transparent; transition:.15s; }
.lt-btn.primary{ background:var(--color-accent); color:#fff; box-shadow:0 3px 12px -3px var(--color-accent); }
.lt-btn.primary:hover{ filter:brightness(1.06); }
.lt-btn.ghost{ background:transparent; color:var(--color-text-secondary); border-color:var(--color-border-strong,#D2C7B0); }
.lt-btn.ghost:hover{ color:var(--color-text-primary); border-color:var(--color-text-muted); }
      `}</style>
    </div>,
    document.body
  );
};

export default ProductTour;
