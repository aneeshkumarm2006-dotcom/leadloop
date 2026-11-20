import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageWrapper from '../components/layout/PageWrapper';
import SettingsSidebar, { SettingsTabBar } from '../components/settings/SettingsSidebar';
import { SETTINGS_TAB_KEYS, ADMIN_ONLY_TABS } from '../components/settings/settingsTabs';
import OrganisationSettings from '../components/settings/OrganisationSettings';
import TemplatesSettings from '../components/settings/TemplatesSettings';
import ProfileSettings from '../components/settings/ProfileSettings';
import EmailAccountConnect from '../components/settings/EmailAccountConnect';
import SmsConfigForm from '../components/settings/SmsConfigForm';
import SmsOptOutList from '../components/settings/SmsOptOutList';
import WhatsAppConfigForm from '../components/settings/WhatsAppConfigForm';
import WhatsAppTemplateManager from '../components/settings/WhatsAppTemplateManager';
import AdsTrackingHub from '../components/settings/ads/AdsTrackingHub';
import AiKeysConfigForm from '../components/settings/AiKeysConfigForm';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import * as orgService from '../services/orgService';
import * as profileService from '../services/profileService';
import useToastStore from '../store/toastStore';

/**
 * Settings Page — full-width layout: the Settings menu as a sticky white
 * column next to the app sidebar (a horizontal tab bar on phones), and the
 * selected tab using all remaining width. Each tab renders its own
 * <PageHeader> ("Settings › <Group>") + <PageBody>.
 *
 * `?tab=<key>` deep-links a tab (notifications link to /settings?tab=ads);
 * admin-only tabs bounce non-admins to Profile.
 */

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
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(SETTINGS_TAB_KEYS.includes(urlTab) ? urlTab : 'organisation');
  useEffect(() => {
    if (SETTINGS_TAB_KEYS.includes(urlTab)) setActiveTab(urlTab);
  }, [urlTab]);
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

  // If a non-admin has an admin-only tab selected, bounce them to Profile.
  // Wait until the user + workspace are loaded so a deep link (e.g. the ad
  // platform OAuth return to ?tab=ads&connect=meta) isn't bounced on first paint.
  useEffect(() => {
    if (user && currentOrg && !isAdmin && ADMIN_ONLY_TABS.includes(activeTab)) {
      setActiveTab('profile');
    }
  }, [isAdmin, activeTab, user, currentOrg]);

  // Fetch org details (with inviteCode) for Organisation tab
  useEffect(() => {
    if (activeTab === 'organisation' && currentOrg?._id && !orgState?.inviteCode) {
      orgService
        .getOrg(currentOrg._id)
        .then((o) => setOrgState(o))
        .catch(() => {});
    }
  }, [activeTab, currentOrg?._id, orgState?.inviteCode]);

  // Menu selection: switch tab, mirror it in ?tab= (so refresh / share keeps
  // the tab) and start the new tab at the top.
  const handleTabChange = useCallback(
    (key) => {
      setActiveTab(key);
      if (searchParams.get('tab') !== key) {
        const next = new URLSearchParams(searchParams);
        next.set('tab', key);
        setSearchParams(next, { replace: true });
      }
      window.scrollTo({ top: 0 });
    },
    [searchParams, setSearchParams],
  );

  const roleLabel = isMainAdmin ? t('settings.roles.owner') : isAdmin ? t('settings.roles.admin') : t('settings.roles.member');

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
    const workspaceId = currentOrg?._id;
    if (activeTab === 'organisation' && isAdmin) {
      return (
        <OrganisationSettings
          org={orgState}
          isMainAdmin={isMainAdmin}
          roleLabel={roleLabel}
          onRegenerate={handleRegenerate}
          onDeleteOrg={handleDeleteOrg}
        />
      );
    }
    if (activeTab === 'templates') {
      return <TemplatesSettings orgId={workspaceId} isAdmin={isAdmin} />;
    }
    if (activeTab === 'email') {
      return <EmailAccountConnect workspaceId={workspaceId} />;
    }
    if (activeTab === 'sms' && isAdmin) {
      return <SmsConfigForm workspaceId={workspaceId} extra={<SmsOptOutList workspaceId={workspaceId} />} />;
    }
    if (activeTab === 'whatsapp' && isAdmin) {
      return <WhatsAppConfigForm workspaceId={workspaceId} extra={<WhatsAppTemplateManager workspaceId={workspaceId} />} />;
    }
    if (activeTab === 'ads' && isAdmin) {
      // The hub keeps AdConversionsSettings as its collapsible Advanced section.
      return <AdsTrackingHub workspaceId={workspaceId} />;
    }
    if (activeTab === 'ai') {
      return <AiKeysConfigForm />;
    }
    return (
      <ProfileSettings
        user={user}
        subtitleLine={[roleLabel, currentOrg?.name].filter(Boolean).join(' · ')}
        onSaveName={handleSaveName}
        onUploadAvatar={handleUploadAvatar}
        onDeleteAccount={handleDeleteAccount}
      />
    );
  };

  // The tab actually on screen (a non-admin on an admin tab sees Profile until
  // the bounce effect lands).
  const shownTab = !isAdmin && ADMIN_ONLY_TABS.includes(activeTab) && activeTab !== 'templates' ? 'profile' : activeTab;

  return (
    <PageWrapper flush>
      <div className="flex items-stretch" style={{ minHeight: 'calc(100vh - 56px)' }}>
        <SettingsSidebar
          activeTab={shownTab}
          onTabChange={handleTabChange}
          showAdminTabs={isAdmin}
          workspaceName={currentOrg?.name}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <SettingsTabBar activeTab={shownTab} onTabChange={handleTabChange} showAdminTabs={isAdmin} />
          {renderTab()}
        </div>
      </div>
    </PageWrapper>
  );
};

export default SettingsPage;
