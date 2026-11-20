import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import { SkeletonBlock } from '../ui/Skeleton';
import { TextField, PrimaryButton, Pill } from './ads/AdsShared';
import * as whatsappService from '../../services/whatsappService';
import useToastStore from '../../store/toastStore';
import { SettingsHeader, SettingsCard, CardTitle, InlineError, MainAsideGrid } from './SettingsLayout';
import TwilioAside from './TwilioAside';

/**
 * WhatsAppConfigForm — Settings → WhatsApp: workspace Twilio WhatsApp
 * credentials (F11.5, admin-only). Same layout as the SMS tab: header with
 * status, form card, optional `extra` (the template manager) and the aside.
 *
 * Account SID, a write-only Auth Token field (the stored token is never sent
 * back — leave blank to keep it), and the WhatsApp sender id (the approved
 * `whatsapp:`-capable number). Reuses the F10 Twilio account + the shared
 * opt-out list, so a STOP suppresses both SMS and WhatsApp.
 *
 * Props: workspaceId — the current workspace; extra — node rendered below the form.
 */
const WhatsAppConfigForm = ({ workspaceId, extra }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState(''); // write-only; '' keeps the stored one
  const [whatsappSenderId, setWhatsappSenderId] = useState('');

  const applyConfig = (c) => {
    setConfig(c);
    setAccountSid(c?.accountSid || '');
    setWhatsappSenderId(c?.whatsappSenderId || '');
    setAuthToken('');
  };

  const load = useCallback(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    whatsappService
      .getConfig(workspaceId)
      .then(applyConfig)
      .catch((err) => setError(err?.response?.data?.error || t('pages.failedToLoadWhatsApp')))
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
        whatsappSenderId: whatsappSenderId.trim(),
      };
      if (authToken.trim()) payload.authToken = authToken.trim();
      const c = await whatsappService.saveConfig(workspaceId, payload);
      applyConfig(c);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      toast.success?.(t('pages.whatsAppSettingsSaved'));
    } catch (err) {
      setError(err?.response?.data?.error || t('pages.couldNotSaveWhatsApp'));
    } finally {
      setSaving(false);
    }
  };

  const isConnected = !!(config?.accountSid && config?.hasAuthToken && config?.whatsappSenderId);

  return (
    <>
      <SettingsHeader
        tab="whatsapp"
        title={t('settings.tabs.whatsapp')}
        subtitle={t('settings.whatsapp.subtitle')}
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
            <SettingsCard aria-labelledby="wa-form-title" style={{ gap: 18 }}>
              <CardTitle id="wa-form-title">{t('settings.whatsapp.formTitle')}</CardTitle>
              {loading ? (
                <div role="status" aria-live="polite" className="flex flex-col gap-3">
                  <span className="sr-only">{t('pages.loading')}</span>
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
                      hint={t('pages.authTokenHelperWhatsApp')}
                      autoComplete="off"
                    />
                    <TextField
                      label={t('pages.whatsAppSenderNumber')}
                      type="tel"
                      value={whatsappSenderId}
                      onChange={setWhatsappSenderId}
                      placeholder="+14155238886"
                      hint={t('pages.whatsAppSenderHelper')}
                      autoComplete="off"
                    />
                  </div>

                  <InlineError>{error}</InlineError>

                  <div className="flex items-center justify-end gap-3 flex-wrap" style={{ paddingTop: 14, borderTop: '1px solid #EFE8DA' }}>
                    {saved && (
                      <span role="status" className="inline-flex items-center gap-1 font-body text-[13px] font-semibold text-[color:var(--color-status-done)]">
                        <Check size={14} aria-hidden="true" />
                        {t('pages.saved')}
                      </span>
                    )}
                    <PrimaryButton type="submit" loading={saving}>
                      {saving ? t('pages.saving') : t('pages.saveWhatsAppSettings')}
                    </PrimaryButton>
                  </div>
                </form>
              )}
            </SettingsCard>
            {extra}
          </div>

          <TwilioAside
            idPrefix="wa"
            steps={[t('settings.twilio.where1'), t('settings.twilio.where2'), t('settings.whatsapp.where3')]}
            usedBy={t('settings.whatsapp.usedBy')}
          />
        </MainAsideGrid>
      </PageBody>
    </>
  );
};

export default WhatsAppConfigForm;
