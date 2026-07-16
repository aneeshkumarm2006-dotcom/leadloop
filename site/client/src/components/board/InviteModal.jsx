import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Mail, Send } from 'lucide-react';
import { sendInvite } from '../../services/orgService';
import useOrgStore from '../../store/orgStore';

/**
 * InviteModal — popup shown when admin clicks "Invite other member".
 * Displays the org invite link (copyable) and lets the admin send
 * an invite email to any address.
 *
 * Props:
 *   onClose — () => void
 */
const InviteModal = ({ onClose }) => {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id;
  const inviteCode = currentOrg?.inviteCode || '';
  const orgName = currentOrg?.name || 'your workspace';

  const inviteLink = inviteCode
    ? `${window.location.origin}/onboarding?invite=${inviteCode}`
    : '';

  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSend = async () => {
    if (!email.trim() || !orgId) return;
    setSending(true);
    setError('');
    setSent(false);
    try {
      await sendInvite(orgId, email.trim());
      setSent(true);
      setEmail('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send invite. Try again.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSend();
    if (e.key === 'Escape') onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[440px] mx-4 bg-white"
        style={{
          borderRadius: 'var(--radius-xl, 12px)',
          boxShadow: 'var(--shadow-md, 0 8px 32px rgba(0,0,0,0.16))',
          padding: '28px',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2
              className="font-display font-bold text-[17px]"
              style={{ color: 'var(--color-text-primary)', margin: 0 }}
            >
              Invite Members
            </h2>
            <p
              className="font-body text-[13px] mt-0.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Share the link or send an email invite
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-md transition-colors hover:bg-[color:var(--color-bg-subtle)]"
            style={{
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Invite link */}
        <div className="mb-5">
          <p
            className="font-body text-[11px] font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Invite Link
          </p>
          <div
            className="flex items-center gap-2"
            style={{
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              background: 'var(--color-bg-input)',
            }}
          >
            <span
              className="flex-1 font-body text-[12px] truncate select-all"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {inviteLink || 'Loading…'}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!inviteLink}
              aria-label="Copy invite link"
              className="flex items-center gap-1 font-body text-[12px] font-medium shrink-0 transition-colors"
              style={{
                color: copied ? 'var(--color-success, #16a34a)' : 'var(--color-accent)',
                background: 'none',
                border: 'none',
                cursor: inviteLink ? 'pointer' : 'not-allowed',
                padding: '2px 4px',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
          <span
            className="font-body text-[12px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            or invite by email
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
        </div>

        {/* Email input */}
        <div className="mb-3">
          <p
            className="font-body text-[11px] font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Email Address
          </p>
          <div className="flex gap-2">
            <div
              className="flex items-center flex-1"
              style={{
                border: '1.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '0 10px',
                background: 'var(--color-bg-input)',
                height: 36,
              }}
            >
              <Mail size={14} style={{ color: 'var(--color-text-muted)', marginRight: 6, flexShrink: 0 }} />
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setSent(false); setError(''); }}
                onKeyDown={handleKeyDown}
                placeholder="colleague@example.com"
                className="flex-1 font-body bg-transparent focus:outline-none"
                style={{ fontSize: 13, color: 'var(--color-text-primary)', border: 'none' }}
              />
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={!email.trim() || sending}
              className="flex items-center gap-1.5 font-body font-semibold text-[13px] shrink-0 transition-colors"
              style={{
                height: 36,
                padding: '0 16px',
                background: 'var(--color-accent)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: !email.trim() || sending ? 'not-allowed' : 'pointer',
                opacity: !email.trim() || sending ? 0.6 : 1,
              }}
            >
              <Send size={13} />
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>

        {/* Feedback */}
        {sent && (
          <p className="font-body text-[13px]" style={{ color: 'var(--color-success, #16a34a)' }}>
            Invite sent successfully!
          </p>
        )}
        {error && (
          <p className="font-body text-[13px]" style={{ color: 'var(--color-error, #dc2626)' }}>
            {error}
          </p>
        )}
      </div>
    </div>,
    document.body
  );
};

export default InviteModal;
