import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff } from 'lucide-react';
import Button from '../ui/Button';
import { ClaudeIcon, OpenAIIcon } from '../icons/AiBrandIcons';
import { AI_MODELS, defaultModelFor } from '../icons/aiModels';
import { updateAiSettings } from '../../services/profileService';
import useAuthStore from '../../store/authStore';
import useToastStore from '../../store/toastStore';

/**
 * AiKeysConfigForm — standalone Settings tab (like SMS / WhatsApp) for the
 * personal AI drafter. Holds the Anthropic (Claude) and OpenAI (ChatGPT) API
 * keys plus the default provider + model used by the "Describe what you want"
 * automation drafter.
 *
 * Keys are per-user: stored AES-encrypted server-side and never sent back, so an
 * empty field means "unchanged" — we only submit a key the user actually types.
 */

// One provider key row: brand icon + label, a masked input (placeholder shows
// whether a key is saved), a show/hide toggle, and a Save button.
const KeyRow = ({ icon, label, placeholder, present, onSave }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(value.trim());
      setValue('');
      setReveal(false);
    } catch (err) {
      setError(err.response?.data?.error || t('pages.couldNotSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-body font-semibold text-[13px] text-[color:var(--color-text-primary)]">
          {label}
        </span>
        {present && (
          <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold text-[color:var(--color-status-done)]">
            <Check size={12} aria-hidden="true" />
            {t('pages.aiKeySaved')}
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <input
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={present ? '••••••••••••••••  ' + t('pages.aiKeyReplaceHint') : placeholder}
            autoComplete="off"
            className="w-full font-mono text-[13px] text-[color:var(--color-text-primary)] bg-[color:var(--color-bg-subtle)] pl-3 pr-9 focus:outline-none focus:border-[color:var(--color-accent)]"
            style={{ height: 38, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
          />
          {value && (
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? t('pages.aiKeyHide') : t('pages.aiKeyShow')}
              className="absolute top-1/2 -translate-y-1/2 right-2 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
            >
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
        </div>
        <Button variant="secondary" size="default" onClick={handleSave} disabled={saving || !value.trim()}>
          {saving ? t('pages.saving') : t('pages.save')}
        </Button>
      </div>
      {error && (
        <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]">{error}</p>
      )}
    </div>
  );
};

const AiKeysConfigForm = () => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const user = useAuthStore((s) => s.user);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const present = user?.aiKeysPresent || {};

  const [provider, setProvider] = useState(user?.aiProvider || 'claude');
  const [model, setModel] = useState(user?.aiModel || defaultModelFor(user?.aiProvider || 'claude'));

  useEffect(() => {
    if (user?.aiProvider) setProvider(user.aiProvider);
    if (user?.aiModel) setModel(user.aiModel);
  }, [user?.aiProvider, user?.aiModel]);

  const saveKey = async (patch) => {
    await updateAiSettings(patch);
    await fetchCurrentUser();
    toast.success?.(t('pages.aiKeysSavedToast'));
  };

  const persistModel = (next) => {
    updateAiSettings(next).then(() => fetchCurrentUser()).catch(() => {});
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

  const PROVIDERS = [
    { key: 'claude', label: 'Claude' },
    { key: 'openai', label: 'ChatGPT' },
  ];

  return (
    <div>
      <header className="mb-6">
        <h2 className="font-display font-bold text-[color:var(--color-text-primary)]" style={{ fontSize: 20 }}>
          {t('pages.aiKeysTitle')}
        </h2>
        <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
          {t('pages.aiKeysDescription')}
        </p>
      </header>

      {/* Provider keys */}
      <div className="flex flex-col gap-5" style={{ maxWidth: 480 }}>
        <KeyRow
          icon={<ClaudeIcon size={18} />}
          label={t('pages.aiKeyAnthropic')}
          placeholder="sk-ant-..."
          present={!!present.anthropic}
          onSave={(key) => saveKey({ anthropicKey: key })}
        />
        <KeyRow
          icon={<OpenAIIcon size={18} color="var(--color-text-primary)" />}
          label={t('pages.aiKeyOpenai')}
          placeholder="sk-..."
          present={!!present.openai}
          onSave={(key) => saveKey({ openaiKey: key })}
        />
      </div>

      {/* Default drafter model */}
      <section className="mt-10 pt-8" style={{ maxWidth: 480, borderTop: '1px solid var(--color-border)' }}>
        <h3 className="font-display font-semibold text-[color:var(--color-text-primary)]" style={{ fontSize: 15 }}>
          {t('pages.aiDefaultModel')}
        </h3>
        <p className="mt-1 font-body text-xs text-[color:var(--color-text-muted)]">
          {t('pages.aiDefaultModelHint')}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div
            className="inline-flex gap-1 p-1"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 9999 }}
          >
            {PROVIDERS.map(({ key, label }) => {
              const on = provider === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => chooseProvider(key)}
                  aria-pressed={on}
                  className="inline-flex items-center gap-2 font-body font-semibold transition-colors"
                  style={{
                    height: 32,
                    padding: '0 14px',
                    borderRadius: 9999,
                    fontSize: 13,
                    border: 'none',
                    cursor: 'pointer',
                    background: on ? 'var(--color-bg-surface)' : 'transparent',
                    color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    boxShadow: on ? 'var(--shadow-card)' : 'none',
                  }}
                >
                  {key === 'claude'
                    ? <ClaudeIcon size={15} color={on ? undefined : 'currentColor'} />
                    : <OpenAIIcon size={15} color={on ? undefined : 'currentColor'} />}
                  {label}
                </button>
              );
            })}
          </div>

          <select
            value={model || ''}
            onChange={(e) => chooseModel(e.target.value)}
            className="font-body text-[13px] text-[color:var(--color-text-primary)] bg-[color:var(--color-bg-surface)] px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
            style={{ height: 38, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            {(AI_MODELS[provider] || []).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
};

export default AiKeysConfigForm;
