import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, ChevronDown, Copy, Check, Send, Search } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
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

const CHIP_STYLES = {
  blue: { background: 'var(--color-accent-light)', color: '#2C5138' },
  gold: { background: 'var(--color-status-working-bg)', color: 'var(--color-status-working)' },
  grey: { background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' },
};

const Chip = ({ children, variant = 'grey' }) => {
  const styles = CHIP_STYLES[variant] || CHIP_STYLES.grey;
  return (
    <span
      className="inline-flex items-center font-body font-semibold"
      style={{
        height: 22,
        padding: '0 10px',
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 'var(--radius-full)',
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
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const options = ['admin', 'member'];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`Role: ${currentRole === 'admin' ? 'Admin' : 'Member'}`}
        className="inline-flex items-center gap-1 font-body font-semibold text-[12px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          height: 28,
          padding: '0 10px',
          border: '1px solid var(--color-border-strong)',
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
  const { t } = useTranslation();
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

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSend();
  };

  const fieldBox = {
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-bg-input)',
  };
  const copyBtn = {
    height: 38,
    padding: '0 12px',
    borderRadius: 9,
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface)',
    fontWeight: 600,
    fontSize: 13,
    flexShrink: 0,
  };

  return (
    <aside
      aria-labelledby="invite-people-heading"
      className="flex flex-col"
      style={{
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        boxShadow: 'var(--shadow-card)',
        padding: 22,
        gap: 16,
      }}
    >
      <h2
        id="invite-people-heading"
        className="font-display font-bold"
        style={{ margin: 0, fontSize: 18, color: 'var(--color-text-primary)' }}
      >
        {t('membersPage.invitePeople', 'Invite people')}
      </h2>

      {/* Send invite via email */}
      <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: 8 }} noValidate>
        <label
          htmlFor="invite-email"
          className="font-body font-bold"
          style={{ fontSize: 13, color: 'var(--color-text-primary)' }}
        >
          {t('membersPage.sendViaEmail', 'Send invite via email')}
        </label>
        <div className="flex" style={{ gap: 8 }}>
          <input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSent(false); setError(''); }}
            placeholder="colleague@example.com"
            className="font-body focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            style={{ ...fieldBox, flex: '1 1 auto', minWidth: 0, height: 42, padding: '0 12px', fontSize: 14, color: 'var(--color-text-primary)' }}
          />
          <button
            type="submit"
            disabled={!email.trim() || sending}
            className="inline-flex items-center gap-1.5 font-body font-bold text-[14px] shrink-0 transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
            style={{
              height: 42,
              padding: '0 16px',
              background: 'var(--color-accent)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: !email.trim() || sending ? 'not-allowed' : 'pointer',
              opacity: !email.trim() || sending ? 0.6 : 1,
            }}
          >
            <Send size={13} aria-hidden="true" />
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div aria-live="polite">
          {sent && (
            <p className="font-body text-[13px]" style={{ color: 'var(--color-success)' }}>
              Invite sent successfully!
            </p>
          )}
          {error && (
            <p className="font-body text-[13px]" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          )}
        </div>
      </form>

      {/* Share a link / code */}
      <div
        className="flex flex-col font-body"
        style={{ paddingTop: 14, borderTop: '1px solid var(--color-bg-subtle)', gap: 10, fontSize: 13 }}
      >
        <div className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {t('membersPage.orShareLink', 'Or share a link')}
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <code
            className="font-mono select-all"
            title={inviteLink || undefined}
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              padding: '10px 12px',
              borderRadius: 9,
              background: 'var(--color-bg-base)',
              fontSize: 11.5,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {inviteLink || 'Loading…'}
          </code>
          <button
            type="button"
            onClick={() => handleCopy(inviteLink, 'link')}
            disabled={!inviteLink}
            aria-label="Copy invite link"
            className="inline-flex items-center gap-1 font-body transition-colors hover:bg-[color:var(--color-bg-subtle)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ ...copyBtn, color: copiedLink ? 'var(--color-success)' : 'var(--color-text-primary)' }}
          >
            {copiedLink ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copiedLink ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex items-center flex-wrap" style={{ gap: 8, color: 'var(--color-text-secondary)' }}>
          <span>
            {t('membersPage.inviteCode', 'Invite code:')}{' '}
            <strong className="font-mono" style={{ color: 'var(--color-text-primary)', letterSpacing: '0.08em' }}>
              {inviteCode || 'Loading…'}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => handleCopy(inviteCode, 'code')}
            disabled={!inviteCode}
            aria-label="Copy invite code"
            className="inline-flex items-center gap-1 font-body font-semibold text-[12.5px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: copiedCode ? 'var(--color-success)' : 'var(--color-accent)', background: 'none', border: 'none', padding: '2px 4px' }}
          >
            {copiedCode ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copiedCode ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </aside>
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
  const [query, setQuery] = useState('');
  const { t } = useTranslation();

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

  const q = query.trim().toLowerCase();
  const visibleMembers = q
    ? members.filter((m) => `${m.name || ''} ${m.email || ''}`.toLowerCase().includes(q))
    : members;

  const countLabel = `${members.length} ${members.length === 1 ? 'person' : 'people'} in this workspace`;

  const search = (
    <label
      className="flex items-center gap-2 font-body focus-within:ring-2 focus-within:ring-[color:var(--color-accent)]"
      style={{
        height: 40,
        padding: '0 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-strong)',
        background: 'var(--color-bg-input)',
        color: 'var(--color-text-secondary)',
        width: 260,
        maxWidth: '100%',
      }}
    >
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('membersPage.search', 'Search members')}
        aria-label={t('membersPage.search', 'Search members')}
        className="bg-transparent focus:outline-none"
        style={{ border: 'none', fontSize: 13.5, width: '100%', color: 'var(--color-text-primary)' }}
      />
    </label>
  );

  const thStyle = { padding: '12px 10px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'left', whiteSpace: 'nowrap' };
  const tdStyle = { padding: '13px 10px', borderTop: '1px solid var(--color-bg-subtle)', verticalAlign: 'middle' };

  const roleChip = (isTheMainAdmin, isAnAdmin) =>
    isTheMainAdmin ? (
      <Chip variant="blue">Owner</Chip>
    ) : isAnAdmin ? (
      <Chip variant="gold">Admin</Chip>
    ) : (
      <Chip variant="grey">Member</Chip>
    );

  const table = (
    <section
      aria-label="Members"
      className="bg-surface min-w-0"
      style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}
    >
      <table className="w-full font-body" style={{ borderCollapse: 'collapse', fontSize: 13.5, tableLayout: 'auto' }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-input)' }}>
            <th scope="col" style={{ ...thStyle, paddingLeft: 20, borderTopLeftRadius: 'var(--radius-lg)' }}>Member</th>
            <th scope="col" className="hidden md:table-cell" style={thStyle}>Email</th>
            <th scope="col" className="hidden md:table-cell" style={thStyle}>Role</th>
            <th scope="col" className="hidden lg:table-cell" style={thStyle}>Joined</th>
            <th scope="col" style={{ ...thStyle, paddingRight: 20, borderTopRightRadius: 'var(--radius-lg)' }}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleMembers.map((m) => {
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
              <tr key={m._id}>
                {/* Avatar + name (email + role underneath on small screens) */}
                <td style={{ ...tdStyle, paddingLeft: 20 }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar user={m} size={32} />
                    <div className="min-w-0">
                      <p className="font-bold text-[color:var(--color-text-primary)] truncate">
                        {m.name || 'Unnamed'}
                        {isSelf && (
                          <span className="ml-1.5 font-normal text-[color:var(--color-text-secondary)]">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="md:hidden text-[12px] text-[color:var(--color-text-secondary)] truncate">
                        {m.email}
                      </p>
                      <div className="md:hidden mt-1">{roleChip(isTheMainAdmin, isAnAdmin)}</div>
                    </div>
                  </div>
                </td>

                <td className="hidden md:table-cell" style={{ ...tdStyle, color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>
                  {m.email}
                </td>

                <td className="hidden md:table-cell" style={tdStyle}>
                  {canChangeRole ? (
                    <RoleDropdown
                      currentRole={memberRole}
                      onChange={(newRole) => handleRoleChange(m._id, newRole)}
                      disabled={changingRole === m._id}
                    />
                  ) : (
                    roleChip(isTheMainAdmin, isAnAdmin)
                  )}
                </td>

                <td className="hidden lg:table-cell" style={{ ...tdStyle, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                  {m.createdAt ? formatShortDate(m.createdAt) : '—'}
                </td>

                <td style={{ ...tdStyle, paddingRight: 20, textAlign: 'right' }}>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => setConfirmMember(m)}
                      className="inline-flex items-center gap-1 font-body font-semibold text-[13px] transition-colors hover:bg-[color:var(--color-status-stuck-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-status-stuck)]"
                      style={{
                        height: 32,
                        padding: '0 12px',
                        borderRadius: 8,
                        border: '1px solid #E8C9C2',
                        background: 'var(--color-bg-surface)',
                        color: 'var(--color-status-stuck)',
                      }}
                      aria-label={`Remove ${m.name || m.email}`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {q && visibleMembers.length === 0 && (
            <tr>
              <td colSpan={5} style={{ ...tdStyle, padding: '24px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                {t('membersPage.noMatch', 'No members match “{{query}}”.', { query: query.trim() })}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );

  const grid = (
    <div
      className={[
        'grid gap-5 items-start',
        isAdmin ? 'lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]' : '',
      ].join(' ')}
    >
      {table}
      {isAdmin && <InviteSection currentOrg={currentOrg} />}
    </div>
  );

  const removeModal = (
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
  );

  // Embedded (inside Workspace settings): no page chrome — count + search row,
  // then the same table / invite grid.
  if (embedded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-body text-sm text-[color:var(--color-text-secondary)]">{countLabel}</p>
          {search}
        </div>
        {grid}
        {removeModal}
      </div>
    );
  }

  return (
    <PageWrapper flush>
      <PageHeader title="Members" subtitle={countLabel} actions={search} />
      <PageBody>
        {grid}
        {removeModal}
      </PageBody>
    </PageWrapper>
  );
};

export default MembersPage;
