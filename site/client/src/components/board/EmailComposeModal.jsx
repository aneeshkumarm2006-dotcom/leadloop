import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, X, Send } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import RichEditor from './RichEditor';
import * as emailService from '../../services/emailService';
import useToastStore from '../../store/toastStore';

/**
 * EmailComposeModal — compose + send an email on a task (F8.6).
 *
 * Reuses RichEditor (TipTap) for the body; subject + to/cc/bcc fields; a
 * Cloudinary attachment picker. Sends through `POST /api/tasks/:id/emails`,
 * which routes via the user's connected mailbox (or the Resend fallback).
 *
 * Props:
 *   isOpen, onClose
 *   task        — the task the email is attached to
 *   onSent(msg) — called with the created EmailMessage on success
 *   replyTo     — optional EmailMessage to reply to (prefills to/subject/thread)
 */
const splitAddrs = (value) =>
  (value || '')
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const EmailComposeModal = ({ isOpen, onClose, task, onSent, replyTo = null }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  const [to, setTo] = useState(replyTo?.from || '');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${(replyTo.subject || '').replace(/^Re:\s*/i, '')}` : ''
  );
  const [bodyEmpty, setBodyEmpty] = useState(true);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleEditorChange = (state) => setBodyEmpty(state.isEmpty);

  const handlePickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of files) {
        const att = await emailService.uploadAttachment(file);
        setAttachments((prev) => [...prev, att]);
      }
    } catch (err) {
      setError(err?.response?.data?.error || t('itemTabs.attachmentUploadFailed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (url) =>
    setAttachments((prev) => prev.filter((a) => a.url !== url));

  const handleSend = async () => {
    const toList = splitAddrs(to);
    if (!toList.length) {
      setError(t('itemTabs.addAtLeastOneRecipient'));
      return;
    }
    const bodyHtml = editorRef.current?.getHTML?.() || '';
    if (bodyEmpty || !editorRef.current?.getText?.().trim()) {
      setError(t('itemTabs.writeMessageBeforeSending'));
      return;
    }
    setSending(true);
    setError('');
    try {
      const payload = {
        to: toList,
        cc: splitAddrs(cc),
        bcc: splitAddrs(bcc),
        subject,
        body: bodyHtml,
        attachments,
        inReplyTo: replyTo?.messageId || null,
        threadId: replyTo?.threadId || null,
      };
      const { email, via } = await emailService.sendTaskEmail(task._id, payload);
      toast.success?.(
        via === 'resend'
          ? t('itemTabs.sentViaCrm')
          : t('itemTabs.emailSent')
      );
      onSent?.(email);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || t('itemTabs.emailSendError'));
    } finally {
      setSending(false);
    }
  };

  const fieldStyle = {
    height: 38,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={replyTo ? t('itemTabs.reply') : t('itemTabs.newEmail')}
      maxWidth={620}
      closeOnOverlayClick={!sending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            {t('itemTabs.cancel')}
          </Button>
          <Button variant="primary" icon={Send} onClick={handleSend} disabled={sending || uploading}>
            {sending ? t('itemTabs.sending') : t('itemTabs.send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* To */}
        <label className="flex flex-col gap-1">
          <span className="font-body text-[12px] font-semibold text-[color:var(--color-text-secondary)]">{t('itemTabs.to')}</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('itemTabs.recipientPlaceholder')}
              className="flex-1 font-body text-[13px] px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
              style={fieldStyle}
            />
            {!showCcBcc && (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="font-body text-[12px] text-[color:var(--color-accent)]"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                {t('itemTabs.ccBcc')}
              </button>
            )}
          </div>
        </label>

        {showCcBcc && (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-body text-[12px] font-semibold text-[color:var(--color-text-secondary)]">{t('itemTabs.cc')}</span>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="font-body text-[13px] px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
                style={fieldStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-body text-[12px] font-semibold text-[color:var(--color-text-secondary)]">{t('itemTabs.bcc')}</span>
              <input
                type="text"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                className="font-body text-[13px] px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
                style={fieldStyle}
              />
            </label>
          </>
        )}

        {/* Subject */}
        <label className="flex flex-col gap-1">
          <span className="font-body text-[12px] font-semibold text-[color:var(--color-text-secondary)]">{t('itemTabs.subject')}</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('itemTabs.subject')}
            className="font-body text-[13px] px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
            style={fieldStyle}
          />
        </label>

        {/* Body */}
        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 10px',
            minHeight: 160,
          }}
        >
          <RichEditor
            placeholder={t('itemTabs.writeYourMessagePlaceholder')}
            editorRef={editorRef}
            onChange={handleEditorChange}
          />
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <ul className="flex flex-col gap-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {attachments.map((a) => (
              <li
                key={a.url}
                className="flex items-center gap-2 font-body text-[12px]"
                style={{
                  background: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                }}
              >
                <Paperclip size={12} aria-hidden="true" />
                <span className="flex-1 truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.url)}
                  aria-label={t('itemTabs.removeAttachment', { name: a.name })}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 font-body text-[12px] text-[color:var(--color-text-secondary)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <Paperclip size={14} aria-hidden="true" />
            {uploading ? t('itemTabs.uploading') : t('itemTabs.attachFiles')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handlePickFiles}
            className="hidden"
            aria-label={t('itemTabs.attachFiles')}
          />
        </div>

        {error && (
          <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default EmailComposeModal;
