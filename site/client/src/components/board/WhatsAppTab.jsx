import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Send, RefreshCw, Paperclip, X, FileText, Clock } from 'lucide-react';
import * as whatsappService from '../../services/whatsappService';
import useOrgStore from '../../store/orgStore';
import { formatDate, timeAgo } from '../../utils/dateUtils';
import ChatBubble from './ChatBubble';

/**
 * WhatsAppTab — the task drawer's WhatsApp conversation (F11.5).
 *
 * Reuses the shared ChatBubble subcomponent (F10) for the thread. WhatsApp adds
 * the 24-hour customer-service window: inside it free-form messages (and media)
 * send; once it lapses only an APPROVED template may be sent, so a "Send
 * template" picker appears and the free-form composer is disabled (AC1/AC3/AC4).
 * Polls lightly while mounted so inbound replies surface — and re-open the
 * window — without a manual refresh.
 *
 * Props:
 *   task — populated board task (WhatsApp is lead/board scoped)
 *   onCountChange(n) — bubbles the message count to the tab badge
 */

/** Extract ordered, unique `{{n}}` / `{{name}}` placeholder keys from a body. */
const templateVarKeys = (body) => {
  const keys = [];
  const seen = new Set();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(body || ''))) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      keys.push(m[1]);
    }
  }
  return keys;
};

/** Live preview of a template body with the entered variables substituted. */
const renderPreview = (body, vars) =>
  String(body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    vars[key] ? vars[key] : match
  );

