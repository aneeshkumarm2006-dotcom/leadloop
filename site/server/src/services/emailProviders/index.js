/**
 * emailProviders/index.js — provider adapter registry (Phase 3, F8.3).
 *
 * Maps an `EmailAccount.provider` to its adapter (gmail / microsoft / smtp).
 * Each adapter exposes the same contract: `send`, `fetchThread`, `fetchRecent`.
 * The email service resolves a valid access token, then delegates here.
 */

const gmailAdapter = require('./gmailAdapter');
const microsoftAdapter = require('./microsoftAdapter');
const imapAdapter = require('./imapAdapter');

const ADAPTERS = {
  gmail: gmailAdapter,
  microsoft: microsoftAdapter,
  smtp: imapAdapter,
};

const getAdapter = (provider) => ADAPTERS[provider] || null;

module.exports = { getAdapter, ADAPTERS };
