/**
 * emailAccountController.js — connect / list / disconnect mailboxes (F8.5).
 *
 * `connect` returns the provider consent URL; the public, state-verified
 * `oauthCallback` exchanges the code, stores ENCRYPTED tokens on an
 * `EmailAccount`, and bounces the browser back to the client settings page.
 * Tokens are never returned to the client — list responses are redacted.
 */

const mongoose = require('mongoose');
const EmailAccount = require('../models/EmailAccount');
const emailOAuth = require('../services/emailOAuth');

const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:5173';

/** Redacted account shape for client responses (no token ciphertext). */
const serializeAccount = (acc) => ({
  _id: acc._id,
  provider: acc.provider,
  workspaceId: acc.workspaceId,
  defaultFrom: acc.defaultFrom,
  signature: acc.signature,
  status: acc.status,
  lastError: acc.lastError || null,
  connectedAt: acc.connectedAt,
  lastSyncAt: acc.lastSyncAt,
});

/** GET /api/email-accounts?workspaceId= — the caller's connected mailboxes. */
const listAccounts = async (req, res) => {
  try {
    const query = { userId: req.user.userId };
    if (req.query.workspaceId && mongoose.Types.ObjectId.isValid(req.query.workspaceId)) {
      query.workspaceId = req.query.workspaceId;
    }
    const accounts = await EmailAccount.find(query).sort({ connectedAt: -1 });
    return res.json({ accounts: accounts.map(serializeAccount) });
  } catch (err) {
    console.error('listAccounts error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/email-accounts/connect/:provider  body { workspaceId } → { url }. */
const connectProvider = async (req, res) => {
  try {
    const { provider } = req.params;
    if (!emailOAuth.isSupportedProvider(provider)) {
      return res.status(400).json({ error: `Unsupported provider "${provider}"` });
    }
    const workspaceId = req.body && req.body.workspaceId;
    if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'A valid workspaceId is required' });
    }
    const url = emailOAuth.getAuthUrl({ provider, userId: req.user.userId, workspaceId });
    return res.json({ url });
  } catch (err) {
    if (err.code === 'OAUTH_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    console.error('connectProvider error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/email-accounts/oauth/callback/:provider (PUBLIC, state-verified).
 * Exchanges the code, upserts the account with encrypted tokens, and redirects
 * the browser back to the client settings page with a status query param.
 */
const oauthCallback = async (req, res) => {
  const { provider } = req.params;
  const settingsUrl = (status, extra = '') =>
    `${CLIENT_URL()}/settings?tab=email&email=${status}${extra}`;

  try {
    if (req.query.error) {
      return res.redirect(settingsUrl('error', `&reason=${encodeURIComponent(req.query.error)}`));
    }
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(settingsUrl('error', '&reason=missing_params'));

    let decoded;
    try {
      decoded = emailOAuth.verifyState(state);
    } catch {
      return res.redirect(settingsUrl('error', '&reason=bad_state'));
    }
    if (decoded.provider !== provider) {
      return res.redirect(settingsUrl('error', '&reason=provider_mismatch'));
    }

    const { tokens, address } = await emailOAuth.exchangeCode(provider, code);

    let account = await EmailAccount.findOne({
      userId: decoded.userId,
      workspaceId: decoded.workspaceId,
    });
    if (!account) {
      account = new EmailAccount({
        userId: decoded.userId,
        workspaceId: decoded.workspaceId,
        provider,
      });
    }
    account.provider = provider;
    account.setTokens(tokens);
    if (address) account.defaultFrom = address;
    account.status = 'active';
    account.lastError = null;
    account.connectedAt = new Date();
    await account.save();

    return res.redirect(settingsUrl('connected', `&provider=${provider}`));
  } catch (err) {
    console.error('oauthCallback error:', err);
    return res.redirect(settingsUrl('error', '&reason=exchange_failed'));
  }
};

/** DELETE /api/email-accounts/:id — disconnect the caller's own mailbox. */
const disconnectAccount = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid account id' });
    }
    const deleted = await EmailAccount.findOneAndDelete({ _id: id, userId: req.user.userId });
    if (!deleted) return res.status(404).json({ error: 'Account not found' });
    return res.status(204).end();
  } catch (err) {
    console.error('disconnectAccount error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { listAccounts, connectProvider, oauthCallback, disconnectAccount };
