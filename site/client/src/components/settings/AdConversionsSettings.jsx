import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import * as adService from '../../services/adConversionService';
import { getBoards, getBoardPipeline } from '../../services/boardService';
import useToastStore from '../../store/toastStore';

/**
 * AdConversionsSettings — report qualified leads back to Meta / Google Ads
 * (admin-only Settings tab).
 *
 *  1. Stages: per board, which groups count as a Qualified lead / Customer.
 *  2. Meta: dataset ID + write-only access token, event names, test event code
 *     and a "Send test event" button.
 *  3. Google: customer ID + conversion action IDs (agency credentials live on
 *     the server; the card says what is missing until they are set).
 *  4. Recent sends, with skip / failure reasons.
 */

const card = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};
const selectStyle = {
  height: 38,
  padding: '0 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  maxWidth: '100%',
};
const muted = { fontSize: 12, color: 'var(--color-text-muted)' };

const Toggle = ({ checked, onChange, disabled, label }) => (
  <label className="inline-flex items-center gap-2 font-body" style={{ fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }}
    />
    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</span>
  </label>
);

const SectionTitle = ({ children, sub }) => (
  <div className="mb-3">
    <h3 className="font-display font-bold" style={{ fontSize: 16, color: 'var(--color-text-primary)' }}>{children}</h3>
    {sub ? <p className="font-body mt-1" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{sub}</p> : null}
  </div>
);

const STATUS_COLOR = {
  sent: 'var(--color-status-done)',
  skipped: 'var(--color-text-muted)',
  failed: 'var(--color-status-stuck)',
  dead: 'var(--color-status-stuck)',
  pending: 'var(--color-text-secondary)',
};

