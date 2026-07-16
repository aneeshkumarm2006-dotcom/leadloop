/**
 * automationRecipes.js — seed catalogue for the F6 Recipe Library (F6.2).
 *
 * Idempotent: `seedAutomationRecipes()` upserts each recipe keyed by `slug`, so
 * it's safe to run on every boot. Editing a recipe here and re-deploying updates
 * the catalogue entry; per the pre-flight versioning decision (snapshot-at-clone,
 * no auto-migration) it does NOT touch automations already cloned from it.
 *
 * Recipe column references are board column **keys** (slugs), not ObjectIds —
 * the clone resolver (`automationRecipeController.buildAutomationFromRecipe`)
 * maps each key to the target board's column id, and STATUS_BECAME option values
 * are resolved against that column's options by id/label. A reference the board
 * can't satisfy, or a channel action whose phase hasn't shipped, makes the clone
 * `validation: 'incomplete'` (F6.3 / AC4).
 *
 * REGION NOTE: most recipes are region-agnostic (`region: null`). The two
 * Edmonton-tagged entries are provisional examples — the definitive
 * region-specific list is the pending Thoma stakeholder check (phase-2 pre-flight).
 * Re-running the seed after that confirms simply updates the `region` arrays.
 */

const AutomationRecipe = require('../models/AutomationRecipe');

/**
 * Friendly label for each cross-phase channel/marker an action can require.
 * Mirrors the `requires` markers on the F5 `actionTypes` registry. Surfaced on
 * the recipe card as the "Requires … setup" chip.
 */
const CHANNEL_LABELS = {
  F7: 'Webhooks',
  F8: 'Email',
  F9: 'Lead routing',
  F10: 'SMS',
  F11: 'WhatsApp',
  CALENDAR: 'Calendar',
};

/**
 * The seed catalogue. ≥8 real-estate recipes including the four named in the
 * phase doc (slugs marked ★ below). Column keys assume a real-estate leads board
 * with `stage` (status), `move_in_date` / `viewing_date` (date), and
 * `owner` / `agent` (person) columns — common on boards created from the
 * real-estate template; any the board lacks resolve to an empty binding and flag
 * the clone incomplete for the user to finish.
 */
