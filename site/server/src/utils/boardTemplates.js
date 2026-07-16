/**
 * boardTemplates.js — built-in board templates for the flexible-columns
 * engine (Phase 1, F1).
 *
 * Each template seeds a new board with a fixed `columns[]` array (in order),
 * the right `type` per column, and `settings.options` for any
 * `status` / `dropdown` / `tags` columns. The first column is always the
 * board's primary column (the row title).
 *
 * Column option ids (slug strings like `new`, `qualified`) are deliberately
 * human-readable so automations and reports can read them without a UI
 * round-trip.
 *
 * The list mirrors the phase doc (§F1 Target State). Stage / Property Type /
 * City / Lead Source option sets ship as the agreed-upon defaults; update
 * the seed list if Thoma changes scope (see phase-1-TODO §Pre-flight).
 */

const COLOR = {
  gray: '#6B7280',
  blue: '#2563EB',
  orange: '#D97706',
  green: '#16A34A',
  emerald: '#059669',
  red: '#DC2626',
  yellow: '#CA8A04',
  purple: '#7C3AED',
  cyan: '#0891B2',
  pink: '#DB2777',
};

const stageOptions = [
  { id: 'new', label: 'New', color: COLOR.gray, order: 0, isDefault: true },
  { id: 'contacted', label: 'Contacted', color: COLOR.blue, order: 1 },
  { id: 'qualified', label: 'Qualified', color: COLOR.cyan, order: 2 },
  { id: 'viewing_scheduled', label: 'Viewing Scheduled', color: COLOR.orange, order: 3 },
  { id: 'offer', label: 'Offer', color: COLOR.purple, order: 4 },
  { id: 'closed', label: 'Closed', color: COLOR.green, order: 5 },
  { id: 'lost', label: 'Lost', color: COLOR.red, order: 6 },
];

const propertyTypeOptions = [
  { id: 'condo', label: 'Condo', color: COLOR.blue, order: 0 },
  { id: 'house', label: 'House', color: COLOR.green, order: 1 },
  { id: 'townhouse', label: 'Townhouse', color: COLOR.orange, order: 2 },
  { id: 'land', label: 'Land', color: COLOR.emerald, order: 3 },
  { id: 'commercial', label: 'Commercial', color: COLOR.purple, order: 4 },
];

const cityOptions = [
  { id: 'edmonton', label: 'Edmonton', color: COLOR.blue, order: 0 },
  { id: 'saskatoon', label: 'Saskatoon', color: COLOR.green, order: 1 },
  { id: 'regina', label: 'Regina', color: COLOR.orange, order: 2 },
  { id: 'montreal', label: 'Montreal', color: COLOR.purple, order: 3 },
];

const leadSourceOptions = [
  { id: 'website', label: 'Website', color: COLOR.blue, order: 0 },
  { id: 'zillow', label: 'Zillow', color: COLOR.cyan, order: 1 },
  { id: 'referral', label: 'Referral', color: COLOR.green, order: 2 },
  { id: 'walk_in', label: 'Walk-in', color: COLOR.orange, order: 3 },
  { id: 'ad', label: 'Ad', color: COLOR.pink, order: 4 },
  { id: 'other', label: 'Other', color: COLOR.gray, order: 5 },
];

const priorityOptions = [
  { id: 'critical', label: 'Critical', color: COLOR.red, order: 0 },
  { id: 'high', label: 'High', color: COLOR.orange, order: 1 },
  { id: 'medium', label: 'Medium', color: COLOR.yellow, order: 2, isDefault: true },
  { id: 'low', label: 'Low', color: COLOR.gray, order: 3 },
];

// --- Leasing CRM option sets (Rakotta-style) --------------------------------

// Lead status WITHIN a pipeline stage (the stages themselves are groups).
const leadStatusOptions = [
  { id: 'new', label: 'New', color: COLOR.gray, order: 0, isDefault: true },
  { id: 'attempted', label: 'Attempted Contact', color: COLOR.yellow, order: 1 },
  { id: 'reached', label: 'Reached', color: COLOR.blue, order: 2 },
  { id: 'interested', label: 'Interested', color: COLOR.green, order: 3 },
  { id: 'not_interested', label: 'Not Interested', color: COLOR.red, order: 4 },
];

