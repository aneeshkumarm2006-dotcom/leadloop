import { useEffect, useMemo, useState } from 'react';
import { Trash2, Share2, Clock, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import useWorkspaceStore from '../../store/workspaceStore';
import useBoardStore from '../../store/boardStore';
import { formatShortDate } from '../../utils/dateUtils';

/**
 * GrantsTable — list / add / revoke cross-workspace grants for the current
 * workspace (Phase 1 / F3). Mounted in the Workspace settings "Sharing" tab.
 * Admin-only (the API enforces it; the page gates the tab).
 *
 * A grant gives a named external user `viewer` (read) or `editor` (read+write)
 * access to one board (or the whole workspace) without making them a member.
 */
const RoleChip = ({ role }) => {
  const editor = role === 'editor';
  return (
    <span
      className="inline-flex items-center font-body font-semibold"
      style={{
        height: 22,
        padding: '0 10px',
        fontSize: 11,
        borderRadius: 'var(--radius-full)',
        letterSpacing: 0.3,
        background: editor ? 'var(--color-accent-light)' : 'var(--color-bg-subtle)',
        color: editor ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
      }}
    >
      {editor ? 'Editor' : 'Viewer'}
    </span>
  );
};

const fieldStyle = {
  height: 38,
  padding: '0 10px',
  border: '1.5px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  display: 'block',
};

const AddGrantForm = ({ workspaceId, boards, onCreated }) => {
  const createGrant = useWorkspaceStore((s) => s.createGrant);

  const [resourceType, setResourceType] = useState('board');
  const [resourceId, setResourceId] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Default the board picker to the first board once boards load.
  useEffect(() => {
    if (resourceType === 'board' && !resourceId && boards.length) {
      setResourceId(boards[0]._id);
    }
  }, [resourceType, resourceId, boards]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!email.trim()) {
      setError('Enter the email of the person to share with.');
      return;
    }
    const effectiveResourceId = resourceType === 'workspace' ? workspaceId : resourceId;
    if (resourceType === 'board' && !effectiveResourceId) {
      setError('Pick a board to share.');
      return;
    }
    setSubmitting(true);
    try {
      await createGrant(workspaceId, {
        resourceType,
        resourceId: effectiveResourceId,
        granteeEmail: email.trim(),
        role,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setSuccess('Access granted.');
      setEmail('');
      setExpiresAt('');
      onCreated?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the grant. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        padding: '18px 20px',
        marginBottom: 24,
      }}
    >
      <h3
        className="font-display font-bold flex items-center gap-2"
        style={{ fontSize: 15, color: 'var(--color-text-primary)', marginBottom: 14 }}
      >
        <Share2 size={15} aria-hidden="true" />
        Share access
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label style={labelStyle} htmlFor="grant-scope">Scope</label>
          <select
            id="grant-scope"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            style={{ ...fieldStyle, width: '100%' }}
          >
            <option value="board">A single board</option>
            <option value="workspace">The entire workspace</option>
          </select>
        </div>

        {resourceType === 'board' && (
          <div>
            <label style={labelStyle} htmlFor="grant-board">Board</label>
            <select
              id="grant-board"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              style={{ ...fieldStyle, width: '100%' }}
            >
              {boards.length === 0 && <option value="">No boards available</option>}
              {boards.map((b) => (
                <option key={b._id} value={b._id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle} htmlFor="grant-email">Grant to (email)</label>
          <input
            id="grant-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSuccess(''); setError(''); }}
            placeholder="person@example.com"
            style={{ ...fieldStyle, width: '100%' }}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="grant-role">Access level</label>
          <select
            id="grant-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ ...fieldStyle, width: '100%' }}
          >
            <option value="viewer">Viewer (read-only)</option>
            <option value="editor">Editor (read &amp; write)</option>
          </select>
        </div>

        <div>
          <label style={labelStyle} htmlFor="grant-expiry">Expires (optional)</label>
          <input
            id="grant-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={{ ...fieldStyle, width: '100%' }}
          />
        </div>

        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={submitting} icon={Share2}>
            {submitting ? 'Sharing…' : 'Share'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="font-body flex items-center gap-1.5" style={{ fontSize: 13, color: '#DC2626', marginTop: 10 }}>
          <AlertCircle size={13} aria-hidden="true" /> {error}
        </p>
      )}
      {success && (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-done, #16a34a)', marginTop: 10 }}>
          {success}
        </p>
      )}
    </form>
  );
};

const GrantsTable = ({ workspaceId }) => {
  const grants = useWorkspaceStore((s) => s.grants);
  const fetchGrants = useWorkspaceStore((s) => s.fetchGrants);
  const revokeGrant = useWorkspaceStore((s) => s.revokeGrant);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);

  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetchGrants(workspaceId)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId, fetchGrants]);

  // Ensure the board picker has boards to choose from.
  useEffect(() => {
    if (workspaceId && boards.length === 0) {
      fetchBoards(workspaceId).catch(() => {});
    }
  }, [workspaceId, boards.length, fetchBoards]);

  const handleRevoke = async (grantId) => {
    setRevokingId(grantId);
    try {
      await revokeGrant(workspaceId, grantId);
    } finally {
      setRevokingId(null);
    }
  };

  const sortedGrants = useMemo(
    () => [...grants].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [grants]
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 900 }}>
      <AddGrantForm
        workspaceId={workspaceId}
        boards={boards}
        onCreated={() => fetchGrants(workspaceId).catch(() => {})}
      />

      <div
        className="bg-surface"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {/* Table header */}
        <div
          className="hidden md:grid items-center px-4"
          style={{
            gridTemplateColumns: '1.4fr 1.4fr 90px 120px 90px',
            height: 40,
            background: 'var(--color-bg-subtle)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {['Shared with', 'Resource', 'Access', 'Expires', ''].map((h) => (
            <span
              key={h}
              className="font-body font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)]"
              style={{ fontSize: 11 }}
            >
              {h}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center font-body text-[13px] text-[color:var(--color-text-muted)]">
            Loading shared access…
          </div>
        ) : sortedGrants.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="font-body font-medium text-[13px] text-[color:var(--color-text-primary)]">
              Nothing shared yet
            </p>
            <p className="font-body text-[12px] text-[color:var(--color-text-muted)] mt-1">
              Grant a board or this workspace to a user in another workspace above.
            </p>
          </div>
        ) : (
          sortedGrants.map((g) => {
            const grantee = g.granteeUserId || {};
            return (
              <div
                key={g._id}
                className="grid items-center gap-2 px-4 py-3"
                style={{
                  gridTemplateColumns: '1.4fr 1.4fr 90px 120px 90px',
                  borderBottom: '1px solid var(--color-border)',
                  opacity: g.isExpired ? 0.55 : 1,
                }}
              >
                <div className="min-w-0">
                  <p className="font-body font-semibold text-[13px] text-[color:var(--color-text-primary)] truncate">
                    {grantee.name || grantee.email || 'Unknown user'}
                  </p>
                  {grantee.email && (
                    <p className="font-body text-[11px] text-[color:var(--color-text-muted)] truncate">
                      {grantee.email}
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-body text-[13px] text-[color:var(--color-text-secondary)] truncate">
                    {g.resourceLabel}
                  </p>
                  <p className="font-body text-[11px] text-[color:var(--color-text-muted)]">
                    {g.resourceType === 'workspace' ? 'Whole workspace' : 'Board'}
                  </p>
                </div>
                <div><RoleChip role={g.role} /></div>
                <div className="font-body text-[12px] text-[color:var(--color-text-muted)] flex items-center gap-1">
                  {g.expiresAt ? (
                    <>
                      <Clock size={11} aria-hidden="true" />
                      {g.isExpired ? 'Expired' : formatShortDate(g.expiresAt)}
                    </>
                  ) : (
                    'Never'
                  )}
                </div>
                <div className="flex justify-end md:justify-start">
                  <button
                    type="button"
                    onClick={() => handleRevoke(g._id)}
                    disabled={revokingId === g._id}
                    className="inline-flex items-center gap-1 font-body font-semibold text-[12px] text-[color:var(--color-status-stuck)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded disabled:opacity-50"
                    aria-label="Revoke access"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {revokingId === g._id ? '…' : 'Revoke'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default GrantsTable;
