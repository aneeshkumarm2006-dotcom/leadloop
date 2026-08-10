import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, Play, Rocket, Sparkles, Mail } from 'lucide-react';
import { startTour } from './ProductTour';

/**
 * HelpMenu — the "?" in the top bar.
 *
 * Onboarding help that only exists on day one is help nobody has when they
 * actually need it. This keeps the tour, the setup checklist and the guides
 * reachable at any time.
 */
const HelpMenu = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const items = [
    {
      icon: Play,
      label: t('help.replayTour', 'Take the tour again'),
      onClick: () => {
        setOpen(false);
        startTour();
      },
    },
    {
      icon: Rocket,
      label: t('help.setupChecklist', 'Finish setting up'),
      onClick: () => {
        setOpen(false);
        navigate('/workspace');
      },
    },
    {
      icon: Sparkles,
      label: t('help.leadSources', 'Connect a lead source'),
      onClick: () => {
        setOpen(false);
        navigate('/lead-sources');
      },
    },
    {
      icon: Mail,
      label: t('help.contact', 'Ask us anything'),
      onClick: () => {
        setOpen(false);
        window.location.href = 'mailto:support@leadloop.app';
      },
    },
  ];

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('help.title', 'Help')}
        aria-expanded={open}
        className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
        style={{ width: 36, height: 36, background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <HelpCircle size={19} color="var(--color-text-secondary)" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 236,
            background: 'var(--color-bg-elevated, #fff)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            zIndex: 60,
          }}
        >
          <div
            className="font-mono"
            style={{
              padding: '9px 13px',
              background: 'var(--color-bg-subtle)',
              borderBottom: '1px solid var(--color-border)',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--color-text-secondary)',
            }}
          >
            {t('help.title', 'Help')}
          </div>
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={it.onClick}
                className="flex items-center gap-2.5 w-full text-left hover:bg-[color:var(--color-bg-subtle)]"
                style={{
                  padding: '10px 13px',
                  fontSize: 13,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                <Icon size={15} style={{ color: 'var(--color-accent)', flexShrink: 0 }} aria-hidden="true" />
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HelpMenu;
