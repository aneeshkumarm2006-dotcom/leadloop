/**
 * tiktokEvents.js — send events to a TikTok Pixel through the Events API 2.0.
 *
 *   POST https://business-api.tiktok.com/open_api/{version}/event/track/
 *   header Access-Token: <advertiser access token>
 *   body { event_source: 'web', event_source_id: <pixel code>, test_event_code?, data: [...] }
 *
 * TikTok answers HTTP 200 for most errors and signals them in the body's
 * `code` (0 = OK). Result shape matches metaCapi.sendEvents:
 *   { ok: true, response } | { ok: false, retryable, error, response }
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */

const API_VERSION = () => process.env.TIKTOK_API_VERSION || 'v1.3';
const BASE = () => `https://business-api.tiktok.com/open_api/${API_VERSION()}`;

// Business API codes worth retrying: rate limit / internal / temporarily unavailable.
// (40100 = QPS limit, 50000/50002 = internal error, 51xxx = service unavailable.)
const RETRYABLE_CODES = new Set([40100, 40016, 50000, 50002, 51003, 51004]);

const trimResponse = (body) => {
  if (!body || typeof body !== 'object') return body ?? null;
  return { code: body.code, message: body.message, request_id: body.request_id };
};

/**
 * @param {Object}   args
 * @param {string}   args.pixelCode
 * @param {string}   args.accessToken
 * @param {Object[]} args.events          items built by conversionPayloads.tiktokEvent
 * @param {string}   [args.testEventCode] send as test events (Events Manager → Test events)
 */
const sendEvents = async ({ pixelCode, accessToken, events, testEventCode, fetchImpl = fetch }) => {
  if (!pixelCode || !accessToken) return { ok: false, retryable: false, error: 'tiktok_not_configured' };
  const body = { event_source: 'web', event_source_id: pixelCode, data: events };
  if (testEventCode) body.test_event_code = testEventCode;

  let res;
  let json = null;
  try {
    res = await fetchImpl(`${BASE()}/event/track/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    return { ok: false, retryable: true, error: `network: ${err.message}` };
  }

  if (res.ok && json && json.code === 0) return { ok: true, response: trimResponse(json) };
  const code = json && typeof json.code === 'number' ? json.code : null;
  const retryable = res.status >= 500 || res.status === 429 || (code != null && RETRYABLE_CODES.has(code));
  return {
    ok: false,
    retryable,
    error: json && json.message ? `${json.message}${code != null ? ` (code ${code})` : ''}` : `HTTP ${res.status}`,
    response: trimResponse(json),
  };
};

module.exports = { sendEvents, API_VERSION };
