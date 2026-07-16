import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Users,
  Check,
  ArrowLeft,
  Home,
  LayoutGrid,
  UserCheck,
  Calendar,
  BarChart3,
  LayoutList,
  ChevronDown,
  Zap,
  Sparkles,
  Plug,
  CalendarClock,
} from 'lucide-react';
import Navbar from './Navbar';
import SidebarFolders from './SidebarFolders';
import useOrgStore from '../../store/orgStore';
import useAuthStore from '../../store/authStore';
import useBoardStore from '../../store/boardStore';

/** A single left-sidebar nav row (icon + label) with active highlight. */
const SidebarLink = ({ icon: Icon, label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors duration-100 hover:bg-[color:var(--color-bg-subtle)]"
    style={{
      background: active ? 'var(--color-accent-light)' : undefined,
      color: active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
      fontWeight: active ? 600 : 500,
    }}
  >
    <Icon size={16} aria-hidden="true" />
    <span className="font-body text-[13px] truncate">{label}</span>
  </button>
);

const AVATAR_COLORS = ['#3E6B4E', '#16A34A', '#EA580C', '#7C3AED', '#D97706', '#DC2626'];

const getAvatarColor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

/* ----------------------------- Org Sidebar ----------------------------- */

const OrgSidebar = () => {
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgs = useOrgStore((s) => s.orgs);
  const setCurrentOrg = useOrgStore((s) => s.setCurrentOrg);
  const createOrg = useOrgStore((s) => s.createOrg);
  const joinOrg = useOrgStore((s) => s.joinOrg);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const user = useAuthStore((s) => s.user);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Keep the sidebar board list in sync with the current workspace.
  useEffect(() => {
    if (currentOrg?._id) fetchBoards(currentOrg._id).catch(() => {});
  }, [currentOrg?._id, fetchBoards]);

  const adminId =
    typeof currentOrg?.admin === 'object' && currentOrg?.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg?.admin;
  const isAdmin =
    (!!user && !!adminId && String(adminId) === String(user._id)) ||
    (!!user &&
      Array.isArray(currentOrg?.admins) &&
      currentOrg.admins.some((a) => String(typeof a === 'object' && a ? a._id || a : a) === String(user._id)));

  // Sidebar = navigation only. Workspace-level things (Dashboard/Reports/Members)
  // live as Workspace-Home tabs; board-level things (Calendar) are board views.
  // "My Leads" stays here as the personal, cross-board view.
  const navItems = [
    { to: '/workspace', label: t('workspace.home'), icon: Home },
    { to: '/my-tasks', label: t('nav.myLeads'), icon: UserCheck },
  ];

  const handleSwitch = (orgId) => {
    if (orgId !== currentOrg?._id) setCurrentOrg(orgId);
    navigate('/workspace');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createOrg(orgName.trim());
      await fetchCurrentUser();
      setOrgName('');
      setMode(null);
      navigate('/workspace');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create workspace');
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await joinOrg(inviteCode.trim());
      await fetchCurrentUser();
      setInviteCode('');
      setMode(null);
      navigate('/workspace');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid invite code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="hidden md:flex flex-col shrink-0"
      style={{
        width: 240,
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
        // Stay put while the main content scrolls (sticky under the 56px navbar).
        position: 'sticky',
        top: 56,
        alignSelf: 'flex-start',
        height: 'calc(100vh - 56px)',
      }}
    >
      {/* Workspace switcher (Monday-style) */}
      <div className="px-3 py-3 shrink-0 relative" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button
          type="button"
          onClick={() => setSwitcherOpen((v) => !v)}
          aria-expanded={switcherOpen}
          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[color:var(--color-bg-subtle)]"
        >
          <div
            className="flex items-center justify-center font-display font-bold text-white shrink-0"
            style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: getAvatarColor(currentOrg?.name || ''), fontSize: 12 }}
            aria-hidden="true"
          >
            {(currentOrg?.name || '?').trim().charAt(0).toUpperCase()}
          </div>
          <span className="flex-1 min-w-0 text-left font-body font-semibold text-[14px] text-[color:var(--color-text-primary)] truncate">
            {currentOrg?.displayName || currentOrg?.name || 'Workspace'}
          </span>
          <ChevronDown size={16} color="var(--color-text-muted)" aria-hidden="true" />
        </button>
        {switcherOpen && (
          <div className="absolute left-3 right-3 mt-1 bg-white z-50" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
            <div className="py-1 max-h-72 overflow-y-auto">
              {orgs.map((org) => {
                const active = org._id === currentOrg?._id;
                return (
                  <button
                    key={org._id}
                    type="button"
                    onClick={() => { handleSwitch(org._id); setSwitcherOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--color-bg-subtle)]"
                  >
                    <div className="flex items-center justify-center font-display font-bold text-white shrink-0" style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', background: getAvatarColor(org.name || ''), fontSize: 11 }} aria-hidden="true">
                      {(org.name || '?').trim().charAt(0).toUpperCase()}
                    </div>
                    <span className="flex-1 font-body text-[13px] text-[color:var(--color-text-primary)] truncate" style={{ fontWeight: active ? 600 : 400 }}>{org.name}</span>
                    {active && <Check size={14} color="var(--color-accent)" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="py-1" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button type="button" onClick={() => { setMode('create'); setError(''); setSwitcherOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-left font-body text-[13px] text-[color:var(--color-accent)] hover:bg-[color:var(--color-bg-subtle)]">
                <Plus size={14} /> Create workspace
              </button>
              <button type="button" onClick={() => { setMode('join'); setError(''); setSwitcherOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-left font-body text-[13px] text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-bg-subtle)]">
                <Users size={14} /> Join workspace
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!mode && (
          <>
            {/* App sections */}
            <nav className="py-2">
              {navItems.map((item) => (
                <SidebarLink
                  key={item.to}
                  icon={item.icon}
                  label={item.label}
                  active={pathname === item.to}
                  onClick={() => navigate(item.to)}
                />
              ))}
              {isAdmin && (
                <SidebarLink
                  icon={Zap}
                  label={t('automationsHub.title')}
                  active={pathname.startsWith('/automations') && pathname !== '/automations/forms'}
                  onClick={() => navigate('/automations/hub')}
                />
              )}
              {isAdmin && (
                <SidebarLink
                  icon={Sparkles}
                  label={t('automationsForms.nav')}
                  active={pathname === '/automations/forms'}
                  onClick={() => navigate('/automations/forms')}
                />
              )}
              {isAdmin && (
                <SidebarLink
                  icon={Plug}
                  label={t('integrationsPremium.nav')}
                  active={pathname === '/integrations'}
                  onClick={() => navigate('/integrations')}
                />
              )}
              {isAdmin && (
                <SidebarLink
                  icon={CalendarClock}
                  label={t('bookingPremium.nav')}
                  active={pathname === '/booking'}
                  onClick={() => navigate('/booking')}
                />
              )}
            </nav>

            {/* Boards grouped by folder (Phase 3.1) */}
            <SidebarFolders
              orgId={currentOrg?._id}
              boards={boards}
              isAdmin={isAdmin}
              pathname={pathname}
              onNavigate={navigate}
              onRefreshBoards={() => currentOrg?._id && fetchBoards(currentOrg._id).catch(() => {})}
            />
          </>
        )}

        {/* Create form */}
        {mode === 'create' && (
          <div className="p-4">
            <button
              type="button"
              onClick={() => { setMode(null); setError(''); }}
              className="flex items-center gap-1 font-body text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] mb-4"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
            <p className="font-display font-bold text-[14px] text-[color:var(--color-text-primary)] mb-4">
              Create workspace
            </p>
            <form onSubmit={handleCreate}>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Workspace name"
                autoFocus
                disabled={submitting}
                className="w-full h-9 px-3 font-body text-[13px] text-[color:var(--color-text-primary)] bg-[color:var(--color-bg-input)] focus:outline-none"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                }}
              />
              {error && (
                <p className="mt-2 font-body text-[11px] text-[color:var(--color-status-stuck)]">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting || !orgName.trim()}
                className="mt-3 w-full h-9 font-body font-semibold text-[13px] text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                style={{ borderRadius: 'var(--radius-md)' }}
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </form>
          </div>
        )}

        {/* Join form */}
        {mode === 'join' && (
          <div className="p-4">
            <button
              type="button"
              onClick={() => { setMode(null); setError(''); }}
              className="flex items-center gap-1 font-body text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] mb-4"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
            <p className="font-display font-bold text-[14px] text-[color:var(--color-text-primary)] mb-4">
              Join workspace
            </p>
            <form onSubmit={handleJoin}>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Paste invite code"
                autoFocus
                disabled={submitting}
                className="w-full h-9 px-3 font-body text-[13px] text-[color:var(--color-text-primary)] bg-[color:var(--color-bg-input)] focus:outline-none"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                }}
              />
              {error && (
                <p className="mt-2 font-body text-[11px] text-[color:var(--color-status-stuck)]">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting || !inviteCode.trim()}
                className="mt-3 w-full h-9 font-body font-semibold text-[13px] text-[color:var(--color-text-primary)] bg-white hover:bg-[color:var(--color-bg-subtle)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                style={{
                  border: '1.5px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                {submitting ? 'Joining…' : 'Join'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

/* ----------------------------- PageWrapper ----------------------------- */

/**
 * PageWrapper — standard shell used by all authenticated in-app pages.
 * Renders the Navbar + a persistent org sidebar on the left + page content.
 *
 * Props:
 *   showNav (bool, default true) — render the Navbar + sidebar
 *   padded  (bool, default true) — apply page padding to the content area
 *   children
 */
const PageWrapper = ({
  showNav = true,
  padded = true,
  children,
  className = '',
}) => {
  const { pathname } = useLocation();
  const contentHeight = showNav ? 'calc(100vh - 56px)' : '100vh';

  return (
    <div className="min-h-screen bg-base">
      {showNav && <Navbar />}

      <div
        className="flex"
        style={{
          minHeight: contentHeight,
          background: 'var(--color-bg-base)',
        }}
      >
        {showNav && <OrgSidebar />}

        <div className={['flex-1 min-w-0', className].join(' ')}>
          <div
            key={pathname}
            className={[
              'mx-auto w-full macan-page-enter',
              padded ? 'px-4 py-6 md:px-10 md:py-8' : '',
            ].join(' ')}
            style={{ maxWidth: 1440 }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PageWrapper;