const visitTypeOptions = [
  { id: 'in_person', label: 'In-person', color: COLOR.blue, order: 0 },
  { id: 'virtual', label: 'Virtual', color: COLOR.purple, order: 1 },
  { id: 'self_guided', label: 'Self-guided', color: COLOR.cyan, order: 2 },
];

const languageOptions = [
  { id: 'fr', label: 'Français', color: COLOR.blue, order: 0 },
  { id: 'en', label: 'English', color: COLOR.green, order: 1 },
];

const availabilityOptions = [
  { id: 'available', label: 'Available', color: COLOR.green, order: 0, isDefault: true },
  { id: 'pending', label: 'Pending', color: COLOR.orange, order: 1 },
  { id: 'leased', label: 'Leased', color: COLOR.gray, order: 2 },
  { id: 'off_market', label: 'Off-market', color: COLOR.red, order: 3 },
];

// Pipeline stages = board groups (a lead moves between groups as it advances).
// Mirrors how Rakotta configures Monday (PLAN.md §3 / §1.1).
const leasingPipelineGroups = [
  'New Lead',
  'Contacted',
  'Follow-up',
  'Visit Booked',
  'Application',
  'Lease to Sign',
  'Lease Signed',
  'Blacklisted',
  'Archived',
];

const realEstateLeads = {
  id: 'real_estate_leads',
  name: 'Real Estate Leads',
  description: 'Lead pipeline for real-estate agents: contact, qualify, view, offer, close.',
  columns: [
    { key: 'lead_name',     name: 'Lead Name',     type: 'text',      isPrimary: true },
    { key: 'stage',         name: 'Stage',         type: 'status',    settings: { options: stageOptions } },
    { key: 'property_type', name: 'Property Type', type: 'dropdown',  settings: { options: propertyTypeOptions } },
    { key: 'city',          name: 'City',          type: 'dropdown',  settings: { options: cityOptions } },
    { key: 'price_range',   name: 'Price Range',   type: 'number',    settings: { min: 0 } },
    { key: 'lead_source',   name: 'Lead Source',   type: 'dropdown',  settings: { options: leadSourceOptions } },
    { key: 'agent',         name: 'Agent',         type: 'person' },
    { key: 'move_in_date',  name: 'Move-in Date',  type: 'date' },
    { key: 'phone',         name: 'Phone',         type: 'phone' },
    { key: 'email',         name: 'Email',         type: 'email' },
    { key: 'notes',         name: 'Notes',         type: 'long_text' },
    { key: 'score',         name: 'Score',         type: 'number',    settings: { min: 0, max: 100 }, readOnly: true },
  ],
};

/**
 * Real-estate CRM (leasing) — the flagship template. Pipeline stages are
 * GROUPS; each lead is an item that moves between them. Columns mirror
 * Rakotta's lead fields (building / agent / visit-type / language / dates /
 * email / phone / notes). PLAN.md §1.1.
 */
const realEstateCrm = {
  id: 'real_estate_crm',
  name: 'Real Estate CRM',
  description:
    'Leasing lead pipeline (Rakotta-style): stages as groups, with building, agent, visit-type, language and contact fields.',
  groups: leasingPipelineGroups,
  // A public intake form is auto-created with the board (PLAN.md §1.1). Field
  // keys map to the columns above; `required` marks must-fill fields. Bilingual
  // thank-you copy below (full per-field FR/EN labels are a later enhancement).
  starterForm: {
    name: 'Lead Intake',
    welcomeMessage: "Merci! Nous vous contacterons bientôt. / Thanks! We'll be in touch shortly.",
    fieldKeys: ['lead_name', 'email', 'phone', 'building', 'visit_type', 'language'],
    requiredKeys: ['lead_name'],
  },
  columns: [
    { key: 'lead_name',       name: 'Lead',           type: 'text',      isPrimary: true },
    { key: 'lead_status',     name: 'Lead Status',    type: 'status',    settings: { options: leadStatusOptions } },
    { key: 'building',        name: 'Building',       type: 'dropdown',  settings: { options: [] } },
    { key: 'agent',           name: 'Agent',          type: 'person' },
    { key: 'visit_type',      name: 'Visit Type',     type: 'status',    settings: { options: visitTypeOptions } },
    { key: 'language',        name: 'Language',       type: 'status',    settings: { options: languageOptions } },
    { key: 'inscription_date', name: 'Inscription',   type: 'date' },
    { key: 'visit_date',      name: 'Visit Date',     type: 'date' },
    { key: 'move_in_date',    name: 'Move-in Date',   type: 'date' },
    { key: 'phone',           name: 'Phone',          type: 'phone' },
    { key: 'email',           name: 'Email',          type: 'email' },
    { key: 'notes',           name: 'Notes',          type: 'long_text' },
  ],
};

