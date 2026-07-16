import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  Check,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ArrowRight,
  Terminal,
  Braces,
  FileCode,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import Button from '../ui/Button';
import { Toggle } from './automationFields';
import * as leadService from '../../services/leadConnectionService';

/**
 * LeadApiDocsModal — the "connect your website form" documentation popup (F14).
 *
 * Everything a developer needs to wire an external form to this board via the
 * API key: the endpoint, the key (shown in full only right after create/rotate,
 * masked otherwise), copy-paste cURL / JavaScript / HTML snippets, the columns
 * the first submission defined, and a live log of recent submissions so they can
 * confirm it works.
 *
 * Props:
 *   - connection : serialized LeadConnection (ingestUrl, tokenLast4, fields, …)
 *   - apiKey     : plaintext key, or null when it's no longer retrievable
 *   - onClose()  : close the popup
 *   - onRotate() : async → returns the NEW plaintext apiKey (parent persists)
 *   - onReset()  : async → clears the locked schema (parent refreshes)
 *   - onUpdate(payload) : async PATCH (e.g. `{ evolveSchema }`; parent refreshes)
 */

const MASK = '••••••••••••••••';

const CopyButton = ({ value, label }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 12,
        padding: '4px 8px',
        borderRadius: 'var(--radius-md)',
        border: '1.5px solid var(--color-border)',
        background: 'transparent',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? t('leadApi.copied', 'Copied') : label || t('leadApi.copy', 'Copy')}
    </button>
  );
};

const CodeBlock = ({ code }) => (
  <div style={{ position: 'relative' }}>
    <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
      <CopyButton value={code} />
    </div>
    <pre
      style={{
        margin: 0,
        padding: '14px 16px',
        paddingTop: 40,
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-subtle, #0f172a10)',
        border: '1px solid var(--color-border)',
        overflowX: 'auto',
        fontSize: 12.5,
        lineHeight: 1.6,
        color: 'var(--color-text-primary)',
      }}
    >
      <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre' }}>{code}</code>
    </pre>
  </div>
);

