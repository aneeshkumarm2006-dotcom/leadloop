import { useMemo, useState } from 'react';
import { Users, Share2 } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
import MembersPage from './MembersPage';
import GrantsTable from '../components/workspace/GrantsTable';
import useAuthStore from '../store/authStore';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * WorkspaceSettingsPage — workspace administration (Phase 1 / F3).
 *
 * Two tabs:
 *   - Members — reuses the existing MembersPage (embedded, no page chrome).
 *   - Sharing — the cross-workspace grants table (admin only).
 *
 * The Sharing tab is hidden for non-admins; the grant API enforces admin too.
 */
const useIsCurrentWorkspaceAdmin = () => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useWorkspaceStore((s) => s.currentOrg);
  return useMemo(() => {
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
  }, [user, currentOrg]);
};

const TabButton = ({ active, onClick, icon: Icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className="inline-flex items-center gap-2 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
    style={{
      height: 38,
      padding: '0 14px',
      borderRadius: 'var(--radius-md)',
      background: active ? 'var(--color-accent-light)' : 'transparent',
      color: active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
      fontWeight: active ? 600 : 500,
      fontSize: 14,
    }}
  >
    <Icon size={15} aria-hidden="true" />
    {children}
  </button>
);

const WorkspaceSettingsPage = () => {
  const currentOrg = useWorkspaceStore((s) => s.currentOrg);
  const isAdmin = useIsCurrentWorkspaceAdmin();
  const [tab, setTab] = useState('members');

  // Guard: a non-admin who somehow lands on the sharing tab is bounced back.
  const activeTab = tab === 'sharing' && !isAdmin ? 'members' : tab;

  return (
    <PageWrapper flush>
      <PageHeader
        eyebrow="Settings › Workspace"
        title="Workspace"
        subtitle={currentOrg?.displayName || currentOrg?.name || 'Your workspace'}
      >
        <nav aria-label="Workspace settings" className="flex flex-wrap items-center gap-1">
          <TabButton
            active={activeTab === 'members'}
            onClick={() => setTab('members')}
            icon={Users}
          >
            Members
          </TabButton>
          {isAdmin && (
            <TabButton
              active={activeTab === 'sharing'}
              onClick={() => setTab('sharing')}
              icon={Share2}
            >
              Sharing
            </TabButton>
          )}
        </nav>
      </PageHeader>

      <PageBody>
        {activeTab === 'members' ? (
          <MembersPage embedded />
        ) : (
          <GrantsTable workspaceId={currentOrg?._id} />
        )}
      </PageBody>
    </PageWrapper>
  );
};

export default WorkspaceSettingsPage;