/**
 * Listings / Inventory — buildings are GROUPS, units are items. Sqft/Price are
 * numbers (summable in group footers once §1.6 ships). PLAN.md §1.2.
 */
const listingsInventory = {
  id: 'listings_inventory',
  name: 'Listings / Inventory',
  description:
    'Property/unit inventory: buildings as groups, units as rows, with availability, beds/baths, sqft and price.',
  groups: ['Building A', 'Building B'],
  columns: [
    { key: 'unit_name',    name: 'Unit',          type: 'text',     isPrimary: true },
    { key: 'availability', name: 'Availability',  type: 'status',   settings: { options: availabilityOptions } },
    { key: 'bedrooms',     name: 'Bedrooms',      type: 'number',   settings: { min: 0 } },
    { key: 'bathrooms',    name: 'Bathrooms',     type: 'number',   settings: { min: 0 } },
    { key: 'sqft',         name: 'Sqft',          type: 'number',   settings: { min: 0 } },
    { key: 'price',        name: 'Price',         type: 'number',   settings: { min: 0 } },
    { key: 'floor',        name: 'Floor',         type: 'number' },
    { key: 'notes',        name: 'Notes',         type: 'long_text' },
  ],
};

const boardTemplates = [realEstateCrm, listingsInventory, realEstateLeads];

const getBoardTemplate = (id) =>
  boardTemplates.find((t) => t.id === id) || null;

/**
 * Shape a raw column spec list into the form the Board schema's `columns`
 * subdoc expects: assigns `order` by index, defaults `width`, defaults
 * missing `settings` to `{}`, and guarantees exactly one `isPrimary`
 * (the Board pre-save invariant). Returns a plain array.
 */
const shapeColumns = (cols) => {
  if (!Array.isArray(cols)) return [];
  const out = cols.map((c, i) => ({
    key: c.key,
    name: c.name,
    type: c.type,
    settings: c.settings || {},
    order: i,
    width: c.width || 160,
    isPrimary: !!c.isPrimary,
  }));
  if (out.length > 0 && !out.some((c) => c.isPrimary)) {
    out[0].isPrimary = true;
  }
  return out;
};

/**
 * Materialise a template's `columns[]` into the shape expected by the
 * Board schema's `columns` subdoc.
 *
 * Returns a plain array — caller pushes into `board.columns` and saves.
 */
const materializeTemplateColumns = (template) => {
  if (!template || !Array.isArray(template.columns)) return [];
  return shapeColumns(template.columns);
};

/**
 * Build a default `columns[]` array for a board that is being converted to
 * the flexible-columns engine (or created without a template). The columns
 * mirror the legacy fixed fields so existing task data keeps rendering.
 *
 * Column `key`s MUST match `LEGACY_COLUMN_KEY_TO_TASK_FIELD` in Task.js so
 * the pre-save sync keeps projecting values back onto the legacy fields:
 *   status, priority, assignees, due_date, tags.
 *
 * The Status and Tags option ids are set to the stringified `_id` of the
 * corresponding `board.statuses` / `board.labels` subdoc. This makes the
 * existing one-directional sync (columnValues → legacy field) a correct
 * pass-through: a status column value *is* the legacy status id.
 *
 * Status is omitted when the board has no statuses; Tags is omitted when the
 * board has no labels.
 */