const WhatsAppTab = ({ task, onCountChange }) => {
  const { t } = useTranslation();
  const taskId = task?._id || null;
  const workspaceId = useOrgStore((s) => s.currentOrg?._id) || null;

  const [messages, setMessages] = useState([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [lastInboundAt, setLastInboundAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);

  // Media attachment (compose)
  const [media, setMedia] = useState(null); // { url, name, mime }
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateVars, setTemplateVars] = useState({});

  const reload = useCallback(
    (silent = false) => {
      if (!taskId) return;
      if (!silent) setLoading(true);
      whatsappService
        .listTaskWhatsApp(taskId)
        .then((data) => {
          setMessages(data.messages || []);
          setWindowOpen(!!data.windowOpen);
          setLastInboundAt(data.lastInboundAt || null);
          onCountChange?.((data.messages || []).length);
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
    setMedia(null);
    setSelectedTemplate(null);
    setTemplateVars({});
    setShowTemplates(false);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Load the workspace's templates once (for the out-of-window picker).
  useEffect(() => {
    if (!workspaceId) return;
    whatsappService
      .listTemplates(workspaceId)
      .then(setTemplates)
      .catch(() => {});
  }, [workspaceId]);

  // Light poll for inbound replies while the tab is mounted (re-opens window).
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

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'approved'),
    [templates]
  );

  const appendSent = (msg) => {
    setMessages((prev) => {
      const next = [msg, ...prev];
      onCountChange?.(next.length);
      return next;
    });
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const uploaded = await whatsappService.uploadMedia(file);
      setMedia({ url: uploaded.url, name: uploaded.name, mime: uploaded.mime });
    } catch (err) {
      setError(err?.response?.data?.error || t('itemTabs.mediaUploadError'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Free-form (in-window) send.
  const handleSend = async (e) => {
    e?.preventDefault?.();
    const body = draft.trim();
    if ((!body && !media) || sending || !taskId) return;
    setSending(true);
    setError('');
    try {
      const { message } = await whatsappService.sendTaskWhatsApp(taskId, {
        body,
        mediaUrl: media?.url || undefined,
      });
      appendSent(message);
      setDraft('');
      setMedia(null);
    } catch (err) {
      setError(err?.response?.data?.error || t('itemTabs.whatsappSendError'));
    } finally {
      setSending(false);
    }
  };

  // Template (out-of-window or in-window) send.
  const handleSendTemplate = async () => {
    if (!selectedTemplate || sending || !taskId) return;
    setSending(true);
    setError('');
    try {
      const { message } = await whatsappService.sendTaskWhatsApp(taskId, {
        templateId: selectedTemplate.providerTemplateId,
        variables: templateVars,
        mediaUrl: media?.url || undefined,
      });
      appendSent(message);
      setSelectedTemplate(null);
      setTemplateVars({});
      setShowTemplates(false);
      setMedia(null);
    } catch (err) {
      setError(err?.response?.data?.error || t('itemTabs.templateSendError'));
    } finally {
      setSending(false);
    }
  };

  const pickTemplate = (t) => {
    setSelectedTemplate(t);
    const keys = templateVarKeys(t.body);
    const next = {};
    keys.forEach((k) => { next[k] = ''; });
    setTemplateVars(next);
  };

  const selectedKeys = selectedTemplate ? templateVarKeys(selectedTemplate.body) : [];

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

      {/* 24h window banner */}
      <div style={{ padding: '0 16px 8px' }}>
        {windowOpen ? (
          <span
            className="inline-flex items-center gap-1 font-body"
            style={{ fontSize: 11, color: 'var(--color-status-done)' }}
          >
            <MessageCircle size={12} aria-hidden="true" />
            {t('itemTabs.windowOpen')}
            {lastInboundAt ? t('itemTabs.lastReply', { time: timeAgo(lastInboundAt) }) : ''}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 font-body"
            style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
            title={lastInboundAt ? t('itemTabs.lastInbound', { date: formatDate(lastInboundAt) }) : t('itemTabs.noInboundReply')}
          >
            <Clock size={12} aria-hidden="true" />
            {t('itemTabs.windowClosed')}
          </span>
        )}
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
            <MessageCircle size={28} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
            <p className="font-body text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('itemTabs.noWhatsappMessages')}
            </p>
          </div>
        ) : (
          ordered.map((m) => (
            <ChatBubble
              key={m._id}
              message={m}
              meta={m.mediaUrl ? <MediaThumb url={m.mediaUrl} /> : null}
            />
          ))
        )}
      </div>

      {/* Template picker panel */}
      {showTemplates && (
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-bg-subtle, #F9FAFB)',
            padding: '10px 16px',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="font-body font-semibold" style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
              {selectedTemplate ? t('itemTabs.fillTemplateVariables') : t('itemTabs.chooseApprovedTemplate')}
            </span>
            <button
              type="button"
              onClick={() => { setShowTemplates(false); setSelectedTemplate(null); }}
              aria-label={t('itemTabs.closeTemplatePicker')}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}
            >
              <X size={14} />
            </button>
          </div>

          {!selectedTemplate ? (
            approvedTemplates.length === 0 ? (
              <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {t('itemTabs.noApprovedTemplates')}
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {approvedTemplates.map((t) => (
                  <li key={t._id}>
                    <button
                      type="button"
                      onClick={() => pickTemplate(t)}
                      className="w-full text-left transition-colors hover:bg-[color:var(--color-bg-surface,#FFFFFF)]"
                      style={{
                        padding: '8px 10px',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        background: '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <span className="font-body font-semibold" style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                        {t.name || t.providerTemplateId}
                      </span>
                      <span className="block font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {t.body}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="flex flex-col gap-2">
              {selectedKeys.length === 0 ? (
                <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {t('itemTabs.templateNoVariables')}
                </p>
              ) : (
                selectedKeys.map((k) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {`{{${k}}}`}
                    </span>
                    <input
                      type="text"
                      value={templateVars[k] || ''}
                      onChange={(e) => setTemplateVars((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="font-body focus:outline-none"
                      style={{
                        fontSize: 13,
                        padding: '6px 8px',
                        border: '1.5px solid var(--color-border-strong)',
                        borderRadius: 'var(--radius-md)',
                        background: '#FFFFFF',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </label>
                ))
              )}
              <div
                className="font-body"
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  background: '#FFFFFF',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 10px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {renderPreview(selectedTemplate.body, templateVars)}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="font-body transition-colors hover:bg-[color:var(--color-bg-surface,#FFFFFF)]"
                  style={{
                    height: 32, padding: '0 12px', fontSize: 12, fontWeight: 500,
                    background: 'transparent', color: 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  }}
                >
                  {t('itemTabs.back')}
                </button>
                <button
                  type="button"
                  onClick={handleSendTemplate}
                  disabled={sending}
                  className="inline-flex items-center gap-2 font-body disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover"
                  style={{
                    height: 32, padding: '0 14px', fontSize: 12, fontWeight: 600,
                    background: 'var(--color-accent)', color: '#FFFFFF', border: 'none',
                    borderRadius: 'var(--radius-md)', cursor: sending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Send size={13} aria-hidden="true" />
                  {sending ? t('itemTabs.sending') : t('itemTabs.sendTemplate')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSend}
        style={{ borderTop: '1px solid var(--color-border)', padding: '10px 16px 14px 16px', background: '#FFFFFF' }}
      >
        {media && (
          <div
            className="flex items-center gap-2"
            style={{
              marginBottom: 8, padding: '6px 8px', fontSize: 12,
              background: 'var(--color-bg-subtle, #F3F4F6)', borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <FileText size={13} aria-hidden="true" />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{media.name}</span>
            <button
              type="button"
              onClick={() => setMedia(null)}
              aria-label={t('itemTabs.removeAttachmentSimple')}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" aria-label={t('itemTabs.attachMedia')} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!taskId || uploading || sending}
            aria-label={t('itemTabs.attachMedia')}
            className="inline-flex items-center justify-center transition-colors hover:bg-[color:var(--color-bg-subtle)]"
            style={{
              width: 38, height: 38, flexShrink: 0,
              background: 'transparent', border: '1px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-md)', cursor: taskId && !uploading ? 'pointer' : 'not-allowed',
              color: 'var(--color-text-secondary)',
            }}
          >
            <Paperclip size={15} aria-hidden="true" />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={windowOpen ? t('itemTabs.typeAMessage') : t('itemTabs.windowClosedUseTemplate')}
            rows={2}
            disabled={!taskId || sending || !windowOpen}
            className="flex-1 font-body focus:outline-none disabled:opacity-60"
            style={{
              resize: 'none', fontSize: 13, lineHeight: 1.5, padding: '8px 10px',
              color: 'var(--color-text-primary)', background: 'var(--color-bg-surface, #FFFFFF)',
              border: '1.5px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)',
            }}
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !media) || sending || !taskId || !windowOpen}
            className="inline-flex items-center justify-center gap-2 font-body whitespace-nowrap transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover"
            style={{
              height: 38, padding: '0 14px', background: 'var(--color-accent)', color: '#FFFFFF',
              fontWeight: 600, fontSize: 13, border: 'none', borderRadius: 'var(--radius-md)',
              cursor: (draft.trim() || media) && !sending && windowOpen ? 'pointer' : 'not-allowed',
            }}
          >
            <Send size={14} aria-hidden="true" />
            {sending ? t('itemTabs.sending') : t('itemTabs.send')}
          </button>
        </div>
        <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
          <span className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {uploading ? t('itemTabs.uploading') : windowOpen ? t('itemTabs.cmdEnterToSend') : t('itemTabs.freeFormLocked')}
          </span>
          <button
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            disabled={!taskId}
            className="inline-flex items-center gap-1 font-body transition-colors hover:bg-[color:var(--color-bg-subtle)]"
            style={{
              height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600,
              background: 'transparent', color: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)',
              cursor: taskId ? 'pointer' : 'not-allowed',
            }}
          >
            <MessageCircle size={13} aria-hidden="true" />
            {t('itemTabs.sendTemplate')}
          </button>
        </div>
      </form>
    </div>
  );
};

/** A small media preview rendered under a chat bubble. */
const MediaThumb = ({ url }) => {
  const { t } = useTranslation();
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(url || '');
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 4, display: 'inline-block' }}>
        <img
          src={url}
          alt={t('itemTabs.whatsappMedia')}
          style={{ maxWidth: 180, maxHeight: 180, borderRadius: 10, objectFit: 'cover', display: 'block' }}
        />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-body"
      style={{ marginTop: 4, fontSize: 11, color: 'var(--color-accent)' }}
    >
      <FileText size={12} aria-hidden="true" />
      {t('itemTabs.viewAttachment')}
    </a>
  );
};

export default WhatsAppTab;
