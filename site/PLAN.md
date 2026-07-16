# PLAN.md — Real-Estate CRM (Monday-style) SaaS

> Single source of truth for turning this Monday.com-clone task tracker into a
> **generic real-estate CRM SaaS** usable by any real-estate / leasing company.
> Modeled on how a real leasing company (Rakotta, Montréal) configures Monday.com.
>
> Status: **planning** — no build started. Last updated: 2026-06-07.
>
> **Companion:** [FEATURES.md](FEATURES.md) — the detailed per-phase feature list
> (what we build · what it does · how to use it) for every item in §5.

---

## 1. Vision

A **"Monday.com for real estate"** — a flexible, board-based CRM that real-estate
and leasing companies use to manage leads, visits, pipelines, listings,
marketing performance, and agent commissions. We keep the power of the generic
board engine and ship an opinionated real-estate experience on top of it.

## 2. Locked strategic decisions

1. **Vertical UX on the generic engine** — model Contacts/Leads/Listings/Deals
   *as boards* under the hood (they inherit columns, automations, forms, views,
   permissions, comms for free) and present them through purpose-built CRM
   screens. Do **not** rebuild the engine per entity.
2. **CRM only — Property Management is OUT of scope.** Rent collection, lease
   compliance, tenant portals, maintenance, payments → leave to Building Stack /
   Yardi / Buildium. We offer **optional integration later** (CSV import +
   generic connector framework), never a PM platform. (See §7.)
3. **Customer = organizations with internal teams of agents** — team logins,
   team dashboards, role permissions, and agent salary/commission tracking.
4. **MLS/IDX = later.** Manual/CSV listing entry for the MVP.
5. **Single-tenant — deploy direct to the company, NOT self-serve SaaS billing.**
   We ship a dedicated instance per company (starting with our own in-house
   company). **No Stripe, no plans/tiers/trials, no per-org metering, and no
   "Upgrade" buttons anywhere in the UI.** Automation/action usage is surfaced for
   **observability only** — never as a paywall or cap. (Revisit only if we ever
   pivot to multi-tenant self-serve; the old Stripe-billing phase is now dropped —
   see §5 Phase 6.)

## 3. Reference: how Rakotta built a RE CRM out of generic Monday primitives

Everything Rakotta uses is **generic Monday primitives + configuration** — there
is no real-estate-specific object anywhere. The "CRM" is:

- **1 board** = the CRM (1,944 leads).
- **Groups** = pipeline stages (New Lead → Contacted → Follow-up → Visit booked →
  Application → Lease to sign → Lease signed → Blacklisted → Archived).
- **Items** = leads. **Columns** = lead fields (Status: building/lead-status/
  visit-type/language; People: agent; Date/Timeline: inscription/move-in/visit;
  Email; Phone; Text: notes/comments; Number).
- **Multiple saved views** of the same board (table grouped/filtered per building,
  Calendar of visits, public Forms).
- **Automations** (32 on the CRM board), **subitems**, **column summaries**
  (status battery + numeric sum), **filters** (person, advanced AND/OR, AI).
- **Second board** "BD-Logements" = unit/property inventory (buildings = groups,
  units = items, Sqft/Price summed).
- **Dashboards/Overviews** with chart widgets + marketing ROI + **per-widget
  permissions**. **Docs/Workdocs** workspace for SOPs/tenant letters.
- Multi-**workspace** org with **folders**.

> Two structural wins for us: (a) **no item limits** — Rakotta is at 99% of
> Monday's board cap and shards leads across 3 archive boards; MongoDB has no such
> ceiling. (b) **native email/SMS/WhatsApp** — Rakotta hacks around Monday's weak
> WhatsApp with `WHTSAPP` name prefixes; we have it built in.

## 4. Current state of THIS codebase

Stack: React 19 + Vite (client) · Express 5 + Mongoose/MongoDB (server) ·
Cloudinary · Google OAuth · Twilio (SMS/WhatsApp) · Gmail/MS email.

Legend: ✅ have · 🟡 partial (finish) · 🔴 build new · ♻️ repurpose/remove

