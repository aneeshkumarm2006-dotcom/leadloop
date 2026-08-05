import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Users,
  Check,
  ArrowLeft,
  Home,
  UserCheck,
  ChevronDown,
  Zap,
  Sparkles,
  CalendarClock,
} from 'lucide-react';
import Navbar from './Navbar';
import SidebarFolders from './SidebarFolders';
import ProductTour from '../onboarding/ProductTour';
import useOrgStore from '../../store/orgStore';
import useAuthStore from '../../store/authStore';
import useBoardStore from '../../store/boardStore';
import { getAvatarColor } from '../../utils/avatarColors';

/**
 * The dark "pine" sidebar is the app's brand anchor — deep forest ink against
 * the cream paper content, echoing the login brand panel and the marketing
 * site. Everything on it uses the pine token family (globals.css).
 */

/** Looping-arrows mark — the "loop" in LeadLoop (shared with AuthScreen). */
const LoopMark = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66"
      stroke="#fff"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M17 3v4h-4M7 21v-4h4"
      stroke="#fff"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** A single sidebar nav row (icon + label) with the pine active pill. */
const SidebarLink = ({ icon: Icon, label, active, onClick, tourId }) => (
  <button
    type="button"
    onClick={onClick}
    data-tour={tourId}
    className="w-full flex items-center gap-2.5 text-left transition-colors duration-100"
    style={{
      height: 34,
      padding: '0 10px',
      margin: '1px 0',
      borderRadius: 'var(--radius-md)',
      background: active ? 'var(--color-pine-active)' : 'transparent',
      color: active ? 'var(--color-pine-text)' : 'var(--color-pine-text-2)',
      fontWeight: active ? 600 : 500,
    }}
    onMouseEnter={(e) => {
      if (!active) {
        e.currentTarget.style.background = 'var(--color-pine-raise)';
        e.currentTarget.style.color = 'var(--color-pine-text)';
      }
    }}
    onMouseLeave={(e) => {
      if (!active) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-pine-text-2)';
      }
    }}
  >
    <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
    <span className="font-body text-[13px] truncate">{label}</span>
  </button>
);

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
    { to: '/workspace', label: t('workspace.home'), icon: Home, tourId: 'workspace-home' },
    { to: '/my-tasks', label: t('nav.myLeads'), icon: UserCheck, tourId: 'my-leads' },
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

  // Dark-field input used by the create / join forms.
  const pineInputStyle = {
    height: 34,
    padding: '0 10px',
    fontSize: 13,
    width: '100%',
    border: '1px solid var(--color-pine-line)',
    borderRadius: 'var(--radius-md)',
    background: 'rgba(237, 232, 218, 0.08)',
    color: 'var(--color-pine-text)',
    outline: 'none',
  };

  return (
    <div
      className="hidden md:flex flex-col shrink-0"
      style={{
        width: 248,
        background: 'var(--color-pine)',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
      }}
    >
      {/* Brand row — the logo lives here now (desktop). */}
      <button
        type="button"
        onClick={() => navigate('/workspace')}
        aria-label="LeadLoop home"
        className="flex items-center gap-2.5 shrink-0 text-left"
        style={{
          height: 56,
          padding: '0 16px',
          borderBottom: '1px solid var(--color-pine-line)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <span
          className="flex items-center justify-center shrink-0"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--color-accent)',
          }}
          aria-hidden="true"
        >
          <LoopMark size={16} />
        </span>
        <span
          className="font-display font-bold tracking-tight"
          style={{ fontSize: 17, color: 'var(--color-pine-text)' }}
        >
          LeadLoop
        </span>
      </button>

      {/* Workspace switcher */}
      <div className="px-3 py-3 shrink-0 relative" style={{ borderBottom: '1px solid var(--color-pine-line)' }}>
        <button
          type="button"
          onClick={() => setSwitcherOpen((v) => !v)}
          aria-expanded={switcherOpen}
          data-tour="workspace"
          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
          style={{ background: switcherOpen ? 'var(--color-pine-raise)' : 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-pine-raise)'; }}
          onMouseLeave={(e) => { if (!switcherOpen) e.currentTarget.style.background = 'transparent'; }}
        >
          <div
            className="flex items-center justify-center font-display font-bold text-white shrink-0"
            style={{ width: 26, height: 26, borderRadius: 7, background: getAvatarColor(currentOrg?.name || ''), fontSize: 12, boxShadow: 'inset 0 0 0 1px rgba(237,232,218,0.25)' }}
            aria-hidden="true"
          >
            {(currentOrg?.name || '?').trim().charAt(0).toUpperCase()}
          </div>
          <span
            className="flex-1 min-w-0 text-left font-body font-semibold text-[13.5px] truncate"
            style={{ color: 'var(--color-pine-text)' }}
          >
            {currentOrg?.displayName || currentOrg?.name || 'Workspace'}
          </span>
          <ChevronDown size={15} color="var(--color-pine-text-2)" aria-hidden="true" />
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
                    <div className="flex items-center justify-center font-display font-bold text-white shrink-0" style={{ width: 24, height: 24, borderRadius: 6, background: getAvatarColor(org.name || ''), fontSize: 11 }} aria-hidden="true">
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
      <div className="flex-1 overflow-y-auto px-2 pb-4">
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
                  tourId={item.tourId}
                />
              ))}
              {isAdmin && (
                <SidebarLink
                  icon={Zap}
                  label={t('automationsHub.title')}
                  active={pathname.startsWith('/automations') && pathname !== '/automations/forms'}
                  onClick={() => navigate('/automations/hub')}
                  tourId="automations"
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
              {/* Integrations link hidden — page is out of the app for now.
                  Restore this block to bring it back. */}
              {isAdmin && (
                <SidebarLink
                  icon={CalendarClock}
                  label={t('bookingPremium.nav')}
                  active={pathname === '/booking'}
                  onClick={() => navigate('/booking')}
                  tourId="booking"
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
          <div className="p-2 pt-4">
            <button
              type="button"
              onClick={() => { setMode(null); setError(''); }}
              className="flex items-center gap-1 font-body text-[12px] mb-4 transition-colors"
              style={{ color: 'var(--color-pine-text-2)' }}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
            <p className="font-display font-bold text-[14px] mb-4" style={{ color: 'var(--color-pine-text)' }}>
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
                className="font-body placeholder:text-[color:var(--color-pine-text-2)]"
                style={pineInputStyle}
              />
              {error && (
                <p className="mt-2 font-body text-[11px]" style={{ color: '#E8A79B' }}>{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting || !orgName.trim()}
                className="mt-3 w-full font-body font-semibold text-[13px] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                style={{ height: 34, borderRadius: 'var(--radius-md)', background: 'var(--color-pine-text)', color: 'var(--color-pine)' }}
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </form>
          </div>
        )}

        {/* Join form */}
        {mode === 'join' && (
          <div className="p-2 pt-4">
            <button
              type="button"
              onClick={() => { setMode(null); setError(''); }}
              className="flex items-center gap-1 font-body text-[12px] mb-4 transition-colors"
              style={{ color: 'var(--color-pine-text-2)' }}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
            <p className="font-display font-bold text-[14px] mb-4" style={{ color: 'var(--color-pine-text)' }}>
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
                className="font-body placeholder:text-[color:var(--color-pine-text-2)]"
                style={pineInputStyle}
              />
              {error && (
                <p className="mt-2 font-body text-[11px]" style={{ color: '#E8A79B' }}>{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting || !inviteCode.trim()}
                className="mt-3 w-full font-body font-semibold text-[13px] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                style={{ height: 34, borderRadius: 'var(--radius-md)', background: 'transparent', border: '1px solid var(--color-pine-line)', color: 'var(--color-pine-text)' }}
              >
                {submitting ? 'Joining…' : 'Join'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Brand foot — quiet mono tag, mirrors the login panel. */}
      <div
        className="shrink-0 font-mono"
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--color-pine-line)',
          fontSize: 9.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(169, 188, 167, 0.75)',
        }}
      >
        The leasing OS · Montréal
      </div>
    </div>
  );
};

/* ----------------------------- PageWrapper ----------------------------- */

/**
 * PageWrapper — standard shell used by all authenticated in-app pages.
 * Layout: [pine sidebar] | [topbar + page content]. The sidebar owns the
 * brand; the topbar (Navbar) carries search and account controls.
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

  return (
    <div className="min-h-screen bg-base flex">
      {showNav && <OrgSidebar />}

      <div className="flex-1 min-w-0 flex flex-col" style={{ background: 'var(--color-bg-base)' }}>
        {showNav && <Navbar />}

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
      {showNav && <ProductTour />}
    </div>
  );
};

export default PageWrapper;
