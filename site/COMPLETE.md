# COMPLETE.md — build progress tracker

> What's **done** vs **remaining** for the Real-Estate CRM. Companion to
> [PLAN.md](PLAN.md) (strategy + roadmap) and [FEATURES.md](FEATURES.md)
> (per-feature spec). Status legend: ✅ done · 🟡 partial · 🔴 not started ·
> ⛔ dropped.
>
> Last updated: 2026-06-07.

---

## ✅ Done

### Deployment & infrastructure
- ✅ **Frontend on Vercel** (`realestate-crm-flame.vercel.app`) — fixed 404 (Root
  Directory `client`, Framework = Vite, output `dist`).
- ✅ **Server on Render** (`realestate-crm-q8jk.onrender.com`).
- ✅ **Google OAuth login working end-to-end** — corrected `GOOGLE_CALLBACK_URL`,
  `CLIENT_URL`, client id/secret match, and Google Console redirect URIs.
- ✅ Env-var mapping documented (Render server vars vs Vercel `VITE_API_BASE_URL`).

### Plan accuracy (codebase audit, 2026-06-07)
- ✅ **Verified the §4 inventory against real code.** Engine + comms (email Gmail/
  MS/IMAP, SMS, WhatsApp, webhooks) confirmed genuinely built; calendar, subitems,
  workspaces/permissions, saved views confirmed ✅.
- ✅ **Corrected three inventory claims:** AI lead scoring → **⛔ dropped** (no
  Anthropic dependency exists); Filters → **🔴** (was 🟡); Saved Views → **✅**
  (view-tab switcher already shipped).
- ⛔ **Anthropic AI features removed from scope** (PLAN.md §2.5 / §6). Deterministic
  lead intake (round-robin / geo / fixed) covers assignment.

### Phase 0 — De-task-tracker (reframe) — ✅ COMPLETE
- ✅ **i18n foundation** (`react-i18next`) — **EN + FR (Québec)**, browser
  detection, persisted choice, `<html lang>` sync, **adding any language = 1 JSON
  file + 1 line in `client/src/i18n/languages.js`**. Switcher in the avatar menu.
- ✅ **0.3 Nav relabel** → Dashboard · Boards · My Leads · Calendar · Members ·
  Reports (Productivity dropped from nav).
- ✅ **0.2 Productivity page shelved** (off nav, code retained).
- ✅ **0.1 My Tasks → My Leads** — assigned-to-me leads grouped by board
  (`client/src/pages/MyTasksPage.jsx`); personal-task concept retired.
- ✅ **0.5 Dashboard & onboarding reframe** — greeting, "leads waiting", quick
  actions, stat cards (Open/Completed Leads), activity/boards headings, onboarding.
- ✅ **0.4 Terminology sweep (full)** — Task→Lead across **~40 files**, **892
  namespaced keys × 2 locales**, validated EN/FR parity, **0 missing keys** at
  build time.

### Board UX improvements (2026-06-07)
- ✅ **New boards start blank** — only the primary **Lead** column; add columns on
  the spot via "+ Add column" (no preset Status/Priority/Owner/Due). Existing
  legacy boards untouched. (`buildPrimaryOnlyColumns` in `boardTemplates.js`,
  `boardController.createBoard`.)
- ✅ **Frozen Lead column** — primary column (+ drag handle + checkbox) is
  sticky/pinned-left; other columns scroll horizontally underneath, hover/highlight
  synced. (`client/src/components/board/DataGrid.jsx`.)

### Filters — quick (column-aware) — ✅ DONE
- ✅ **Board filter bar now reads the board's real columns** (Lead Status, Assigned
  To, etc.) instead of fixed legacy task fields. Status/dropdown/tags/person/
  checkbox columns each become a filter chip. Uses the canonical
  `[{columnId, op, value}]` shape via new `client/src/utils/columnFilter.js`;
  evaluated through `taskFilters.js`. Legacy boards keep the classic chips.