const AdConversionsSettings = ({ workspaceId }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // form state
  const [rules, setRules] = useState([]);
  const [meta, setMeta] = useState({ enabled: false, datasetId: '', testEventCode: '', eventNames: { qualified: '', customer: '' } });
  const [metaToken, setMetaToken] = useState('');
  const [google, setGoogle] = useState({ enabled: false, customerId: '', conversionActions: { qualified: '', customer: '' } });

  // stages picker
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [stages, setStages] = useState([]);

  // test event + log
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [events, setEvents] = useState([]);

  const apply = (c) => {
    setConfig(c);
    setRules(c.rules || []);
    setMeta({ enabled: c.meta.enabled, datasetId: c.meta.datasetId, testEventCode: c.meta.testEventCode, eventNames: { ...c.meta.eventNames } });
    setGoogle({ enabled: c.google.enabled, customerId: c.google.customerId, conversionActions: { ...c.google.conversionActions } });
    setMetaToken('');
  };

  const loadEvents = useCallback(() => {
    if (!workspaceId) return;
    adService.listConversionEvents(workspaceId).then(setEvents).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([adService.getAdConversions(workspaceId), getBoards(workspaceId)])
      .then(([c, b]) => {
        apply(c);
        const list = (b || []).filter((x) => !x.isPersonal);
        setBoards(list);
        const mapped = (c.rules || [])[0]?.boardId;
        setBoardId(mapped || (list[0] && list[0]._id) || '');
      })
      .catch((err) => setError(err?.response?.data?.error || t('adConversions.loadError', 'Could not load ad conversion settings.')))
      .finally(() => setLoading(false));
    loadEvents();
  }, [workspaceId, t, loadEvents]);

  useEffect(() => {
    if (!boardId) {
      setStages([]);
      return;
    }
    getBoardPipeline(boardId)
      .then((p) => setStages(p.stages || []))
      .catch(() => setStages([]));
  }, [boardId]);

  const stageFor = (groupId) => rules.find((r) => r.boardId === boardId && r.groupId === groupId)?.stage || '';
  const setStageFor = (groupId, stage) => {
    setRules((prev) => {
      const rest = prev.filter((r) => !(r.boardId === boardId && r.groupId === groupId));
      return stage ? [...rest, { boardId, groupId, stage }] : rest;
    });
  };

  const mappedCount = useMemo(() => rules.length, [rules]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        rules,
        meta: { enabled: meta.enabled, datasetId: meta.datasetId.trim(), testEventCode: meta.testEventCode.trim(), eventNames: meta.eventNames },
        google: { enabled: google.enabled, customerId: google.customerId.trim(), conversionActions: google.conversionActions },
      };
      if (metaToken.trim()) payload.meta.accessToken = metaToken.trim();
      apply(await adService.saveAdConversions(workspaceId, payload));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      toast.success?.(t('adConversions.saved', 'Ad conversion settings saved'));
    } catch (err) {
      setError(err?.response?.data?.error || t('adConversions.saveError', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await adService.sendMetaTestEvent(workspaceId, meta.testEventCode.trim());
      if (Array.isArray(r.warnings) && r.warnings.length > 0) {
        // Accepted, but Meta flagged something — usually a test code from the
        // wrong channel in the Test events dropdown. Show Meta's own words.
        setTestResult({ ok: false, warn: true, text: `${t('adConversions.testWarn', 'Meta received it but warned:')} ${r.warnings.join(' ')}` });
      } else {
        setTestResult({ ok: true, text: t('adConversions.testOk', 'Meta received the test event. Check Events Manager → Test events.') });
      }
    } catch (err) {
      setTestResult({ ok: false, text: err?.response?.data?.error || t('adConversions.testFail', 'Meta rejected the test event.') });
    } finally {
      setTesting(false);
    }
  };

  const reasonText = (reason) => {
    const known = {
      no_ad_consent: t('adConversions.reason.no_ad_consent', 'No ad consent'),
      no_match_keys: t('adConversions.reason.no_match_keys', 'No email, phone or click ID to match'),
      no_conversion_action: t('adConversions.reason.no_conversion_action', 'No Google conversion action for this stage'),
      lead_deleted: t('adConversions.reason.lead_deleted', 'Lead was deleted'),
      not_configured: t('adConversions.reason.not_configured', 'Not configured'),
    };
    return known[reason] || reason;
  };

  if (loading) {
    return <p className="font-body" style={{ color: 'var(--color-text-muted)' }}>{t('pages.loading')}</p>;
  }

  const stageOptions = [
    { value: '', label: t('adConversions.notReported', 'Not reported') },
    { value: 'qualified', label: t('adConversions.stageQualified', 'Qualified lead') },
    { value: 'customer', label: t('adConversions.stageCustomer', 'Customer (won)') },
  ];

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 720 }}>
      <header>
        <h2 className="font-display font-bold" style={{ fontSize: 20, color: 'var(--color-text-primary)' }}>
          {t('adConversions.title', 'Ad conversions')}
        </h2>
        <p className="mt-1 font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adConversions.description', 'When a lead reaches a stage you choose, LeadLoop reports it to Meta and Google Ads so your campaigns optimise for real customers, not just form fills. Only leads who gave ad consent are sent.')}
        </p>
      </header>

      {config && !config.encryptionConfigured && (
        <p className="font-body" role="alert" style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>
          {t('adConversions.noEncryption', 'Token encryption is not configured on the server (EMAIL_TOKEN_ENCRYPTION_KEY), so access tokens cannot be saved yet.')}
        </p>
      )}

      {/* 1. Stages */}
      <section style={card}>
        <SectionTitle sub={t('adConversions.stagesSub', 'Pick the board, then choose which stages are reported. A lead is reported once per stage, the first time it enters it.')}>
          {t('adConversions.stagesTitle', '1. Which stages count')}
        </SectionTitle>
        <div className="flex flex-col gap-3">
          <select aria-label={t('adConversions.board', 'Board')} value={boardId} onChange={(e) => setBoardId(e.target.value)} style={selectStyle}>
            {boards.map((b) => (
              <option key={b._id} value={b._id}>{b.name}</option>
            ))}
          </select>
          {stages.length === 0 ? (
            <p className="font-body" style={muted}>{t('adConversions.noStages', 'This board has no stages yet.')}</p>
          ) : (
            stages.map((s) => (
              <div key={s._id} className="flex items-center justify-between gap-3 flex-wrap">
                <span className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.name}</span>
                <select aria-label={s.name} value={stageFor(s._id)} onChange={(e) => setStageFor(s._id, e.target.value)} style={{ ...selectStyle, minWidth: 180 }}>
                  {stageOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))
          )}
          <p className="font-body" style={muted}>
            {t('adConversions.mappedCount', '{{count}} stage(s) reported across all boards.', { count: mappedCount })}
          </p>
        </div>
      </section>

      {/* 2. Meta */}
      <section style={card}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <SectionTitle sub={t('adConversions.metaSub', 'Events Manager → your dataset → Settings → "Generate access token". The token can only send events to that dataset.')}>
            {t('adConversions.metaTitle', '2. Meta (Conversions API)')}
          </SectionTitle>
          <Toggle
            checked={meta.enabled}
            onChange={(v) => setMeta((m) => ({ ...m, enabled: v }))}
            label={meta.enabled ? t('adConversions.on', 'On') : t('adConversions.off', 'Off')}
          />
        </div>
        <div className="flex flex-col gap-3">
          <Input
            label={t('adConversions.datasetId', 'Dataset ID')}
            value={meta.datasetId}
            onChange={(e) => setMeta((m) => ({ ...m, datasetId: e.target.value }))}
            placeholder="29215329168108100"
          />
          <Input
            label={t('adConversions.accessToken', 'Access token')}
            type="password"
            autoComplete="off"
            value={metaToken}
            onChange={(e) => setMetaToken(e.target.value)}
            placeholder={config?.meta.hasAccessToken ? t('adConversions.tokenStored', '•••••••• stored — leave blank to keep') : 'EAA…'}
          />
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Input
              label={t('adConversions.eventQualified', 'Event name — Qualified lead')}
              value={meta.eventNames.qualified}
              onChange={(e) => setMeta((m) => ({ ...m, eventNames: { ...m.eventNames, qualified: e.target.value } }))}
            />
            <Input
              label={t('adConversions.eventCustomer', 'Event name — Customer')}
              value={meta.eventNames.customer}
              onChange={(e) => setMeta((m) => ({ ...m, eventNames: { ...m.eventNames, customer: e.target.value } }))}
            />
          </div>
          <Input
            label={t('adConversions.testCode', 'Test event code (optional)')}
            value={meta.testEventCode}
            onChange={(e) => setMeta((m) => ({ ...m, testEventCode: e.target.value }))}
            placeholder="TEST12345"
            helperText={t('adConversions.testCodeHelp', 'From Events Manager → Test events. While set, every event is sent as a test and does not affect ad results. Clear it to go live.')}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              variant="secondary"
              onClick={runTest}
              disabled={testing || !config?.meta.hasAccessToken || !config?.meta.datasetId || !meta.testEventCode.trim()}
            >
              {testing ? t('adConversions.testing', 'Sending…') : t('adConversions.sendTest', 'Send test event')}
            </Button>
            {!config?.meta.hasAccessToken && (
              <span className="font-body" style={muted}>{t('adConversions.saveFirst', 'Save the dataset ID and token first.')}</span>
            )}
          </div>
          {testResult && (
            <p
              className="font-body"
              role="status"
              style={{
                fontSize: 13,
                color: testResult.ok
                  ? 'var(--color-status-done)'
                  : testResult.warn
                    ? 'var(--color-status-working, #B26A00)'
                    : 'var(--color-status-stuck)',
              }}
            >
              {testResult.text}
            </p>
          )}
        </div>
      </section>

      {/* 3. Google */}
      <section style={card}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <SectionTitle sub={t('adConversions.googleSub', 'Uses your agency’s Google Ads API access. The client’s account must be linked under your manager account.')}>
            {t('adConversions.googleTitle', '3. Google Ads (offline conversions)')}
          </SectionTitle>
          <Toggle
            checked={google.enabled}
            disabled={!config?.google.serverConfigured}
            onChange={(v) => setGoogle((g) => ({ ...g, enabled: v }))}
            label={google.enabled ? t('adConversions.on', 'On') : t('adConversions.off', 'Off')}
          />
        </div>
        {!config?.google.serverConfigured && (
          <p className="font-body mb-3" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {t('adConversions.googleWaiting', 'Waiting for Google Ads API access on the server. Missing: {{missing}}', {
              missing: (config?.google.serverMissing || []).join(', '),
            })}
          </p>
        )}
        <div className="flex flex-col gap-3">
          <Input
            label={t('adConversions.customerId', 'Google Ads customer ID')}
            value={google.customerId}
            onChange={(e) => setGoogle((g) => ({ ...g, customerId: e.target.value }))}
            placeholder="123-456-7890"
          />
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Input
              label={t('adConversions.actionQualified', 'Conversion action ID — Qualified lead')}
              value={google.conversionActions.qualified}
              onChange={(e) => setGoogle((g) => ({ ...g, conversionActions: { ...g.conversionActions, qualified: e.target.value } }))}
            />
            <Input
              label={t('adConversions.actionCustomer', 'Conversion action ID — Customer')}
              value={google.conversionActions.customer}
              onChange={(e) => setGoogle((g) => ({ ...g, conversionActions: { ...g.conversionActions, customer: e.target.value } }))}
            />
          </div>
        </div>
      </section>

      {error && (
        <p className="font-body" role="alert" style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>{error}</p>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" onClick={save} disabled={saving}>
          {saving ? t('pages.saving') : t('adConversions.save', 'Save ad conversion settings')}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 font-body text-[12px] font-semibold" style={{ color: 'var(--color-status-done)' }}>
            <Check size={14} aria-hidden="true" />
            {t('pages.saved')}
          </span>
        )}
      </div>

      {/* 4. Recent sends */}
      <section style={card}>
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>{t('adConversions.recentTitle', 'Recent sends')}</SectionTitle>
          <Button type="button" variant="ghost" onClick={loadEvents}>{t('adConversions.refresh', 'Refresh')}</Button>
        </div>
        {events.length === 0 ? (
          <p className="font-body" style={muted}>{t('adConversions.noEvents', 'Nothing sent yet. Move a lead into a reported stage to send one.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li key={ev._id} className="flex items-center justify-between gap-3 flex-wrap font-body" style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {ev.leadName || '—'}
                  <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>
                    {' · '}{ev.platform === 'meta' ? 'Meta' : 'Google'}{' · '}
                    {ev.stage === 'qualified' ? t('adConversions.stageQualified', 'Qualified lead') : t('adConversions.stageCustomer', 'Customer (won)')}
                    {ev.test ? ` · ${t('adConversions.test', 'test')}` : ''}
                  </span>
                </span>
                <span style={{ color: STATUS_COLOR[ev.status] || 'inherit' }}>
                  {t(`adConversions.status.${ev.status}`, ev.status)}
                  {ev.reason ? ` — ${reasonText(ev.reason)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default AdConversionsSettings;
