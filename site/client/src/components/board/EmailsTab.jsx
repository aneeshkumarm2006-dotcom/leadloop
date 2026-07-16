import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, MailOpen, ArrowDownLeft, ArrowUpRight, CornerUpLeft, Plus, MousePointerClick } from 'lucide-react';
import * as emailService from '../../services/emailService';
import { timeAgo, formatDate } from '../../utils/dateUtils';
import EmailComposeModal from './EmailComposeModal';

/**
 * EmailsTab — the task drawer's email thread (F8.6).
 *
 * Lists the task's sent + received emails (newest first), a read pane for the
 * selected message, a Compose button, and per-message Reply. Outbound rows
 * surface tracking — an "Opened" badge once a recipient triggers the pixel (AC4)
 * and a click count when links are followed.
 *
 * Props:
 *   task — populated task
 *   onCountChange(n) — bubbles the message count to the tab badge
 */
// Maps an email status to its `itemTabs.*` translation key.
const STATUS_LABEL_KEYS = {
  queued: 'itemTabs.statusQueued',
  sent: 'itemTabs.statusSent',
  failed: 'itemTabs.statusFailed',
  bounced: 'itemTabs.statusBounced',
  received: 'itemTabs.statusReceived',
};

const EmailsTab = ({ task, onCountChange }) => {
  const { t } = useTranslation();
  const taskId = task?._id || null;
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);

  const reload = useCallback(() => {
    if (!taskId) return;
    setLoading(true);
    setError('');
    emailService
      .listTaskEmails(taskId)
      .then((list) => {
        setEmails(list);
        onCountChange?.(list.length);
        if (list.length && !selectedId) setSelectedId(list[0]._id);
      })
      .catch((err) => setError(err?.response?.data?.error || t('itemTabs.emailsLoadError')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, onCountChange]);

  useEffect(() => {
    setEmails([]);
    setSelectedId(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const handleSent = (msg) => {
    setEmails((prev) => {
      const next = [msg, ...prev];
      onCountChange?.(next.length);
      return next;
    });
    setSelectedId(msg._id);
  };

  const openCompose = (reply = null) => {
    setReplyTo(reply);
    setComposeOpen(true);
  };

  const selected = emails.find((e) => e._id === selectedId) || null;

  return (
    <div className="flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      {/* Header row with Compose */}
      <div className="flex items-center justify-between" style={{ padding: '10px 16px' }}>
        <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('itemTabs.messageCount', { count: emails.length })}
        </span>
        <button
          type="button"
          onClick={() => openCompose(null)}
          disabled={!taskId}
          className="inline-flex items-center gap-1 font-body transition-colors duration-150 hover:bg-accent-hover"
          style={{
            height: 30,
            padding: '0 12px',
            background: 'var(--color-accent)',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: 12,
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: taskId ? 'pointer' : 'not-allowed',
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {t('itemTabs.newEmail')}
        </button>
      </div>

      {error && (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--color-status-stuck)', padding: '0 16px 8px' }}>
          {error}
        </p>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <p className="font-body text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}>
            {t('itemTabs.loadingEmails')}
          </p>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center" style={{ padding: '32px 16px', gap: 8 }}>
            <Mail size={28} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
            <p className="font-body text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('itemTabs.noEmailsOnLead')}
            </p>
          </div>
        ) : (
          <>
            {/* Message list */}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflowY: 'auto', borderBottom: '1px solid var(--color-border)' }}>
              {emails.map((m) => {
                const isActive = m._id === selectedId;
                const isOut = m.direction === 'out';
                const opened = Array.isArray(m.openedAt) && m.openedAt.length > 0;
                return (
                  <li key={m._id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(m._id)}
                      className="w-full text-left transition-colors duration-150"
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '10px 16px',
                        background: isActive ? 'var(--color-bg-subtle)' : 'transparent',
                        border: 'none',
                        borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ paddingTop: 2, color: 'var(--color-text-muted)' }}>
                        {isOut ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-body truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {isOut ? t('itemTabs.toRecipients', { recipients: (m.to || []).join(', ') }) : m.from}
                          </span>
                          <span className="font-body shrink-0" style={{ fontSize: 11, color: 'var(--color-text-muted)' }} title={formatDate(m.sentAt)}>
                            {timeAgo(m.sentAt)}
                          </span>
                        </span>
                        <span className="font-body truncate block" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          {m.subject || t('itemTabs.noSubject')}
                        </span>
                        <span className="flex items-center gap-2 mt-1">
                          <StatusBadge status={m.status} />
                          {isOut && opened && (
                            <span className="inline-flex items-center gap-1 font-body" style={{ fontSize: 10, color: 'var(--color-status-done)' }}>
                              <MailOpen size={11} /> {t('itemTabs.opened')}
                            </span>
                          )}
                          {isOut && Array.isArray(m.clicks) && m.clicks.length > 0 && (
                            <span className="inline-flex items-center gap-1 font-body" style={{ fontSize: 10, color: 'var(--color-accent)' }}>
                              <MousePointerClick size={11} /> {m.clicks.length}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Read pane */}
            {selected && (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>
                <div className="flex items-start justify-between gap-3">
                  <div style={{ minWidth: 0 }}>
                    <p className="font-display" style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                      {selected.subject || t('itemTabs.noSubject')}
                    </p>
                    <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      {selected.direction === 'out' ? t('itemTabs.to') : t('itemTabs.from')}:{' '}
                      {selected.direction === 'out' ? (selected.to || []).join(', ') : selected.from}
                    </p>
                    <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {formatDate(selected.sentAt)} · {STATUS_LABEL_KEYS[selected.status] ? t(STATUS_LABEL_KEYS[selected.status]) : selected.status}
                      {selected.provider ? t('itemTabs.viaProvider', { provider: selected.provider }) : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCompose(selected)}
                    className="inline-flex items-center gap-1 font-body shrink-0"
                    style={{ fontSize: 12, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    <CornerUpLeft size={13} aria-hidden="true" /> {t('itemTabs.reply')}
                  </button>
                </div>

                <div
                  className="font-body"
                  style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}
                  // Body HTML is sanitised server-side before storage.
                  dangerouslySetInnerHTML={{ __html: selected.bodyHtml || `<p>${(selected.body || '').replace(/\n/g, '<br/>')}</p>` }}
                />

                {Array.isArray(selected.attachments) && selected.attachments.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {selected.attachments.map((a) => (
                      <li key={a.url}>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-body"
                          style={{ fontSize: 12, color: 'var(--color-accent)' }}
                        >
                          {a.name || t('itemTabs.attachment')}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {composeOpen && (
        <EmailComposeModal
          isOpen={composeOpen}
          onClose={() => setComposeOpen(false)}
          task={task}
          onSent={handleSent}
          replyTo={replyTo}
        />
      )}
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const { t } = useTranslation();
  const color =
    status === 'failed' || status === 'bounced'
      ? 'var(--color-status-stuck)'
      : status === 'received'
        ? 'var(--color-accent)'
        : status === 'sent'
          ? 'var(--color-status-done)'
          : 'var(--color-text-muted)';
  return (
    <span className="font-body" style={{ fontSize: 10, fontWeight: 600, color }}>
      {STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status}
    </span>
  );
};

export default EmailsTab;
