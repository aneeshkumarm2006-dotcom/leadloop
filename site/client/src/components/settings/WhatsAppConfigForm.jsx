import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import * as whatsappService from '../../services/whatsappService';
import useToastStore from '../../store/toastStore';

/**
 * WhatsAppConfigForm — workspace Twilio WhatsApp credentials (F11.5, admin-only).
 *
 * Account SID, a write-only Auth Token field (the stored token is never sent
 * back — leave blank to keep it), and the WhatsApp sender id (the approved
 * `whatsapp:`-capable number). Reuses the F10 Twilio account + the shared opt-out
 * list, so a STOP suppresses both SMS and WhatsApp. Mirrors SmsConfigForm.
 *
 * Props: workspaceId — the current workspace.
 */
const WhatsAppConfigForm = ({ workspaceId }) => {
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

  return (
    <div>
      <header className="mb-6">
        <h2 className="font-display font-bold text-[color:var(--color-text-primary)]" style={{ fontSize: 20 }}>
          {t('pages.whatsAppTwilio')}
        </h2>
        <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
          {t('pages.whatsAppDescription')}
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
            helperText={t('pages.authTokenHelperWhatsApp')}
            autoComplete="off"
          />
          <Input
            label={t('pages.whatsAppSenderNumber')}
            value={whatsappSenderId}
            onChange={(e) => setWhatsappSenderId(e.target.value)}
            placeholder="+14155238886"
            helperText={t('pages.whatsAppSenderHelper')}
          />

          <div className="flex items-center gap-3 mt-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t('pages.saving') : t('pages.saveWhatsAppSettings')}
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

export default WhatsAppConfigForm;
