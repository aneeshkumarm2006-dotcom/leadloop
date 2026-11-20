import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import Button from '../ui/Button';
import { ClaudeIcon, OpenAIIcon } from '../icons/AiBrandIcons';
import { AI_MODELS, defaultModelFor } from '../icons/aiModels';
import { updateAiSettings } from '../../services/profileService';
import useAuthStore from '../../store/authStore';
import useToastStore from '../../store/toastStore';
import { Pill, SelectField } from './ads/AdsShared';
import { SettingsHeader, SettingsCard, CardTitle, CardText, InlineError } from './SettingsLayout';

/**
 * AiKeysConfigForm — Settings → AI keys. The personal AI drafter: Anthropic
 * (Claude) and OpenAI (ChatGPT) API keys side by side, plus the default
 * provider + model used by the "Describe what you want" automation drafter.
 *
 * Keys are per-user: stored AES-encrypted server-side and never sent back, so
 * an empty field means "unchanged" — the header Save only submits keys the user
 * actually typed (a blank string would clear the stored key). The provider /
 * model pickers save as soon as they change.
 */

const fieldClass =
  'w-full font-mono focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_rgba(62,107,78,0.15)]';

const KeyCard = ({ id, icon, tint, name, vendor, placeholder, present, value, onChange, helpHref, helpLabel }) => {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);
  const inputId = useId();
  const hintId = useId();
  return (
    <SettingsCard aria-labelledby={id} style={{ gap: 14 }}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex items-center justify-center shrink-0" style={{ width: 42, height: 42, borderRadius: 12, background: tint }}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <CardTitle id={id} size={18}>{name}</CardTitle>
          <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{vendor}</div>
        </div>
        {present ? <Pill tone="ok" dot>{t('settings.ai.keySaved')}</Pill> : <Pill tone="neutral">{t('settings.ai.noKey')}</Pill>}
      </div>
      <div className="flex flex-col gap-[7px] font-body">
        <label htmlFor={inputId} className="font-bold" style={{ fontSize: 13.5 }}>{t('settings.ai.keyLabel')}</label>
        <div className="relative">
          <input
            id={inputId}
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={present ? `••••••••••••••••  ${t('pages.aiKeyReplaceHint')}` : placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hintId}
            className={fieldClass}
            style={{ height: 46, padding: '0 44px 0 14px', borderRadius: 12, border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-input)', fontSize: 13, color: 'var(--color-text-primary)' }}
          />
          {value && (
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? t('pages.aiKeyHide') : t('pages.aiKeyShow')}
              aria-pressed={reveal}
              className="absolute top-1/2 -translate-y-1/2 right-2 inline-flex items-center justify-center rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-accent)]"
              style={{ width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {reveal ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          )}
        </div>
        <span id={hintId} style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{t('settings.ai.keyHint')}</span>
      </div>
      <a
        href={helpHref}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start font-body font-semibold hover:underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
        style={{ fontSize: 13, color: 'var(--color-accent)', borderRadius: 4 }}
      >
        {helpLabel} <span aria-hidden="true">→</span>
        <span className="sr-only"> {t('settings.ai.opensNewTab')}</span>
      </a>
    </SettingsCard>
  );
};

const AiKeysConfigForm = () => {
  const { t } = useTranslation();
  const formId = useId();
  const toast = useToastStore.getState();
  const user = useAuthStore((s) => s.user);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const present = user?.aiKeysPresent || {};

  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [provider, setProvider] = useState(user?.aiProvider || 'claude');
  const [model, setModel] = useState(user?.aiModel || defaultModelFor(user?.aiProvider || 'claude'));

  useEffect(() => {
    if (user?.aiProvider) setProvider(user.aiProvider);
    if (user?.aiModel) setModel(user.aiModel);
  }, [user?.aiProvider, user?.aiModel]);

  const dirty = !!(anthropicKey.trim() || openaiKey.trim());

  const handleSave = async (e) => {
    e.preventDefault();
    if (!dirty || saving) return;
    const patch = {};
    if (anthropicKey.trim()) patch.anthropicKey = anthropicKey.trim();
    if (openaiKey.trim()) patch.openaiKey = openaiKey.trim();
    setSaving(true);
    setError('');
    try {
      await updateAiSettings(patch);
      await fetchCurrentUser();
      setAnthropicKey('');
      setOpenaiKey('');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      toast.success?.(t('pages.aiKeysSavedToast'));
    } catch (err) {
      setError(err.response?.data?.error || t('pages.couldNotSave'));
    } finally {
      setSaving(false);
    }
  };

  const persistModel = (next) => {
    updateAiSettings(next)
      .then(() => fetchCurrentUser())
      .catch((err) => toast.error?.(err?.response?.data?.error || t('pages.couldNotSave')));
  };
  const chooseProvider = (p) => {
    const m = defaultModelFor(p);
    setProvider(p);
    setModel(m);
    persistModel({ aiProvider: p, aiModel: m });
  };
  const chooseModel = (m) => {
    setModel(m);
    persistModel({ aiModel: m });
  };

  return (
    <>
      <SettingsHeader
        tab="ai"
        title={t('pages.aiKeysTitle')}
        subtitle={t('settings.ai.subtitle')}
        actions={
          <>
            {saved && (
              <span role="status" className="inline-flex items-center gap-1 font-body text-[13px] font-semibold text-[color:var(--color-status-done)]">
                <Check size={14} aria-hidden="true" />
                {t('pages.saved')}
              </span>
            )}
            <Button type="submit" form={formId} variant="primary" size="lg" disabled={!dirty || saving}>
              {saving ? t('pages.saving') : t('pages.save')}
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-5">
          <form id={formId} onSubmit={handleSave} className="flex flex-col gap-3">
            <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
              <KeyCard
                id={`${formId}-claude`}
                icon={<ClaudeIcon size={22} />}
                tint="#F4E4DA"
                name="Claude"
                vendor="Anthropic"
                placeholder="sk-ant-..."
                present={!!present.anthropic}
                value={anthropicKey}
                onChange={setAnthropicKey}
                helpHref="https://console.anthropic.com/settings/keys"
                helpLabel={t('settings.ai.claudeHelp')}
              />
              <KeyCard
                id={`${formId}-openai`}
                icon={<OpenAIIcon size={22} color="#1F5C4A" />}
                tint="#E3EEEA"
                name="ChatGPT"
                vendor="OpenAI"
                placeholder="sk-..."
                present={!!present.openai}
                value={openaiKey}
                onChange={setOpenaiKey}
                helpHref="https://platform.openai.com/api-keys"
                helpLabel={t('settings.ai.openaiHelp')}
              />
            </div>
            <InlineError>{error}</InlineError>
          </form>

          {/* Default drafter model */}
          <SettingsCard aria-labelledby={`${formId}-model`} className="flex-wrap items-center" style={{ gap: 20, flexDirection: 'row' }}>
            <div className="min-w-0" style={{ flex: '1 1 320px' }}>
              <CardTitle id={`${formId}-model`} size={18}>{t('settings.ai.defaultModelTitle')}</CardTitle>
              <CardText style={{ marginTop: 4 }}>{t('pages.aiDefaultModelHint')}</CardText>
            </div>
            <div className="grid gap-3 min-w-0" style={{ flex: '0 1 520px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
              <SelectField
                label={t('settings.ai.providerLabel')}
                value={provider}
                onChange={chooseProvider}
                options={[
                  { value: 'claude', label: t('settings.ai.claudeOption') },
                  { value: 'openai', label: t('settings.ai.openaiOption') },
                ]}
              />
              <SelectField
                label={t('settings.ai.modelLabel')}
                value={model || ''}
                onChange={chooseModel}
                options={(AI_MODELS[provider] || []).map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>
          </SettingsCard>
        </div>
      </PageBody>
    </>
  );
};

export default AiKeysConfigForm;
