import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import * as smsService from '../../services/smsService';
import useToastStore from '../../store/toastStore';

/**
 * SmsConfigForm — workspace Twilio SMS credentials (F10.5, admin-only).
 *
 * Account SID, a write-only Auth Token field (the stored token is never sent
 * back — leave blank to keep it), the default sender number / Messaging Service
 * SID, and the TCPA/CASL opt-out footer toggle.
 *
 * Props: workspaceId — the current workspace.
 */
const SmsConfigForm = ({ workspaceId }) => {
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

  return (
    <div>
      <header className="mb-6">
        <h2 className="font-display font-bold text-[color:var(--color-text-primary)]" style={{ fontSize: 20 }}>
          {t('pages.smsTwilio')}
        </h2>
        <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
          {t('pages.smsDescription')}
        </p>
      </header>

      {error && (
        <p className="font-body text-[12px] mb-4" style={{ color: 'var(--color-status-stuck)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-body" style={{ color: 'var(--color-text-muted)' }}>
          {t('pages.loading')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" style={{ maxWidth: 480 }}>
          <Input
            label={t('pages.accountSid')}
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <Input
            label={t('pages.authToken')}
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={config?.hasAuthToken ? t('pages.authTokenStoredPlaceholder') : t('pages.twilioAuthToken')}
            helperText={t('pages.authTokenHelperSms')}
            autoComplete="off"
          />
          <Input
            label={t('pages.defaultSenderNumber')}
            value={defaultFrom}
            onChange={(e) => setDefaultFrom(e.target.value)}
            placeholder="+15551234567"
            helperText={t('pages.defaultSenderHelper')}
          />
          <Input
            label={t('pages.messagingServiceSid')}
            value={messagingServiceSid}
            onChange={(e) => setMessagingServiceSid(e.target.value)}
            placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />

          <label className="flex items-start gap-3" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={appendOptOutFooter}
              onChange={(e) => setAppendOptOutFooter(e.target.checked)}
              style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--color-accent)' }}
            />
            <span>
              <span className="font-body font-semibold" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                {t('pages.appendOptOutFooter')}
              </span>
              <span className="block font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {t('pages.optOutFooterHelper')}
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3 mt-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t('pages.saving') : t('pages.saveSmsSettings')}
            </Button>
            {saved && (
              <span className="inline-flex items-center gap-1 font-body text-[12px] font-semibold text-[color:var(--color-status-done)]">
                <Check size={14} aria-hidden="true" />
                {t('pages.saved')}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
};

export default SmsConfigForm;