| Area | Capability | Status | Key files |
|---|---|---|---|
| Board engine | Board / Group / Item | ✅ | `server/src/models/{Board,TaskGroup,Task}.js`, `client/src/pages/BoardDetailPage.jsx` |
| Columns | Status, People, Date, Timeline, Email, Phone, Text, LongText, Number, Dropdown, Tags, Rating, Location, File, Formula, Mirror, ConnectBoards, Checkbox, Link | ✅ | `client/src/components/board/columns/*` |
| Item detail | profile w/ Updates/Files/Emails/SMS/WhatsApp/Activity tabs | ✅ | `client/src/components/board/*Tab.jsx` |
| Calendar view | map date col → calendar | ✅ | `server/src/models/CalendarView.js`, `client/src/pages/CalendarPage.jsx` |
| Forms | public, slug, required, captcha | 🟡 branding/logo | `server/src/models/Form.js`, `client/src/pages/{FormBuilderPage,PublicFormPage}.jsx` |
| Automations | rules engine + recipes | ✅ engine / 🟡 general-purpose library | `server/src/services/automationRunner.js`, `client/src/components/board/AutomationBuilder.jsx` |
| Automations Hub | central Autopilot-style manage + monitor for all automations & integrations (no billing) | 🔴 | (new) `client/src/pages/AutomationsHubPage.jsx` — see §9 |
| Subitems | nested items | ✅ | `client/src/components/board/SubitemsList.jsx` |
| Saved views | per-board saved configs + view-tab switcher | ✅ | `server/src/models/SavedTableView.js`, `client/src/services/savedViewService.js`, `client/src/components/board/TableView.jsx` |
| Filters | board filter bar — **simple multi-select pills only** (no AND/OR) | 🔴 advanced builder | `client/src/components/board/BoardFilterBar.jsx` |
| Group summaries | sum/avg/distribution logic | 🟡 group-footer UI | aggregation utils + `InsightsTab.jsx` |
| Connected/mirror boards | board-to-board refs | ✅ | `server/src/models/BoardConnection.js`, `client/src/components/board/columns/MirrorCell.jsx` |
| Dashboards/charts | chart widgets | 🟡 builder | `server/src/models/ChartWidget.js`, `client/src/components/analytics/*` |
| Workspaces / permissions | grants + roleCheck — **but "Workspace" is currently just an alias for Organisation** (`Workspace.js` re-exports `Organisation`); they are the SAME entity, so there is no real workspace layer *inside* an org | 🟡 | `server/src/models/{Workspace,WorkspaceGrant}.js`, `server/src/middleware/roleCheck.js` |
| **Workspaces under an Organisation** (true hierarchy: Org → Workspace → Folder → Board) | — single org contains many workspaces; boards live in a workspace, not directly on the org. **Not built** (org == workspace today). See §3.3 | 🔴 | (none) |
| Comms | Email (Gmail/MS/IMAP), SMS, WhatsApp, Webhooks | ✅ | `server/src/services/{emailService,smsService,whatsappService}.js` |
| AI lead scoring / auto-response | **dropped** — not needed for now; deterministic lead intake (round-robin / geo / fixed) covers assignment. No Anthropic dependency or AI code exists (see Lead intake row) | ⛔ | — |
| Lead intake | policy-driven intake (deterministic: round-robin / geo / fixed) | ✅ | `server/src/models/LeadIntakePolicy.js`, `server/src/services/leadIntakeRunner.js` |
| Folders in workspace | — | 🔴 | (none) |
| Email sequences / cadences | — | 🔴 | (none) |
| Quotes & Invoices | — | 🔴 | (none) |
| Mass email tracking | — | 🔴 | (none) |
| Docs / Workdocs | — | 🔴 | (none) |
| Commission / agent salary | **dropped** — out of scope per stakeholder (2026-06-08); no salary/commission tracking | ⛔ | — |
| Marketing ROI analytics | — | 🔴 | (none) |
| Per-widget permissions | — | 🔴 | (none) |
| Self-serve signup / billing | **dropped** — single-tenant direct deploy, no Stripe (see §2.5) | ⛔ | — |

Estimated coverage: **~65% of the CRM primitives already exist.**

---

## 5. Phased plan

Effort sizing: **S** ≈ ≤1 day · **M** ≈ 2–4 days · **L** ≈ 1–2 weeks (1 dev, rough).

