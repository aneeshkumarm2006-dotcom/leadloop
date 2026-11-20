import {
  Building2,
  LayoutTemplate,
  Mail,
  MessageSquare,
  MessageCircle,
  Target,
  Sparkles,
  UserCircle2,
} from 'lucide-react';

/**
 * Settings tab registry — shared by the Settings menu (desktop column + mobile
 * tab bar), the page router and the per-tab headers ("Settings › <Group>").
 *
 * `adminOnly` tabs hold workspace-level credentials; non-admins never see them
 * and are bounced to Profile if they deep-link to one.
 * `keywords` are extra (untranslated) search terms for the menu filter.
 */
export const SETTINGS_GROUPS = ['workspace', 'channels', 'growth', 'you'];

export const SETTINGS_TABS = [
  { key: 'organisation', group: 'workspace', icon: Building2, adminOnly: true, keywords: 'workspace invite team members plan billing delete' },
  { key: 'templates', group: 'workspace', icon: LayoutTemplate, adminOnly: true, keywords: 'board templates pipeline stages columns' },
  // Email connection is per-user (any member can connect their own mailbox).
  { key: 'email', group: 'channels', icon: Mail, adminOnly: false, keywords: 'gmail google outlook microsoft mailbox inbox' },
  // SMS / WhatsApp (Twilio) are workspace-level credentials — admin only.
  { key: 'sms', group: 'channels', icon: MessageSquare, adminOnly: true, keywords: 'twilio text messages opt-out stop' },
  { key: 'whatsapp', group: 'channels', icon: MessageCircle, adminOnly: true, keywords: 'twilio templates messages' },
  // Ads & tracking (Meta / Google Ads / TikTok, website tag) — admin only.
  { key: 'ads', group: 'growth', icon: Target, adminOnly: true, keywords: 'meta facebook instagram google tiktok pixel conversions website tag lead ads' },
  // AI keys and Profile are personal.
  { key: 'ai', group: 'you', icon: Sparkles, adminOnly: false, keywords: 'claude chatgpt openai anthropic api key model' },
  { key: 'profile', group: 'you', icon: UserCircle2, adminOnly: false, keywords: 'name photo avatar picture language delete account' },
];

/** `?tab=<key>` values that deep-link a Settings tab. */
export const SETTINGS_TAB_KEYS = SETTINGS_TABS.map((t) => t.key);

export const ADMIN_ONLY_TABS = SETTINGS_TABS.filter((t) => t.adminOnly).map((t) => t.key);

export const settingsGroupOf = (key) => SETTINGS_TABS.find((t) => t.key === key)?.group || 'you';
