import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import { SkeletonBlock } from '../ui/Skeleton';
import { TextField, PrimaryButton, Pill } from './ads/AdsShared';
import * as smsService from '../../services/smsService';
import useToastStore from '../../store/toastStore';
import { SettingsHeader, SettingsCard, CardTitle, InlineError, MainAsideGrid } from './SettingsLayout';
import TwilioAside from './TwilioAside';

/**
 * SmsConfigForm — Settings → SMS: workspace Twilio SMS credentials (F10.5,
 * admin-only). Renders the whole tab: header (with connection status), the
 * form card, an optional `extra` block under it (the opt-out list) and the
 * "Where to find these" / "Used by" aside.
 *
 * Account SID, a write-only Auth Token field (the stored token is never sent
 * back — leave blank to keep it), the default sender number / Messaging Service
 * SID, and the TCPA/CASL opt-out footer toggle.
 *
 * Props: workspaceId — the current workspace; extra — node rendered below the form.
 */
const SmsConfigForm = ({ workspaceId, extra }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState(''); // write-only; '' keeps the stored one
  const [defaultFrom, setDefaultFrom] = useState('');
  const [messagingServiceSid, setMessagingServiceSid] = useState('');
  const [appendOptOutFooter, setAppendOptOutFooter] = useState(true);

  const applyConfig = (c) => {
    setConfig(c);
    setAccountSid(c?.accountSid || '');
    setDefaultFrom(c?.defaultFrom || '');
    setMessagingServiceSid(c?.messagingServiceSid || '');
    setAppendOptOutFooter(c ? c.appendOptOutFooter !== false : true);
    setAuthToken('');
  };

  const load = useCallback(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    smsService
      .getSmsConfig(workspaceId)
      .then(applyConfig)
      .catch((err) => setError(err?.response?.data?.error || t('pages.failedToLoadSms')))
      .finally(() => setLoading(false));
  }, [workspaceId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        accountSid: accountSid.trim(),
        defaultFrom: defaultFrom.trim(),
        messagingServiceSid: messagingServiceSid.trim(),
        appendOptOutFooter,
      };
      if (authToken.trim()) payload.authToken = authToken.trim();
      const c = await smsService.saveSmsConfig(workspaceId, payload);
      applyConfig(c);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      toast.success?.(t('pages.smsSettingsSaved'));
    } catch (err) {
      setError(err?.response?.data?.error || t('pages.couldNotSaveSms'));
    } finally {
      setSaving(false);
    }
  };

  const isConnected = !!(config?.accountSid && config?.hasAuthToken && (config?.defaultFrom || config?.messagingServiceSid));

  return (
    <>
      <SettingsHeader
        tab="sms"
        title={t('settings.tabs.sms')}
        subtitle={t('settings.sms.subtitle')}
        actions={
          loading ? null : isConnected ? (
            <Pill tone="ok" dot>{t('settings.status.connected')}</Pill>
          ) : (
            <Pill tone="neutral" dot>{t('settings.status.notConnected')}</Pill>
          )
        }
      />
      <PageBody>
        <MainAsideGrid>
          <div className="flex flex-col gap-5 min-w-0">
            <SettingsCard aria-labelledby="sms-form-title" style={{ gap: 18 }}>
              <CardTitle id="sms-form-title">{t('settings.sms.formTitle')}</CardTitle>
              {loading ? (
                <div role="status" aria-live="polite" className="flex flex-col gap-3">
                  <span className="sr-only">{t('pages.loading')}</span>
                  <SkeletonBlock height={46} borderRadius={12} />
                  <SkeletonBlock height={46} borderRadius={12} />
                  <SkeletonBlock height={46} borderRadius={12} />
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: 18 }}>
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
                    <TextField
                      label={t('pages.accountSid')}
                      value={accountSid}
                      onChange={setAccountSid}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <TextField
                      label={t('pages.authToken')}
                      type="password"
                      value={authToken}
                      onChange={setAuthToken}
                      placeholder={config?.hasAuthToken ? t('pages.authTokenStoredPlaceholder') : t('pages.twilioAuthToken')}
                      hint={t('pages.authTokenHelperSms')}
                      autoComplete="off"
                    />
                    <TextField
                      label={t('pages.defaultSenderNumber')}
                      type="tel"
                      value={defaultFrom}
                      onChange={setDefaultFrom}
                      placeholder="+15551234567"
                      hint={t('pages.defaultSenderHelper')}
                      autoComplete="off"
                    />
                    <TextField
                      label={t('pages.messagingServiceSid')}
                      value={messagingServiceSid}
                      onChange={setMessagingServiceSid}
                      placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  <label
                    className="flex items-start gap-3 font-body has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--color-accent)]"
                    style={{ padding: 14, borderRadius: 12, background: 'var(--color-bg-base)', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={appendOptOutFooter}
                      onChange={(e) => setAppendOptOutFooter(e.target.checked)}
                      style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--color-accent)', flexShrink: 0 }}
                    />
                    <span>
                      <span className="block font-bold" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
                        {t('pages.appendOptOutFooter')}
                      </span>
                      <span className="block" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                        {t('pages.optOutFooterHelper')}
                      </span>
                    </span>
                  </label>

                  <InlineError>{error}</InlineError>

                  <div className="flex items-center justify-end gap-3 flex-wrap" style={{ paddingTop: 14, borderTop: '1px solid #EFE8DA' }}>
                    {saved && (
                      <span role="status" className="inline-flex items-center gap-1 font-body text-[13px] font-semibold text-[color:var(--color-status-done)]">
                        <Check size={14} aria-hidden="true" />
                        {t('pages.saved')}
                      </span>
                    )}
                    <PrimaryButton type="submit" loading={saving}>
                      {saving ? t('pages.saving') : t('pages.saveSmsSettings')}
                    </PrimaryButton>
                  </div>
                </form>
              )}
            </SettingsCard>
            {extra}
          </div>

          <TwilioAside
            idPrefix="sms"
            steps={[t('settings.twilio.where1'), t('settings.twilio.where2'), t('settings.sms.where3')]}
            usedBy={t('settings.sms.usedBy')}
          />
        </MainAsideGrid>
      </PageBody>
    </>
  );
};

export default SmsConfigForm;
