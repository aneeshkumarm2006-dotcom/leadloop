import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, CheckCircle2, XCircle, MinusCircle, History } from 'lucide-react';
import * as automationService from '../../services/automationService';

/**
 * AutomationRunLog — slide-over drawer showing the last 20 firings of one
 * automation (F4.7). Reads `GET /api/automations/:id/run-log` which returns the
 * capped `triggerHistory[]` most-recent-first: each row carries a timestamp, the
 * matching task, a matched flag, and per-action outcomes.
 *
 * `resolveTaskName(taskId)` is optional — when supplied (the board page has the
 * task list in memory) firings show the task title instead of a raw id.
 */
const STATUS_META = {
  ok: { color: 'var(--color-status-done, #16A34A)', Icon: CheckCircle2, label: 'ok' },
  failed: { color: 'var(--color-status-stuck, #DC2626)', Icon: XCircle, label: 'failed' },
  skipped: { color: 'var(--color-text-muted, #9CA3AF)', Icon: MinusCircle, label: 'skipped' },
};

const formatTimestamp = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const shortId = (id) => {
  if (!id) return '—';
  const s = id.toString();
  return s.length > 8 ? `…${s.slice(-6)}` : s;
};

const ActionOutcome = ({ outcome, t }) => {
  const meta = STATUS_META[outcome.status] || STATUS_META.skipped;
  const { Icon } = meta;
  const statusLabel = t(`automation.runStatus_${meta.label}`);
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} color={meta.color} style={{ marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
      <div className="min-w-0">
        <span
          className="font-body"
          style={{ fontSize: 12, color: 'var(--color-text-primary)' }}
        >
          {outcome.actionType}
        </span>
        <span
          className="font-body"
          style={{ fontSize: 11, color: meta.color, marginLeft: 6 }}
        >
          {statusLabel}
        </span>
        {outcome.error && (
          <p
            className="font-body"
            style={{ fontSize: 11, color: 'var(--color-status-stuck, #DC2626)', marginTop: 2 }}
          >
            {outcome.error}
          </p>
        )}
      </div>
    </div>
  );
};

const AutomationRunLog = ({
  isOpen,
  onClose,
  automationId,
  automationName,
  resolveTaskName,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const displayName = automationName || t('automation.automationFallback');

  useEffect(() => {
    if (!isOpen || !automationId) return undefined;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await automationService.getRunLog(automationId);
        if (active) setRows(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load run log:', err);
        if (active) {
          setError(
            err?.response?.data?.error || t('automation.runLogLoadError')
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [isOpen, automationId, t]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label={t('automation.runLogForLabel', { name: displayName })}
        style={{
          position: 'relative',
          width: 'min(420px, 100vw)',
          height: '100%',
          background: 'var(--color-bg-surface)',
          borderLeft: '1.5px solid var(--color-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          className="flex items-center justify-between"
          style={{
            padding: '14px 16px',
            borderBottom: '1.5px solid var(--color-border)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <History size={16} color="var(--color-text-secondary)" aria-hidden="true" />
            <div className="min-w-0">
              <p
                className="font-display font-semibold truncate"
                style={{ fontSize: 14, color: 'var(--color-text-primary)' }}
              >
                {t('automation.runLogTitle')}
              </p>
              <p
                className="font-body truncate"
                style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
              >
                {displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('automation.closeRunLog')}
            className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]"
            style={{ width: 30, height: 30, border: '1.5px solid var(--color-border)', cursor: 'pointer' }}
          >
            <X size={14} color="var(--color-text-secondary)" />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {loading ? (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('automation.loading')}
            </p>
          ) : error ? (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck, #DC2626)' }}>
              {error}
            </p>
          ) : rows.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{ padding: '40px 16px', color: 'var(--color-text-muted)' }}
            >
              <History size={26} aria-hidden="true" />
              <p className="font-body mt-2" style={{ fontSize: 14 }}>
                {t('automation.noFiringsYet')}
              </p>
              <p className="font-body" style={{ fontSize: 12 }}>
                {t('automation.noFiringsHint')}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row, i) => {
                const taskLabel =
                  (resolveTaskName && row.taskId && resolveTaskName(row.taskId)) ||
                  (row.taskId
                    ? t('automation.runLogLead', { id: shortId(row.taskId) })
                    : t('automation.runLogNoLead'));
                const actions = Array.isArray(row.actionsRun) ? row.actionsRun : [];
                return (
                  <li
                    key={i}
                    style={{
                      border: '1.5px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      background: 'var(--color-bg-input)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="font-body truncate"
                        style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}
                      >
                        {taskLabel}
                      </span>
                      <span
                        className="font-body shrink-0"
                        style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
                      >
                        {formatTimestamp(row.firedAt)}
                      </span>
                    </div>
                    {!row.matched && (
                      <span
                        className="font-body"
                        style={{
                          display: 'inline-block',
                          marginTop: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--color-bg-subtle)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {t('automation.conditionNotMet')}
                      </span>
                    )}
                    {actions.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {actions.map((o, j) => (
                          <ActionOutcome key={j} outcome={o} t={t} />
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
};

export default AutomationRunLog;
