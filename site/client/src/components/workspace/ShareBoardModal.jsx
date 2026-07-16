import { useState } from 'react';
import { Share2, AlertCircle, Check } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * ShareBoardModal — grant a single board to a named user in another workspace
 * (Phase 1 / F3). Opened from the board card "Share" menu item.
 *
 * Props: { isOpen, onClose, board }
 *   `board` carries `_id`, `name`, and `organisation` (the grantor workspace).
 */
const fieldStyle = {
  height: 40,
  padding: '0 12px',
  border: '1.5px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  fontSize: 14,
  width: '100%',
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-muted)',
  marginBottom: 6,
  display: 'block',
};

const ShareBoardModal = ({ isOpen, onClose, board }) => {
  const createGrant = useWorkspaceStore((s) => s.createGrant);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const workspaceId =
    board && (typeof board.organisation === 'object'
      ? board.organisation?._id
      : board.organisation);

  const reset = () => {
    setEmail('');
    setRole('viewer');
    setExpiresAt('');
    setError('');
    setDone(false);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose?.();
  };

  const handleSubmit = async () => {
    setError('');
    if (!email.trim()) {
      setError('Enter the email of the person to share with.');
      return;
    }
    if (!workspaceId || !board?._id) {
      setError('This board cannot be shared.');
      return;
    }
    setSubmitting(true);
    try {
      await createGrant(workspaceId, {
        resourceType: 'board',
        resourceId: board._id,
        granteeEmail: email.trim(),
        role,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not share this board. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Share "${board?.name || 'board'}"`}
      maxWidth={460}
      footer={
        done ? (
          <Button variant="primary" onClick={handleClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting} icon={Share2}>
              {submitting ? 'Sharing…' : 'Share board'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center text-center py-4">
          <div
            className="flex items-center justify-center"
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              background: 'var(--color-accent-light)',
              marginBottom: 12,
            }}
          >
            <Check size={22} color="var(--color-accent)" aria-hidden="true" />
          </div>
          <p className="font-body text-[14px] text-[color:var(--color-text-primary)]">
            <strong>{board?.name}</strong> is now shared with{' '}
            <strong>{email}</strong> as a {role}.
          </p>
          <p className="font-body text-[12px] text-[color:var(--color-text-muted)] mt-2">
            They'll see it under "Shared with me" on their next reload.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-body text-[13px] text-[color:var(--color-text-secondary)]">
            Grant a user in another workspace access to this board. They don't
            need to be a member of your workspace.
          </p>

          <div>
            <label style={labelStyle} htmlFor="share-email">Their email</label>
            <input
              id="share-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="person@example.com"
              style={fieldStyle}
              autoFocus
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="share-role">Access level</label>
            <select
              id="share-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={fieldStyle}
            >
              <option value="viewer">Viewer — can read, not edit</option>
              <option value="editor">Editor — can read &amp; edit</option>
            </select>
          </div>

          <div>
            <label style={labelStyle} htmlFor="share-expiry">Expires (optional)</label>
            <input
              id="share-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={fieldStyle}
            />
          </div>

          {error && (
            <p className="font-body flex items-center gap-1.5" style={{ fontSize: 13, color: '#DC2626' }}>
              <AlertCircle size={14} aria-hidden="true" /> {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

export default ShareBoardModal;