const buildDefaultColumns = (board) => {
  const statuses = Array.isArray(board && board.statuses) ? board.statuses : [];
  const labels = Array.isArray(board && board.labels) ? board.labels : [];

  const cols = [
    { key: 'name', name: 'Name', type: 'text', isPrimary: true },
  ];

  if (statuses.length > 0) {
    cols.push({
      key: 'status',
      name: 'Status',
      type: 'status',
      settings: {
        options: statuses.map((s) => ({
          id: s._id.toString(),
          label: s.name,
          color: s.color,
          order: s.order,
          isDefault: !!s.isDefault,
        })),
      },
    });
  }

  cols.push({
    key: 'priority',
    name: 'Priority',
    type: 'status',
    settings: { options: priorityOptions },
  });
  cols.push({ key: 'assignees', name: 'Owner', type: 'person' });
  cols.push({ key: 'due_date', name: 'Due Date', type: 'date' });

  if (labels.length > 0) {
    cols.push({
      key: 'tags',
      name: 'Tags',
      type: 'tags',
      settings: {
        options: labels.map((l) => ({
          id: l._id.toString(),
          label: l.name,
          color: l.color,
          order: l.order,
        })),
      },
    });
  }

  return shapeColumns(cols);
};

/**
 * Materialise a template's `groups` (an array of stage names) into the shape
 * the createBoard flow needs: `[{ name, order }]` in declared order. Returns an
 * empty array when the template seeds no groups.
 */
const materializeTemplateGroups = (template) => {
  const names = Array.isArray(template && template.groups) ? template.groups : [];
  return names.map((name, order) => ({ name, order }));
};

// Map a board column type → a public form field type the builder understands.
const FORM_FIELD_TYPE = {
  text: 'text',
  long_text: 'long_text',
  email: 'email',
  phone: 'phone',
  number: 'number',
  date: 'date',
  dropdown: 'dropdown',
  status: 'dropdown',
  checkbox: 'checkbox',
};

/**
 * Build the starter public intake form (PLAN.md §1.1) for a freshly-created
 * template board. Resolves the template's `starterForm.fieldKeys` against the
 * board's real column ids and returns `{ name, welcomeMessage, fieldMap }`, or
 * null when the template defines no starter form. The caller persists it.
 */
const buildStarterForm = (template, board) => {
  const spec = template && template.starterForm;
  if (!spec || !Array.isArray(spec.fieldKeys)) return null;
  const byKey = {};
  for (const c of board.columns || []) byKey[c.key] = c;
  const required = new Set(spec.requiredKeys || []);
  const fieldMap = [];
  let i = 0;
  for (const key of spec.fieldKeys) {
    const col = byKey[key];
    if (!col) continue;
    const options = Array.isArray(col.settings && col.settings.options)
      ? col.settings.options.map((o) => o.label)
      : [];
    fieldMap.push({
      formFieldId: `f${i}`,
      label: col.name,
      type: FORM_FIELD_TYPE[col.type] || 'text',
      required: required.has(key),
      columnId: col._id.toString(),
      options,
    });
    i += 1;
  }
  if (fieldMap.length === 0) return null;
  return { name: spec.name || 'Lead Intake', welcomeMessage: spec.welcomeMessage || '', fieldMap };
};

/**
 * Columns for a brand-new, blank board: just the primary "Name" column.
 * New boards start empty so the user adds the columns they actually want
 * (Status, Priority, etc.) on the spot, rather than inheriting a preset set.
 * The primary column is mandatory (it's the row title) and cannot be deleted.
 */
const buildPrimaryOnlyColumns = () =>
  shapeColumns([{ key: 'name', name: 'Name', type: 'text', isPrimary: true }]);

module.exports = {
  boardTemplates,
  getBoardTemplate,
  shapeColumns,
  materializeTemplateColumns,
  materializeTemplateGroups,
  buildStarterForm,
  buildPrimaryOnlyColumns,
  buildDefaultColumns,
};
