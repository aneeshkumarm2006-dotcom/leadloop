const express = require('express');
const cors = require('cors');
const passport = require('./config/passport');

const app = express();

// F14 — public API lead ingest, mounted BEFORE the global CORS layer below:
// external customer websites POST leads here from the BROWSER, so the route
// carries its own permissive CORS (credentials:false — auth is the API key).
// The global origin-restricted cors() ends OPTIONS preflights itself, so it
// must never see this route's. Everything else about the route (rate limiter,
// 256KB body caps, key auth) lives in routes/leadConnections.js.
const { publicLeadRouter, boardLeadRouter } = require('./routes/leadConnections');
app.use(publicLeadRouter);

// CORS — allow the frontend client (every route mounted after this point)
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// ===========================================================================
// PUBLIC ROUTE ALLOWLIST (no authMiddleware) — Phase 3, F7.6.
// Auth is applied per-route-file (there is no global auth middleware), so the
// only unauthenticated surfaces are the ones mounted here, ahead of every
// auth-gated router, plus `/` (health) and `/auth/*` (login/OAuth) below.
// Each public path must validate its caller by other means (signed token,
// provider signature, rate limit). Keep this list in sync as F10/F11 land:
//
//   • POST /api/webhooks/in/:token            (F7 inbound — token + rate limit)
//   • GET  /api/email/track/:messageId/...    (F8 open/click pixels — by design)
//   • POST /api/email/inbound/gmail|microsoft (F8 inbound — Pub/Sub + Graph)
//   • GET  /api/email-accounts/oauth/callback/:provider (F8 OAuth — state JWT)
//   • POST /api/sms/inbound | /api/sms/status (F10 — Twilio signature)
//   • POST /api/whatsapp/inbound | /status    (F11 — Twilio signature)
//   • GET  /f/:slug                           (F13 public form render)
//   • POST /f/:slug/submit                    (F13 form submit — rate-limited)
//   • POST /api/leads/ingest                  (F14 API lead ingest — key + rate
//     limit; mounted ABOVE the global cors() with its own permissive CORS so
//     customers' websites can call it from the browser)
//
// Mounted BEFORE the global `express.json()` below: routes that need a body
// carry their OWN parser (the F7 inbound route caps at 256KB; the F8 inbound
// push routes cap at 1MB) so the global parser can't shadow them and no
// auth-gated catch-all sits ahead of them. The webhook rate limiter / signed
// OAuth state / open-pixel-by-id each gate their own surface.
// ===========================================================================
const { publicWebhookRouter, boardWebhookRouter } = require('./routes/webhooks');
const { publicEmailRouter, emailRouter } = require('./routes/emails');
const {
  publicEmailAccountRouter,
  emailAccountRouter,
} = require('./routes/emailAccounts');
const { publicSmsRouter, smsRouter } = require('./routes/sms');
const { publicWhatsAppRouter, whatsappRouter } = require('./routes/whatsapp');
const { publicFormRouter, boardFormRouter } = require('./routes/forms');
const { publicBookingRouter, boardBookingRouter } = require('./routes/bookings');
app.use(publicWebhookRouter);
// F8 — public email tracking pixels, inbound provider push, and the OAuth
// callback. No auth (see allowlist above); each carries its own parser/guard.
app.use(publicEmailRouter);
app.use(publicEmailAccountRouter);
// F10 — public Twilio SMS inbound + status callbacks. No auth (Twilio signature
// validated in the controller); each route carries its own urlencoded parser.
app.use(publicSmsRouter);
// F11 — public Twilio WhatsApp inbound + status callbacks. No auth (Twilio
// signature validated in the controller); each route carries its own parser.
app.use(publicWhatsAppRouter);
// F13 — public form render + submit. No auth (the submit route carries its own
// rate limiter + 256KB body parser); render is read-only config JSON.
app.use(publicFormRouter);
// (F14's publicLeadRouter is mounted at the very top, ABOVE the global cors().)
// Phase 4b — public visit booking render/slots/submit/cancel + .ics. No auth;
// submit/cancel carry their own rate limiter + body parser.
app.use(publicBookingRouter);

// Body parsing (global — applies to every route mounted AFTER this point)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passport (stateless — no session middleware)
app.use(passport.initialize());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'macan-api' });
});

// Routes
app.use('/auth', require('./routes/auth'));
// Org/workspace router mounted under both prefixes (F3 surface rename). The
// MongoDB collection stays `organisations`; the API exposes "Workspace".
const orgsRouter = require('./routes/orgs');
app.use('/api/orgs', orgsRouter);
app.use('/api/workspaces', orgsRouter);
// Phase 3.0 — real Workspace layer, nested under /api/orgs/:orgId/workspaces.
// Mounted AFTER orgsRouter so its nested paths fall through to here.
app.use('/api/orgs', require('./routes/workspaces'));
app.use('/api/boards', require('./routes/boards'));
// F12 — authed, per-user saved calendar views + their normalized events.
app.use('/api', require('./routes/calendarViews'));
// F13 — authed board form management + per-user saved table views + chart widgets.
app.use('/api', boardFormRouter);
// F14 — authed board-scoped lead-connection (API key) management.
app.use('/api', boardLeadRouter);
app.use('/api', boardBookingRouter);
app.use('/api', require('./routes/bookingWorkflows'));
app.use('/api', require('./routes/savedViews'));
app.use('/api', require('./routes/charts'));
app.use('/api', require('./routes/marketing'));
// F7 — admin, board-scoped webhook management (authed). Mounted at /api so its
// routes resolve as /api/boards/:id/webhooks… alongside the boards router.
app.use('/api', boardWebhookRouter);
// F8 — authed email-account management + task-scoped Emails tab.
app.use('/api', emailAccountRouter);
app.use('/api', emailRouter);
// F10 — authed workspace SMS config (admin) + task-scoped SMS tab.
app.use('/api', smsRouter);
// F11 — authed workspace WhatsApp config + templates (admin) + task WhatsApp tab.
app.use('/api', whatsappRouter);
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api', require('./routes/groups'));
app.use('/api', require('./routes/automations'));
// Phase 4 — email sequences (drip cadences) + bulk "mass email" enrollment.
app.use('/api', require('./routes/sequences'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api', require('./routes/comments'));
app.use('/api', require('./routes/updates'));
app.use('/api', require('./routes/activity'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/productivity', require('./routes/productivity'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/search', require('./routes/search'));
app.use('/api/proxy', require('./routes/proxy'));

module.exports = app;