const RECIPES = [
  // ★ 1 — "When new Lead arrives, assign agent by city and send welcome email."
  {
    slug: 'new-lead-assign-agent-welcome',
    name: 'Welcome a new lead',
    description:
      'When a new lead is created, assign the right city agent and send a welcome email.',
    triggerType: 'ITEM_CREATED',
    triggerConfig: {},
    conditions: [],
    actions: [
      { type: 'ASSIGN_LEAD_AGENT', config: {} },
      {
        type: 'SEND_EMAIL',
        config: {
          to: 'owner',
          subject: 'Welcome, {{Lead Name}}!',
          body:
            'Hi {{Lead Name}}, thanks for your interest. Your agent will be in touch shortly.',
          template: '',
        },
      },
    ],
    region: null,
    iconName: 'UserPlus',
  },

  // ★ 2 — "When Stage becomes 'Viewing Scheduled', create calendar event and
  //        send SMS reminder 1 day before."
  {
    slug: 'viewing-scheduled-calendar-sms',
    name: 'Viewing scheduled → calendar + SMS reminder',
    description:
      "When Stage becomes 'Viewing Scheduled', create a calendar event and send an SMS reminder a day before.",
    triggerType: 'STATUS_BECAME',
    triggerConfig: { columnId: 'stage', toValue: 'viewing_scheduled' },
    conditions: [],
    actions: [
      {
        type: 'CREATE_CALENDAR_EVENT',
        config: {
          calendarRef: 'internal',
          title: 'Viewing — {{Lead Name}}',
          startsAtColumnRef: 'viewing_date',
          durationMinutes: 30,
        },
      },
      {
        type: 'SEND_SMS',
        config: {
          to: 'owner',
          template:
            'Reminder: your viewing is scheduled for {{Viewing Date}}. Reply to reschedule.',
        },
      },
    ],
    region: null,
    iconName: 'CalendarClock',
  },

  // ★ 3 — "When Move-in Date is 7 days away, notify owner."
  {
    slug: 'move-in-7-days-notify-owner',
    name: 'Move-in in 7 days → notify owner',
    description:
      'Seven days before a move-in date, notify the listing owner so they can prepare.',
    triggerType: 'DATE_ARRIVED',
    triggerConfig: { columnId: 'move_in_date', offsetDays: 7, comparison: 'before' },
    conditions: [],
    actions: [
      {
        type: 'NOTIFY_PERSON',
        config: {
          userIdOrColumnRef: 'owner',
          message: '{{Lead Name}} moves in on {{Move-in Date}} — 7 days to go.',
          sendEmailDigest: true,
        },
      },
    ],
    region: null,
    iconName: 'Bell',
  },

  // ★ 4 — "When Stage becomes 'Closed', post webhook to accounting system."
  {
    slug: 'stage-closed-post-webhook',
    name: 'Deal closed → notify accounting',
    description:
      "When Stage becomes 'Closed', post a webhook to the accounting system.",
    triggerType: 'STATUS_BECAME',
    triggerConfig: { columnId: 'stage', toValue: 'closed' },
    conditions: [],
    actions: [{ type: 'POST_WEBHOOK', config: { endpointId: 'accounting' } }],
    region: null,
    iconName: 'Webhook',
  },

  // 5 — onboarding checklist (fully bindable, no channel / column refs)
  {
    slug: 'new-lead-onboarding-checklist',
    name: 'New lead → onboarding checklist',
    description:
      'When a lead is created, spin up the first-contact checklist as subitems.',
    triggerType: 'ITEM_CREATED',
    triggerConfig: {},
    conditions: [],
    actions: [
      { type: 'CREATE_SUBITEM', config: { name: 'Call {{Lead Name}}', priority: 'high', assignedTo: [], note: '' } },
      { type: 'CREATE_SUBITEM', config: { name: 'Send brochure', priority: 'medium', assignedTo: [], note: '' } },
      { type: 'CREATE_SUBITEM', config: { name: 'Schedule first viewing', priority: 'medium', assignedTo: [], note: '' } },
    ],
    region: null,
    iconName: 'ListChecks',
  },

  // 6 — qualified → notify agent (NOTIFY_PERSON, no channel)
  {
    slug: 'stage-qualified-notify-agent',
    name: 'Lead qualified → ping the agent',
    description:
      "When Stage becomes 'Qualified', notify the assigned agent to follow up.",
    triggerType: 'STATUS_BECAME',
    triggerConfig: { columnId: 'stage', toValue: 'qualified' },
    conditions: [],
    actions: [
      {
        type: 'NOTIFY_PERSON',
        config: {
          userIdOrColumnRef: 'agent',
          message: '{{Lead Name}} is now Qualified — time to reach out.',
          sendEmailDigest: false,
        },
      },
    ],
    region: null,
    iconName: 'BadgeCheck',
  },

  // 7 — lost → move to Archive group (group ref unbindable from a recipe)
  {
    slug: 'stage-lost-archive',
    name: 'Lead lost → archive it',
    description:
      "When Stage becomes 'Lost', move the item into your Archive group.",
    triggerType: 'STATUS_BECAME',
    triggerConfig: { columnId: 'stage', toValue: 'lost' },
    conditions: [],
    actions: [{ type: 'MOVE_TO_GROUP', config: { groupId: '' } }],
    region: null,
    iconName: 'Archive',
  },

  // 8 — viewing date arrives → WhatsApp reminder
  {
    slug: 'viewing-date-whatsapp-reminder',
    name: 'Viewing day → WhatsApp reminder',
    description:
      'On the day of a viewing, send the client a WhatsApp reminder.',
    triggerType: 'DATE_ARRIVED',
    triggerConfig: { columnId: 'viewing_date', offsetDays: 0, comparison: 'on' },
    conditions: [],
    actions: [
      {
        type: 'SEND_WHATSAPP',
        config: { to: 'owner', templateId: 'viewing_reminder', variables: {} },
      },
    ],
    region: null,
    iconName: 'MessageCircle',
  },

  // 9 — offer form submitted → notify owner (dormant trigger F13)
  {
    slug: 'offer-form-submitted-notify',
    name: 'Offer submitted → notify listing owner',
    description:
      'When an offer is submitted through a public form, notify the listing owner.',
    triggerType: 'FORM_SUBMITTED',
    triggerConfig: {},
    conditions: [],
    actions: [
      {
        type: 'NOTIFY_PERSON',
        config: {
          userIdOrColumnRef: 'owner',
          message: 'A new offer was submitted for {{Lead Name}}.',
          sendEmailDigest: true,
        },
      },
    ],
    region: null,
    iconName: 'Inbox',
  },

  // 10 — Edmonton-specific move-in check-in (provisional region example)
  {
    slug: 'edmonton-move-in-3-days-sms',
    name: 'Edmonton: move-in in 3 days → SMS check-in',
    description:
      'Three days before move-in, send Edmonton tenants an SMS check-in.',
    triggerType: 'DATE_ARRIVED',
    triggerConfig: { columnId: 'move_in_date', offsetDays: 3, comparison: 'before' },
    conditions: [],
    actions: [
      {
        type: 'SEND_SMS',
        config: {
          to: 'owner',
          template:
            'Hi {{Lead Name}}, checking in ahead of your move-in on {{Move-in Date}}.',
        },
      },
    ],
    region: ['Edmonton'],
    iconName: 'MapPin',
  },

  // --- Leasing CRM starters (bind cleanly to the "Real Estate CRM" template,
  //     PLAN.md §1.3): form→lead+assign, status→notify, visit-date→reminder ---

  // 11 ★ — public intake form → assign an agent + welcome the lead by email.
  {
    slug: 'leasing-form-assign-and-welcome',
    name: 'Intake form → assign agent + welcome',
    description:
      'When a lead arrives from a public intake form, auto-assign an agent and email the lead a welcome.',
    triggerType: 'FORM_SUBMITTED',
    triggerConfig: {},
    conditions: [],
    actions: [
      { type: 'ASSIGN_LEAD_AGENT', config: {} },
      {
        type: 'SEND_EMAIL',
        config: {
          to: 'email',
          subject: 'Welcome, {{Lead}}!',
          body: 'Hi {{Lead}}, thanks for your interest — your agent will reach out shortly.',
          template: '',
        },
      },
    ],
    region: null,
    iconName: 'UserPlus',
  },

  // 12 ★ — Lead Status → Interested → notify the assigned agent.
  {
    slug: 'leasing-status-interested-notify-agent',
    name: 'Lead Status → Interested → notify agent',
    description:
      "When Lead Status becomes 'Interested', notify the assigned agent to follow up.",
    triggerType: 'STATUS_BECAME',
    triggerConfig: { columnId: 'lead_status', toValue: 'interested' },
    conditions: [],
    actions: [
      {
        type: 'NOTIFY_PERSON',
        config: {
          userIdOrColumnRef: 'agent',
          message: '{{Lead}} is now Interested — time to reach out.',
          sendEmailDigest: false,
        },
      },
    ],
    region: null,
    iconName: 'BadgeCheck',
  },

  // 13 ★ — one day before a visit → SMS the lead a reminder.
  {
    slug: 'leasing-visit-reminder-1-day',
    name: 'Visit tomorrow → SMS reminder',
    description:
      'One day before a scheduled visit, send the lead an SMS reminder.',
    triggerType: 'DATE_ARRIVED',
    triggerConfig: { columnId: 'visit_date', offsetDays: 1, comparison: 'before' },
    conditions: [],
    actions: [
      {
        type: 'SEND_SMS',
        config: {
          to: 'phone',
          template:
            'Reminder: your visit is scheduled for {{Visit Date}}. Reply to reschedule.',
        },
      },
    ],
    region: null,
    iconName: 'CalendarClock',
  },
];

/**
 * Idempotent upsert keyed by `slug`. Safe to call on every boot.
 * Returns `{ upserted, modified }` counts for the startup log.
 */
const seedAutomationRecipes = async () => {
  let upserted = 0;
  let modified = 0;
  for (const recipe of RECIPES) {
    const { slug, ...rest } = recipe;
    const res = await AutomationRecipe.updateOne(
      { slug },
      { $set: { slug, ...rest } },
      { upsert: true }
    );
    if (res.upsertedCount) upserted += 1;
    else if (res.modifiedCount) modified += 1;
  }
  console.log(
    `[seed] automation recipes: ${RECIPES.length} total (${upserted} new, ${modified} updated)`
  );
  return { upserted, modified, total: RECIPES.length };
};

module.exports = { seedAutomationRecipes, RECIPES, CHANNEL_LABELS };
