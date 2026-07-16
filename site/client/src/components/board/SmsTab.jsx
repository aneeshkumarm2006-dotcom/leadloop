import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Send, RefreshCw } from 'lucide-react';
import * as smsService from '../../services/smsService';
import ChatBubble from './ChatBubble';

/**
 * SmsTab — the task drawer's SMS conversation (F10.5).
 *
 * A chat-bubble thread (shared ChatBubble subcomponent, reused by F11 WhatsApp)
 * of inbound + outbound messages with delivery status (AC4), plus a compose box
 * to send a manual reply. Polls lightly while mounted so inbound replies surface
 * without a manual refresh (AC3).
 *
 * Props:
 *   task — populated board task (SMS is lead/board scoped)
 *   onCountChange(n) — bubbles the message count to the tab badge
 */
const SmsTab = ({ task, onCountChange }) => {
  const { t } = useTranslation();
  const taskId = task?._id || null;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);

  const reload = useCallback(
    (silent = false) => {
      if (!taskId) return;
      if (!silent) setLoading(true);
      smsService
        .listTaskSms(taskId)
        .then((list) => {
          setMessages(list);
          onCountChange?.(list.length);
        })
        .catch((err) => {
          if (!silent) setError(err?.response?.data?.error || t('itemTabs.messagesLoadError'));
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [taskId, onCountChange, t]
  );

  useEffect(() => {
    setMessages([]);
    setError('');
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Light poll for inbound replies while the tab is mounted (AC3).
  useEffect(() => {
    if (!taskId) return undefined;
    const id = setInterval(() => reload(true), 8000);
    return () => clearInterval(id);
  }, [taskId, reload]);

  // API returns newest-first; render oldest-first like a chat.
  const ordered = useMemo(
    () => [...messages].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()),
    [messages]
  );

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [ordered.length]);

  const handleSend = async (e) => {
    e?.preventDefault?.();
    const body = draft.trim();
    if (!body || sending || !taskId) return;
    setSending(true);
    setError('');
    try {
      const msg = await smsService.sendTaskSms(taskId, { body });
      setMessages((prev) => {
        const next = [msg, ...prev];
        onCountChange?.(next.length);
        return next;
      });
      setDraft('');
    } catch (err) {
      setError(err?.response?.data?.error || t('itemTabs.smsSendError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      <div className="flex items-center justify-between" style={{ padding: '10px 16px' }}>
        <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('itemTabs.messageCount', { count: messages.length })}
        </span>
        <button
          type="button"
          onClick={() => reload()}
          disabled={!taskId}
          aria-label={t('itemTabs.refreshMessages')}
          className="inline-flex items-center justify-center transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            cursor: taskId ? 'pointer' : 'not-allowed',
            color: 'var(--color-text-secondary)',
          }}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>

      {error && (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--color-status-stuck)', padding: '0 16px 8px' }}>
          {error}
        </p>
      )}

      <div ref={threadRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px' }}>
        {loading ? (
          <p className="font-body text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}>
            {t('itemTabs.loadingMessages')}
          </p>
        ) : ordered.length === 0 ? (
          <div className="flex flex-col items-center justify-center" style={{ padding: '32px 16px', gap: 8 }}>
            <MessageSquare size={28} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
            <p className="font-body text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('itemTabs.noSmsOnLead')}
            </p>
          </div>
        ) : (
          ordered.map((m) => <ChatBubble key={m._id} message={m} />)
        )}
      </div>

      <form
        onSubmit={handleSend}
        style={{ borderTop: '1px solid var(--color-border)', padding: '10px 16px 14px 16px', background: '#FFFFFF' }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t('itemTabs.typeAMessage')}
            rows={2}
            disabled={!taskId || sending}
            className="flex-1 font-body focus:outline-none"
            style={{
              resize: 'none',
              fontSize: 13,
              lineHeight: 1.5,
              padding: '8px 10px',
              color: 'var(--color-text-primary)',
              background: 'var(--color-bg-surface, #FFFFFF)',
              border: '1.5px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-md)',
            }}
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || !taskId}
            className="inline-flex items-center justify-center gap-2 font-body whitespace-nowrap transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover"
            style={{
              height: 38,
              padding: '0 14px',
              background: 'var(--color-accent)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 13,
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
            }}
          >
            <Send size={14} aria-hidden="true" />
            {sending ? t('itemTabs.sending') : t('itemTabs.send')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SmsTab;
