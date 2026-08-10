import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Building2,
  Briefcase,
  GitBranch,
  Users,
  Radio,
  Copy,
  ArrowRight,
} from 'lucide-react';
import Dropdown from '../components/ui/Dropdown';
import Button from '../components/ui/Button';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import { updateProfile, completeWizard } from '../services/setupService';
import { createBoard } from '../services/boardService';

/**
 * SetupWizardPage — the guided first run for whoever CREATES a workspace.
 *
 * Replaces "ask for a name, then drop them in an empty workspace". Five steps,
 * each explaining why it matters; every step is skippable and the wizard can be
 * left at any point (the Workspace-Home checklist picks up whatever is left).
 *
 * Someone who JOINS with an invite code never sees this — they are an agent
 * joining a workspace that is already configured, not the person setting it up.
 */

const STEPS = ['business', 'type', 'pipeline', 'team', 'sources'];

// Business type → the starter board template it seeds. Template ids come from
// the server's boardTemplates registry.
const TEMPLATE_FOR = {
  leasing: 'real_estate_crm',
  sales: 'real_estate_leads',
  both: 'real_estate_crm',
  property_management: 'real_estate_crm',
};

// Stages each template creates, shown as a preview BEFORE the board exists so
// people understand their pipeline instead of discovering it afterwards.
const STAGES_FOR = {
  real_estate_crm: [
    ['New Lead', '#8C8578'],
    ['Contacted', '#579BFC'],
    ['Follow-up', '#B08A3C'],
    ['Visit Booked', '#C4632B'],
    ['Application', '#8A5CA6'],
    ['Lease to Sign', '#3E8FA0'],
    ['Lease Signed', '#4E9068'],
  ],
  real_estate_leads: [
    ['New', '#8C8578'],
    ['Contacted', '#579BFC'],
    ['Qualified', '#3E8FA0'],
    ['Viewing Scheduled', '#C4632B'],
    ['Offer', '#8A5CA6'],
    ['Closed', '#4E9068'],
  ],
};

const TIMEZONES = {
  CA: [
    'America/Toronto',
    'America/Montreal',
    'America/Winnipeg',
    'America/Edmonton',
    'America/Vancouver',
    'America/Halifax',
    'America/Regina',
  ],
  US: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
  ],
};

const guessTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

const shell = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
};

const SetupWizardPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
  const user = useAuthStore((s) => s.user);
  const orgId = currentOrg?._id || null;

  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — business
  const [country, setCountry] = useState('CA');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('CAD');
  // Step 2 — what they do
  const [businessType, setBusinessType] = useState('leasing');
  // Step 3 — pipeline
  const [dropped, setDropped] = useState([]); // stage labels the user removed
  const [boardCreated, setBoardCreated] = useState(false);

  useEffect(() => {
    const guess = guessTimezone();
    if (guess) {
      setTimezone(guess);
      if (!guess.startsWith('America/')) return;
      // A US zone in the guess flips the country default.
      if (TIMEZONES.US.includes(guess)) {
        setCountry('US');
        setCurrency('USD');
      }
    }
  }, []);

  // Nobody should land here without a workspace.
  useEffect(() => {
    if (currentOrg === null) return;
    if (!orgId) navigate('/onboarding', { replace: true });
  }, [orgId, currentOrg, navigate]);

  const template = TEMPLATE_FOR[businessType] || 'real_estate_crm';
  const stages = useMemo(
    () => (STAGES_FOR[template] || []).filter(([label]) => !dropped.includes(label)),
    [template, dropped]
  );

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  const finish = async () => {
    setBusy(true);
    try {
      if (orgId) await completeWizard(orgId);
      await fetchOrgs?.();
    } catch {
      /* finishing is best-effort — never trap someone in the wizard */
    }
    navigate('/workspace', { replace: true });
  };

  const next = async () => {
    setError('');
    if (step === 'business' || step === 'type') {
      setBusy(true);
      try {
        await updateProfile(orgId, { country, timezone, currency, businessType });
      } catch (e) {
        setError(e?.response?.data?.error || t('setup.saveError', 'Could not save. Try again.'));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (step === 'pipeline' && !boardCreated) {
      setBusy(true);
      try {
        await createBoard({
          name: t('setup.pipelineBoardName', 'Leads'),
          visibility: 'public',
          organisation: orgId,
          template,
        });
        setBoardCreated(true);
      } catch (e) {
        setError(e?.response?.data?.error || t('setup.boardError', 'Could not create the board.'));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (isLast) return finish();
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    return undefined;
  };

  const skip = () => (isLast ? finish() : setStepIdx((i) => i + 1));

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(currentOrg?.inviteCode || '');
    } catch {
      /* clipboard unavailable */
    }
  };

  const countryOptions = [
    { value: 'CA', label: t('setup.countryCA', 'Canada') },
    { value: 'US', label: t('setup.countryUS', 'United States') },
  ];
  const tzOptions = (TIMEZONES[country] || []).map((z) => ({ value: z, label: z.replace('America/', '') }));
  const currencyOptions = [
    { value: 'CAD', label: 'CAD — Canadian dollar' },
    { value: 'USD', label: 'USD — US dollar' },
  ];

  const TYPES = [
    { id: 'leasing', icon: Building2, title: t('setup.typeLeasing', 'Leasing / rentals') },
    { id: 'sales', icon: Briefcase, title: t('setup.typeSales', 'Residential sales') },
    { id: 'both', icon: GitBranch, title: t('setup.typeBoth', 'Both') },
    { id: 'property_management', icon: Users, title: t('setup.typePM', 'Property management') },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-base)', padding: '32px 16px 56px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1
          className="font-heading"
          style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 4 }}
        >
          {t('setup.welcome', 'Welcome, {{name}}', { name: user?.name?.split(' ')[0] || '' })}
        </h1>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20 }}>
          {t('setup.welcomeSub', 'A few quick questions and your workspace is ready to take leads.')}
        </p>

        <div style={shell}>
          {/* Stepper */}
          <div
            className="flex items-center"
            style={{ borderBottom: '1px solid var(--color-border)', padding: '0 8px', overflowX: 'auto' }}
          >
            {STEPS.map((s, i) => {
              const done = i < stepIdx;
              const now = i === stepIdx;
              return (
                <div
                  key={s}
                  className="flex items-center gap-2"
                  style={{
                    padding: '13px 14px 11px',
                    fontSize: 12.5,
                    whiteSpace: 'nowrap',
                    color: now ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    fontWeight: now ? 650 : 400,
                    borderBottom: `2px solid ${now ? 'var(--color-accent)' : 'transparent'}`,
                  }}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: now
                        ? 'var(--color-accent)'
                        : done
                          ? 'var(--color-status-done-bg)'
                          : 'var(--color-bg-subtle)',
                      color: now ? '#fff' : done ? 'var(--color-status-done)' : 'var(--color-text-muted)',
                    }}
                  >
                    {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  {t(`setup.step.${s}`, s)}
                </div>
              );
            })}
          </div>

          <div style={{ padding: 22 }}>
            {step === 'business' && (
              <div>
                <h2 className="font-heading" style={{ fontSize: 18, fontWeight: 750 }}>
                  {t('setup.businessTitle', 'Where do you work?')}
                </h2>
                <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '6px 0 18px' }}>
                  {t('setup.businessBody', 'This sets your currency and dates, and how commission is reported.')}
                </p>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                  <Dropdown
                    label={t('setup.country', 'Country')}
                    options={countryOptions}
                    value={country}
                    onChange={(v) => {
                      setCountry(v);
                      setCurrency(v === 'US' ? 'USD' : 'CAD');
                      setTimezone('');
                    }}
                  />
                  <Dropdown
                    label={t('setup.timezone', 'Timezone')}
                    options={tzOptions}
                    value={timezone}
                    onChange={setTimezone}
                    placeholder={t('setup.pickTimezone', 'Choose…')}
                  />
                  <Dropdown
                    label={t('setup.currency', 'Currency')}
                    options={currencyOptions}
                    value={currency}
                    onChange={setCurrency}
                  />
                </div>
              </div>
            )}

            {step === 'type' && (
              <div>
                <h2 className="font-heading" style={{ fontSize: 18, fontWeight: 750 }}>
                  {t('setup.typeTitle', 'What kind of work do you do?')}
                </h2>
                <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '6px 0 18px' }}>
                  {t('setup.typeBody', 'We’ll build the pipeline that matches — you can change it later.')}
                </p>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                  {TYPES.map((ty) => {
                    const Icon = ty.icon;
                    const on = businessType === ty.id;
                    return (
                      <button
                        key={ty.id}
                        type="button"
                        onClick={() => setBusinessType(ty.id)}
                        className="text-left"
                        style={{
                          padding: 14,
                          borderRadius: 'var(--radius-md)',
                          border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          background: on ? 'var(--color-accent-light, #EEF3EA)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon size={19} style={{ color: on ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
                        <div
                          className="font-heading"
                          style={{ fontSize: 13.5, fontWeight: 700, marginTop: 8, color: 'var(--color-text-primary)' }}
                        >
                          {ty.title}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 'pipeline' && (
              <div>
                <h2 className="font-heading" style={{ fontSize: 18, fontWeight: 750 }}>
                  {t('setup.pipelineTitle', 'Here’s the pipeline we’ll build')}
                </h2>
                <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '6px 0 16px' }}>
                  {t('setup.pipelineBody', 'These become the stages on your board. Remove any you don’t need.')}
                </p>
                <div className="flex flex-wrap" style={{ gap: 9 }}>
                  {stages.map(([label, color]) => (
                    <span
                      key={label}
                      className="inline-flex items-center"
                      style={{
                        gap: 7,
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'var(--color-bg-input, #FCFAF4)',
                        border: '1px solid var(--color-border)',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: color }} />
                      {label}
                      {!boardCreated && (
                        <button
                          type="button"
                          onClick={() => setDropped((d) => [...d, label])}
                          aria-label={t('setup.removeStage', 'Remove {{stage}}', { stage: label })}
                          style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, marginLeft: 2 }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {boardCreated && (
                  <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-status-done)', marginTop: 12 }}>
                    <Check size={13} style={{ display: 'inline', verticalAlign: -2 }} />{' '}
                    {t('setup.boardMade', 'Your board is ready.')}
                  </p>
                )}
              </div>
            )}

            {step === 'team' && (
              <div>
                <h2 className="font-heading" style={{ fontSize: 18, fontWeight: 750 }}>
                  {t('setup.teamTitle', 'Bring your team in')}
                </h2>
                <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '6px 0 16px' }}>
                  {t('setup.teamBody', 'Share this code and leads get shared out automatically once there’s more than one of you.')}
                </p>
                <div
                  className="flex items-center justify-between gap-3 flex-wrap"
                  style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-subtle)' }}
                >
                  <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 16, fontWeight: 700, letterSpacing: '0.08em' }}>
                    {currentOrg?.inviteCode || '—'}
                  </code>
                  <Button variant="secondary" onClick={copyInvite}>
                    <span className="inline-flex items-center gap-1.5">
                      <Copy size={14} /> {t('leadSources.copy', 'Copy')}
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {step === 'sources' && (
              <div>
                <h2 className="font-heading" style={{ fontSize: 18, fontWeight: 750 }}>
                  {t('setup.sourcesTitle', 'Where do your leads come from?')}
                </h2>
                <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '6px 0 16px' }}>
                  {t('setup.sourcesBody', 'Connect a source and leads arrive on your board by themselves — no typing.')}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await finish();
                    navigate('/lead-sources');
                  }}
                  className="flex items-center gap-3 w-full text-left"
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-md)',
                    border: '1.5px solid var(--color-accent)',
                    background: 'var(--color-accent-light, #EEF3EA)',
                    cursor: 'pointer',
                  }}
                >
                  <Radio size={19} style={{ color: 'var(--color-accent)' }} />
                  <span style={{ flex: 1 }}>
                    <span
                      className="font-heading"
                      style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)' }}
                    >
                      {t('setup.connectNow', 'Connect a lead source now')}
                    </span>
                    <span className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                      {t('setup.connectHint', 'Facebook, Google Ads, or your website form')}
                    </span>
                  </span>
                  <ArrowRight size={16} style={{ color: 'var(--color-accent)' }} />
                </button>
              </div>
            )}

            {error && (
              <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-status-stuck)', marginTop: 14 }}>
                {error}
              </p>
            )}
          </div>

          <div
            className="flex items-center justify-between gap-3 flex-wrap"
            style={{ borderTop: '1px solid var(--color-border)', padding: '13px 22px' }}
          >
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
              className="font-body"
              style={{
                background: 'none',
                border: 'none',
                fontSize: 13,
                color: stepIdx === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                cursor: stepIdx === 0 ? 'default' : 'pointer',
                padding: 0,
              }}
            >
              {t('common.back', 'Back')}
            </button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={skip} disabled={busy}>
                {isLast ? t('setup.finish', 'Finish') : t('setup.skip', 'Skip for now')}
              </Button>
              <Button variant="primary" onClick={next} disabled={busy}>
                {busy
                  ? t('setup.saving', 'Saving…')
                  : step === 'pipeline' && !boardCreated
                    ? t('setup.createPipeline', 'Create my pipeline')
                    : isLast
                      ? t('setup.finish', 'Finish')
                      : t('setup.continue', 'Continue')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupWizardPage;