const Step = ({ n, title, children }) => (
  <div className="flex gap-3" style={{ alignItems: 'flex-start' }}>
    <div
      className="flex items-center justify-center shrink-0"
      style={{
        width: 24,
        height: 24,
        borderRadius: '999px',
        background: 'var(--color-accent)',
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {n}
    </div>
    <div>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</p>
      <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{children}</p>
    </div>
  </div>
);

const TYPE_LABELS = {
  text: 'Text', long_text: 'Long text', number: 'Number', email: 'Email',
  phone: 'Phone', date: 'Date', link: 'Link', checkbox: 'Checkbox',
};

const buildSnippets = (endpoint, key) => {
  const k = key || 'YOUR_API_KEY';
  const curl = `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${k}' \\
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1 555 0100",
    "message": "Send me a quote"
  }'`;

  const js = `await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${k}',
  },
  body: JSON.stringify({
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1 555 0100',
    message: 'Send me a quote',
  }),
});`;

  const html = `<form id="lead-form">
  <input name="name" placeholder="Your name" required />
  <input name="email" type="email" placeholder="Email" required />
  <input name="phone" placeholder="Phone" />
  <textarea name="message" placeholder="Message"></textarea>
  <button type="submit">Send</button>
</form>

<script>
  document.getElementById('lead-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await fetch('${endpoint}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': '${k}' },
      body: JSON.stringify(data),
    });
    e.target.reset();
    alert('Thanks! We received your message.');
  });
</script>`;

  return { curl, js, html };
};

const TABS = [
  { id: 'curl', label: 'cURL', icon: Terminal },
  { id: 'js', label: 'JavaScript', icon: Braces },
  { id: 'html', label: 'HTML form', icon: FileCode },
];

const fmtTime = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
};

const LeadApiDocsModal = ({ connection, apiKey, onClose, onRotate, onReset, onUpdate }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState('curl');
  const [revealedKey, setRevealedKey] = useState(apiKey || null);
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState(null);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => { setRevealedKey(apiKey || null); }, [apiKey]);

  const endpoint = connection?.ingestUrl || '';
  const snippets = buildSnippets(endpoint, revealedKey);
  const fields = connection?.fields || [];

  const loadSubs = useCallback(() => {
    if (!connection?._id) return;
    setLoadingSubs(true);
    leadService
      .listSubmissions(connection._id, 15)
      .then(setSubs)
      .catch(() => setSubs([]))
      .finally(() => setLoadingSubs(false));
  }, [connection?._id]);

  useEffect(() => { loadSubs(); }, [loadSubs]);

  // A failed action must never be silent: surface the server error (e.g. 403
  // for non-admin members) instead of letting the rejection escape the handler.
  const failMessage = (e) =>
    e?.response?.data?.error || t('leadApi.updateError', 'Could not update the API key settings.');

  const rotate = async () => {
    if (!onRotate) return;
    setBusy(true);
    setActionError(null);
    try {
      const newKey = await onRotate();
      if (newKey) setRevealedKey(newKey);
    } catch (e) {
      setActionError(failMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!onReset) return;
    if (!window.confirm(t('leadApi.resetConfirm', 'Forget the current field mapping? The next submission will define the columns again. Existing board columns are kept.'))) return;
    setBusy(true);
    setActionError(null);
    try {
      await onReset();
      loadSubs();
    } catch (e) {
      setActionError(failMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setEvolve = async (v) => {
    if (!onUpdate) return;
    setBusy(true);
    setActionError(null);
    try {
      await onUpdate({ evolveSchema: v });
    } catch (e) {
      setActionError(failMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* How it works */}
      <section>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
          {t('leadApi.intro', 'Connect any external form to this board. Point it at the endpoint below with your API key — every submission becomes a new lead here. You don’t map fields up front:')}
          {' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {t('leadApi.introEmphasis', 'the first submission automatically defines your columns')}
          </strong>.
        </p>
        <div className="flex flex-col gap-3">
          <Step n={1} title={t('leadApi.step1Title', 'Copy your endpoint & key')}>
            {t('leadApi.step1Body', 'Both are below. The key authenticates your form to this board only.')}
          </Step>
          <Step n={2} title={t('leadApi.step2Title', 'Send submissions as JSON')}>
            {t('leadApi.step2Body', 'POST the form fields to the endpoint with the X-API-Key header. Use any field names you like.')}
          </Step>
          <Step n={3} title={t('leadApi.step3Title', 'Columns build themselves')}>
            {t('leadApi.step3Body', 'The first submission creates a column per field (detecting emails, phones, numbers…). After that, any new field you send automatically adds a column — every lead always lands in the right place.')}
          </Step>
        </div>
      </section>

      {/* Endpoint */}
      <section>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
          {t('leadApi.endpoint', 'Endpoint')}
        </label>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
          <code style={{ flex: 1, minWidth: 220, fontSize: 12.5, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>
            <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>POST</span> {endpoint}
          </code>
          <CopyButton value={endpoint} />
        </div>
      </section>

      {/* API key */}
      <section>
        <label className="inline-flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
          <KeyRound size={13} /> {t('leadApi.apiKey', 'API key')}
        </label>
        {revealedKey ? (
          <>
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
              <code style={{ flex: 1, minWidth: 220, fontSize: 12.5, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>
                {revealedKey}
              </code>
              <CopyButton value={revealedKey} label={t('leadApi.copyKey', 'Copy key')} />
            </div>
            <p className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-status-working, #B45309)', marginTop: 6 }}>
              <AlertTriangle size={13} />
              {t('leadApi.keyOnceWarning', 'Copy this now — for your security it won’t be shown again.')}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
            <code style={{ flex: 1, minWidth: 220, fontSize: 12.5, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-muted)' }}>
              lk_{MASK}{connection?.tokenLast4 || ''}
            </code>
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={rotate} disabled={busy}>
              {t('leadApi.rotateReveal', 'Rotate to reveal')}
            </Button>
          </div>
        )}
      </section>

      {/* Snippets */}
      <section>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
          {t('leadApi.examples', 'Examples')}
        </label>
        <div className="flex items-center gap-1" style={{ margin: '8px 0 10px' }}>
          {TABS.map((tb) => {
            const Icon = tb.icon;
            const active = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                className="inline-flex items-center gap-1.5"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1.5px solid',
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                  background: active ? 'var(--color-accent-light)' : 'transparent',
                  color: active ? 'var(--color-accent-text, var(--color-accent))' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <Icon size={13} /> {tb.label}
              </button>
            );
          })}
        </div>
        <CodeBlock code={snippets[tab]} />
        {tab === 'html' && (
          <p className="inline-flex items-start gap-1.5" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            <AlertTriangle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            {t('leadApi.htmlKeyNote', 'A key embedded in a public page is visible in its source. It can only create leads on this one board and is rate-limited, but for stricter control POST from your server (cURL/JavaScript) and keep the key server-side.')}
          </p>
        )}
      </section>

      {/* Detected schema */}
      <section>
        <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
          {t('leadApi.columns', 'Columns from your form')}
        </label>
        {fields.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
            {t('leadApi.columnsEmpty', 'No submissions yet. Your columns will appear here automatically after the first one lands.')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                  <th style={{ padding: '4px 8px' }}>{t('leadApi.colField', 'Form field')}</th>
                  <th style={{ padding: '4px 8px' }}>{t('leadApi.colColumn', 'Board column')}</th>
                  <th style={{ padding: '4px 8px' }}>{t('leadApi.colType', 'Type')}</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.sourceKey} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '4px 8px' }}><code style={{ fontSize: 12 }}>{f.sourceKey}</code></td>
                    <td style={{ padding: '4px 8px', color: 'var(--color-text-secondary)' }}>{f.label}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--color-text-muted)' }}>{TYPE_LABELS[f.type] || f.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {onUpdate && (
          <div style={{ marginTop: 10 }}>
            <div className="flex items-center gap-2">
              <Toggle
                checked={connection?.evolveSchema !== false}
                disabled={busy}
                onChange={setEvolve}
              />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {t('leadApi.evolveToggle', 'Auto-add columns for new fields')}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {connection?.evolveSchema !== false
                ? t('leadApi.evolveOnHint', 'New fields in future submissions will create new columns automatically.')
                : t('leadApi.evolveOffHint', 'Schema is frozen: unknown fields are logged as warnings and won’t create columns.')}
            </p>
          </div>
        )}
      </section>

      {/* Recent submissions */}
      <section>
        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
            <Inbox size={13} /> {t('leadApi.recent', 'Recent submissions')}
          </label>
          <button type="button" onClick={loadSubs} title={t('leadApi.refresh', 'Refresh')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <RefreshCw size={13} />
          </button>
        </div>
        {loadingSubs && !subs ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 6 }}>{t('leadApi.loading', 'Loading…')}</p>
        ) : !subs || subs.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
            {t('leadApi.recentEmpty', 'Nothing yet. Send a test submission with the snippet above to confirm it works.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" style={{ marginTop: 8 }}>
            {subs.map((s) => (
              <li key={s._id} className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12, padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <span style={{ fontWeight: 700, color: s.status === 'rejected' ? 'var(--color-status-stuck)' : 'var(--color-status-done)' }}>
                  {s.status}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>{fmtTime(s.createdAt)}</span>
                {s.error && <span style={{ color: 'var(--color-status-stuck)' }}>· {s.error}</span>}
                {Array.isArray(s.warnings) && s.warnings.length > 0 && (
                  <span style={{ color: 'var(--color-status-working, #B45309)' }}>· {s.warnings.length} {t('leadApi.warnings', 'warning(s)')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer actions */}
      {actionError && (
        <p className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-status-stuck, #DC2626)' }}>
          <AlertTriangle size={13} /> {actionError}
        </p>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={rotate} disabled={busy}>
            {t('leadApi.rotateKey', 'Rotate key')}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
            {t('leadApi.resetSchema', 'Reset field mapping')}
          </Button>
        </div>
        <Button variant="primary" size="sm" onClick={onClose}>
          {t('leadApi.done', 'Done')}
        </Button>
      </div>
    </div>
  );
};

export default LeadApiDocsModal;
