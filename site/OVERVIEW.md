# Rakotta Monday — Complete Site Reference

> A full description of the site so anyone (or any AI) reading this knows the
> whole product: what it is, every feature it has, its pages, its data, and how
> it's built. This is the ground-truth map of the system.
>
> Last updated: 2026-07-15.

---

## 1. What it is

**Rakotta Monday** is a **"Monday.com for real estate"** — a board-based CRM that
leasing and real-estate companies use to run their entire operation: capturing
leads, booking property visits, moving deals through a pipeline, tracking
listings, communicating with clients (email/SMS/WhatsApp), automating workflows,
and reporting on performance.

Under the hood it's a generic Monday-style **board engine** (boards → groups →
rows → columns). On top of that engine sits an **opinionated real-estate CRM**:
pipeline templates, listing inventory, lead-intake forms, a visit-booking system,
and marketing analytics. Everything a real-estate team needs is modeled with the
same primitives, so every feature (columns, automations, forms, views,
permissions, comms) works everywhere for free.

The app runs in **English and French (Québec)**; any language can be added.

---

## 2. Tech stack

- **Frontend:** React 19 + Vite, deployed on **Vercel**
  (`realestate-crm-flame.vercel.app`). Charts via Recharts, rich text via Tiptap,
  drag-and-drop, `react-i18next` for translations.
- **Backend:** Node/Express 5 + MongoDB (Mongoose), deployed on **Render**
  (`realestate-crm-q8jk.onrender.com`).
- **Auth:** Google OAuth (working end-to-end).
- **External services:** Cloudinary (file storage), Twilio (SMS + WhatsApp),
  Gmail / Microsoft / IMAP (email).
- **Repo layout:** `client/` (React app) and `server/` (Express API).

---

## 3. The core concept: everything is a board

| Real-estate concept | How it's modeled |
|---|---|
| The CRM | A **board** |
| Pipeline stages | **Groups** in the board |
| A lead / deal | A **row (item/task)** |
| Lead fields (agent, status, dates, phone…) | **Columns** |
| Property inventory | A **second board** — buildings = groups, units = rows |
| Sub-tasks under a lead | **Subitems** |
| Different ways to see a board | **Saved views** (table, calendar, map, form) |
| Linking a lead to a unit/other record | **Connect-boards / mirror columns** |

Because leads, listings, and deals are all boards, they inherit columns,
automations, forms, views, permissions, and communication automatically.

---

## 4. Pages (what the user navigates)

| Route | Page | Purpose |
|---|---|---|
| `/dashboard` | **Dashboard** | Home: greeting, "leads waiting", quick actions, stat cards, recent boards, activity. |
| `/boards` | **My Boards** | All boards the user can access. |
| `/boards/:id` | **Board Detail** | The main workspace — table/calendar/map/form views of a board. |
| `/my-tasks` | **My Leads** | Every lead assigned to the current agent, grouped by board. |
| `/calendar` | **Calendar** | Cross-board calendar of dated items (visits, follow-ups). |
| `/analytics` | **Analytics / Reports** | Dashboards, charts, and marketing ROI. |
| `/automations` · `/automations/hub` | **Automations & Hub** | Build and manage automations across the account. |
| `/automations/forms` | **Automation Forms** | Form-triggered automations. |
| `/integrations` | **Integrations** | Connected channels and connectors. |
| `/booking` · `/booking-app` | **Booking** | Manage visit-booking links. |
| `/boards/:id/automations` | Board automations | Automations scoped to one board. |
| `/boards/:id/integrations` | Board integrations | Channel setup for one board. |
| `/boards/:id/intake` | **Lead Intake** | Lead-assignment policy for a board. |
| `/boards/:id/bookings` | **Booking Links** | A board's property-visit links. |
| `/boards/:id/sequences` | **Sequences** | Email drip cadences for a board. |
| `/forms/new` · `/forms/:id/edit` | **Form Builder** | Create/edit public intake forms. |
| `/members` | **Members** | Team members and invites. |
| `/workspace` · `/workspace-settings` | **Workspace** | Workspace home and settings. |
| `/settings` | **Settings** | Email/SMS/WhatsApp config, AI keys, profile. |
| `/onboarding` | **Onboarding** | First-run setup for a new company. |
| `/login` · `/auth/callback` | **Login / Auth** | Google sign-in flow. |
| `/f/:slug` | **Public Form** | Public-facing lead-capture form (no login). |
| `/book/:slug` | **Public Booking** | Public-facing visit booking page (no login). |

