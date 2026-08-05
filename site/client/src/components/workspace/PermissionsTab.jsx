import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Plus, Trash2, LayoutList, Folder as FolderIcon, Building2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import DatePickerPopover from '../ui/DatePickerPopover';
import * as workspaceService from '../../services/workspaceService';
import useToastStore from '../../store/toastStore';

/**
 * PermissionsTab — Phase 3.2 access control. Admins grant a member Viewer/Editor
 * access to a board, a folder, or the whole workspace (Option-2: no row-level).
 * Lists active grants with revoke. Reuses the WorkspaceGrant CRUD endpoints.
 *
 * Props: orgId, boards (with folderId/name), members, currentUserId
 */
const PermissionsTab = ({ orgId, boards = [], members = [], currentUserId }) => {
  const { t } = useTranslation();
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);
  const [folders, setFolders] = useState([]);
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [g, f] = await Promise.all([
        workspaceService.listGrants(orgId),
        workspaceService.listWorkspaces(orgId),
      ]);
      setGrants(g || []);
      setFolders(f || []);
    } catch (err) {
      toastError(err?.response?.data?.error || t('perm.loadError'));
    } finally {
      setLoading(false);
    }
  }, [orgId, toastError, t]);

  useEffect(() => { load(); }, [load]);

  const grantableMembers = useMemo(
    () => members.filter((m) => String(m._id) !== String(currentUserId)),
    [members, currentUserId]
  );

  const handleCreate = async (payload) => {
    // A whole-workspace grant must reference the org id as the resource.
    const body = payload.resourceType === 'workspace' ? { ...payload, resourceId: orgId } : payload;
    try {
      await workspaceService.createGrant(orgId, body);
      setFormOpen(false);
      toastSuccess(t('perm.granted'));
      await load();
    } catch (err) {
      toastError(err?.response?.data?.error || t('perm.grantError'));
    }
  };

  const handleRevoke = async (grant) => {
    if (!window.confirm(t('perm.revokeConfirm'))) return;
    try {
      await workspaceService.revokeGrant(orgId, grant._id);
      await load();
    } catch (err) {
      toastError(err?.response?.data?.error || t('perm.revokeError'));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-start gap-2">
          <Shield size={18} color="var(--color-accent)" aria-hidden="true" style={{ marginTop: 2 }} />
          <div>
            <h3 className="font-display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('perm.title')}</h3>
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('perm.subtitle')}</p>
          </div>
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setFormOpen(true)}>{t('perm.grantAccess')}</Button>
      </div>

      <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading && grants.length === 0 ? (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: 24 }}>{t('perm.loading')}</p>
        ) : grants.length === 0 ? (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: 24, textAlign: 'center' }}>{t('perm.empty')}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={th}>{t('perm.colMember')}</th>
                <th style={th}>{t('perm.colResource')}</th>
                <th style={th}>{t('perm.colRole')}</th>
                <th style={th}>{t('perm.colExpires')}</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g._id} style={{ borderTop: '1px solid var(--color-border)', opacity: g.isExpired ? 0.5 : 1 }}>
                  <td style={td}>
                    <span className="font-body" style={{ fontWeight: 600 }}>{g.granteeUserId?.name || g.granteeUserId?.email || '—'}</span>
                    {g.granteeUserId?.email && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)' }}>{g.granteeUserId.email}</span>}
                  </td>
                  <td style={td}>
                    <span className="inline-flex items-center gap-1.5">
                      <ResourceIcon type={g.resourceType} />
                      {g.resourceLabel || '—'}
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>· {t(`perm.type.${g.resourceType}`)}</span>
                    </span>
                  </td>
                  <td style={td}><RoleBadge role={g.role} t={t} /></td>
                  <td style={{ ...td, color: 'var(--color-text-muted)' }}>{g.expiresAt ? new Date(g.expiresAt).toLocaleDateString() : t('perm.never')}{g.isExpired ? ` (${t('perm.expired')})` : ''}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" onClick={() => handleRevoke(g)} aria-label={t('perm.revoke')} title={t('perm.revoke')} style={{ width: 28, height: 28, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}>
                      <Trash2 size={14} color="#DC2626" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <GrantForm
          members={grantableMembers}
          boards={boards}
          folders={folders}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
};