### Phase 1 — Core CRM parity (in progress)
- ✅ **1.1 RE pipeline template** — template engine now seeds **pipeline-stage
  GROUPS** + columns. New **"Real Estate CRM"** template (Rakotta-style leasing):
  groups `New Lead → Contacted → Follow-up → Visit Booked → Application → Lease to
  Sign → Lease Signed → Blacklisted → Archived`; columns Lead, Lead Status,
  Building, Agent, Visit Type, Language (FR/EN), Inscription/Visit/Move-in dates,
  Phone, Email, Notes. (`boardTemplates.js`, `boardController.createBoard` seeds
  `TaskGroup`s.)
- ✅ **1.2 Listings / Inventory template** — buildings as groups, units as rows,
  with Availability, Bedrooms, Bathrooms, Sqft, Price, Floor, Notes.
- ✅ **1.3 Starter RE automation recipes** — 3 new recipes that bind cleanly to the
  Real Estate CRM template: intake form → assign agent + welcome email; Lead Status
  → Interested → notify agent; visit-date − 1 day → SMS reminder. (13 recipes total
  now; `server/src/seeds/automationRecipes.js`.)
- ✅ **1.4 View-tab switcher** — already shipped (verified in audit).
- ✅ **1.6 Group summaries** — per-group footer with clickable numeric
  SUM/AVG/COUNT/MIN/MAX + status/dropdown distribution ("battery") bar, frozen
  first column. (`client/src/utils/columnSummary.js`, `DataGrid.jsx`.)
- ✅ **1.7 Form branding** — logo, cover image, accent color, custom headline on
  public intake forms (`Form.branding`, FormBuilder branding section,
  PublicFormPage renders it).
- ✅ **1.5 Advanced filter builder** — Monday-style two-mode filter. **Quick
  filters** (column chips) + **Advanced builder**: `Where [Column][Condition]
  [Value]` rows with **AND/OR**, **nested groups**, live "Showing X of Y" count,
  Clear all, and a **Quick ↔ Advanced** toggle. Full per-type operator set
  (is/contains/between/before/after/empty/…) on a recursive `{conjunction, rules}`
  tree. ⛔ No "Filter with AI". (`columnFilter.js`, `AdvancedFilterPanel.jsx`,
  `BoardFilterBar.jsx`, `taskFilters.js`.)
- ✅ **1.1 starter form** — creating a Real Estate CRM board now auto-seeds a
  **"Lead Intake"** public form (Lead/Email/Phone/Building/Visit Type/Language,
  bilingual thank-you), which appears as a board **form tab**. (`boardTemplates.js
  buildStarterForm`, `boardController.createBoard`.)
- ✅ **Forms as board tabs** — public forms render as tabs next to Board · Table
  view · Insights, with a live preview + copy/open/edit. (`FormBoardView.jsx`.)
- ✅ Templates picker shows a **stages** line; templates API exposes `groups`.
- **Phase 1 — Core CRM parity: ✅ COMPLETE.**

---

## 🔴 Remaining

### Phase 1 — Core CRM parity — ✅ COMPLETE (nothing left)
> Optional polish: per-field **bilingual** form labels on the public form
> (currently labels come from column names; thank-you copy is bilingual), and
> **Save-to-view** for the advanced filter (persist the tree to a SavedTableView +
> mirror the evaluator server-side). Neither blocks Phase 1.

### Phase 1b — Automations Hub & general-purpose library — ✅ COMPLETE (2026-06-08)
- ✅ **1b.1/1b.5 Automations Hub** — account-wide page (`/automations/hub`, sidebar
  entry) with Workflows (every automation across boards + on/off toggle), Health
  (broken/failing), Usage (run-log charts), Connections tabs. `automationHubController`
  (`/hub`, `/usage`, `/connections`).
- ✅ **1b.2 Triggers (+4 → 13)** — CHECKBOX_CHECKED, NUMBER_CROSSED (ride
  task.column_changed), ITEM_MOVED_TO_GROUP, UPDATE_POSTED (new emit points in
  taskController/updateController). Matchers + tests.