---

## 5. Feature areas

### 5.1 Boards, groups & rows
- Boards made of **groups** (used as pipeline stages) and **rows** (leads).
- **Real Estate CRM template** — one click seeds the standard pipeline: New Lead →
  Contacted → Follow-up → Visit Booked → Application → Lease to Sign → Lease
  Signed → Blacklisted → Archived, plus lead columns, an intake form, and starter
  automations.
- **Listings / Inventory template** — buildings as groups, units as rows, with
  availability, bedrooms, bathrooms, sqft, price, floor, notes, and auto-totals.
- New boards can start blank (just a primary **Lead** column) and grow via
  "+ Add column".
- **Frozen primary column** — the Lead column stays pinned while other columns
  scroll horizontally.
- **Bulk actions** — select multiple rows to edit, move, or delete at once.
- **Subitems** — nested rows under a lead, with roll-up.
- **Checklists** and **rich-text updates** on each row.

### 5.2 Column types (19)
Status, People, Date, Timeline, Email, Phone, Text, Long Text, Number, Dropdown,
Tags, Rating, Location, File, Formula, Mirror, Connect-Boards, Checkbox, Link.
Each renders its own cell editor and offers type-specific filter operators.

### 5.3 Item (lead) detail
Opening a lead shows tabs: **Updates** (rich-text comments), **Files**, **Emails**,
**SMS**, **WhatsApp**, and **Activity log** — a full communication and history
record per lead.

### 5.4 Views
- **Table view** — grouped/sorted/filtered grid.
- **Calendar view** — maps a date column onto a calendar.
- **Map view** — plots rows with location columns on a map.
- **Form view** — the board's public intake form shown as a tab.
- **Saved views** — save a filter/sort/group/column setup as a named view tab,
  per user, per board.

### 5.5 Filters
- **Quick filters** — one chip per real board column (status, dropdown, tags,
  person, checkbox).
- **Advanced filter builder** — `Where [Column] [Condition] [Value]` rows combined
  with **AND/OR** and **nested groups**, a live "showing X of Y" count, and a
  quick↔advanced toggle. Operators are per-column-type (is/contains/between/
  before/after/empty, etc.).

### 5.6 Group summaries
Each pipeline stage has a footer with numeric **SUM / AVG / COUNT / MIN / MAX**
(click to switch) and a colored **status "battery"** distribution bar.

### 5.7 Public intake forms
- Built in a **Form Builder**; published at `/f/:slug` with no login.
- **Branding** — logo, cover image, accent color, custom headline.
- Required fields, captcha, bilingual thank-you copy.
- **Lead-source capture** — a source tag auto-fills a source column for marketing
  attribution.
- On submit → a new lead lands in the chosen pipeline group.

### 5.8 Automation engine (When → If → Then)
- **Triggers (When):** item created, group created, column value changed, status
  became X, status changed from X to Y, checkbox checked, item moved to group,
  update posted, number crossed threshold, date arrived, person assigned, form
  submitted, webhook received, schedule/recurring.
- **Conditions (If):** column compares (equals/contains/empty), number/date
  compares, person-assigned checks, item-in-group / item-in-status, combined with
  **AND/OR condition trees**.
- **Actions (Then):** create item, create subitem, set column value, clear column,
  move to group, duplicate item, delete item, notify person, send email, send SMS,
  send WhatsApp, enroll in email sequence, create calendar event, post webhook,
  assign lead agent.
- **AI draft** — describe an automation in words and get a drafted When→If→Then
  (backed by an AI-keys config in Settings).
- **Automations Hub** — account-wide page with **Health** (broken/failing rules),
  **Usage** (run-log charts, top boards/creators — observability only, no caps),
  **Workflows** (every automation grouped by board with on/off toggles), and
  **Connections** (channel status). Recipe catalogue with ready-made recipes.
- **Run log** — every automation execution is recorded and viewable.

### 5.9 Communication (native, built in)
- **Email** — connect Gmail / Microsoft / IMAP accounts; send, sync inbound,
  reply, and log against leads. **Email templates** with variables.
- **SMS** — via Twilio, with opt-out handling.
- **WhatsApp** — via Twilio, with template management.
- **Webhooks** — inbound (create/update leads from external systems) and outbound
  (post board events to other systems), with delivery logging.
