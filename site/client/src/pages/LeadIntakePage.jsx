import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import useBoardStore from '../store/boardStore';
import IntakePolicyForm from '../components/board/IntakePolicyForm';
import IntakeEventsPanel from '../components/board/IntakeEventsPanel';

/**
 * LeadIntakePage — the F9 Automated Lead Agent surface (admin-only). Mirrors
 * IntegrationsPage: usable standalone via `/boards/:id/intake` with the board
 * from the route param (or a picker when none is in scope).
 */

const useIsCurrentOrgAdmin = () => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  if (!user || !currentOrg) return false;
  const adminId =
    typeof currentOrg.admin === 'object' && currentOrg.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg.admin;
  const isMainAdmin = !!adminId && String(adminId) === String(user._id);
  const isExtraAdmin =
    Array.isArray(currentOrg.admins) &&
    currentOrg.admins.some((a) => {
      const id = typeof a === 'object' && a !== null ? a._id || a : a;
      return String(id) === String(user._id);
    });
  return isMainAdmin || isExtraAdmin;
};

const LeadIntakePage = ({ boardId: boardIdProp = null }) => {
  const params = useParams();
  const isAdmin = useIsCurrentOrgAdmin();

  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const getBoardById = useBoardStore((s) => s.getBoardById);

  const routeBoardId = boardIdProp || params.id || null;
  const [pickedBoardId, setPickedBoardId] = useState(null);
  const boardId = routeBoardId || pickedBoardId;
  const board = boardId ? getBoardById(boardId) : null;

  useEffect(() => {
    if (orgId && boards.length === 0) {
      fetchBoards(orgId).catch((err) => console.error('Failed to fetch boards:', err));
    }
  }, [orgId, boards.length, fetchBoards]);

  const boardOptions = useMemo(
    () =>
      (boards || [])
        .filter((b) => !orgId || String(b.organisation || '') === String(orgId))
        .map((b) => ({ value: b._id, label: b.name })),
    [boards, orgId]
  );

  return (
    <PageWrapper>
      <header className="mb-6">
        <h1 className="font-display font-bold inline-flex items-center gap-2" style={{ fontSize: 22, color: 'var(--color-text-primary)' }}>
          <UserPlus size={20} /> Lead Intake
        </h1>
        <p className="font-body mt-1" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Automatically assign, stage, welcome, and follow up on every new lead for this board.
        </p>
      </header>

      {!routeBoardId && (
        <div className="mb-6 flex flex-col gap-2" style={{ maxWidth: 360 }}>
          <label className="font-body font-medium text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
            Board
          </label>
          <select
            value={pickedBoardId || ''}
            onChange={(e) => setPickedBoardId(e.target.value || null)}
            className="font-body"
            style={{
              height: 38,
              padding: '0 10px',
              borderRadius: 'var(--radius-md)',
              border: '1.5px solid var(--color-border)',
              background: 'var(--color-bg-input)',
              color: 'var(--color-text-primary)',
              fontSize: 14,
            }}
          >
            <option value="">Choose a board…</option>
            {boardOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {!isAdmin ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Lead intake settings are admin-only.
        </p>
      ) : !boardId ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Choose a board above to configure its lead intake.
        </p>
      ) : !board ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Loading board…
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <IntakePolicyForm boardId={boardId} board={board} />
          <IntakeEventsPanel boardId={boardId} />
        </div>
      )}
    </PageWrapper>
  );
};

export default LeadIntakePage;
