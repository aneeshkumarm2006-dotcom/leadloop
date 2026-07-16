require('dotenv').config();
require('./src/models'); // register all Mongoose models
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { startAutomationRunner } = require('./src/services/automationRunner');
const {
  startDateAutomationRunner,
} = require('./src/services/dateAutomationRunner');
const {
  startWebhookRetryRunner,
} = require('./src/services/webhookDispatcher');
const { startEmailSyncRunner } = require('./src/services/emailSyncRunner');
const { startSequenceRunner } = require('./src/services/sequenceRunner');
const { startBookingWorkflowRunner } = require('./src/services/bookingWorkflowRunner');
const {
  mountLeadIntakeRunner,
} = require('./src/services/leadIntakeRunner');
const { warnIfMultiReplica } = require('./src/middleware/rateLimit');
const eventBus = require('./src/services/eventBus');
const {
  mountAutomationEventDispatcher,
} = require('./src/services/automationEventDispatcher');
const { mountMirrorRefresh } = require('./src/services/mirrorRefresh');
const { seedAutomationRecipes } = require('./src/seeds/automationRecipes');
const { seedEmailTemplates } = require('./src/seeds/emailTemplates');

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  // Idempotent — keeps the F6 recipe catalogue in sync on every boot.
  await seedAutomationRecipes().catch((err) =>
    console.error('[seed] automation recipes failed:', err)
  );
  // F9 — seed the welcome-touch email templates (idempotent).
  await seedEmailTemplates().catch((err) =>
    console.error('[seed] email templates failed:', err)
  );
  eventBus.mount();
  mountAutomationEventDispatcher();
  mountMirrorRefresh();
  startAutomationRunner();
  startDateAutomationRunner();
  // F7 — outbound webhook retry sweep (every minute).
  startWebhookRetryRunner();
  // F8 — inbound email sync: 2-min IMAP poll + 30-min push heartbeat.
  startEmailSyncRunner();
  // Phase 4 — email sequence drip runner (per-minute) + reply auto-stop.
  startSequenceRunner();
  // Booking workflows — on-booking alerts + before-event reminder emails.
  startBookingWorkflowRunner();
  // F9 — Automated Lead Agent: runs the board intake policy on `lead.intake`.
  mountLeadIntakeRunner();
  // F7 — warn if the in-memory rate-limit bucket won't meter across replicas.
  warnIfMultiReplica();
  app.listen(PORT, () => {
    console.log(`Macan API listening on port ${PORT}`);
  });
};

start();
