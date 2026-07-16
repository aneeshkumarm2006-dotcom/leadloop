# FEATURES.md — detailed feature spec (per phase)

> Companion to [PLAN.md](PLAN.md). PLAN.md = strategy, decisions, and the phase
> roadmap. **This file = the detailed feature list** for each phase: for every
> feature — **What we build · What it does · How to use it**.
>
> Status: **planning** — no build started. Last updated: 2026-06-07.
>
> Conventions: effort **S** ≤1 day · **M** 2–4 days · **L** 1–2 weeks.
> Status — ✅ have · 🟡 partial (finish) · 🔴 build new · ♻️ repurpose · ⛔ excluded.
> "How to use" is written as the end-user flow (agent / org admin), not the dev flow.

---

## Table of contents
- [Phase 0 — De-task-tracker (reframe the skin)](#phase-0--de-task-tracker)
- [Phase 1 — Core CRM parity](#phase-1--core-crm-parity)
- [Phase 1b — Automations Hub & general-purpose automations](#phase-1b--automations-hub--general-purpose-automations)
- [Phase 2 — Reporting & dashboards](#phase-2--reporting--dashboards)
- [Phase 3 — Org structure & differentiator](#phase-3--org-structure--differentiator)
- [Phase 4 — Comms & sales tooling](#phase-4--comms--sales-tooling)
- [Phase 4b — Visit Booking System (Calendly-style)](#phase-4b--visit-booking-system-calendly-style)
- [Phase 5 — Knowledge base (Docs)](#phase-5--knowledge-base-docs)
- [Phase 6 — Internal deployment & onboarding](#phase-6--internal-deployment--onboarding)
- [Later / Optional — PM integration](#later--optional--pm-integration)

---

## Phase 0 — De-task-tracker
*Goal: the app reads as a real-estate CRM, not a generic task tracker. Mostly
rename/reframe — almost nothing is deleted.*

### 0.1 My Tasks → My Leads / My Deals — ♻️ S
- **What we build:** Repurpose the personal-task page and `Task.isPersonal` into an
  "assigned to me" view of leads/deals; or remove if redundant with board filters.
  Files: `client/src/pages/MyTasksPage.jsx`, `PersonalTaskModal.jsx`,
  `server/src/routes/tasks.js`, `Task.js`.
- **What it does:** Each agent gets a single screen of every lead/deal assigned to
  them across all boards, instead of a personal to-do list.
- **How to use:** Click **My Leads** in the nav → see your assigned items grouped by
  stage → open one to work it. No separate "personal task" concept.

### 0.2 Productivity page → shelved — ♻️ S
- **What we build:** Hide/disable the Productivity page; its role is replaced by
  agent-performance reporting in Phase 3. Files: `ProductivityPage.jsx`,
  `productivityController.js`.
- **What it does:** Removes a task-tracker-flavoured screen that doesn't fit CRM.
- **How to use:** N/A (removed from nav). Agent metrics return in [§3.3](#33-agent-performance--commissionsalary-module---l).

### 0.3 Navigation relabel — ♻️ S
- **What we build:** Rename nav items *My Boards · My Tasks · Productivity* →
  **Contacts · Listings · Deals · Calendar · Reports · Docs**. File:
  `client/src/components/layout/Navbar.jsx`.
- **What it does:** The top nav speaks CRM language; each label routes to the right
  board/view under the hood.
- **How to use:** Use the nav as the primary way to move between CRM areas.

### 0.4 Terminology pass (Task/Item → Lead/Contact/Deal) — ♻️ S
- **What we build:** Change display labels and i18n strings only — keep model names
  (`Task`, `Board`) internally untouched.
- **What it does:** Buttons, headers, and empty states say "Add lead" / "deal"
  instead of "Add task".
- **How to use:** Transparent — users just see CRM wording everywhere.

### 0.5 Dashboard & onboarding reframe — ♻️ S
- **What we build:** RE-flavoured greeting, quick actions (Add lead, Log a viewing,
  New listing), and an onboarding flow for a leasing company. Files:
  `client/src/components/dashboard/*`, `OnboardingPage.jsx`.
- **What it does:** First screen after login is a CRM home, not a task dashboard.
- **How to use:** Land on the dashboard → use quick actions to create your first
  lead/listing → follow onboarding to seed a pipeline.

---

## Phase 1 — Core CRM parity
*Goal: open the app and see a leasing company's setup (à la Rakotta) running.*

### 1.1 RE pipeline template seed — 🔴 M
- **What we build:** A seed that creates a CRM board with pipeline **groups** (New
  Lead → Contacted → Follow-up → Visit booked → Application → Lease to sign → Lease
  signed → Blacklisted → Archived), the standard **lead columns** (building, agent,
  status, visit-type, dates, email, phone, notes), a bilingual public **intake
  form**, and starter automations. New: `server/src/seeds/realEstateTemplates.js`,
  extend `boardTemplates.js`.
- **What it does:** One click gives a new org a working lead pipeline instead of a
  blank board.
- **How to use:** Create board → pick **Real-estate CRM** template → board appears
  pre-populated with stages, columns, a form link, and basic automations.

### 1.2 Listings / Inventory template seed — 🔴 M
- **What we build:** A second template: buildings = **groups**, units = **items**,
  with Sqft/Price number columns and an availability status.
- **What it does:** Tracks property/unit inventory alongside the lead pipeline, with
  per-building grouping and summed Sqft/Price.
- **How to use:** Create board → pick **Listings/Inventory** template → add buildings
  as groups and units as rows; availability and totals roll up automatically.

### 1.3 Starter RE automation recipes — 🔴 S
- **What we build:** A handful of ready RE recipes (form→create lead + assign agent,
  status→notify, visit-date→reminder). Extends `automationRecipes.js`.
- **What it does:** Common leasing workflows work out of the box.
- **How to use:** Board → **Automations** → **Use a recipe** → pick one → map its
  columns → turn on. (Full general library in [Phase 1b](#phase-1b--automations-hub--general-purpose-automations).)

### 1.4 View-tab switcher — ✅ DONE
- **What we build:** *Nothing — already shipped.* Verified 2026-06-07: the saved-view
  tab switcher exists in `TableView.jsx` (save/load/apply filter+group+sort+column
  config, per-user per-board). Files: `SavedTableView` model, `savedViewService`,
  `client/src/components/board/TableView.jsx`.
- **What it does:** The same board data, presented several ways, switchable in one
  click — grouped-by-building table, calendar of visits, public form.
- **How to use:** On a board, click a **view tab** along the top to switch; **+** to
  save the current filter/sort/group as a new named view.

### 1.5 Advanced filter builder — 🔴 L
> Modeled on Monday.com's board filter, which has **two coexisting modes**:
> **Quick filters** (chip-per-column) and **Advanced filters** (the Column /
> Condition / Value builder). Researched 2026-06-07.

- **Quick filters — ✅ DONE (2026-06-07).** `BoardFilterBar.jsx` now renders a
  chip per *real* board column (status / dropdown / tags / person / checkbox) via
  `client/src/utils/columnFilter.js`, instead of the fixed legacy task fields.
  This is the "Switch to quick filters" half of Monday's filter.
- **What we still build (the *Advanced* mode):** a builder panel like Monday's —
  `Where [Column] [Condition] [Value]` rows combined with **AND / OR**, **nested
  groups** (`+ New group`), a live **"Showing X of Y leads"** count, **Clear
  all**, **Save to this view**, and a **"Switch to quick filters"** toggle back to
  the chip bar. ⛔ **No "Filter with AI"** (we dropped AI — [PLAN.md §2.5](PLAN.md)).
- **Per-column-type conditions** (each column offers only its relevant operators):
  | Column type | Conditions |
  |---|---|
  | Status / Dropdown | is · is not · is one of · is not one of · is empty · is not empty |
  | Text / Email / Phone / Link | contains · doesn't contain · is · is not · starts with · ends with · is empty · is not empty |
  | Numbers | = · ≠ · > · < · ≥ · ≤ · between · is empty · is not empty |
  | Date / Timeline | is · is before · is after · is between · relative (today / past / future / this week) · is empty · is not empty |
  | People | is · is not · is one of · contains · is empty · is not empty |
  | Checkbox | is checked · is unchecked |
- **Data model:** upgrade today's flat `[{ columnId, op, value }]` (AND-only;
  eq / in / between) to a **group tree** `{ conjunction: 'and'|'or', rules: [
  condition | group ] }` with the operators above. Evaluate client-side, mirror in
  `server/src/utils/columnFilter.js` so saved views / calendar / charts stay
  consistent. **Open choice:** extend the canonical shape everywhere vs. board-only
  (decide at build time).
- **What it does:** Slice the board by any combination, e.g. *(agent = X AND status =
  Visit booked) OR language = FR*.
- **How to use:** Board → **Filter** → **Advanced** → add `Where Column / Condition
  / Value` rows, combine with AND/OR, nest with **+ New group** → watch the live
  count → **Save to this view** (§1.4) or **Switch to quick filters**.

### 1.6 Group summaries — 🟡 M
- **What we build:** A per-group footer with numeric **SUM/AVG** and a **status
  battery** distribution bar. Wires existing aggregation into group headers/footers.
- **What it does:** Each pipeline stage shows totals (e.g. summed deal value) and a
  colored bar of status breakdown at a glance.
- **How to use:** Open a board grouped by stage → read the summary row under each
  group; click a number column's footer to switch SUM/AVG/count.

### 1.7 Form branding — 🟡 S
- **What we build:** Logo, cover image, and brand colors on public intake forms.
  Files: `Form.js`, `PublicFormPage.jsx`.
- **What it does:** Public lead-capture forms look like the company, not generic.
- **How to use:** Form builder → **Branding** → upload logo/cover, set colors →
  publish; the public URL reflects branding.

---

## Phase 1b — Automations Hub & general-purpose automations
*Goal: one Autopilot-style hub to build, manage, and monitor every automation +
integration across the account — on Monday's general-purpose library, **no billing**.
Full reference in [PLAN.md §9](PLAN.md).*

### 1b.1 Automations Hub page — 🔴 L
- **What we build:** A top-level **Automations Hub** with left nav *Health · Usage ·
  Workflows · Connections* and *Automations / Integrations* tabs. Account-wide list
  of all automations & integration recipes grouped by board, each showing owner,
  last-run time, run status, and an on/off toggle. New: `AutomationsHubPage.jsx`,
  `automationHubController.js`. **No "Upgrade plan" button, no action cap.**
- **What it does:** Replaces hunting board-by-board — see and control every
  automation in the whole org from one screen, and spot broken ones.
- **How to use:** Open **Automations Hub** from the main nav →
  - **Health:** review failing / incomplete automations (e.g. channel not connected,
    broken column reference) and fix them.
  - **Workflows:** browse all automations grouped by board; toggle any on/off; click
    one to edit.
  - **Usage:** see the observability dashboard ([§1b.5](#1b5-usage--observability-dashboard--m)).
  - **Connections:** manage connected accounts ([§1b.4](#1b4-connections--connectors--lon-demand)).

### 1b.2 General-purpose triggers — 🔴 L
- **What we build:** Extend the `triggerType` set beyond today's 9 with: status
  **from X to Y**, **subitem created / subitem status changed**, **item moved to
  group**, **checkbox checked**, **update posted**, **number crosses threshold**,
  **date passes (overdue)**, **item name changed**, **dependency date changed**, and
  a polished **every-time-period** recurring UX over `SCHEDULE`.
- **What it does:** Automations can react to far more board events — matching what a
  Monday user expects when they say "When …".
- **How to use:** In the automation builder, the **When** dropdown now lists all
  these triggers; pick one and configure its parameters (column, from/to value,
  threshold, offset days, schedule).

### 1b.3 General-purpose conditions & actions — 🔴 L
- **What we build:**
  - **Conditions (If):** column equals/contains/empty, number/date compares, person
    assigned checks, and nestable **AND/OR** groups.
  - **Actions (Then):** `DUPLICATE_ITEM`, `ARCHIVE_ITEM`, `DELETE_ITEM`,
    `MOVE_ITEM_TO_BOARD`, `CREATE_ITEM_IN_BOARD`, generalised `ASSIGN_PERSON` /
    `ASSIGN_CREATOR`, `CLEAR_COLUMN`, date ops (`SET_DATE`, `PUSH_DATE_BY_N`), number
    ops (`INCREASE/DECREASE/SET_NUMBER`), update ops (`CREATE_UPDATE`,
    `REPLY_TO_UPDATE`, `MENTION_PERSON`), `CONNECT_BOARDS` / `CREATE_DEPENDENCY`, and
    subitem roll-up (set parent status when all subitems done).
- **What it does:** Lets users compose almost any Monday-style rule —
  *When → If → Then* — without code.
- **How to use:** In the builder, add **If** conditions (combine with AND/OR) and one
  or more **Then** actions from the expanded list; each action shows its own config
  form.

### 1b.4 Connections / connectors — 🔴 L (on demand)
- **What we build:** Surface native channels (Email, SMS, WhatsApp, Webhooks,
  Calendar) as first-class **Connections**, plus Monday-style connectors built on
  demand (Slack, Teams, Google/Outlook Calendar, Jira, GitHub, Salesforce, HubSpot,
  Mailchimp, Typeform, Drive/Dropbox) and a **generic REST connector framework**.
  ⛔ No Stripe/PayPal billing connector.
- **What it does:** Lets automations send to / receive from external tools, and gives
  one place to authorize and revoke those accounts.
- **How to use:** Hub → **Connections** → **Connect** an account (OAuth/token) → it
  becomes available as a trigger source and action target in the builder.

### 1b.5 Usage / observability dashboard — 🔴 M
- **What we build:** The usage screen from the reference shots — action-usage
  **count** (no denominator/cap), daily-action **bar chart**, **top boards /
  workflows** and **top creators** pies, and a **top integrations / workflows**
  table (Integration · Board · Owner · Actions), date-range filterable. Reuses
  `AutomationRunLog`. ⛔ No quota, projected-actions, "pro plan", billing link, or
  Upgrade button.
- **What it does:** Shows where automation activity is happening so admins can audit
  and tune — purely informational, never a paywall.
- **How to use:** Hub → **Usage** → pick a date range → read the charts/table to see
  which boards, people, and integrations drive the most automation runs.

### 1b.6 Custom automation composer — 🟡 M
- **What we build:** Generalise the existing builder so the **When → If → Then**
  composer works on any board, not just RE recipes. File: `AutomationBuilder.jsx`.
- **What it does:** Power users build bespoke rules from scratch by combining any
  trigger, conditions, and actions.
- **How to use:** Board or Hub → **Automations** → **Create custom automation** →
  pick a When, add If conditions, add Then actions → **Activate**.

---

## Phase 2 — Reporting & dashboards

### 2.1 Multi-section dashboard builder — 🔴 L
- **What we build:** A dashboard where you add/drag **widgets** into **sections**
  with headers, each widget connected to a board. Files: `ChartWidget` model + new
  builder UI.
- **What it does:** Composable reporting pages (pipeline by stage, visits this week,
  leases signed by agent) assembled from board data.
- **How to use:** **Reports** → **New dashboard** → **Add widget** → choose a chart +
  source board + grouping → drag to arrange → save/share.

### 2.2 More chart widget types — 🟡 M
- **What we build:** Additional widgets: stacked-bar-over-time, counts by source,
  etc. Files: `client/src/components/analytics/*` (recharts already in deps).
- **What it does:** Richer visualizations beyond the current set.
- **How to use:** When adding a widget, pick the new chart type and map its axes.

### 2.3 Marketing / ROI analytics — 🔴 M
- **What we build:** Leads/visits/leases **by source**, **ad budget per source**, and
  **cost-per-lead**. Needs a lead-source + campaign-budget data model.
- **What it does:** Shows which marketing channels actually convert and what each
  lead costs.
- **How to use:** Tag leads with a source → enter campaign budgets → open the
  **Marketing ROI** dashboard to see cost-per-lead and conversion by source.

### 2.4 Per-widget / per-board permissions — 🔴 M
- **What we build:** Extend `WorkspaceGrant` / `roleCheck` to widget scope so
  individual widgets/boards can be locked. 
- **What it does:** Sensitive widgets (e.g. revenue) are visible only to allowed
  roles even on a shared dashboard.
- **How to use:** Edit a widget → **Permissions** → choose who can view → others see
  it locked/hidden.

---

## Phase 3 — Org structure & differentiator

### 3.0 Workspaces under the Organisation + access control — 🔴 L  (IN PROGRESS)
> **Decision (2026-06-08): Option 2 — per-workspace/per-board access control.**
> A new real `Workspace` model lives inside the org; boards belong to a workspace
> (board keeps `organisation` = the company for tenant scoping, **adds** `workspace`
> for grouping + access). Built in two stages.
- **Stage 1 — Hierarchy (non-destructive):** real `server/src/models/Workspace.js`
  (`{ organisation, name, order }`), `board.workspace` ref, workspace CRUD endpoints,
  sidebar **Organisation → Workspaces → Boards**, board created inside a workspace.
  Migration: a default **"General"** workspace per org holds existing boards. No
  access change yet (admins/members see boards as before, just grouped).
- **Stage 2 — Granular access control (the requested feature):** an admin can grant
  a member access to a **whole workspace** (all its boards) or a **single board**,
  each as **Viewer** (read) or **Editor** (read+write), with optional **expiry** and
  **revoke** — built on the existing `WorkspaceGrant` + `roleCheck`. Non-admins see
  only granted workspaces/boards everywhere (sidebar, board list, search, dashboards,
  calendar); org **owner/admins see everything**. An admin **Access** screen lists
  each member and their grants.
- ⛔ **Row/item-level access is NOT in scope** (no per-lead/per-group restriction) —
  stakeholder decision 2026-06-08. Access is **workspace + board level only**.
- **How to use:** **+ New workspace** in the sidebar → create boards inside it →
  **Access** screen → grant a member a workspace/board as Viewer/Editor (± expiry).

### 3.1 Teams & team dashboards — 🔴 M
- **What we build:** **Teams** under the organisation with membership, plus
  team-scoped dashboards. New: `server/src/models/Team.js`.
- **What it does:** Group agents into teams; each team gets its own rolled-up view.
- **How to use:** Org admin → **Teams** → create a team, add agents → open the team
  dashboard to see that team's pipeline and performance.

### 3.2 Roles / permissions & workspace home — 🟡 M / 🔴 folders
- **What we build:** Role polish (**Org admin / Team lead / Agent**), a workspace
  **home UI** (banner, Content/Collaborators tabs), and workspace **folders**.
- **What it does:** Clear permission tiers and a navigable workspace with folders for
  organizing many boards.
- **How to use:** Admin assigns roles per member; users browse the workspace home and
  drop boards into folders.

### 3.3 Agent performance & commission/salary module — ⛔ DROPPED
> Stakeholder decision (2026-06-08): **no salary or commission tracking.** Agent
> *activity* performance still surfaces through Phase 2 dashboards (leads per
> agent, conversions, etc.) — but the app computes **no compensation**.
- **What we build:** ~~Base salary + **commission rules** → auto-compute earnings on
  deal close → team/agent reports. New: `server/src/models/Compensation.js` +~~
  reports. *(This is our edge over Monday.)*
- **What it does:** When a deal closes, the system computes each agent's commission
  and rolls earnings into performance reports.
- **How to use:** Admin sets each agent's base + commission rule → on deal close
  earnings compute automatically → view per-agent/per-team earnings in **Reports**.

---

## Phase 4 — Comms & sales tooling

### 4.1 Email sequences (drip cadences) — 🔴 L
- **What we build:** Multi-step email **sequences** on the automation engine. New:
  `server/src/models/EmailSequence.js` + runner.
- **What it does:** Automatically sends a timed series of emails to a lead (e.g.
  day 0 welcome, day 2 follow-up, day 5 listings) until they reply or convert.
- **How to use:** **Sequences** → build steps with delays and templates → enroll
  leads (manually or via automation); enrollment stops on reply/stage change.

### 4.2 Mass email tracking — 🔴 M
- **What we build:** Campaign send with **open/click** stats.
- **What it does:** Send to a segment and see who opened/clicked.
- **How to use:** Select leads → **Send campaign** → pick a template → view
  open/click results in the campaign report.

### 4.3 Quotes & invoices — 🔴 L
- **What we build:** Lease offers / deposits as **quotes/invoices** with PDF + an
  e-sign hook; delivered via native email/SMS/WhatsApp.
- **What it does:** Generate a branded offer/invoice PDF, send it, and capture
  signature/acceptance.
- **How to use:** On a deal → **Create quote** → fill terms → send → recipient signs;
  status updates back on the deal.

---

## Phase 4b — Visit Booking System (Calendly-style)

> Our own booking engine for **property visits** — a Calendly clone scoped to real
> estate. **One shareable link per building**, wired to a **board's calendar**.
> Visitors self-book a visit slot; a lead + calendar event are created and an agent
> is assigned automatically. No third-party (Calendly) dependency.

**Locked scope (stakeholder):** one link = one building; pick the **target Board**
and **target Group** at creation; **availability set manually** (weekly hours +
date overrides) like Calendly; on booking → calendar event + confirmation email +
auto-assign agent + lead into the chosen group; entry point is a new **"Booking
Links"** button in the board toolbar; reschedule = **cancel + rebook** link (MVP).

### 4b.1 Booking link + slot engine — 🔴 L
- **What we build:** `BookingLink` and `Booking` models + a **slot engine**. New:
  `server/src/models/BookingLink.js`, `server/src/models/Booking.js`,
  `server/src/services/slotEngine.js`, `bookingController.js`, `routes/bookings.js`.
  - `BookingLink`: `{ board, group (target), title/building, slug, duration,
    location, timezone, availability { weeklyHours[], dateOverrides[] },
    bufferBefore, bufferAfter, dailyCap, minNotice, dateRangeDays, questions[],
    assignMode (fixed | round-robin), agents[], branding {logo, accent, headline},
    active }`.
  - `Booking`: `{ link, board, slotStart, slotEnd, visitor {name,email,phone},
    answers[], status (confirmed | cancelled), leadId, agent, cancelToken }`.
- **What it does:** Open slots = `weeklyHours` − `dateOverrides` − `minNotice` /
  `dateRangeDays` − slots already booked on that board, returned in the **visitor's
  timezone**. Prevents double-booking against the board's calendar.
- **How to use (admin):** Board toolbar → **Booking Links** → **New link** →
  building name, **pick target Group**, duration, location, **draw weekly hours +
  date overrides**, buffers / daily cap / min-notice, booking questions, agent
  assignment → get a shareable `/book/:slug` URL.

### 4b.2 Public booking page — 🔴 M
- **What we build:** Frontend-served public page at **`/book/:slug`** (same pattern
  as public Forms `/f/:slug`).
- **What it does:** Branding/building header → **day picker** → **free slots** →
  visitor form (name/email/phone + questions) → confirmation screen. Fully **EN/FR
  + any-language**, visitor timezone auto-detected.
- **How to use (visitor):** Open the link → pick a day → pick a free slot → fill the
  form → confirm → receive a confirmation email with calendar invite + cancel/rebook
  links.

### 4b.3 On-booking actions — 🔴 S
- **What we build:** The booking-creation side effects.
- **What it does:** On confirm → (1) **create a lead** in the link's chosen group
  (reuse the Forms intake path), (2) **stamp its date column** so it appears on the
  **board Calendar view**, (3) **auto-assign an agent** (fixed or round-robin via
  the Person column), (4) **send confirmation emails** to visitor + agent with an
  **`.ics`** invite and **cancel/rebook** links.
- **How to use:** Automatic; the new visit shows up as a lead in "Visit Booked" (or
  whichever group was chosen) and on the board's Calendar.

### 4b.4 Manage links & bookings — 🔴 S
- **What we build:** A board's **Booking Links** manager + bookings list.
- **What it does:** List/copy-URL/edit/deactivate links; view bookings (who booked,
  when, status) and cancel from the admin side.
- **How to use:** Board toolbar → **Booking Links** → manage existing links and see
  their bookings.

**Reuses:** board Calendar view (Phase 3.0), Person/Assigned-to column, public-form
intake pattern, i18n EN/FR. **Later (not MVP):** reminder emails (24h/1h), Google
Calendar busy-sync, payments, embed widget, no-show tracking, follow-up emails, and
a true in-place reschedule flow.

---

## Phase 5 — Knowledge base (Docs)

### 5.1 Docs / Workdocs — 🔴 L
- **What we build:** Rich-text **docs** (SOPs, tenant letters, templates, guides) —
  the one fully-missing module. New: `server/src/models/Doc.js` + editor (Tiptap
  already in deps).
- **What it does:** A collaborative document space living alongside boards, for
  process docs and reusable letter templates.
- **How to use:** **Docs** → **New doc** → write with the rich editor → share within
  the workspace; reference templates when emailing leads.

---

## Phase 6 — Internal deployment & onboarding
*(was "SaaS productization" — billing dropped per [PLAN.md §2.5](PLAN.md))*

### 6.1 Signup / invites — 🔴 M
- **What we build:** Email/password auth alongside Google OAuth, **org-scoped and
  admin-invited** (not public self-serve).
- **What it does:** Lets the company add its own team members securely without an
  open signup funnel.
- **How to use:** Admin → **Members** → **Invite** → user accepts and sets a password
  (or signs in with Google).

### 6.2 Stripe billing — ⛔ DROPPED
- **What we build:** Nothing. Per [PLAN.md §2.5](PLAN.md) we deploy single-tenant
  direct to the company. **No plans, tiers, trials, metering, or "Upgrade" UI.**
- **What it does:** N/A — keeps the product free of any paywall/upgrade surface.
- **How to use:** N/A.

### 6.3 Template gallery / onboarding — 🔴 M
- **What we build:** A gallery of board/team templates and guided onboarding for new
  **boards & teams within the org**.
- **What it does:** Spin up new structured boards fast from curated templates.
- **How to use:** **+ New** → **From template** → pick one → it seeds columns,
  groups, and starter automations.

### 6.4 Deployment runbook — 🔴 S
- **What we build:** Env config, seed data, and single-instance hosting docs for the
  company's deployment.
- **What it does:** Makes standing up the company's own instance repeatable.
- **How to use:** Ops follows the runbook to configure env vars, seed, and host.

---

## Later / Optional — PM integration
*Not a property-management build — integrate, don't build (see [PLAN.md §7](PLAN.md)).*

### L.1 Generic CSV import — 🔴 M
- **What we build:** CSV import for units/leases/tenants.
- **What it does:** Pull existing inventory/tenant data in without manual entry.
- **How to use:** **Import** → upload CSV → map columns → confirm; rows become items.

### L.2 Connector framework (Building Stack / Yardi / Buildium) — 🔴 L
- **What we build:** A generic connector framework; add specific PM connectors only
  on paying-customer demand. (Building Stack API is sales-gated — pursue a
  partnership only when a customer requires it.)
- **What it does:** Syncs data with external PM systems without us building PM.
- **How to use:** **Connections** → add a PM connector → authorize → map fields →
  data syncs on a schedule.