- All messages thread onto the relevant lead's detail tabs.

### 5.10 Email sequences (drip cadences)
- Build multi-step **email sequences** with delays between steps.
- **Enroll** leads manually or automatically (via an automation action).
- Enrollment tracks each lead's progress; a runner sends steps on schedule.

### 5.11 Lead intake & assignment
- Per-board **intake policy** — automatically assign incoming leads by
  **round-robin, geography, or fixed** agent, and fire a welcome message.
- **Lead ingest API** — external systems can push leads in; an in-app API-docs
  modal shows how. Ingest is logged.
- **Lead connections** — link related leads/records across boards.

### 5.12 Visit booking (Calendly-style)
- **One booking link per building**, wired to a board and target group.
- Manual availability — weekly hours + date overrides, buffers, daily cap,
  minimum notice, date range.
- Timezone-aware **slot engine** (handles DST) shows free slots in the visitor's
  timezone.
- Public page at `/book/:slug`: pick a day → pick a slot → fill the form →
  confirm.
- On booking → creates a **lead** in the chosen group, stamps the date column (so
  it shows on the board calendar), **auto-assigns an agent** (fixed or
  round-robin), and emails visitor + agent a confirmation with an **.ics** invite
  and cancel/rebook link.
- **Booking workflows** — automated follow-ups tied to bookings.

### 5.13 Reporting & dashboards
- **Workspace dashboard** — admins add chart widgets, each pulling from any board;
  responsive grid; everyone views.
- **Chart types** — bar, line, pie, funnel, number, stacked-bar.
- **Board performance** and **overdue-assignee** reports.
- **Marketing & ROI** — a **Campaign** model (source label + ad spend + dates) and
  a report showing per-source leads / wins / conversion / cost-per-lead /
  cost-per-acquisition.
- **Per-widget visibility** — lock sensitive widgets to admins only.

### 5.14 Org structure & permissions
- Hierarchy: **Organisation → Workspace → Folder → Board**.
- Sidebar is a **collapsible folder tree** with admin folder CRUD.
- **Granular access control** — grant a member **Viewer** (read) or **Editor**
  (read+write) on a single **board**, a **folder**, or a whole **workspace**, with
  optional **expiry** and **revoke**. Owner/admins see everything; members see only
  what they're granted. Managed on an admin **Permissions** screen.
- **Members** page for the team roster and invites; **Share board** modal.

### 5.15 Other
- **Global search** across boards and leads.
- **Notifications** — in-app notification feed.
- **Activity log** — org-wide and per-item history.
- **Comments** on records.
- **Onboarding** flow to seed a new company's first pipeline.

---

## 6. Data models (server)

Board · TaskGroup · Task (lead/row) · Update · Comment · ActivityLog ·
Automation · AutomationRecipe · AutomationRunLog · CalendarView · SavedTableView ·
ChartWidget · Form · Submission · BoardConnection · LeadConnection ·
LeadIntakePolicy · LeadIngestLog · Booking · BookingLink · BookingWorkflow ·
Campaign · EmailAccount · EmailMessage · EmailTemplate · EmailSequence ·
SequenceEnrollment · SmsConfig · SmsMessage · SmsOptOut · WhatsAppConfig ·
WhatsAppMessage · WhatsAppTemplate · WebhookEndpoint · WebhookDelivery ·
Notification · Organisation · Workspace · WorkspaceGrant · User.

---

## 7. What it deliberately is NOT

- **Not property management** — no rent collection, payments, lease-compliance,
  tenant portals, maintenance, or accounting. Those integrate later (CSV import +
  connector framework), never built in-house.
- **Not self-serve SaaS** — single-tenant, one dedicated instance per company. No
  Stripe, no plans/tiers/trials, no metering, no "Upgrade" buttons anywhere.
- **No commission/salary math** — agent *activity* shows in dashboards, but no
  compensation is computed.
- **Not full Monday parity** — no Gantt, Workload, mobile apps, or marketplace;
  only the views real-estate teams actually use.

---

## 8. Companion documents

- **[PLAN.md](PLAN.md)** — strategy, locked decisions, and the phased roadmap.
- **[FEATURES.md](FEATURES.md)** — detailed per-feature spec (what/why/how-to-use).
- **[COMPLETE.md](COMPLETE.md)** — build progress: what's done vs remaining.
