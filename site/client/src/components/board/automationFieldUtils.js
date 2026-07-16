/**
 * automationFieldUtils.js — pure helpers + constants for the schema-driven
 * automation action config (F5/F6). Split out from the component renderers in
 * [automationFields.jsx](./automationFields.jsx) so that file can fast-refresh
 * cleanly (components-only export).
 */

// ----- Flexible-column helpers (F1 board.columns) --------------------------
export const boardColumns = (board) =>
  board && Array.isArray(board.columns) ? board.columns : [];

export const columnsOfType = (board, type) =>
  boardColumns(board).filter((c) => c.type === type);

export const optionsForColumn = (col) =>
  (col?.settings?.options || [])
    .filter((o) => o && o.id != null)
    .map((o) => ({ value: o.id.toString(), label: o.label || o.id.toString() }));

export const findColumn = (board, columnId) =>
  boardColumns(board).find(
    (c) => c._id?.toString() === (columnId || '').toString()
  ) || null;

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// Human labels for every F5 action type (the catalog returns only `type`).
export const ACTION_LABELS = {
  CREATE_TASK: 'Create a task',
  CREATE_SUBITEM: 'Create a subitem',
  SET_COLUMN_VALUE: 'Set a column value',
  CLEAR_COLUMN: 'Clear a column value',
  MOVE_TO_GROUP: 'Move item to group',
  DUPLICATE_ITEM: 'Duplicate this item',
  DELETE_ITEM: 'Delete this item',
  NOTIFY_PERSON: 'Notify a person',
  SEND_EMAIL: 'Send email',
  SEND_SMS: 'Send SMS',
  SEND_WHATSAPP: 'Send WhatsApp',
  CREATE_CALENDAR_EVENT: 'Create calendar event',
  POST_WEBHOOK: 'Post webhook',
  ASSIGN_LEAD_AGENT: 'Assign lead agent',
};

export const PHASE3_NOTE = 'Available after Phase 3';

// Fallback catalog so the action picker still offers the two always-available
// actions before `GET /api/automations/action-catalog` resolves.
export const FALLBACK_CATALOG = [
  {
    type: 'CREATE_SUBITEM',
    disabled: false,
    requires: null,
    configSchema: {
      fields: [
        { key: 'name', label: 'Subitem name', type: 'text', required: true, template: true },
        { key: 'priority', label: 'Priority', type: 'priority' },
        { key: 'assignedTo', label: 'Assignees', type: 'users' },
        { key: 'note', label: 'Note', type: 'textarea' },
      ],
    },
  },
  {
    type: 'CREATE_TASK',
    disabled: false,
    requires: null,
    configSchema: {
      fields: [
        { key: 'name', label: 'Task name', type: 'text', required: true, template: true },
        { key: 'group', label: 'Group', type: 'group', required: true },
        { key: 'priority', label: 'Priority', type: 'priority' },
        { key: 'assignedTo', label: 'Assignees', type: 'users' },
        { key: 'note', label: 'Note', type: 'textarea' },
      ],
    },
  },
];

export const catalogEntry = (catalog, type) =>
  (catalog && catalog.length ? catalog : FALLBACK_CATALOG).find((c) => c.type === type) ||
  FALLBACK_CATALOG.find((c) => c.type === type) ||
  null;

export const fieldsForType = (catalog, type) =>
  catalogEntry(catalog, type)?.configSchema?.fields || [];

/**
 * Seed a fresh `config` object for a newly-chosen action type from its schema
 * defaults (priority → medium, group → first group, booleans → false, …).
 */
export const defaultConfigForType = (catalog, type, groups) => {
  const cfg = {};
  for (const f of fieldsForType(catalog, type)) {
    if (f.type === 'priority') cfg[f.key] = 'medium';
    else if (f.type === 'users') cfg[f.key] = [];
    else if (f.type === 'boolean') cfg[f.key] = false;
    else if (f.type === 'group') cfg[f.key] = groups?.[0]?._id || '';
    else if (f.type === 'select') cfg[f.key] = f.options?.[0]?.value || '';
    else if (f.type === 'keyValue') cfg[f.key] = {};
    else cfg[f.key] = '';
  }
  return cfg;
};

/**
 * Schema-driven required-field validation for an actions[] list. Returns an
 * error string or null.
 */
export const validateActionList = (actions, catalog) => {
  if (!actions || actions.length === 0) return 'Add at least one action';
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const cfg = a.config || {};
    const entry = catalogEntry(catalog, a.type);
    const fields = entry?.configSchema?.fields || [];
    for (const f of fields) {
      if (!f.required) continue;
      const v = cfg[f.key];
      const empty =
        v == null || v === '' || (Array.isArray(v) && v.length === 0) ||
        (typeof v === 'string' && !v.trim());
      if (empty) return `Action ${i + 1}: ${f.label} is required`;
    }
  }
  return null;
};

// ----- Shared styles -------------------------------------------------------
export const selectStyle = (disabled) => ({
  height: 34,
  padding: '0 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  width: '100%',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

export const smallInputStyle = (disabled) => ({
  height: 32,
  padding: '0 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  width: '100%',
  cursor: disabled ? 'not-allowed' : 'text',
  opacity: disabled ? 0.6 : 1,
});
