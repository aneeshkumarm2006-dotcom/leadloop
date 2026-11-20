/**
 * googleTagManager.js — one-click install of the LeadLoop website tag through
 * Google Tag Manager (API v2), using the same Google sign-in as Google Ads
 * (with the extra Tag Manager scopes).
 *
 *   list containers → find default workspace → create-or-update a Custom HTML
 *   tag "LeadLoop" (All Pages trigger) → create version → publish.
 */

const { requestJson, PlatformError } = require('./adConnectHttp');
const googleAds = require('./googleAdsConversions');

const GTM = 'https://tagmanager.googleapis.com/tagmanager/v2';
const ALL_PAGES_TRIGGER_ID = '2147479553'; // GTM's built-in "All Pages" trigger
const TAG_NAME = 'LeadLoop';

const ID_RE = /^\d{1,20}$/;

/** The Custom HTML tag body (pure — unit-tested). */
const leadLoopTag = (snippetTag) => ({
  name: TAG_NAME,
  type: 'html',
  parameter: [
    { type: 'template', key: 'html', value: snippetTag },
    { type: 'boolean', key: 'supportDocumentWrite', value: 'false' },
  ],
  firingTriggerId: [ALL_PAGES_TRIGGER_ID],
  tagFiringOption: 'oncePerEvent',
  notes: 'Added by LeadLoop — loads lead capture and your ad pixels. Managed from LeadLoop → Settings → Ads & tracking.',
});

const client = (refreshToken, { fetchImpl = fetch } = {}) => {
  const call = async (path, opts = {}) => {
    const at = await googleAds.accessToken(fetchImpl, { refreshToken });
    const { json } = await requestJson(`${GTM}/${path}`, { ...opts, headers: { Authorization: `Bearer ${at}` }, fetchImpl, label: 'gtm' });
    return json || {};
  };

  const listContainers = async () => {
    const accounts = ((await call('accounts')).account || []).slice(0, 50);
    const out = [];
    for (const a of accounts) {
      let containers = [];
      try {
        containers = (await call(`accounts/${encodeURIComponent(a.accountId)}/containers`)).container || [];
      } catch (err) {
        console.warn('[gtm] container list skipped for an account:', err.message);
        continue;
      }
      for (const c of containers) {
        const ctx = c.usageContext || [];
        if (ctx.length && !ctx.includes('web')) continue; // only web containers
        out.push({
          accountId: String(a.accountId),
          accountName: a.name || '',
          containerId: String(c.containerId),
          publicId: c.publicId || '',
          name: c.name || '',
          domains: c.domainName || [],
        });
      }
    }
    return out;
  };

  /**
   * Install (or update) the tag and publish. Idempotent: an existing tag named
   * "LeadLoop" in the workspace is updated in place.
   */
  const install = async ({ accountId, containerId, snippetTag }) => {
    if (!ID_RE.test(String(accountId)) || !ID_RE.test(String(containerId))) {
      throw new PlatformError('gtm: invalid ids', { status: 400, code: 'invalid_ids' });
    }
    const base = `accounts/${accountId}/containers/${containerId}`;
    const container = await call(base);
    const workspaces = (await call(`${base}/workspaces`)).workspace || [];
    const ws = workspaces.find((w) => /default workspace/i.test(w.name || '')) || workspaces[0];
    if (!ws) throw new PlatformError('gtm: container has no workspace', { status: 409, code: 'no_workspace' });
    const wsPath = `${base}/workspaces/${encodeURIComponent(ws.workspaceId)}`;

    const tags = (await call(`${wsPath}/tags`)).tag || [];
    const existing = tags.find((t) => t.name === TAG_NAME);
    const body = leadLoopTag(snippetTag);
    const tag = existing
      ? await call(`${wsPath}/tags/${encodeURIComponent(existing.tagId)}${existing.fingerprint ? `?fingerprint=${encodeURIComponent(existing.fingerprint)}` : ''}`, { method: 'PUT', body })
      : await call(`${wsPath}/tags`, { method: 'POST', body });

    const created = await call(`${wsPath}:create_version`, {
      method: 'POST',
      body: { name: 'LeadLoop tag', notes: 'Installs/updates the LeadLoop website tag.' },
    });
    if (created.compilerError) throw new PlatformError('gtm: workspace has compiler errors', { status: 409, code: 'compiler_error' });
    const version = created.containerVersion || {};
    if (!version.containerVersionId) {
      // Typically: the workspace has conflicting/unsynced changes.
      throw new PlatformError('gtm: version was not created', { status: 409, code: 'version_not_created' });
    }
    await call(`${base}/versions/${encodeURIComponent(version.containerVersionId)}:publish`, { method: 'POST' });
    return {
      containerPublicId: container.publicId || '',
      workspaceId: String(ws.workspaceId),
      tagId: String(tag.tagId || (existing && existing.tagId) || ''),
      versionId: String(version.containerVersionId),
      publishedAt: new Date(),
    };
  };

  return { listContainers, install };
};

module.exports = { client, leadLoopTag, ALL_PAGES_TRIGGER_ID, TAG_NAME };
