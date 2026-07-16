/**
 * webhookDispatcher.js — outbound webhook delivery + retry (Phase 3, F7.4).
 *
 * `dispatch(endpoint, envelope)` persists a `WebhookDelivery` (`pending`), signs
 * the JSON body with `hmacSigner.sign(body, endpoint.secret)`, and POSTs it to
 * `endpoint.url` with an `X-CRM-Signature` header. On a 2xx the delivery is
 * marked `delivered`; otherwise `attempt` advances and `nextRetryAt` is set to
 * the next backoff instant. After the backoff schedule is exhausted the delivery
 * is marked `failed`.
 *
 * Backoff schedule (AC3): retries wait 1m → 5m → 30m → 2h. `attempt` counts the
 * failures accumulated so far; the wait before the next retry is
 * `BACKOFF_MS[attempt]`, and once `attempt` reaches `BACKOFF_MS.length` the
 * delivery is `failed`. `startWebhookRetryRunner()` is an idempotent every-minute
 * cron (modeled on dateAutomationRunner) that re-attempts due `pending` rows.
 */

const cron = require('node-cron');
const WebhookDelivery = require('../models/WebhookDelivery');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const { sign } = require('../utils/hmacSigner');

// Waits before retry #1, #2, #3, #4 respectively (1m, 5m, 30m, 2h).
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 2_000; // chars stored from the destination response

let started = false;

/**
 * Pure backoff decision. Given the number of failures so far, return the ms to
 * wait before the next attempt, or `null` when the schedule is exhausted (→
 * mark failed). Exported for unit tests.
 */
const nextBackoffMs = (attempt) =>
  attempt >= 0 && attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : null;

/** Truncate a response body to a bounded string for the audit row. */
const boundedBody = (text) => {
  if (text == null) return null;
  const s = typeof text === 'string' ? text : String(text);
  return s.length > MAX_RESPONSE_BODY ? `${s.slice(0, MAX_RESPONSE_BODY)}…` : s;
};

/**
 * Perform one POST attempt for a delivery and update it in place. Records the
 * outcome (delivered / pending+nextRetryAt / failed) and persists the row.
 *
 * @param {Object} delivery - a WebhookDelivery doc (status 'pending')
 * @param {Object} endpoint - the outbound WebhookEndpoint (url + secret)
 * @param {Date}   [now=new Date()]
 */
const attemptDelivery = async (delivery, endpoint, now = new Date()) => {
  const body = JSON.stringify(delivery.payload == null ? {} : delivery.payload);
  const signature = sign(body, endpoint.secret);

  let ok = false;
  let responseStatus = null;
  let responseBody = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CRM-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    responseStatus = res.status;
    try {
      responseBody = boundedBody(await res.text());
    } catch {
      responseBody = null;
    }
    ok = res.status >= 200 && res.status < 300;
  } catch (err) {
    responseStatus = 0;
    responseBody = boundedBody(err?.message || 'request failed');
    ok = false;
  }

  delivery.response = { status: responseStatus, body: responseBody };

  if (ok) {
    delivery.status = 'delivered';
    delivery.nextRetryAt = null;
  } else {
    const wait = nextBackoffMs(delivery.attempt);
    if (wait == null) {
      delivery.status = 'failed';
      delivery.nextRetryAt = null;
    } else {
      delivery.status = 'pending';
      delivery.nextRetryAt = new Date(now.getTime() + wait);
      delivery.attempt += 1;
    }
  }

  await delivery.save();
  return delivery;
};

/**
 * Dispatch an envelope to an outbound endpoint. Creates the `pending` delivery
 * row, then makes the first attempt immediately. Returns the delivery doc.
 *
 * @param {Object} endpoint - outbound WebhookEndpoint (url + secret)
 * @param {Object} envelope - the JSON envelope to POST (event/taskSnapshot/…)
 */
const dispatch = async (endpoint, envelope) => {
  if (!endpoint || endpoint.direction !== 'out' || !endpoint.url) {
    throw new Error('dispatch requires an outbound endpoint with a url');
  }
  const delivery = await WebhookDelivery.create({
    endpointId: endpoint._id,
    direction: 'out',
    payload: envelope,
    status: 'pending',
    attempt: 0,
  });
  await attemptDelivery(delivery, endpoint);
  return delivery;
};

/**
 * One retry sweep: re-attempt every `pending` outbound delivery whose
 * `nextRetryAt` is due. Loads each delivery's endpoint to re-sign with the
 * current secret. Best-effort per row — one failure never aborts the sweep.
 */
const retryDueDeliveries = async (now = new Date()) => {
  let due;
  try {
    due = await WebhookDelivery.find({
      direction: 'out',
      status: 'pending',
      nextRetryAt: { $ne: null, $lte: now },
    }).limit(200);
  } catch (err) {
    console.error('[webhookDispatcher] failed to query due deliveries:', err);
    return;
  }

  for (const delivery of due) {
    try {
      const endpoint = await WebhookEndpoint.findById(delivery.endpointId);
      if (!endpoint || !endpoint.enabled || endpoint.direction !== 'out') {
        // Endpoint vanished / disabled — stop retrying.
        delivery.status = 'failed';
        delivery.nextRetryAt = null;
        await delivery.save();
        continue;
      }
      await attemptDelivery(delivery, endpoint, now);
    } catch (err) {
      console.error(
        '[webhookDispatcher] retry failed for delivery',
        delivery?._id?.toString(),
        err?.message || err
      );
    }
  }
};

/**
 * Start the every-minute retry cron. Idempotent — safe to call once on boot
 * (mirrors startDateAutomationRunner).
 */
const startWebhookRetryRunner = () => {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => {
    retryDueDeliveries().catch((err) =>
      console.error('[webhookDispatcher] retry tick error:', err)
    );
  });
  console.log('webhook retry runner started');
};

module.exports = {
  dispatch,
  attemptDelivery,
  retryDueDeliveries,
  startWebhookRetryRunner,
  // Exported for unit tests.
  nextBackoffMs,
  BACKOFF_MS,
};
