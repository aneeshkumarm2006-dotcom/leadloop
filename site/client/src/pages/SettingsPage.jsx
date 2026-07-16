import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Copy, Check, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import SettingsSidebar, { SettingsTabBar } from '../components/settings/SettingsSidebar';
import EmailAccountConnect from '../components/settings/EmailAccountConnect';
import SmsConfigForm from '../components/settings/SmsConfigForm';
import SmsOptOutList from '../components/settings/SmsOptOutList';
import WhatsAppConfigForm from '../components/settings/WhatsAppConfigForm';
import WhatsAppTemplateManager from '../components/settings/WhatsAppTemplateManager';
import AiKeysConfigForm from '../components/settings/AiKeysConfigForm';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import * as orgService from '../services/orgService';
import * as profileService from '../services/profileService';
import * as columnService from '../services/columnService';
import useBoardStore from '../store/boardStore';
import useToastStore from '../store/toastStore';
/**
 * Settings Page — org and profile.
 * See Macan_Design.md Section 7.8.
 */

const AVATAR_COLORS = [
  '#3E6B4E', '#16A34A', '#EA580C', '#7C3AED', '#D97706', '#DC2626',
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

/* ------------------------- Organisation tab ------------------------- */

const OrganisationTab = ({ org, isMainAdmin, onRegenerate, onDeleteOrg }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const confirmMatches =
    org?.name && deleteConfirmText.trim() === org.name.trim();

  // Build the invite URL — we surface the raw code so users can paste it
  // into the Join flow. Include origin for convenience.
  const inviteUrl = org?.inviteCode
    ? `${window.location.origin}/onboarding?invite=${org.inviteCode}`
    : '';

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = inviteUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmMatches) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeleteOrg();
    } catch (err) {
      setDeleteError(err.response?.data?.error || t('pages.failedToDeleteOrg'));
      setDeleting(false);
    }
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setShowDeleteModal(false);
    setDeleteConfirmText('');
    setDeleteError('');
  };

  return (
    <div>
      <header className="mb-6">
        <h2
          className="font-display font-bold text-[color:var(--color-text-primary)]"
          style={{ fontSize: 20 }}
        >
          {t('pages.organisation')}
        </h2>
        <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
          {org?.name || t('pages.workspaceSettings')}
        </p>
      </header>

      {/* Invite Link section */}
      <section>
        <h3
          className="font-display font-semibold text-[color:var(--color-text-primary)]"
          style={{ fontSize: 15 }}
        >
          {t('pages.inviteLink')}
        </h3>
        <p className="mt-1 font-body text-xs text-[color:var(--color-text-muted)]">
          {t('pages.inviteLinkDescription')}
        </p>

        <div className="mt-3 flex flex-col sm:flex-row items-stretch gap-2">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className="flex-1 font-body text-[13px] text-[color:var(--color-text-primary)] bg-[color:var(--color-bg-subtle)] px-3 focus:outline-none"
            style={{
              height: 38,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
            }}
            aria-label={t('pages.inviteLink')}
            onFocus={(e) => e.target.select()}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="default"
              icon={copied ? Check : Copy}
              onClick={handleCopy}
            >
              {copied ? t('pages.copied') : t('pages.copyLink')}
            </Button>
            <Button
              variant="secondary"
              size="default"
              icon={RefreshCw}
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? t('pages.regenerating') : t('pages.regenerate')}
            </Button>
          </div>
        </div>

        <p className="mt-2 font-body text-xs text-[color:var(--color-text-muted)]">
          {t('pages.inviteCode')}{' '}
          <span
            className="font-mono font-semibold text-[color:var(--color-text-secondary)]"
            style={{ fontSize: 12 }}
          >
            {org?.inviteCode || '—'}
          </span>
        </p>
      </section>

      {/* Danger zone */}
      <section
        className="mt-8 pt-8"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <h3
          className="font-display font-semibold text-[color:var(--color-status-stuck)]"
          style={{ fontSize: 15 }}
        >
          {t('pages.dangerZone')}
        </h3>
        <p className="mt-1 font-body text-xs text-[color:var(--color-text-muted)]">
          {t('pages.irreversibleActions')}
        </p>
        <div
          className="mt-3"
          style={{
            border: '1.5px solid var(--color-status-stuck)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-status-stuck-bg)',
            overflow: 'hidden',
          }}
        >
          <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-body font-semibold text-[13px] text-[color:var(--color-text-primary)]">
                {t('pages.regenerateInviteCode')}
              </p>
              <p className="font-body text-[12px] text-[color:var(--color-text-secondary)]">
                {t('pages.oldInviteLinksStop')}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon={RefreshCw}
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {t('pages.regenerate')}
            </Button>
          </div>

          {isMainAdmin && (
            <div
              className="p-4 flex items-center justify-between gap-4 flex-wrap"
              style={{ borderTop: '1px solid var(--color-status-stuck)' }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-body font-semibold text-[13px] text-[color:var(--color-text-primary)]">
                    {t('pages.deleteThisOrg')}
                  </p>
                  <span
                    className="inline-flex items-center font-body font-semibold"
                    style={{
                      height: 18,
                      padding: '0 8px',
                      fontSize: 10,
                      borderRadius: 'var(--radius-full)',
                      letterSpacing: 0.4,
                      background: 'var(--color-status-stuck)',
                      color: 'white',
                    }}
                  >
                    {t('pages.ownerOnly')}
                  </span>
                </div>
                <p className="font-body text-[12px] text-[color:var(--color-text-secondary)]">
                  {t('pages.deleteOrgWarning')}
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                onClick={() => {
                  setDeleteError('');
                  setDeleteConfirmText('');
                  setShowDeleteModal(true);
                }}
              >
                {t('pages.deleteOrganisation')}
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Delete-organisation confirmation modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={closeDeleteModal}
        title={t('pages.deleteOrgModalTitle', { name: org?.name || t('pages.organisationLower') })}
        closeOnOverlayClick={!deleting}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={closeDeleteModal}
              disabled={deleting}
            >
              {t('pages.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteConfirm}
              disabled={deleting || !confirmMatches}
            >
              {deleting ? t('pages.deleting') : t('pages.deleteOrganisation')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div
            className="flex items-start gap-3 rounded-lg p-3"
            style={{ background: '#fff5f5', border: '1px solid #fca5a5' }}
          >
            <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <p className="font-body text-[13px]" style={{ color: '#374151' }}>
              <strong>{t('pages.actionPermanent')}</strong>
            </p>
          </div>
          <p className="font-body text-[14px] text-[color:var(--color-text-primary)]">
            {t('pages.deletingOrgWill')}
          </p>
          <ul
            className="font-body text-[13px] text-[color:var(--color-text-secondary)] flex flex-col gap-1"
            style={{ paddingLeft: 16, listStyleType: 'disc' }}
          >
            <li>{t('pages.deleteOrgBulletBoards')}</li>
            <li>{t('pages.deleteOrgBulletAutomations')}</li>
            <li>{t('pages.deleteOrgBulletNotifications')}</li>
            <li>{t('pages.deleteOrgBulletMembers', { count: org?.members?.length || 0 })}</li>
          </ul>
          <div className="mt-1">
            <label
              className="font-body text-[12px] font-semibold text-[color:var(--color-text-secondary)]"
              htmlFor="delete-org-confirm"
            >
              {t('pages.typeToConfirmBefore')}<span className="font-mono text-[color:var(--color-text-primary)]">{org?.name}</span>{t('pages.typeToConfirmAfter')}
            </label>
            <input
              id="delete-org-confirm"
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleting}
              autoComplete="off"
              className="mt-2 w-full font-body text-[13px] text-[color:var(--color-text-primary)] bg-white px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
              style={{
                height: 38,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            />
          </div>
          {deleteError && (
            <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
};

/* ---------------------------- Profile tab ---------------------------- */

const ProfileTab = ({ user, onSaveName, onUploadAvatar, onDeleteAccount }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    setName(user?.name || '');
  }, [user?.name]);

  const effectiveAvatar = previewUrl || user?.profilePic;

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('pages.chooseImageFile'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t('pages.imageTooLarge'));
      return;
    }
    setError('');

    // Local preview
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setAvatarLoadError(false);
    setUploading(true);
    try {
      await onUploadAvatar(file);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      // Drop the blob preview now that the real Cloudinary URL is on the user
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(null);
    } catch (err) {
      setError(err.response?.data?.error || t('pages.uploadFailed'));
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === user?.name) return;
    setSaving(true);
    setError('');
    try {
      await onSaveName(name.trim());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || t('pages.couldNotSave'));
    } finally {
      setSaving(false);
    }
  };

  const dirty = name.trim() && name.trim() !== (user?.name || '');

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeleteAccount();
    } catch (err) {
      setDeleteError(err.response?.data?.error || t('pages.failedToDeleteAccount'));
      setDeleting(false);
    }
  };

  return (
    <div>
      <header className="mb-6">
        <h2
          className="font-display font-bold text-[color:var(--color-text-primary)]"
          style={{ fontSize: 20 }}
        >
          {t('pages.profile')}
        </h2>
        <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
          {t('pages.managePersonalDetails')}
        </p>
      </header>

      {/* Avatar uploader */}
      <div className="flex items-center gap-4 mb-8">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label={t('pages.changeProfilePicture')}
          className="relative group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] rounded-full"
          style={{ width: 80, height: 80 }}
        >
          {effectiveAvatar && !avatarLoadError ? (
            <img
              src={effectiveAvatar}
              alt={user?.name || 'Avatar'}
              className="object-cover"
              style={{ width: 80, height: 80, borderRadius: 9999 }}
              onError={() => setAvatarLoadError(true)}
            />
          ) : (
            <div
              className="flex items-center justify-center font-display font-semibold text-white"
              style={{
                width: 80,
                height: 80,
                borderRadius: 9999,
                background: getAvatarColor(user?.email || user?.name || ''),
                fontSize: 32,
              }}
            >
              {getInitial(user?.name)}
            </div>
          )}
          {/* Hover overlay */}
          <span
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{
              borderRadius: 9999,
              background: 'rgba(0, 0, 0, 0.5)',
            }}
            aria-hidden="true"
          >
            <Camera size={24} color="white" />
          </span>
          {uploading && (
            <span
              className="absolute inset-0 flex items-center justify-center"
              style={{
                borderRadius: 9999,
                background: 'rgba(0, 0, 0, 0.5)',
              }}
            >
              <span className="font-body text-[11px] font-semibold text-white">
                {t('pages.uploading')}
              </span>
            </span>
          )}
        </button>
        <div>
          <p className="font-body font-semibold text-[14px] text-[color:var(--color-text-primary)]">
            {t('pages.profilePicture')}
          </p>
          <p className="font-body text-[12px] text-[color:var(--color-text-muted)]">
            {t('pages.pngOrJpg')}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            aria-label={t('pages.uploadAvatar')}
          />
        </div>
      </div>

      {/* Name + email form */}
      <form onSubmit={handleSaveName} className="flex flex-col gap-4 max-w-[480px]" style={{ maxWidth: 480 }}>
        <Input
          label={t('pages.displayName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('pages.yourName')}
          disabled={saving}
          required
        />
        <Input
          label={t('pages.email')}
          type="email"
          value={user?.email || ''}
          onChange={() => {}}
          disabled
          helperText={t('pages.connectedViaGoogle')}
        />

        {error && (
          <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 mt-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!dirty || saving}
          >
            {saving ? t('pages.saving') : t('pages.saveChanges')}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 font-body text-[12px] font-semibold text-[color:var(--color-status-done)]">
              <Check size={14} aria-hidden="true" />
              {t('pages.saved')}
            </span>
          )}
        </div>
      </form>

      {/* Danger Zone */}
      <div
        className="mt-10"
        style={{
          maxWidth: 480,
          border: '1px solid #fca5a5',
          borderRadius: 'var(--radius-lg)',
          padding: 20,
          background: '#fff5f5',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={16} color="#dc2626" aria-hidden="true" />
          <h3
            className="font-display font-semibold"
            style={{ fontSize: 14, color: '#dc2626' }}
          >
            {t('pages.dangerZone')}
          </h3>
        </div>
        <p className="font-body text-[13px] mb-4" style={{ color: '#6b7280' }}>
          {t('pages.deleteAccountWarning')}
        </p>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            setDeleteError('');
            setShowDeleteModal(true);
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
          {t('pages.deleteAccount')}
        </Button>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => !deleting && setShowDeleteModal(false)}
        title={t('pages.deleteAccount')}
        closeOnOverlayClick={!deleting}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
            >
              {t('pages.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? t('pages.deleting') : t('pages.yesDeleteAccount')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div
            className="flex items-start gap-3 rounded-lg p-3"
            style={{ background: '#fff5f5', border: '1px solid #fca5a5' }}
          >
            <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <p className="font-body text-[13px]" style={{ color: '#374151' }}>
              <strong>{t('pages.actionPermanent')}</strong>
            </p>
          </div>
          <p className="font-body text-[14px] text-[color:var(--color-text-primary)]">
            {t('pages.deletingAccountWill')}
          </p>
          <ul className="font-body text-[13px] text-[color:var(--color-text-secondary)] flex flex-col gap-1" style={{ paddingLeft: 16, listStyleType: 'disc' }}>
            <li>{t('pages.deleteAccountBulletOrgs')}</li>
            <li>{t('pages.deleteAccountBulletRemove')}</li>
            <li>{t('pages.deleteAccountBulletLeads')}</li>
            <li>{t('pages.deleteAccountBulletProfile')}</li>
          </ul>
          {deleteError && (
            <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
};

/* --------------------------- Templates Tab ------------------------- */

/**
 * TemplatesTab — lists built-in board templates. Each card has a "Create
 * board" action that creates a new board pre-seeded with the template's
 * columns (`POST /api/boards?template=<id>`). Admin-only.
 *
 * Phase 1, F1 — wired up via /api/boards/templates.
 */
const TemplatesTab = ({ orgId, isAdmin }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(null); // template id
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const addBoardLocal = useBoardStore((s) => s.addBoardLocal);
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  useEffect(() => {
    columnService
      .listBoardTemplates()
      .then((t) => setTemplates(t || []))
      .catch((err) => toastError(err?.response?.data?.error || t('pages.couldNotLoadTemplates')))
      .finally(() => setLoading(false));
  }, [toastError, t]);

  const handleCreate = async (templateId) => {
    if (!orgId) {
      toastError(t('pages.selectWorkspaceFirst'));
      return;
    }
    if (!name.trim()) return;
    setBusy(true);
    try {
      const board = await columnService.createBoardFromTemplate(templateId, {
        name: name.trim(),
        organisation: orgId,
      });
      addBoardLocal(board);
      toastSuccess?.(t('pages.boardCreatedFromTemplate', { name: board.name }));
      setCreateOpen(null);
      setName('');
      navigate(`/boards/${board._id}`);
    } catch (err) {
      toastError(err?.response?.data?.error || t('pages.couldNotCreateBoard'));
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <p className="font-body" style={{ color: 'var(--color-text-muted)' }}>
        {t('pages.onlyAdminsCreateBoards')}
      </p>
    );
  }

  if (loading) {
    return <p className="font-body" style={{ color: 'var(--color-text-muted)' }}>{t('pages.loadingTemplates')}</p>;
  }

  if (templates.length === 0) {
    return <p className="font-body" style={{ color: 'var(--color-text-muted)' }}>{t('pages.noTemplatesAvailable')}</p>;
  }

  return (
    <div>
      <header className="mb-4">
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700 }}>
          {t('pages.boardTemplates')}
        </h2>
        <p className="mt-1 font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('pages.boardTemplatesDescription')}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="bg-surface"
            style={{
              padding: 16,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <h3 className="font-display" style={{ fontSize: 15, fontWeight: 700 }}>{tpl.name}</h3>
            <p className="mt-1 font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {tpl.description}
            </p>
            <p className="mt-2 font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {t('pages.templateColumns', { count: tpl.columns?.length || 0 })} {tpl.columns?.slice(0, 4).map((c) => c.name).join(', ')}
              {tpl.columns?.length > 4 ? '…' : ''}
            </p>
            {tpl.groups?.length > 0 && (
              <p className="mt-1 font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {t('pages.templateStages', { count: tpl.groups.length })} {tpl.groups.slice(0, 4).join(', ')}
                {tpl.groups.length > 4 ? '…' : ''}
              </p>
            )}
            <div className="mt-3">
              <Button
                variant="primary"
                onClick={() => {
                  setCreateOpen(tpl.id);
                  setName(tpl.name);
                }}
              >
                {t('pages.createBoard')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <Modal
          isOpen
          onClose={() => {
            setCreateOpen(null);
            setName('');
          }}
          title={t('pages.nameYourNewBoard')}
        >
          <div style={{ padding: 16 }}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('pages.boardNamePlaceholder')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setCreateOpen(null);
                  setName('');
                }}
              >
                {t('pages.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => handleCreate(createOpen)}
                disabled={busy || !name.trim()}
              >
                {busy ? t('pages.creating') : t('pages.create')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

/* ------------------------------ Page ------------------------------ */

const SettingsPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const logout = useAuthStore((s) => s.logout);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const deleteOrgFromStore = useOrgStore((s) => s.deleteOrg);

  // Resolve admin-ness from currentOrg (authoritative for the UI guard)
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

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    searchParams.get('tab') === 'email' ? 'email' : 'organisation'
  );
  const [orgState, setOrgState] = useState(currentOrg || null);
  const toast = useToastStore.getState();

  // Surface the OAuth callback result (?email=connected|error) once, then strip
  // the query so a refresh doesn't re-toast.
  useEffect(() => {
    const status = searchParams.get('email');
    if (!status) return;
    setActiveTab('email');
    if (status === 'connected') {
      const provider = searchParams.get('provider');
      toast.success?.(provider ? t('pages.mailboxConnectedWith', { provider }) : t('pages.mailboxConnected'));
    } else if (status === 'error') {
      const reason = searchParams.get('reason');
      toast.error?.(reason ? t('pages.mailboxConnectErrorWith', { reason }) : t('pages.mailboxConnectError'));
    }
    const next = new URLSearchParams(searchParams);
    next.delete('email');
    next.delete('provider');
    next.delete('reason');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep local orgState in sync with currentOrg
  useEffect(() => {
    setOrgState(currentOrg || null);
  }, [currentOrg]);

  // If a non-admin has an admin-only tab selected, bounce them to Profile
  useEffect(() => {
    if (
      !isAdmin &&
      (activeTab === 'organisation' ||
        activeTab === 'templates' ||
        activeTab === 'sms' ||
        activeTab === 'whatsapp')
    ) {
      setActiveTab('profile');
    }
  }, [isAdmin, activeTab]);

  // Fetch org details (with inviteCode) for Organisation tab
  useEffect(() => {
    if (activeTab === 'organisation' && currentOrg?._id && !orgState?.inviteCode) {
      orgService
        .getOrg(currentOrg._id)
        .then((o) => setOrgState(o))
        .catch(() => {});
    }
  }, [activeTab, currentOrg?._id, orgState?.inviteCode]);

  const handleRegenerate = async () => {
    if (!currentOrg?._id) return;
    const newCode = await orgService.regenerateInvite(currentOrg._id);
    setOrgState((prev) => (prev ? { ...prev, inviteCode: newCode } : prev));
  };

  const handleSaveName = async (name) => {
    await profileService.updateProfile({ name });
    await fetchCurrentUser();
  };

  const handleUploadAvatar = async (file) => {
    await profileService.uploadAvatar(file);
    await fetchCurrentUser();
  };

  const handleDeleteAccount = async () => {
    await profileService.deleteAccount();
    await logout();
    navigate('/login');
  };

  const handleDeleteOrg = async () => {
    if (!currentOrg?._id) return;
    const nextOrg = await deleteOrgFromStore(currentOrg._id);
    await fetchCurrentUser();
    navigate(nextOrg ? '/dashboard' : '/onboarding');
  };

  const renderTab = () => {
    if (activeTab === 'organisation' && isAdmin) {
      return (
        <OrganisationTab
          org={orgState}
          isMainAdmin={isMainAdmin}
          onRegenerate={handleRegenerate}
          onDeleteOrg={handleDeleteOrg}
        />
      );
    }
    if (activeTab === 'templates') {
      return <TemplatesTab orgId={currentOrg?._id} isAdmin={isAdmin} />;
    }
    if (activeTab === 'email') {
      return <EmailAccountConnect workspaceId={currentOrg?._id} />;
    }
    if (activeTab === 'sms' && isAdmin) {
      return (
        <div>
          <SmsConfigForm workspaceId={currentOrg?._id} />
          <SmsOptOutList workspaceId={currentOrg?._id} />
        </div>
      );
    }
    if (activeTab === 'whatsapp' && isAdmin) {
      return (
        <div>
          <WhatsAppConfigForm workspaceId={currentOrg?._id} />
          <WhatsAppTemplateManager workspaceId={currentOrg?._id} />
        </div>
      );
    }
    if (activeTab === 'ai') {
      return <AiKeysConfigForm />;
    }
    return (
      <ProfileTab
        user={user}
        onSaveName={handleSaveName}
        onUploadAvatar={handleUploadAvatar}
        onDeleteAccount={handleDeleteAccount}
      />
    );
  };

  return (
    <PageWrapper>
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        {/* Page header */}
        <header className="mb-6">
          <h1
            className="font-display font-bold text-[color:var(--color-text-primary)]"
            style={{ fontSize: 28, letterSpacing: '-0.01em' }}
          >
            {t('pages.settings')}
          </h1>
          <p className="mt-1 font-body text-sm text-[color:var(--color-text-secondary)]">
            {t('pages.manageOrgAndProfile')}
          </p>
        </header>

        <div
          className="flex flex-col md:flex-row overflow-hidden bg-surface"
          style={{
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-card)',
            minHeight: 500,
          }}
        >
          <SettingsSidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showAdminTabs={isAdmin}
          />
          <SettingsTabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showAdminTabs={isAdmin}
          />
          <div className="flex-1" style={{ padding: 32 }}>
            {renderTab()}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
};

export default SettingsPage;