### Phase 0 — De-task-tracker (reframe the skin)
*Goal: the app reads as a CRM, not a task tracker. Mostly rename/reframe — almost
nothing is deleted.*

**Remove / Repurpose**
- ♻️ **S** — `Task.isPersonal` + **My Tasks** page + `PersonalTaskModal` + `GET /tasks/my` → repurpose to "My Leads / My Deals" (assigned-to-me), or remove. Files: `client/src/pages/MyTasksPage.jsx`, `client/src/components/board/PersonalTaskModal.jsx`, `server/src/routes/tasks.js`, `server/src/models/Task.js`.
- ♻️ **S** — **Productivity** page → shelve (replaced by agent-performance in Phase 3). Files: `client/src/pages/ProductivityPage.jsx`, `server/src/controllers/productivityController.js`.
- ♻️ **S** — Nav relabel: *My Boards · My Tasks · Productivity* → **Contacts · Listings · Deals · Calendar · Reports · Docs**. File: `client/src/components/layout/Navbar.jsx`.
- ♻️ **S** — Display terminology *Task/item* → **Lead/Contact/Deal** (keep model names internally; change labels/i18n only).
- ♻️ **S** — Reframe Dashboard greeting/QuickActions + Onboarding for RE. Files: `client/src/components/dashboard/*`, `client/src/pages/OnboardingPage.jsx`.

### Phase 1 — Core CRM parity (match Rakotta's CRM board)
*Goal: open the app and see Rakotta's setup running.*

**Build**
- 🔴 **M** — **RE pipeline template** seed: pipeline stages (groups), lead column
  set (building/agent/status/visit-type/dates/email/phone/notes), bilingual public
  intake form, starter automations. New: `server/src/seeds/realEstateTemplates.js`,
  extend `server/src/utils/boardTemplates.js`.
- 🔴 **M** — **Listings/Inventory template** seed: buildings = groups, units =
  items, Sqft/Price number columns, availability status.
- 🔴 **S** — Starter **RE automation recipes** (form→lead+assign, status→notify,
  visit-date→reminder). Extend `server/src/seeds/automationRecipes.js`.
- ✅ **DONE** — **View-tab switcher** UX (multiple saved views per board as tabs)
  is already shipped in `TableView.jsx`. Files: `SavedTableView` model,
  `savedViewService`, `TableView.jsx`. *(No work needed — verified 2026-06-07.)*
- 🔴 **L** — **Advanced filter builder** — Monday's two-mode filter. **Quick
  filters** (chip-per-column popovers) are **done (2026-06-07)**: `BoardFilterBar`
  now reads the board's real columns via `utils/columnFilter.js`. **Still to
  build = the *Advanced* builder:** `Where [Column] [Condition] [Value]` rows
  combined with **AND/OR**, **nested groups** (`+ New group`), a live
  **"Showing X of Y"** count, **Clear all**, **Save to this view**, and a
  **"Switch to quick filters"** toggle ↔ the chip bar. Per-column-type condition
  sets (see FEATURES.md §1.5 table). Upgrade the flat `[{columnId,op,value}]`
  shape to a **group tree** `{ conjunction, rules:[condition|group] }` with a
  matching evaluator client-side + mirrored in `server/src/utils/columnFilter.js`.
  ⛔ Skip **"Filter with AI"** (no AI — §2.5). File: `BoardFilterBar.jsx` +
  new advanced-builder panel + `columnFilter.js` (client/server). (Shares work
  with the §9.3 automation conditions.)
  **Open design choice:** extend the canonical filter shape *everywhere* (boards,
  saved views, calendar, charts all gain groups/operators) vs. add the tree for
  the board advanced filter *only* — decide at build time.
- 🟡 **M** — **Group summaries**: numeric SUM/AVG footer + status battery bar per
  group. Wire existing aggregation logic into group headers/footers.
- 🟡 **S** — Form **branding** (logo, cover, colors). File: `Form.js`, `PublicFormPage.jsx`.

### Phase 1b — Automations Hub & Monday general-purpose automation library
*Goal: a central, Autopilot-style hub to build, manage and monitor every
automation + integration across the whole account — and broaden our recipe /
trigger / action set to match Monday's **general-purpose** automation library
(not just RE recipes). Full spec in §9.*