const GrantForm = ({ members, boards, folders, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [granteeUserId, setGranteeUserId] = useState(members[0]?._id ? String(members[0]._id) : '');
  const [scope, setScope] = useState('board'); // board | folder | workspace
  const [resourceId, setResourceId] = useState(boards[0]?._id ? String(boards[0]._id) : '');
  const [role, setRole] = useState('viewer');
  const [expiresAt, setExpiresAt] = useState('');
  const [err, setErr] = useState('');

  const resourceOptions = useMemo(() => {
    if (scope === 'board') return boards.map((b) => ({ value: String(b._id), label: b.name }));
    if (scope === 'folder') return folders.map((f) => ({ value: String(f._id), label: f.name }));
    return [];
  }, [scope, boards, folders]);

  // Keep a valid resource selected when scope changes.
  useEffect(() => {
    if (scope === 'workspace') return;
    if (!resourceOptions.some((o) => o.value === resourceId)) {
      setResourceId(resourceOptions[0]?.value || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, resourceOptions]);

  const submit = () => {
    setErr('');
    if (!granteeUserId) return setErr(t('perm.errMember'));
    if (scope !== 'workspace' && !resourceId) return setErr(t('perm.errResource'));
    onSubmit({
      resourceType: scope,
      resourceId: scope === 'workspace' ? undefined : resourceId,
      granteeUserId,
      role,
      expiresAt: expiresAt || null,
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('perm.grantAccess')}
      maxWidth={460}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>{t('perm.cancel')}</Button>
          <Button variant="primary" size="sm" onClick={submit}>{t('perm.grant')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('perm.member')}>
          <Dropdown
            placeholder={t('perm.noMembers')}
            options={members.map((m) => ({ value: String(m._id), label: m.name || m.email }))}
            value={granteeUserId}
            onChange={setGranteeUserId}
          />
        </Field>

        <Field label={t('perm.scope')}>
          <div className="flex gap-2">
            {[
              { v: 'board', label: t('perm.type.board') },
              { v: 'folder', label: t('perm.type.folder') },
              { v: 'workspace', label: t('perm.type.workspace') },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setScope(o.v)}
                className="font-body"
                style={{
                  flex: 1, height: 34, fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${scope === o.v ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                  background: scope === o.v ? 'var(--color-accent-light)' : 'transparent',
                  color: scope === o.v ? 'var(--color-accent)' : 'var(--color-text-secondary)', cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        {scope !== 'workspace' && (
          <Field label={scope === 'board' ? t('perm.board') : t('perm.folder')}>
            <Dropdown
              placeholder="—"
              options={resourceOptions}
              value={resourceId}
              onChange={setResourceId}
            />
          </Field>
        )}

        <Field label={t('perm.role')}>
          <div className="flex gap-2">
            {['viewer', 'editor'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className="font-body"
                style={{
                  flex: 1, height: 34, fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${role === r ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                  background: role === r ? 'var(--color-accent-light)' : 'transparent',
                  color: role === r ? 'var(--color-accent)' : 'var(--color-text-secondary)', cursor: 'pointer',
                }}
              >
                {t(`perm.role.${r}`)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('perm.expiresOptional')}>
          <DatePickerPopover value={expiresAt} onChange={setExpiresAt} placeholder="Pick a date" />
        </Field>

        {err && <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>{err}</p>}
      </div>
    </Modal>
  );
};

const Field = ({ label, children }) => (
  <label className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
    <span style={{ display: 'block', marginBottom: 6 }}>{label}</span>
    {children}
  </label>
);

const ResourceIcon = ({ type }) => {
  if (type === 'folder') return <FolderIcon size={14} color="var(--color-text-secondary)" />;
  if (type === 'workspace') return <Building2 size={14} color="var(--color-text-secondary)" />;
  return <LayoutList size={14} color="var(--color-text-secondary)" />;
};

const RoleBadge = ({ role, t }) => {
  const editor = role === 'editor';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: editor ? '#3E6B4E' : 'var(--color-text-secondary)', background: editor ? '#3E6B4E1A' : 'var(--color-bg-subtle)', borderRadius: 'var(--radius-full)', padding: '2px 8px' }}>
      {t(`perm.role.${role}`)}
    </span>
  );
};

const th = { padding: '8px 12px', fontWeight: 600 };
const td = { padding: '10px 12px', color: 'var(--color-text-primary)', verticalAlign: 'top' };

export default PermissionsTab;
