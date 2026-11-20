import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Copy, Check, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { getBilling } from '../../services/billingService';
import { SettingsHeader, SettingsCard, CardTitle, CardText, PineCard, InlineError } from './SettingsLayout';

/**
 * Settings → Organisation (admin-only). Workspace details, invite link (copy /
 * regenerate), current plan (links to Plans & billing) and, for the owner,
 * the delete-organisation danger zone.
 *
 * Props:
 *   org          — workspace with inviteCode (fetched by the page)
 *   isMainAdmin  — owner; only the owner can delete the workspace
 *   roleLabel    — "Owner" / "Admin"
 *   onRegenerate — async () => void
 *   onDeleteOrg  — async () => void (throws on failure)
 */

const WORKSPACE_TINTS = ['#8A5A44', '#3E6B4E', '#6E8B3D', '#B08A3C', '#C4632B', '#4E7A70'];
const tintFor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return WORKSPACE_TINTS[Math.abs(hash) % WORKSPACE_TINTS.length];
};

const PlanCard = ({ orgId }) => {
  const { t } = useTranslation();
  const [planName, setPlanName] = useState('');

  useEffect(() => {
    if (!orgId) return undefined;
    let alive = true;
    getBilling(orgId)
      .then((d) => {
        const name = d?.subscription?.planName;
        if (alive && typeof name === 'string') setPlanName(name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [orgId]);

  return (
    <PineCard aria-labelledby="org-plan-title">
      <div className="uppercase" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em', color: 'var(--color-pine-text-2)' }}>
        {t('settings.org.planEyebrow')}
      </div>
      <h2 id="org-plan-title" className="font-display font-bold" style={{ margin: 0, fontSize: 22 }}>
        {planName || t('settings.org.planFallback')}
      </h2>
      <p style={{ margin: 0, color: '#C9D4C7' }}>{t('settings.org.planBody')}</p>
      <Link
        to="/billing"
        className="self-start font-bold hover:underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-pine-gold)]"
        style={{ marginTop: 4, color: 'var(--color-pine-gold)', textDecoration: 'none', borderRadius: 4 }}
      >
        {t('settings.org.planLink')} <span aria-hidden="true">→</span>
      </Link>
    </PineCard>
  );
};

const OrganisationSettings = ({ org, isMainAdmin, roleLabel, onRegenerate, onDeleteOrg }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const copyTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const confirmMatches = org?.name && deleteConfirmText.trim() === org.name.trim();

  // The raw code is surfaced so users can paste it into the Join flow; the
  // origin is included for convenience.
  const inviteUrl = org?.inviteCode ? `${window.location.origin}/onboarding?invite=${org.inviteCode}` : '';

  const flashCopied = () => {
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      flashCopied();
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = inviteUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      flashCopied();
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenError('');
    try {
      await onRegenerate();
    } catch (err) {
      setRegenError(err?.response?.data?.error || t('pages.couldNotSave'));
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

  const memberCount = Array.isArray(org?.members) ? org.members.length : 0;

  return (
    <>
      <SettingsHeader tab="organisation" title={t('pages.organisation')} subtitle={t('settings.org.subtitle')} />
      <PageBody>
        <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
          <div className="flex flex-col gap-5 min-w-0">
            {/* Workspace details */}
            <SettingsCard aria-labelledby="org-details-title">
              <CardTitle id="org-details-title">{t('settings.org.detailsTitle')}</CardTitle>
              <div className="flex items-center gap-4 min-w-0">
                <div
                  aria-hidden="true"
                  className="flex items-center justify-center shrink-0 font-display font-bold text-white"
                  style={{ width: 64, height: 64, borderRadius: 16, background: tintFor(org?.name || ''), fontSize: 26 }}
                >
                  {(org?.name || '?').trim().charAt(0).toUpperCase()}
                </div>
                <dl className="m-0 min-w-0 font-body">
                  <dt className="sr-only">{t('settings.org.nameLabel')}</dt>
                  <dd className="m-0 font-display font-bold truncate" style={{ fontSize: 20 }}>
                    {org?.name || t('pages.workspaceSettings')}
                  </dd>
                  <dt className="sr-only">{t('settings.org.membersLabel')}</dt>
                  <dd className="m-0" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {[memberCount ? t('settings.org.members', { count: memberCount }) : '', roleLabel ? t('settings.org.yourRole', { role: roleLabel }) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </dl>
              </div>
            </SettingsCard>

            {/* Invite teammates */}
            <SettingsCard aria-labelledby="org-invite-title" style={{ gap: 14 }}>
              <CardTitle id="org-invite-title">{t('settings.org.inviteTitle')}</CardTitle>
              <CardText>{t('pages.inviteLinkDescription')}</CardText>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  aria-label={t('pages.inviteLink')}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 focus:outline-none focus:shadow-[0_0_0_3px_rgba(62,107,78,0.15)]"
                  style={{
                    flex: '1 1 300px',
                    height: 44,
                    padding: '0 14px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--color-bg-base)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12.5,
                    color: 'var(--color-text-primary)',
                    textOverflow: 'ellipsis',
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="lg" icon={copied ? Check : Copy} onClick={handleCopy} disabled={!inviteUrl}>
                    {copied ? t('pages.copied') : t('pages.copyLink')}
                  </Button>
                  <Button variant="secondary" size="lg" icon={RefreshCw} onClick={handleRegenerate} disabled={regenerating}>
                    {regenerating ? t('pages.regenerating') : t('pages.regenerate')}
                  </Button>
                </div>
              </div>
              <span className="sr-only" aria-live="polite">{copied ? t('pages.copied') : ''}</span>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                <span>
                  {t('pages.inviteCode')}{' '}
                  <strong className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{org?.inviteCode || '—'}</strong>
                </span>
                <span style={{ fontSize: 12.5 }}>{t('pages.oldInviteLinksStop')}</span>
              </div>
              <InlineError>{regenError}</InlineError>
            </SettingsCard>
          </div>

          <div className="flex flex-col gap-5 min-w-0">
            <PlanCard orgId={org?._id} />

            {isMainAdmin && (
              <SettingsCard tone="danger" aria-labelledby="org-danger-title" style={{ gap: 12 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle id="org-danger-title" tone="danger">{t('pages.dangerZone')}</CardTitle>
                  <span
                    className="inline-flex items-center font-body font-semibold"
                    style={{ height: 20, padding: '0 8px', fontSize: 10.5, borderRadius: 999, letterSpacing: 0.4, background: 'var(--color-status-stuck-bg)', color: 'var(--color-status-stuck)' }}
                  >
                    {t('pages.ownerOnly')}
                  </span>
                </div>
                <CardText>{t('pages.deleteOrgWarning')}</CardText>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError('');
                    setDeleteConfirmText('');
                    setShowDeleteModal(true);
                  }}
                  className="self-start inline-flex items-center gap-2 font-body font-bold hover:bg-[color:var(--color-status-stuck-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-status-stuck)]"
                  style={{ height: 40, padding: '0 16px', borderRadius: 10, border: '1px solid var(--color-status-stuck)', background: '#fff', color: 'var(--color-status-stuck)', fontSize: 14, cursor: 'pointer' }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t('pages.deleteThisOrg')}
                </button>
              </SettingsCard>
            )}
          </div>
        </div>
      </PageBody>

      {/* Delete-organisation confirmation modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={closeDeleteModal}
        title={t('pages.deleteOrgModalTitle', { name: org?.name || t('pages.organisationLower') })}
        closeOnOverlayClick={!deleting}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDeleteModal} disabled={deleting}>
              {t('pages.cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={handleDeleteConfirm} disabled={deleting || !confirmMatches}>
              {deleting ? t('pages.deleting') : t('pages.deleteOrganisation')}
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
          <p className="font-body text-[14px] text-[color:var(--color-text-primary)]">{t('pages.deletingOrgWill')}</p>
          <ul className="font-body text-[13px] text-[color:var(--color-text-secondary)] flex flex-col gap-1" style={{ paddingLeft: 16, listStyleType: 'disc' }}>
            <li>{t('pages.deleteOrgBulletBoards')}</li>
            <li>{t('pages.deleteOrgBulletAutomations')}</li>
            <li>{t('pages.deleteOrgBulletNotifications')}</li>
            <li>{t('pages.deleteOrgBulletMembers', { count: memberCount })}</li>
          </ul>
          <div className="mt-1">
            <label className="font-body text-[12px] font-semibold text-[color:var(--color-text-secondary)]" htmlFor="delete-org-confirm">
              {t('pages.typeToConfirmBefore')}
              <span className="font-mono text-[color:var(--color-text-primary)]">{org?.name}</span>
              {t('pages.typeToConfirmAfter')}
            </label>
            <input
              id="delete-org-confirm"
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleting}
              autoComplete="off"
              className="mt-2 w-full font-body text-[13px] text-[color:var(--color-text-primary)] bg-white px-3 focus:outline-none focus:border-[color:var(--color-accent)]"
              style={{ height: 38, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
            />
          </div>
          {deleteError && <p className="font-body text-[12px] text-[color:var(--color-status-stuck)]">{deleteError}</p>}
        </div>
      </Modal>
    </>
  );
};

export default OrganisationSettings;
