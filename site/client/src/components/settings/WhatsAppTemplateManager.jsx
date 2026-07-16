import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, Clock, XCircle, FileText } from 'lucide-react';
import Button from '../ui/Button';
import * as whatsappService from '../../services/whatsappService';
import useToastStore from '../../store/toastStore';
import { formatDate } from '../../utils/dateUtils';

/**
 * WhatsAppTemplateManager — list the workspace's WhatsApp templates with their
 * Meta approval status (F11.5, admin-only). A "Sync" button pulls the latest
 * from Twilio's Content API. Only `approved` templates can be sent outside the
 * 24-hour window; `pending`/`rejected` are surfaced but cannot send.
 *
 * Props: workspaceId — the current workspace.
 */
const STATUS_META = {
  approved: { label: 'Approved', icon: CheckCircle2, color: 'var(--color-status-done)' },
  pending: { label: 'Pending approval', icon: Clock, color: 'var(--color-status-working, #D97706)' },
  rejected: { label: 'Rejected', icon: XCircle, color: 'var(--color-status-stuck)' },
};

const WhatsAppTemplateManager = ({ workspaceId }) => {
  const toast = useToastStore.getState();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    whatsappService
      .listTemplates(workspaceId)
      .then(setTemplates)
      .catch((err) => setError(err?.response?.data?.error || 'Failed to load templates'))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSync = async () => {
    if (!workspaceId) return;
    setSyncing(true);
    setError('');
    try {
      const result = await whatsappService.syncTemplates(workspaceId);
      setTemplates(result.templates || []);
      toast.success?.(`Synced ${result.count || 0} template${result.count === 1 ? '' : 's'}`);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not sync templates');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="mt-10 pt-8" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-semibold text-[color:var(--color-text-primary)]" style={{ fontSize: 15 }}>
            Message templates
          </h3>
          <p className="mt-1 font-body text-xs text-[color:var(--color-text-muted)]">
            Pre-approved WhatsApp templates. Only approved templates can be sent outside the 24-hour window.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync from Twilio'}
        </Button>
      </div>

      {error && (
        <p className="font-body text-[12px] mt-3" style={{ color: 'var(--color-status-stuck)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-body mt-3" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Loading…
        </p>
      ) : templates.length === 0 ? (
        <div className="flex items-center gap-2 mt-4" style={{ color: 'var(--color-text-muted)' }}>
          <FileText size={16} aria-hidden="true" />
          <span className="font-body" style={{ fontSize: 13 }}>
            No templates yet. Click “Sync from Twilio” to pull your approved templates.
          </span>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0, maxWidth: 560 }}>
          {templates.map((t) => {
            const meta = STATUS_META[t.status] || STATUS_META.pending;
            const StatusIcon = meta.icon;
            return (
              <li
                key={t._id}
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-surface, #FFFFFF)',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-body font-semibold" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {t.name || t.providerTemplateId}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 font-body font-semibold"
                    style={{ fontSize: 11, color: meta.color }}
                  >
                    <StatusIcon size={13} aria-hidden="true" />
                    {meta.label}
                  </span>
                </div>
                <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {t.body}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                    {t.providerTemplateId}
                  </span>
                  <span className="font-body" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                    {t.language}
                  </span>
                  {t.lastSyncedAt && (
                    <span className="font-body" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      Synced {formatDate(t.lastSyncedAt)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default WhatsAppTemplateManager;
