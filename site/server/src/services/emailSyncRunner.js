/**
 * emailSyncRunner.js — inbound email drift correction (Phase 3, F8.4).
 *
 * Two idempotent crons (modeled on dateAutomationRunner / webhookDispatcher):
 *   - every 2 min  → poll IMAP-fallback (`smtp`) accounts for new mail
 *   - every 30 min → heartbeat sweep of Gmail/Microsoft push accounts, catching
 *                    anything their push channel missed
 * Each active account's recent inbox is fetched through its adapter and routed
 * via `resolveInboundEmail`. Best-effort per account — one account's failure
 * (expired token, network) never aborts the sweep; repeated failures flip the
 * account to `status: 'error'` via `ensureAccessToken`.
 */

const nodeCron = require('node-cron');
const EmailAccount = require('../models/EmailAccount');
const { getAdapter } = require('./emailProviders');
const { ensureAccessToken } = require('./emailOAuth');
const { resolveInboundEmail } = require('./emailInboundResolver');

let started = false;

/** Poll one account's recent inbox and route each message to a task. */
const syncAccount = async (account) => {
  const adapter = getAdapter(account.provider);
  if (!adapter || typeof adapter.fetchRecent !== 'function') return;

  let messages = [];
  if (account.provider === 'smtp') {
    if (!account.imapConfig || !account.imapConfig.host) return; // no IMAP creds → skip
    messages = await adapter.fetchRecent({ imap: account.imapConfig, max: 25 });
  } else {
    const accessToken = await ensureAccessToken(account);
    messages = await adapter.fetchRecent({ accessToken, max: 25 });
  }

  for (const msg of messages) {
    try {
      await resolveInboundEmail({ ...msg, provider: account.provider });
    } catch (err) {
      console.error('[emailSync] resolve failed:', err?.message || err);
    }
  }
  account.lastSyncAt = new Date();
  await account.save().catch(() => {});
};

/** One sweep over the accounts matching `providers`. */
const sweep = async (providers) => {
  let accounts;
  try {
    accounts = await EmailAccount.find({ status: 'active', provider: { $in: providers } }).limit(500);
  } catch (err) {
    console.error('[emailSync] failed to load accounts:', err?.message || err);
    return;
  }
  for (const account of accounts) {
    try {
      await syncAccount(account);
    } catch (err) {
      console.error('[emailSync] account sweep failed:', account._id?.toString(), err?.message || err);
    }
  }
};

const syncImapAccounts = () => sweep(['smtp']);
const heartbeatPushAccounts = () => sweep(['gmail', 'microsoft']);

/**
 * Start the email sync crons. Idempotent — safe to call once on boot. No-op for
 * scheduling if the process can't reach the DB yet; the crons retry next tick.
 */
const startEmailSyncRunner = () => {
  if (started) return;
  started = true;
  // IMAP fallback — every 2 minutes.
  nodeCron.schedule('*/2 * * * *', () => {
    syncImapAccounts().catch((err) => console.error('[emailSync] imap tick error:', err));
  });
  // Push-account heartbeat — every 30 minutes.
  nodeCron.schedule('*/30 * * * *', () => {
    heartbeatPushAccounts().catch((err) => console.error('[emailSync] heartbeat tick error:', err));
  });
  console.log('email sync runner started');
};

module.exports = {
  startEmailSyncRunner,
  syncAccount,
  syncImapAccounts,
  heartbeatPushAccounts,
};