- ✅ **1b.3 Actions (+3 → 14)** — CLEAR_COLUMN, DUPLICATE_ITEM, DELETE_ITEM
  (registry-driven). **Richer conditions** — AND/OR tree of column-compares
  (`conditionTree` + server `conditionTree.js` evaluator mirroring the board filter;
  wired into dispatcher + date runner; reuses the board's GroupEditor as
  `ConditionTreeBuilder`).
- ✅ **1b.4 Connections** — real connected-status per channel (email/sms/whatsapp/
  webhooks/calendar) with correct manage deep-links.
- ✅ **1b.6 Custom composer** — already board-agnostic (board picker + dynamic
  columns/groups). Verified.
- Tests: 39 automation unit tests green (conditionTree 11, dispatcher 11, actions 17).

### Phase 1b — Automations Hub (original scope note) — ✅
- 🔴 Automations Hub page (Health · Usage · Workflows · Connections), general
  triggers/conditions/actions, usage/observability dashboard, custom composer.
  *(Recommend trimming to the automations Rakotta actually uses — see analysis.)*

### Phase 2 — Reporting & dashboards — ✅ COMPLETE (2026-06-08)
- ✅ **2.4 Per-widget visibility** — ChartWidget `visibility` (everyone | admins);
  members never list/fetch admins-only widgets; form toggle + "Admins" badge.
- ✅ **2.3 Marketing/ROI** — `Campaign` model (source label + ad spend + dates),
  `marketingController` (campaign CRUD + `/marketing/roi`), `marketingRoiService`
  (per-source leads/won/conversion/cost-per-lead/cost-per-acquisition; 4 tests).
  Dedicated **Marketing & ROI** section on AnalyticsPage (campaign manager + ROI
  table + leads/spend charts). **Lead-source capture**: form `sourceTag` +
  `sourceColumnId` auto-fills the source column on every submission; admins also
  set a Source column manually.
- 🟡 **2.2 More chart types** — 6 types + the Marketing report cover current needs;
  add more on demand. (Original §2.1 note retained below.)

### Phase 2 — Reporting & dashboards (original §2.1 note) — 🟢 in progress
- ✅ **2.1 Custom dashboard** — the Reports page now has a composable
  **WorkspaceDashboard**: admins add chart widgets, each pulling from any board in
  the workspace (board picker), in a responsive grid; everyone views. Reuses the
  ChartWidget engine + 6 chart types (bar/line/pie/funnel/number/stacked-bar).
  (`WorkspaceDashboard.jsx`, exported `ChartWidgetForm`/`WidgetCard` from
  `InsightsTab.jsx`, wired into `AnalyticsPage`.)
- 🔴 **2.3 Marketing / ROI analytics** — leads/visits/leases by source, ad budget
  per source, cost-per-lead. Needs a lead-source + campaign-budget data model.
- 🔴 **2.4 Per-widget / per-board permissions** — lock sensitive widgets to roles.
- 🟡 **2.2 More chart types** — 6 types exist; add more (e.g. counts-by-source,
  stacked-over-time) as needed.

### Phase 3 — Org structure & differentiator — ✅ Folders + Permissions COMPLETE (2026-06-08)
- ✅ **3.1 Folders** — the "Workspace" model is the folder layer (Org → Folder →
  Board). `getBoards` returns `folderId`/`folderName`; `updateBoard` moves a board
  between folders. Sidebar is a **collapsible folder tree** with admin folder CRUD
  (create/rename/delete; default folder protected) — `SidebarFolders.jsx`. Board
  create/edit modal has a **Folder picker**. The Content tab's Folder column now
  fills.
- ✅ **3.2 Permissions (Option 2, no row-level)** — added a **`folder`** grant type
  to `WorkspaceGrant`; grants now ENFORCED: `getBoards` shows public + granted
  boards (with `accessRole`), `loadBoardContext` honours grants (viewer=read,
  editor=board-scoped edit), board rename/delete stay org-admin-only. New admin
  **Permissions tab** (`PermissionsTab.jsx`) grants a member Viewer/Editor on a
  board / folder / whole workspace, with expiry + revoke. Reuses the existing
  grant CRUD endpoints.