**Build**
- 🔴 **L** — **Automations Hub page** — left nav *Health · Usage · Workflows ·
  Connections*; top tabs *Automations / Integrations*. Account-wide list of all
  automations & integrations grouped by board, with owner, last run, run status,
  and enable/disable. **No billing, no "Upgrade plan" button, no action cap.**
  New: `client/src/pages/AutomationsHubPage.jsx`,
  `server/src/controllers/automationHubController.js`. See §9.1.
- 🔴 **M** — **Usage / observability dashboard** (action-usage counter, daily-action
  bar chart, top boards/workflows, top creators, top integrations table). Counter is
  **informational only** — no monthly cap, no "projected actions" paywall, no
  "pro plan" copy. Reuses `AutomationRunLog`. See §9.7 for what we deliberately
  drop from Monday's screen.
- 🔴 **L** — **General-purpose automation library** — expand triggers/actions/recipes
  to Monday's general catalogue (status, recurring, notifications, item-creation,
  dependencies, due-dates, move/duplicate/archive, subitems, number, updates).
  Extend `server/src/utils/actionTypes.js`, the `triggerType` enum on
  `Automation.js`, and `server/src/seeds/automationRecipes.js`. See §9.2–§9.5.
- 🟡 **M** — **Custom automation composer** generalised — the "When → If → Then"
  builder usable for any board, not just the RE recipes. File:
  `client/src/components/board/AutomationBuilder.jsx`.

### Phase 2 — Reporting & dashboards
**Build**
- 🔴 **L** — **Multi-section dashboard builder** (add/drag widgets, section
  headers, connect to board). Files: `ChartWidget` model, new dashboard builder UI.
- 🟡 **M** — More **chart widget types** (stacked-bar-over-time, counts by source).
  Files: `client/src/components/analytics/*` (recharts already available).
- 🔴 **M** — **Marketing / ROI analytics**: leads/visits/leases by source, ad
  budget per source, cost-per-lead. Needs a lead-source + campaign-budget data model.
- 🔴 **M** — **Per-widget / per-board permissions** (the "locked" widgets).
  Extend `WorkspaceGrant` / `roleCheck` to widget scope.

### Phase 3 — Org structure & differentiator
**Build**
- 🔴 **L** — **§3.3 Real Workspace layer under the Organisation.** Today
  `Workspace` is a *readability alias* for `Organisation` (same entity), so the
  Monday hierarchy **Organisation → Workspace → Folder → Board** isn't modeled —
  the sidebar's "Organisations" are really separate orgs. Build a true
  `Workspace` model owned by an org, add `board.workspace`, and turn the sidebar
  into a **workspace switcher within the single org** (per single-tenant §2.5).
  New: `server/src/models/Workspace.js` (real model), `board.workspace` ref,
  migration that nests each existing org's boards under a default workspace.
  **Decision (2026-06-07):** confirmed direction = workspaces under the org;
  existing data left **as-is for now** (no migration yet) — keep current
  multi-org plumbing until this phase runs. Folders (below) sit inside workspaces.
- 🔴 **M** — **Teams** under Organisation + **team dashboards** + membership.
  New: `server/src/models/Team.js`.
- 🟡 **M** — Roles/permissions polish (Org admin / Team lead / Agent);
  workspace **home UI** (banner, Content/Collaborators tabs); 🔴 workspace
  **folders** (live *inside* a workspace, per §3.3).
- ⛔ **Agent performance + commission / salary module — DROPPED** (stakeholder
  decision 2026-06-08). No salary/commission tracking. Team/agent *activity*
  reporting still comes via Phase 2 dashboards, but no compensation math.

### Phase 4 — Comms & sales tooling
**Build**
- 🔴 **L** — **Email Sequences** (multi-step drip cadences) on the automations
  engine. New: `server/src/models/EmailSequence.js` + runner.
- 🔴 **M** — **Mass email tracking** (campaign send + open/click stats).
- 🔴 **L** — **Quotes & Invoices** (lease offers / deposits) with PDF + e-sign
  hook; deliver via native email/SMS/WhatsApp.

