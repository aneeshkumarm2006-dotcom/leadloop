import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';

/**
 * GuideCoach — the "now do this" half of the setup checklist.
 *
 * Clicking a checklist item used to just navigate somewhere and abandon you on
 * the page. This picks up a `?guide=<id>` parameter on arrival, spotlights the
 * control you actually need, and says what to do with it — then steps you
 * through the rest of the task.
 *
 * Mounted once in PageWrapper, so a guide can span pages: each step names the
 * route it belongs to, and the coach follows you as you go.
 *
 * Targets are `data-tour="…"` attributes, the same anchors ProductTour uses. A
 * step whose target is missing on the current page still shows its card,
 * centred — guidance never disappears just because a button moved.
 */

const CARD_W = 330;
const PAD = 8;

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The guides. `to` navigates before the step is shown when the user isn't
 * already there. Keys mirror the checklist step ids in setupService.STEPS.
 */
const GUIDES = {
  firstLead: {
    steps: [
      { target: 'new-lead', to: '/workspace', placement: 'bottom', k: 'firstLead1' },
      { target: null, k: 'firstLead2' },
    ],
  },
  inviteTeam: {
    steps: [
      { target: 'invite', to: '/workspace', placement: 'bottom', k: 'inviteTeam1' },
      { target: null, k: 'inviteTeam2' },
    ],
  },
  leadSource: {
    steps: [
      { target: null, to: '/lead-sources', k: 'leadSource1' },
      { target: null, k: 'leadSource2' },
    ],
  },
  businessHours: {
    steps: [{ target: null, to: '/booking', k: 'businessHours1' }],
  },
  pipeline: {
    steps: [{ target: null, to: '/boards?new=1', k: 'pipeline1' }],
  },
};

const GuideCoach = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const guideId = params.get('guide');
  const guide = guideId ? GUIDES[guideId] : null;

  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  // Reset to the first step whenever a new guide starts.
  useEffect(() => {
    setI(0);
  }, [guideId]);

  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('guide');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const step = guide ? guide.steps[Math.min(i, guide.steps.length - 1)] : null;

  // Follow the step to its page if we aren't already there.
  useEffect(() => {
    if (!step?.to) return;
    const [path] = step.to.split('?');
    if (window.location.pathname !== path) navigate(step.to, { replace: true });
  }, [step, navigate]);

  // Measure the spotlight target, and keep it in sync while scrolling.
  useLayoutEffect(() => {
    if (!step) return undefined;
    if (!step.target) {
      setRect(null);
      return undefined;
    }
    const find = () => document.querySelector(`[data-tour="${step.target}"]`);
    const measure = () => {
      const el = find();
      setRect(el ? el.getBoundingClientRect() : null);
    };
    // The destination page may still be rendering when we arrive.
    const timer = setTimeout(() => {
      const el = find();
      if (el) {
        try {
          el.scrollIntoView({ block: 'nearest', behavior: prefersReduced() ? 'auto' : 'smooth' });
        } catch {
          /* older browsers */
        }
      }
      measure();
    }, 260);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    if (!guide) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [guide, close]);

  if (!guide || !step) return null;

  const isLast = i >= guide.steps.length - 1;

  // Card beside the highlighted control, or centred when there is nothing to
  // point at — the instruction still has to be readable either way.
  let cardStyle = {
    position: 'fixed',
    left: '50%',
    bottom: 28,
    transform: 'translateX(-50%)',
    width: `min(${CARD_W}px, calc(100vw - 32px))`,
    zIndex: 100002,
  };
  if (rect) {
    const place = step.placement || 'right';
    let top;
    let left;
    if (place === 'bottom') {
      top = Math.min(rect.bottom + 12, window.innerHeight - 200);
      left = Math.min(Math.max(rect.left, 12), window.innerWidth - CARD_W - 12);
    } else {
      left = rect.right + 14;
      if (left + CARD_W > window.innerWidth - 12) left = Math.max(12, rect.left - CARD_W - 14);
      top = Math.min(Math.max(rect.top, 12), window.innerHeight - 220);
    }
    cardStyle = { position: 'fixed', top, left, width: CARD_W, zIndex: 100002 };
  }

  return (
    <>
      {/* Spotlight ring. Pointer-events stay off so the user can actually click
          the thing we are pointing at — this is a guide, not a modal. */}
      {rect && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 12,
            boxShadow: '0 0 0 3px var(--color-accent), 0 0 0 9999px rgba(31,54,39,.45)',
            zIndex: 100001,
            pointerEvents: 'none',
            transition: prefersReduced() ? 'none' : 'all .25s cubic-bezier(.22,.61,.36,1)',
          }}
        />
      )}

      <div
        role="dialog"
        aria-live="polite"
        style={{
          ...cardStyle,
          background: 'var(--color-bg-surface, #fff)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 16px 40px rgba(0,0,0,.24)',
          padding: 16,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className="font-mono"
            style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}
          >
            {guide.steps.length > 1
              ? t('guide.stepOf', 'Step {{n}} of {{total}}', { n: i + 1, total: guide.steps.length })
              : t('guide.label', 'Guide')}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.dismiss', 'Dismiss')}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
          >
            <X size={15} />
          </button>
        </div>

        <h3
          className="font-heading"
          style={{ fontSize: 15, fontWeight: 750, color: 'var(--color-text-primary)', margin: '8px 0 4px' }}
        >
          {t(`guide.${step.k}.title`, '')}
        </h3>
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {t(`guide.${step.k}.body`, '')}
        </p>

        <div className="flex items-center justify-between" style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={close}
            className="font-body"
            style={{ background: 'none', border: 'none', fontSize: 12.5, color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
          >
            {t('guide.skip', 'Close')}
          </button>
          <button
            type="button"
            onClick={() => (isLast ? close() : setI((n) => n + 1))}
            className="font-body inline-flex items-center gap-1.5"
            style={{
              fontSize: 13,
              fontWeight: 650,
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {isLast ? t('guide.done', 'Got it') : t('guide.next', 'Next')}
            {!isLast && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </>
  );
};

export default GuideCoach;
