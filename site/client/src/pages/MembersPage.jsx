import { useEffect, useRef, useState } from 'react';
import { Trash2, ChevronDown, Copy, Check, Mail, Send, Link, Hash } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import * as orgService from '../services/orgService';
import { formatShortDate } from '../utils/dateUtils';

const AVATAR_COLORS = [
  '#3E6B4E', '#6E8B3D', '#B08A3C', '#C4632B', '#7A5A44', '#4E7A70'
];
const getInitial = (name) => (name ? name.trim().charAt(0).toUpperCase() : '?');
const getAvatarColor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const Avatar = ({ user, size = 40 }) => {
  const [imgError, setImgError] = useState(false);
  if (user?.profilePic && !imgError) {
    return (
      <img
        src={user.profilePic}
        alt={user.name || 'Avatar'}
        className="object-cover"
        style={{ width: size, height: size, borderRadius: 9999 }}
        onError={() => setImgError(true)}
      />
    );
  }
  const seed = user?.email || user?.name || '';
  return (
    <div
      className="flex items-center justify-center font-display font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: getAvatarColor(seed),
        fontSize: size * 0.4,
      }}
      aria-hidden="true"
    >
      {getInitial(user?.name)}
    </div>
  );
};

const Chip = ({ children, variant = 'grey' }) => {
  const styles =
    variant === 'blue'
      ? {
          background: 'var(--color-accent-light)',
          color: 'var(--color-accent-text)',
        }
      : {
          background: 'var(--color-bg-subtle)',
          color: 'var(--color-text-secondary)',
        };
  return (
    <span
      className="inline-flex items-center font-body font-semibold"
      style={{
        height: 22,
        padding: '0 10px',
        fontSize: 11,
        borderRadius: 'var(--radius-full)',
        letterSpacing: 0.3,
        ...styles,
      }}
    >
      {children}
    </span>
  );
};

