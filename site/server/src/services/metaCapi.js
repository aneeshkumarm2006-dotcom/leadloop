/**
 * metaCapi.js — send events to a Meta dataset through the Conversions API.
 *
 *   POST https://graph.facebook.com/{version}/{datasetId}/events
 *
 * Returns a normalised result the conversion runner can act on:
 *   { ok: true,  response }                      — accepted
 *   { ok: false, retryable: true,  error, response } — try again later
 *   { ok: false, retryable: false, error, response } — will never succeed as-is
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */

const API_VERSION = () => process.env.META_API_VERSION || 'v24.0';

// Graph API error codes that are worth retrying (throttling / transient).
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

const trimResponse = (body) => {
  if (!body || typeof body !== 'object') return body ?? null;
  const { events_received, messages, fbtrace_id, error } = body;
  return {
    events_received,
    messages,
    fbtrace_id,
    error: error ? { message: error.message, code: error.code, subcode: error.error_subcode, fbtrace_id: error.fbtrace_id } : undefined,
  };
};

/**
 * @param {Object}   args
 * @param {string}   args.datasetId
 * @param {string}   args.accessToken
 * @param {Object[]} args.events          Conversions API event objects
 * @param {string}   [args.testEventCode] send as test events
 */
const sendEvents = async ({ datasetId, accessToken, events, testEventCode, fetchImpl = fetch }) => {
  if (!datasetId || !accessToken) return { ok: false, retryable: false, error: 'meta_not_configured' };
  const url = `https://graph.facebook.com/${API_VERSION()}/${encodeURIComponent(datasetId)}/events`;
  const body = { data: events, access_token: accessToken };
  if (testEventCode) body.test_event_code = testEventCode;

  let res;
  let json = null;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    return { ok: false, retryable: true, error: `network: ${err.message}` };
  }

  if (res.ok && json && typeof json.events_received === 'number') {
    return { ok: true, response: trimResponse(json) };
  }
  const e = (json && json.error) || {};
  const retryable = res.status >= 500 || res.status === 429 || RETRYABLE_CODES.has(Number(e.code));
  return {
    ok: false,
    retryable,
    error: e.message ? `${e.message}${e.code ? ` (code ${e.code})` : ''}` : `HTTP ${res.status}`,
    response: trimResponse(json),
  };
};

module.exports = { sendEvents, API_VERSION };
