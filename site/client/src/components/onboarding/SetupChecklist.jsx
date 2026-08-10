import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, X, ArrowRight, Rocket } from 'lucide-react';
import useOrgStore from '../../store/orgStore';
import {
  getSetup,
  dismissChecklist,
  markStep,
  getSampleData,
  addSampleData,
  clearSampleData,
} from '../../services/setupService';

/**
 * SetupChecklist — "Getting started, 3 of 7" on the Workspace Home.
 *
 * Every item's done-state is computed on the SERVER from real workspace data,
 * so it ticks itself when the thing is genuinely configured, the whole team
 * sees the same progress, and it survives a new device. (The old product tour
 * stored a flag in localStorage and knew nothing about what was set up.)
 *
 * Hidden entirely when dismissed or 100% complete.
 */

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 18,
};

const SetupChecklist = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [sampleBusy, setSampleBusy] = useState(false);

  const load = useCallback(() => {
    if (!orgId) return;
    getSetup(orgId)
      .then(setData)
      .catch(() => setData(null));
    getSampleData(orgId)
      .then(setSampleCount)
      .catch(() => setSampleCount(0));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const checklist = data?.checklist;
  if (!checklist || hidden || checklist.dismissed || checklist.allDone) return null;

  const hide = async () => {
    setHidden(true); // optimistic — the panel should vanish instantly
    try {
      if (data?.isAdmin) await dismissChecklist(orgId, true);
    } catch {
      /* a failed dismiss just means it returns next visit */
    }
  };

  const toggleSample = async () => {
    setSampleBusy(true);
    try {
      if (sampleCount > 0) {
        await clearSampleData(orgId);
        setSampleCount(0);
      } else {
        const res = await addSampleData(orgId);
        setSampleCount(res.sampleCount || 0);
      }
      load(); // sample leads change the "first lead" step
    } catch {
      /* leave the button as it was */
    } finally {
      setSampleBusy(false);
    }
  };

  const tick = async (stepId) => {
    try {
      const next = await markStep(orgId, stepId, true);
      setData((d) => ({ ...d, checklist: next }));
    } catch {
      /* ignore — the row simply stays unticked */
    }
  };

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: 'var(--color-accent-light, #EEF3EA)',
              color: 'var(--color-accent)',
            }}
          >
            <Rocket size={16} />
          </span>
          <div>
            <div
              className="font-heading"
              style={{ fontSize: 15, fontWeight: 750, color: 'var(--color-text-primary)' }}
            >
              {t('setup.checklistTitle', 'Getting started')}
            </div>
            <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              {t('setup.progress', '{{done}} of {{total}} done', {
                done: checklist.completed,
                total: checklist.total,
              })}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label={t('common.dismiss', 'Dismiss')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress bar */}
      <div
        style={{ height: 7, borderRadius: 6, background: 'var(--color-bg-subtle)', overflow: 'hidden' }}
        role="progressbar"
        aria-valuenow={checklist.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            width: `${checklist.percent}%`,
            background: 'var(--color-accent)',
            borderRadius: 6,
            transition: 'width .5s cubic-bezier(.22,.61,.36,1)',
          }}
        />
      </div>

      <div style={{ marginTop: 6 }}>
        {checklist.steps.map((step) => {
          const clickable = !step.done && (step.href || step.manual);
          const onClick = () => {
            if (step.done) return;
            if (step.href) navigate(step.href);
            else if (step.manual) tick(step.id);
          };
          return (
            <div
              key={step.id}
              onClick={clickable ? onClick : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClick();
                      }
                    }
                  : undefined
              }
              className="flex items-start gap-3"
              style={{
                padding: '11px 4px',
                borderBottom: '1px solid var(--color-border)',
                cursor: clickable ? 'pointer' : 'default',
              }}
            >
              <span
                className="inline-flex items-center justify-center"
                style={{
                  width: 19,
                  height: 19,
                  flex: '0 0 19px',
                  borderRadius: '50%',
                  marginTop: 1,
                  border: step.done ? 'none' : '1.5px solid var(--color-border-strong)',
                  background: step.done ? 'var(--color-status-done)' : 'transparent',
                  color: '#fff',
                }}
              >
                {step.done && <Check size={12} strokeWidth={3} />}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="font-heading"
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: step.done ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                    textDecoration: step.done ? 'line-through' : 'none',
                  }}
                >
                  {t(`setup.steps.${step.id}.title`, step.id)}
                </div>
                {!step.done && (
                  <p
                    className="font-body"
                    style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.45 }}
                  >
                    {t(`setup.steps.${step.id}.body`, '')}
                  </p>
                )}
              </div>

              {clickable && (
                <ArrowRight
                  size={15}
                  style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 3 }}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Learn by doing — an empty board teaches nothing. Admin-only, since it
          writes real (labelled) rows to a shared board. */}
      {data.isAdmin && (
        <div
          className="flex items-center justify-between gap-3 flex-wrap"
          style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}
        >
          <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {sampleCount > 0
              ? t('sample.present', '{{count}} example leads are on your board — remove them any time.', { count: sampleCount })
              : t('sample.offer', 'Not sure what a working pipeline looks like? Try it with example leads.')}
          </p>
          <button
            type="button"
            onClick={toggleSample}
            disabled={sampleBusy}
            className="font-body"
            style={{
              fontSize: 12.5,
              fontWeight: 650,
              padding: '7px 13px',
              borderRadius: 'var(--radius-md)',
              border: '1.5px solid var(--color-border-strong)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: sampleBusy ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {sampleBusy
              ? t('sample.working', 'Working…')
              : sampleCount > 0
                ? t('sample.remove', 'Remove examples')
                : t('sample.add', 'Show me how it works')}
          </button>
        </div>
      )}
    </div>
  );
};

export default SetupChecklist;