const RoleDropdown = ({ currentRole, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const options = ['admin', 'member'];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="inline-flex items-center gap-1 font-body font-semibold text-[12px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          height: 26,
          padding: '0 8px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {currentRole === 'admin' ? 'Admin' : 'Member'}
        {!disabled && <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1"
          style={{
            minWidth: 100,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-surface)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                setOpen(false);
                if (opt !== currentRole) onChange(opt);
              }}
              className="block w-full text-left font-body text-[12px] px-3 py-1.5 hover:bg-[color:var(--color-bg-subtle)]"
              style={{
                color: 'var(--color-text-primary)',
                fontWeight: opt === currentRole ? 600 : 400,
              }}
            >
              {opt === 'admin' ? 'Admin' : 'Member'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const InviteSection = ({ currentOrg }) => {
  const inviteCode = currentOrg?.inviteCode || '';
  const inviteLink = inviteCode
    ? `${window.location.origin}/onboarding?invite=${inviteCode}`
    : '';

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = (text, type) => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    });
  };

  const handleSend = async () => {
    if (!email.trim() || !currentOrg?._id) return;
    setSending(true);
    setError('');
    setSent(false);
    try {
      await orgService.sendInvite(currentOrg._id, email.trim());
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
  };

  return (
    <div
      className="mb-6"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        boxShadow: 'var(--shadow-card)',
        padding: '20px 24px',
      }}
    >
      <h2
        className="font-display font-bold text-[15px] mb-4"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Invite People
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Invite Link */}
        <div>
          <p
            className="font-body text-[11px] font-semibold uppercase tracking-widest mb-1.5 flex items-center gap-1.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Link size={12} />
            Invite Link
          </p>
          <div
            className="flex items-center gap-2"
            style={{
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              background: 'var(--color-bg-input)',
              height: 36,
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
              onClick={() => handleCopy(inviteLink, 'link')}
              disabled={!inviteLink}
              aria-label="Copy invite link"
              className="flex items-center gap-1 font-body text-[12px] font-medium shrink-0 transition-colors"
              style={{
                color: copiedLink ? 'var(--color-success, #16a34a)' : 'var(--color-accent)',
                background: 'none',
                border: 'none',
                cursor: inviteLink ? 'pointer' : 'not-allowed',
                padding: '2px 4px',
              }}
            >
              {copiedLink ? <Check size={13} /> : <Copy size={13} />}
              {copiedLink ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Invite Code */}
        <div>
          <p
            className="font-body text-[11px] font-semibold uppercase tracking-widest mb-1.5 flex items-center gap-1.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Hash size={12} />
            Invite Code
          </p>
          <div
            className="flex items-center gap-2"
            style={{
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              background: 'var(--color-bg-input)',
              height: 36,
            }}
          >
            <span
              className="flex-1 font-body text-[14px] font-semibold tracking-widest select-all"
              style={{ color: 'var(--color-text-primary)', letterSpacing: '0.15em' }}
            >
              {inviteCode || 'Loading…'}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(inviteCode, 'code')}
              disabled={!inviteCode}
              aria-label="Copy invite code"
              className="flex items-center gap-1 font-body text-[12px] font-medium shrink-0 transition-colors"
              style={{
                color: copiedCode ? 'var(--color-success, #16a34a)' : 'var(--color-accent)',
                background: 'none',
                border: 'none',
                cursor: inviteCode ? 'pointer' : 'not-allowed',
                padding: '2px 4px',
              }}
            >
              {copiedCode ? <Check size={13} /> : <Copy size={13} />}
              {copiedCode ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      {/* Send invite via email */}
      <div>
        <p
          className="font-body text-[11px] font-semibold uppercase tracking-widest mb-1.5 flex items-center gap-1.5"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Mail size={12} />
          Send Invite via Email
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
        {sent && (
          <p className="font-body text-[13px] mt-2" style={{ color: 'var(--color-success, #16a34a)' }}>
            Invite sent successfully!
          </p>
        )}
        {error && (
          <p className="font-body text-[13px] mt-2" style={{ color: 'var(--color-error, #dc2626)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

const MembersPage = ({ embedded = false }) => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const members = useOrgStore((s) => s.members);
  const adminId = useOrgStore((s) => s.adminId);
  const adminIds = useOrgStore((s) => s.adminIds);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);

  const [confirmMember, setConfirmMember] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [changingRole, setChangingRole] = useState(null);

  // Resolve admin-ness
  const orgAdminId =
    typeof currentOrg?.admin === 'object' && currentOrg?.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg?.admin;
  const isMainAdmin =
    !!user && !!orgAdminId && String(orgAdminId) === String(user._id);
  const orgAdminsArr = currentOrg?.admins || [];
  const isExtraAdmin =
    !!user &&
    orgAdminsArr.some((a) => {
      const id = typeof a === 'object' && a !== null ? a._id || a : a;
      return String(id) === String(user._id);
    });
  const isAdmin = isMainAdmin || isExtraAdmin;

  useEffect(() => {
    if (currentOrg?._id) {
      fetchMembers(currentOrg._id).catch(() => {});
    }
  }, [currentOrg?._id, fetchMembers]);

  const handleRemove = async () => {
    if (!confirmMember || !currentOrg?._id) return;
    setRemoving(true);
    try {
      await orgService.removeMember(currentOrg._id, confirmMember._id);
      await fetchMembers(currentOrg._id);
      setConfirmMember(null);
    } finally {
      setRemoving(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    if (!currentOrg?._id) return;
    setChangingRole(userId);
    try {
      await orgService.changeRole(currentOrg._id, userId, newRole);
      await fetchMembers(currentOrg._id);
    } finally {
      setChangingRole(null);
    }
  };

  const resolvedAdminId = adminId || orgAdminId;

  const content = (
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        <header className="mb-6">
          {!embedded && (
            <h1
              className="font-display font-bold text-[color:var(--color-text-primary)]"
              style={{ fontSize: 28, letterSpacing: '-0.01em' }}
            >
              Members
            </h1>
          )}
          <p
            className="font-body text-sm text-[color:var(--color-text-secondary)]"
            style={{ marginTop: embedded ? 0 : 4 }}
          >
            {members.length} {members.length === 1 ? 'person' : 'people'} in this workspace
          </p>
        </header>

        <div
          className="bg-surface"
          style={{
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'visible',
            }}
          >
            {/* Table header */}
            <div
              className="hidden md:grid grid-cols-[1fr_1fr_110px_110px_110px] items-center px-4"
              style={{
                height: 40,
                background: 'var(--color-bg-subtle)',
                borderBottom: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              }}
            >
              {['Member', 'Email', 'Role', 'Joined', ''].map((h) => (
                <span
                  key={h}
                  className="font-body font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)]"
                  style={{ fontSize: 11 }}
                >
                  {h}
                </span>
              ))}
            </div>

            {members.map((m) => {
              const isTheMainAdmin = String(m._id) === String(resolvedAdminId);
              const isAnAdmin = isTheMainAdmin || (adminIds || []).includes(String(m._id));
              const isSelf = String(m._id) === String(user?._id);
              const memberRole = isAnAdmin ? 'admin' : 'member';

              const canChangeRole =
                isAdmin &&
                !isTheMainAdmin &&
                !isSelf &&
                (isMainAdmin || !isAnAdmin);

              const canRemove = isAdmin && !isTheMainAdmin && !isSelf;

              return (
                <div
                  key={m._id}
                  className="grid grid-cols-[1fr_110px] md:grid-cols-[1fr_1fr_110px_110px_110px] items-center gap-2 px-4 py-3"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {/* Avatar + name */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar user={m} size={32} />
                    <div className="min-w-0">
                      <p className="font-body font-semibold text-[13px] text-[color:var(--color-text-primary)] truncate">
                        {m.name || 'Unnamed'}
                        {isSelf && (
                          <span className="ml-2 font-body font-normal text-[11px] text-[color:var(--color-text-muted)]">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="md:hidden font-body text-[11px] text-[color:var(--color-text-muted)] truncate">
                        {m.email}
                      </p>
                    </div>
                  </div>

                  {/* Email (desktop) */}
                  <div className="hidden md:block min-w-0">
                    <p className="font-body text-[13px] text-[color:var(--color-text-secondary)] truncate">
                      {m.email}
                    </p>
                  </div>

                  {/* Role chip / dropdown */}
                  <div className="hidden md:block">
                    {isTheMainAdmin ? (
                      <Chip variant="blue">Owner</Chip>
                    ) : canChangeRole ? (
                      <RoleDropdown
                        currentRole={memberRole}
                        onChange={(newRole) => handleRoleChange(m._id, newRole)}
                        disabled={changingRole === m._id}
                      />
                    ) : isAnAdmin ? (
                      <Chip variant="blue">Admin</Chip>
                    ) : (
                      <Chip variant="grey">Member</Chip>
                    )}
                  </div>

                  {/* Joined date */}
                  <div className="hidden md:block">
                    <span className="font-body text-[12px] text-[color:var(--color-text-muted)]">
                      {m.createdAt ? formatShortDate(m.createdAt) : '—'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end md:justify-start">
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => setConfirmMember(m)}
                        className="inline-flex items-center gap-1 font-body font-semibold text-[12px] text-[color:var(--color-status-stuck)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-status-stuck)] rounded"
                        aria-label={`Remove ${m.name || m.email}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Remove
                      </button>
                    ) : (
                      <span className="md:block hidden">
                        {isTheMainAdmin ? (
                          <Chip variant="blue">Owner</Chip>
                        ) : null}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {isAdmin && <div className="mt-6"><InviteSection currentOrg={currentOrg} /></div>}

        {/* Confirm remove modal */}
        <Modal
          isOpen={!!confirmMember}
          onClose={() => (removing ? null : setConfirmMember(null))}
          title="Remove member"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmMember(null)}
                disabled={removing}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRemove} disabled={removing}>
                {removing ? 'Removing…' : 'Remove'}
              </Button>
            </>
          }
        >
          <p className="font-body text-[14px] text-[color:var(--color-text-primary)]">
            Remove{' '}
            <strong>{confirmMember?.name || confirmMember?.email}</strong> from
            this organisation? They will lose access to all boards and tasks.
          </p>
        </Modal>
      </div>
  );

  return embedded ? content : <PageWrapper>{content}</PageWrapper>;
};

export default MembersPage;