- ⛔ Teams / team dashboards / agent-performance + commission — dropped earlier.

### Phase 3 — Org structure & differentiator (original note) — 🔴
- 🔴 **3.0 Workspaces under the Organisation** — real Org → **Workspace** → Folder →
  Board hierarchy (today `Workspace` is an alias for `Organisation`). Sidebar
  becomes a workspace switcher. **Added to plan 2026-06-07; not built; existing
  data left as-is for now.** (FEATURES.md §3.0 / PLAN.md §3.3.)
- 🔴 Teams + team dashboards · roles/folders/workspace home.
- ⛔ **Agent performance + commission/salary module — DROPPED** (stakeholder,
  2026-06-08). Agent *activity* reporting comes via Phase 2 dashboards; no
  compensation math.

### Phase 4 — Comms & sales tooling — 🔴
- 🔴 Email sequences (drip cadences) · mass email tracking · quotes & invoices.

### Phase 4b — Visit Booking System (Calendly-style) — ✅ MVP COMPLETE (2026-06-08)
- ✅ Models `BookingLink` + `Booking`; TZ-aware `slotEngine.js` (weekly hours +
  date overrides − buffers − minNotice − dateRange − dailyCap − booked slots),
  **9 unit tests** incl. DST.
- ✅ Admin CRUD (`/api/boards/:id/booking-links`) + public flow
  (`/book/:slug`, `/slots`, `/submit`, `/cancel/:token`, `/book/ics/:token`).
- ✅ On booking → lead via `createTaskWithColumnValues` in the chosen group,
  stamps the date column (shows on board Calendar), round-robin/fixed agent
  assignment to the person column, confirmation email to visitor + agent with an
  **.ics** "Add to calendar" + cancel/rebook link.
- ✅ Client: **Booking Links** board-toolbar button → manager (create/edit wizard:
  group, date column, duration, timezone, buffers/cap/min-notice/range, weekly
  availability, agents+mode, branding) + public `/book/:slug` page (day picker →
  slots → form → confirmation, + cancel screen).
- 🔜 Later: reminder emails (24h/1h), Google busy-sync, true reschedule, a
  dedicated "my upcoming visits" feed for the Home cockpit (today the visit shows
  as a dated lead).

### Phase 4b — Visit Booking System (original scope note) — 🔴
- 🔴 Our own booking engine for property visits. **One link = one building**, wired
  to a board's calendar (board + target group chosen at creation). Manual
  availability (weekly hours + overrides). On booking → lead in chosen group +
  calendar event + confirmation email + auto-assign agent. Board-toolbar **"Booking
  Links"** button; public page `/book/:slug`; cancel+rebook (MVP). New models:
  `BookingLink`, `Booking` + `slotEngine`. Full spec in PLAN.md/FEATURES.md Phase 4b.

### Phase 5 — Knowledge base — 🔴
- 🔴 Docs / Workdocs (Tiptap).

### Phase 6 — Internal deployment & onboarding — 🔴
- 🔴 Signup/invites (email+password) · template gallery/onboarding · deployment
  runbook. ⛔ Stripe billing dropped.

### Later / Optional — PM integration — 🔴
- 🔴 CSV import · connector framework (Building Stack / Yardi / Buildium).

---

## Notes & deferred decisions
- **Date/number filter chips** in the quick filter bar are deferred to the Phase
  1.5 advanced builder (the `between` UI).
- **Advanced filter shape:** extend the canonical `[{columnId,op,value}]` shape
  everywhere vs. board-only — decide at 1.5 build time.
- **Workspace migration:** existing orgs → workspaces under one org, deferred to
  Phase 3 (no migration yet).
- Orphaned after Phase 0: `PersonalTaskModal.jsx` (safe to delete).