### Phase 4b — Visit Booking System (Calendly-style)
*Our own booking engine for property visits — one shareable link per building,
wired to a board's calendar. No Calendly dependency.*

**Decisions (locked with stakeholder):**
- **One link = one building.** During creation you pick the **target Board** (its
  calendar) and the **target Group** new bookings land in (e.g. "Visit Booked").
- **Availability is set manually** at link-creation time (Calendly-style weekly
  hours + date overrides). No Google Calendar sync for MVP.
- **On booking:** create a **lead** in the chosen group + a **calendar event** on
  that board's Calendar view + **confirmation email** (visitor & agent) + **auto-
  assign agent** (fixed or round-robin).
- **Entry point:** a new **"Booking Links"** button in the board toolbar (next to
  Automations / Integrations / Lead Intake).
- **Reschedule:** cancel-link + rebook (MVP). True in-place reschedule = later.

**Build**
- 🔴 **L** — `BookingLink` + `Booking` models + slot engine (open slots =
  weeklyHours − dateOverrides − minNotice/dateRange − already-booked slots, in the
  visitor's timezone). New: `server/src/models/BookingLink.js`,
  `server/src/models/Booking.js`, `server/src/services/slotEngine.js`,
  `bookingController.js`, `routes/bookings.js`.
- 🔴 **M** — Public booking page `/book/:slug` (frontend-served like `/f/:slug`
  forms): building/branding header → day picker → free slots → form → confirm.
  Full EN/FR + any-language.
- 🔴 **M** — Creation wizard (board toolbar → Booking Links): pick group, duration,
  location, draw weekly availability + overrides, buffers / daily cap / min-notice,
  booking questions, agent assignment (fixed | round-robin), branding.
- 🔴 **S** — On-booking actions: lead → chosen group (reuse Forms intake path),
  stamp date column (→ board Calendar), auto-assign agent, send `.ics`
  confirmation + cancel/rebook links.
- 🔴 **S** — Manage list (a board's links: copy URL, edit, deactivate) + bookings
  list.

**Reuses:** board Calendar view (Phase 3.0), Person/Assigned-to column, public-form
intake pattern, i18n. **Later (not MVP):** reminder emails (24h/1h), Google busy-
sync, payments, embed widget, no-show tracking, follow-ups, true reschedule.

### Phase 5 — Knowledge base
**Build**
- 🔴 **L** — **Docs / Workdocs** (rich-text docs: SOPs, tenant letters, templates,
  guides). The one fully-missing module. New: `server/src/models/Doc.js` + editor
  (Tiptap already in deps).

### Phase 6 — Internal deployment & onboarding
*(was "SaaS productization" — billing dropped per §2.5)*
**Build**
- 🔴 **M** — **Signup / invites** (email/password alongside Google OAuth), scoped
  to the org and admin-invited — for internal team members, not public self-serve.
- ⛔ **Stripe billing — dropped.** Single-tenant direct deploy (§2.5): no plans,
  tiers, trials, per-org metering, or "Upgrade" UI anywhere.
- 🔴 **M** — Template gallery / guided onboarding for new **boards & teams within
  the org**.
- 🔴 **S** — **Deployment runbook** — env config, seed data, single-instance
  hosting for the company.

### Later / Optional — Property-management integration (NOT a PM build)
- 🔴 **M** — Generic **CSV import** for units/leases/tenants.
- 🔴 **L** — **Connector framework**; add **Building Stack / Yardi / Buildium**
  connectors on paying-customer demand. (Building Stack API is sales-gated — pursue
  a partnership only when a customer requires it.)

---

## 6. Free wins to leverage (no build)
- **No item limits** (MongoDB) — a direct selling point vs Monday's board caps.
- **Native email/SMS/WhatsApp** — Monday charges/hacks for this.
- **Deterministic lead intake & auto-assignment** (round-robin / geo / fixed) — no
  AI needed; assigns + sends the welcome touch automatically on form/webhook intake.

> **Note (2026-06-07):** Anthropic AI lead scoring / auto-response is **dropped**
> for now (not built — no Anthropic dependency in the codebase). Revisit only if a
> customer needs it; the deterministic intake above covers assignment today.

## 7. Out of scope (explicit)
- Property management: rent collection, payments, lease-law compliance, tenant
  portals, maintenance/work orders, accounting. → integrate, don't build.
- Full Monday parity (Gantt, Workload, mobile apps, marketplace) — only build the
  views real-estate companies actually use.

## 8. Open questions
- ~~Pricing model & tiers~~ → **Resolved:** single-tenant direct deploy, no
  billing (§2.5). No Stripe, no plans/tiers, no Upgrade UI.
- i18n: bilingual (FR/EN) required for the Québec market from day one?
- Which PM systems do target customers actually use (drives connector priority)?

---

## 9. Automations Hub & general-purpose automation library

> Our take on Monday's **"Autopilot hub"** (the screens that motivated this).
> A central, account-wide place to **build, manage, and monitor** every automation
> and integration — built on the engine we already have. We port Monday's
> *general-purpose* automation library, **but not its billing/metering** (§2.5).

Legend: ✅ have · 🟡 partial · 🔴 build · ⛔ deliberately excluded

### 9.1 Hub layout (mirrors Monday's Autopilot hub, minus billing)
- **Left nav:** Health · Usage · Workflows · Connections.
  - **Health** — automations currently failing / disabled / needing setup
    (channel not connected, column reference broken → maps to our existing
    `validation: 'incomplete'`).
  - **Usage** — observability dashboard (§9.7).
  - **Workflows** — the full list of automations + integration recipes across all
    boards, grouped by board, with owner, last-run time, run status, on/off toggle.
  - **Connections** — connected accounts/channels (§9.6).
- **Top tabs inside Usage:** *Automations* / *Integrations* (Monday splits in-board
  automations from integration "workflows").
- **Stat cards** (account-wide counts): Integrations · Creators · Boards ·
  Workflows. Pure counts — informational.
- ⛔ **Removed vs Monday:** the "Action usage  103 / 25,000", "Projected actions",
  "25,000 actions per month for **pro plan**", "Learn more about automation
  billing", and **"Upgrade plan"** button. No quota, no paywall, no upgrade CTA.

### 9.2 Triggers (When …)
Have today (enum on `Automation.js`): `SCHEDULE` (recurring), `ITEM_CREATED`,
`GROUP_CREATED`, `COLUMN_VALUE_CHANGED`, `STATUS_BECAME`, `DATE_ARRIVED`,
`PERSON_ASSIGNED`, `FORM_SUBMITTED`, `WEBHOOK_RECEIVED`.

To add for general-purpose parity:
- 🔴 `STATUS_CHANGES_FROM_TO` — status moves *from X to Y* (today only "became Y").
- 🔴 `SUBITEM_CREATED` and 🔴 `SUBITEM_STATUS_CHANGED` (+ roll-up to parent).
- 🔴 `ITEM_MOVED_TO_GROUP`.
- 🔴 `CHECKBOX_CHECKED` / `CHECKBOX_UNCHECKED` (special-case of column changed).
- 🔴 `UPDATE_CREATED` / `UPDATE_POSTED` (when someone posts an update/comment).
- 🔴 `NUMBER_CROSSES_THRESHOLD` (number column reaches / >, < a value).
- 🔴 `DATE_PASSES` (overdue — today's `DATE_ARRIVED` covers "in N days" but not the
  "is now overdue" framing; add the comparison).
- 🔴 `ITEM_NAME_CHANGED`.
- 🔴 `DEPENDENCY_DATE_CHANGED` (a predecessor's date moves → shift dependents).
- 🟡 `EVERY_TIME_PERIOD` — covered by `SCHEDULE`; expose Monday's day/week/month/
  year-at-time UX over it.

### 9.3 Conditions (If …)
Have (`conditionSchema`): `ITEM_IN_GROUP`, `ITEM_IN_STATUS`, `GROUP_NAME_MATCHES`.

To add:
- 🔴 column-value compares: equals / not-equals / contains / is-empty (any column).
- 🔴 number compare (>, <, between); 🔴 date compare (before/after/within N days).
- 🔴 person check (assigned / assigned to specific person / unassigned).
- 🟡 **AND/OR groups** — nest multiple conditions (shares work with the §5 Phase 1
  advanced filter builder).

### 9.4 Actions (Then …)
Have today (`actionTypes.js`): `CREATE_TASK`, `CREATE_SUBITEM`, `SET_COLUMN_VALUE`,
`MOVE_TO_GROUP`, `NOTIFY_PERSON`, `SEND_EMAIL`, `SEND_SMS`, `SEND_WHATSAPP`,
`CREATE_CALENDAR_EVENT`, `POST_WEBHOOK`, `ASSIGN_LEAD_AGENT`.

To add for general-purpose parity:
- 🔴 `DUPLICATE_ITEM`, `ARCHIVE_ITEM`, `DELETE_ITEM`.
- 🔴 `MOVE_ITEM_TO_BOARD` and 🔴 `CREATE_ITEM_IN_BOARD` (cross-board).
- 🔴 `ASSIGN_CREATOR` / generalise `ASSIGN_LEAD_AGENT` → `ASSIGN_PERSON`.
- 🔴 `CLEAR_COLUMN`.
- 🔴 date actions: `SET_DATE`, `PUSH_DATE_BY_N` (today/N days/relative).
- 🔴 number actions: `INCREASE_NUMBER` / `DECREASE_NUMBER` / `SET_NUMBER`.
- 🔴 update actions: `CREATE_UPDATE`, `REPLY_TO_UPDATE`, `MENTION_PERSON`.
- 🔴 `CONNECT_BOARDS` / `CREATE_DEPENDENCY`.
- 🔴 subitem roll-up: `SET_PARENT_STATUS_WHEN_ALL_SUBITEMS_DONE`.
- 🟡 integration actions (notify in Slack/Teams, create calendar event in
  Google/Outlook) — land with §9.6 connectors.

### 9.5 Recipe categories to seed (Monday's general catalogue)
Extend `automationRecipes.js` beyond the 10 RE recipes with general-purpose recipes
grouped the way Monday groups them, so the catalogue reads like Monday's:
1. **Status change** — when status → notify / move group / set date / create item.
2. **Recurring** — every period create an item / post a digest / reset a status.
3. **Notifications** — notify when assigned / when due soon / when status changes.
4. **Item creation** — when created: assign, set dates, spawn subitem checklist.
5. **Due dates** — notify N days before due, flag overdue, push date.
6. **Dependencies** — when a date moves, shift dependent items' dates.
7. **Move / archive** — when done → move to group/board or archive; when lost →
   archive.
8. **Subitems** — when all subitems done → set parent status; mirror subitem status.
9. **People** — when assigned → notify; assign creator on create.
10. **Custom** — open "When → If → Then" composer for anything not pre-baked.

### 9.6 Integrations / Connections
Native today (surface these under the hub's **Connections** tab as first-class
"connections"): ✅ Email (Gmail / Microsoft / IMAP), ✅ SMS (Twilio), ✅ WhatsApp
(Twilio), ✅ Webhooks (in + out), ✅ Calendar.

Monday-style connectors to add (general-purpose, build on demand):
- 🔴 Slack, Microsoft Teams (notify / post).
- 🔴 Google Calendar / Outlook Calendar (two-way event sync).
- 🔴 Dev: Jira, GitHub, GitLab.
- 🔴 CRM/marketing: Salesforce, HubSpot, Mailchimp, Typeform.
- 🔴 Files: Google Drive, Dropbox, OneDrive.
- 🔴 **Generic REST connector framework** (auth + request/response mapping) so new
  connectors are config, not code — pairs with the §7 PM-integration connector idea.
- ⛔ No Stripe/PayPal billing connector (we have no billing).

### 9.7 Usage dashboard — observability only (what we keep vs drop)
Keep (informational, account-wide, date-range filterable — like the screenshots):
- Action-usage **count** (actions run in range) — **no denominator, no cap.**
- Daily-action **bar chart**, **top boards / workflows** and **top creators** pie
  charts, **top integrations / workflows** table (Integration · Board · Owner ·
  Actions). All sourced from `AutomationRunLog`.

⛔ Drop entirely: the `X / 25,000` quota, "Projected actions", "pro plan" copy,
"Learn more about automation billing" link, and the **"Upgrade plan"** button.
