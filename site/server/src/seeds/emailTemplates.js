/**
 * emailTemplates.js — seed catalogue for the F9 welcome-touch email templates
 * (F9.1).
 *
 * Idempotent: `seedEmailTemplates()` upserts each template keyed by `key`, so
 * it's safe to run on every boot (mirrors `automationRecipes.js`). The F9 Lead
 * Intake policy form offers these as starter copy; a workspace can override the
 * subject/body inline on the policy.
 *
 * REGION NOTE: ships `region: null` defaults only. The definitive per-region
 * welcome copy (Edmonton / Saskatoon / Regina / Montreal) is the pending Thoma
 * stakeholder check (phase-3 pre-flight) — re-running the seed after that
 * confirms simply adds the region-tagged entries.
 *
 * Bodies use `templateInterpolate.js` tokens: `{{Lead Name}}` resolves against
 * the lead's task column, `{{user.displayName}}` against the assigned agent.
 */

const EmailTemplate = require('../models/EmailTemplate');

const TEMPLATES = [
  {
    key: 'welcome-lead-default',
    name: 'Welcome a new lead (default)',
    subject: 'Welcome, {{Lead Name}}!',
    body:
      'Hi {{Lead Name}},\n\n' +
      'Thanks for reaching out — we received your enquiry and a member of our team will be in touch shortly to help with the next steps.\n\n' +
      'In the meantime, feel free to reply to this email with any questions.\n\n' +
      'Best regards,\n{{user.displayName}}',
    region: null,
    isSeed: true,
  },
  {
    key: 'welcome-lead-viewing',
    name: 'Welcome + offer a viewing',
    subject: 'Thanks for your interest, {{Lead Name}}',
    body:
      'Hi {{Lead Name}},\n\n' +
      "Thank you for your interest. I'd love to set up a viewing at a time that works for you — just let me know your availability and I'll take care of the rest.\n\n" +
      'Talk soon,\n{{user.displayName}}',
    region: null,
    isSeed: true,
  },
];

/**
 * Idempotent upsert keyed by `key`. Safe to call on every boot.
 * Returns `{ upserted, modified, total }` for the startup log.
 */
const seedEmailTemplates = async () => {
  let upserted = 0;
  let modified = 0;
  for (const template of TEMPLATES) {
    const { key, ...rest } = template;
    const res = await EmailTemplate.updateOne(
      { key },
      { $set: { key, ...rest } },
      { upsert: true }
    );
    if (res.upsertedCount) upserted += 1;
    else if (res.modifiedCount) modified += 1;
  }
  console.log(
    `[seed] email templates: ${TEMPLATES.length} total (${upserted} new, ${modified} updated)`
  );
  return { upserted, modified, total: TEMPLATES.length };
};

module.exports = { seedEmailTemplates, TEMPLATES };
