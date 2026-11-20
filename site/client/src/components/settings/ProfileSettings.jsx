import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Trash2, AlertTriangle } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import BrandLogo from './ads/BrandLogo';
import { TextField, SelectField } from './ads/AdsShared';
import LANGUAGES from '../../i18n/languages';
import { SettingsHeader, SettingsCard, CardTitle, CardText, InlineError, MainAsideGrid } from './SettingsLayout';

/**
 * Settings → Profile. Photo card on the left (avatar upload), personal
 * details (display name, read-only Google email, language) and the delete
 * account danger zone on the right. The header "Save changes" submits the
 * details form.
 *
 * Props:
 *   user            — current user
 *   subtitleLine    — "Admin · Workspace" under the name
 *   onSaveName      — async (name) => void
 *   onUploadAvatar  — async (file) => void
 *   onDeleteAccount — async () => void (throws on failure)
 */

const AVATAR_COLORS = ['#3E6B4E', '#6E8B3D', '#B08A3C', '#C4632B', '#7A5A44', '#4E7A70'];
const getInitial = (name) => (name ? name.trim().charAt(0).toUpperCase() : '?');
const getAvatarColor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const AVATAR = 104;

const ProfileSettings = ({ user, subtitleLine, onSaveName, onUploadAvatar, onDeleteAccount }) => {
  const { t, i18n } = useTranslation();
  const formId = useId();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  // URL of a picture that failed to load — falls back to the initial avatar.
  const [failedAvatar, setFailedAvatar] = useState(null);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    setName(user?.name || '');
  }, [user?.name]);

  const effectiveAvatar = previewUrl || user?.profilePic;

  const flashSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError(t('pages.chooseImageFile'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError(t('pages.imageTooLarge'));
      return;
    }
    setPhotoError('');

    // Local preview
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    try {
      await onUploadAvatar(file);
      flashSaved();
      // Drop the blob preview now that the real Cloudinary URL is on the user
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(null);
    } catch (err) {
      setPhotoError(err.response?.data?.error || t('pages.uploadFailed'));
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const dirty = !!name.trim() && name.trim() !== (user?.name || '');

  const handleSaveName = async (e) => {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    setError('');
    try {
      await onSaveName(name.trim());
      flashSaved();
    } catch (err) {
      setError(err.response?.data?.error || t('pages.couldNotSave'));
    } finally {
      setSaving(false);
    }
  };

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

  const activeLang = LANGUAGES.some((l) => l.code === i18n.resolvedLanguage) ? i18n.resolvedLanguage : LANGUAGES[0].code;

  return (
    <>
      <SettingsHeader
        tab="profile"
        title={t('pages.profile')}
        subtitle={t('settings.profile.subtitle')}
        actions={
          <>
            {saved && (
              <span role="status" className="inline-flex items-center gap-1 font-body text-[13px] font-semibold text-[color:var(--color-status-done)]">
                <Check size={14} aria-hidden="true" />
                {t('pages.saved')}
              </span>
            )}
            <Button type="submit" form={formId} variant="primary" size="lg" disabled={!dirty || saving}>
              {saving ? t('pages.saving') : t('pages.saveChanges')}
            </Button>
          </>
        }
      />
      <PageBody>
        <MainAsideGrid reverse>
          {/* Photo card */}
          <SettingsCard className="items-center text-center" style={{ padding: 28, gap: 12 }} aria-label={t('pages.profilePicture')}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label={t('pages.changeProfilePicture')}
              className="relative group rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
              style={{ width: AVATAR, height: AVATAR, border: 'none', padding: 0, background: 'none', cursor: uploading ? 'progress' : 'pointer' }}
            >
              {effectiveAvatar && effectiveAvatar !== failedAvatar ? (
                <img
                  src={effectiveAvatar}
                  alt=""
                  className="object-cover"
                  style={{ width: AVATAR, height: AVATAR, borderRadius: 9999 }}
                  onError={() => setFailedAvatar(effectiveAvatar)}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center font-display font-bold text-white"
                  style={{ width: AVATAR, height: AVATAR, borderRadius: 9999, background: getAvatarColor(user?.email || user?.name || ''), fontSize: 42 }}
                >
                  {getInitial(user?.name)}
                </span>
              )}
              <span
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
                style={{ borderRadius: 9999, background: 'rgba(0, 0, 0, 0.5)' }}
                aria-hidden="true"
              >
                <Camera size={26} color="white" />
              </span>
              {uploading && (
                <span className="absolute inset-0 flex items-center justify-center" style={{ borderRadius: 9999, background: 'rgba(0, 0, 0, 0.5)' }}>
                  <span className="font-body text-[12px] font-semibold text-white">{t('pages.uploading')}</span>
                </span>
              )}
            </button>
            <div className="min-w-0 max-w-full">
              <div className="font-display font-bold break-words" style={{ fontSize: 20 }}>{user?.name || t('pages.yourName')}</div>
              {subtitleLine && <div className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{subtitleLine}</div>}
            </div>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? t('pages.uploading') : t('pages.changeProfilePicture')}
            </Button>
            <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('pages.pngOrJpg')}</span>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" aria-label={t('pages.uploadAvatar')} />
            <InlineError>{photoError}</InlineError>
            <div
              className="inline-flex items-center gap-2 font-body"
              style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', padding: '8px 12px', borderRadius: 999, background: 'var(--color-bg-base)' }}
            >
              <BrandLogo name="google-g" size={14} />
              {t('settings.profile.connectedGoogle')}
            </div>
          </SettingsCard>

          <div className="flex flex-col gap-5 min-w-0">
            {/* Personal details */}
            <SettingsCard aria-labelledby={`${formId}-title`}>
              <CardTitle id={`${formId}-title`}>{t('settings.profile.detailsTitle')}</CardTitle>
              <form id={formId} onSubmit={handleSaveName} className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                <TextField
                  label={t('pages.displayName')}
                  value={name}
                  onChange={setName}
                  placeholder={t('pages.yourName')}
                  disabled={saving}
                  required
                  autoComplete="name"
                />
                <TextField
                  label={t('pages.email')}
                  type="email"
                  value={user?.email || ''}
                  onChange={() => {}}
                  readOnly
                  disabled
                  hint={t('settings.profile.emailHint')}
                />
                <SelectField
                  label={t('language.label')}
                  value={activeLang}
                  onChange={(code) => i18n.changeLanguage(code)}
                  options={LANGUAGES.map((l) => ({ value: l.code, label: l.nativeLabel }))}
                />
              </form>
              <InlineError>{error}</InlineError>
            </SettingsCard>

            {/* Danger zone */}
            <SettingsCard tone="danger" className="flex-wrap items-center" style={{ flexDirection: 'row' }} aria-labelledby={`${formId}-danger`}>
              <div style={{ flex: '1 1 320px' }} className="min-w-0">
                <CardTitle id={`${formId}-danger`} tone="danger">{t('pages.dangerZone')}</CardTitle>
                <CardText style={{ marginTop: 4 }}>{t('pages.deleteAccountWarning')}</CardText>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteError('');
                  setShowDeleteModal(true);
                }}
                className="inline-flex items-center gap-2 font-body font-bold hover:bg-[color:var(--color-status-stuck-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-status-stuck)]"
                style={{ height: 40, padding: '0 16px', borderRadius: 10, border: '1px solid var(--color-status-stuck)', background: '#fff', color: 'var(--color-status-stuck)', fontSize: 14, cursor: 'pointer' }}
              >
                <Trash2 size={15} aria-hidden="true" />
                {t('settings.profile.deleteMyAccount')}
              </button>
            </SettingsCard>
          </div>
        </MainAsideGrid>
      </PageBody>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => !deleting && setShowDeleteModal(false)}
        title={t('pages.deleteAccount')}
        closeOnOverlayClick={!deleting}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
              {t('pages.cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? t('pages.deleting') : t('pages.yesDeleteAccount')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-lg p-3" style={{ background: 'var(--color-status-stuck-bg)', border: '1px solid #E8C9C2' }}>
            <AlertTriangle size={18} color="var(--color-status-stuck)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
            <p className="font-body text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
              <strong>{t('pages.actionPermanent')}</strong>
            </p>
          </div>
          <p className="font-body text-[14px] text-[color:var(--color-text-primary)]">{t('pages.deletingAccountWill')}</p>
          <ul className="font-body text-[13px] text-[color:var(--color-text-secondary)] flex flex-col gap-1" style={{ paddingLeft: 16, listStyleType: 'disc' }}>
            <li>{t('pages.deleteAccountBulletOrgs')}</li>
            <li>{t('pages.deleteAccountBulletRemove')}</li>
            <li>{t('pages.deleteAccountBulletLeads')}</li>
            <li>{t('pages.deleteAccountBulletProfile')}</li>
          </ul>
          {deleteError && <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]">{deleteError}</p>}
        </div>
      </Modal>
    </>
  );
};

export default ProfileSettings;
