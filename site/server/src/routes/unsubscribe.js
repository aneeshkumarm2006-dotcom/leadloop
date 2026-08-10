/**
 * unsubscribe.js — the public unsubscribe page (no auth).
 *
 *   GET  /u/:token   confirmation page
 *   POST /u/:token   perform the unsubscribe (also RFC 8058 one-click)
 *
 * PUBLIC BY NECESSITY: the recipient is not a LeadLoop user, so there is
 * nothing to authenticate. The signed token is the authorisation, and it grants
 * exactly one thing — stopping mail to the address inside it.
 *
 * GET only renders; the change happens on POST. That protects against mail
 * scanners and link prefetchers silently unsubscribing people by fetching the
 * URL. Mail clients that support RFC 8058 one-click POST directly, which is
 * both compliant and the least friction.
 */

const express = require('express');
const rateLimit = require('../middleware/rateLimit');
const { verifyToken } = require('../services/unsubscribeService');
const { suppress } = require('../services/consentGate');

const router = express.Router();

const page = (title, message, formToken) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
 body{margin:0;background:#F6F1E7;color:#211E18;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;
      display:grid;place-items:center;min-height:100vh;padding:24px}
 .card{background:#fff;border:1px solid #E4DCCB;border-radius:14px;padding:32px;max-width:440px;
       box-shadow:0 8px 24px rgba(33,30,24,.06);text-align:center}
 h1{font-size:20px;margin:0 0 8px}
 p{color:#5C554A;font-size:14px;margin:0}
 button{margin-top:20px;background:#3E6B4E;color:#fff;border:0;border-radius:8px;
        padding:11px 20px;font-size:14px;font-weight:600;cursor:pointer}
 .ok{color:#2F6B47;font-weight:600}
</style></head><body><div class="card">
<h1>${title}</h1><p>${message}</p>
${formToken ? `<form method="POST" action="/u/${formToken}"><button type="submit">Unsubscribe me</button></form>` : ''}
</div></body></html>`;

/** GET — show a confirmation, never act. */
router.get('/u/:token', (req, res) => {
  const claim = verifyToken(req.params.token);
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!claim) {
    return res.status(400).send(page('Link not valid', 'This unsubscribe link is not valid. Reply to any of our emails and we will remove you.', null));
  }
  return res.send(
    page('Unsubscribe', `Stop sending marketing email to <strong>${claim.email}</strong>?`, req.params.token)
  );
});

/** POST — perform it. Idempotent, so a repeat click is harmless. */
router.post(
  '/u/:token',
  rateLimit({ capacity: 30, windowMs: 60_000 }),
  express.urlencoded({ extended: false, limit: '16kb' }),
  async (req, res) => {
    const claim = verifyToken(req.params.token);
    res.set('Content-Type', 'text/html; charset=utf-8');
    if (!claim) {
      return res.status(400).send(page('Link not valid', 'This unsubscribe link is not valid.', null));
    }
    try {
      await suppress(claim.organisation, 'email', claim.email, {
        reason: 'unsubscribe',
        note: 'Unsubscribed from an email link',
      });
      return res.send(
        page('You are unsubscribed', `<span class="ok">${claim.email}</span> will no longer receive marketing email from us.`, null)
      );
    } catch (err) {
      console.error('unsubscribe error:', err);
      // Never tell a recipient "try again later" for a legal obligation.
      return res.status(500).send(page('Something went wrong', 'Please reply to any of our emails and we will remove you right away.', null));
    }
  }
);

module.exports = router;
