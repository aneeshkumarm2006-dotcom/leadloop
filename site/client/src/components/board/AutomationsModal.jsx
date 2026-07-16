import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  ChevronLeft,
  Zap,
  X,
  ArrowDown,
  History,
} from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import AssigneePicker from './AssigneePicker';
import AutomationRunLog from './AutomationRunLog';
import TemplateVariableMenu from './TemplateVariableMenu';
import { WhatsAppTemplateField } from './automationFields';
import ConditionTreeBuilder from './ConditionTreeBuilder';
import * as automationService from '../../services/automationService';

const TRIGGER_OPTIONS = [
  { value: 'SCHEDULE', label: 'On a schedule' },
  { value: 'ITEM_CREATED', label: 'When an item is created' },
  { value: 'GROUP_CREATED', label: 'When a group is created' },
  { value: 'COLUMN_VALUE_CHANGED', label: 'When a column changes' },
  { value: 'STATUS_BECAME', label: 'When status becomes…' },
  { value: 'CHECKBOX_CHECKED', label: 'When a checkbox is checked' },
  { value: 'NUMBER_CROSSED', label: 'When a number crosses a threshold' },
  { value: 'ITEM_MOVED_TO_GROUP', label: 'When an item moves to a group' },
  { value: 'UPDATE_POSTED', label: 'When an update is posted' },
  { value: 'DATE_ARRIVED', label: 'When a date arrives' },
  { value: 'PERSON_ASSIGNED', label: 'When a person is assigned' },
  { value: 'FORM_SUBMITTED', label: 'When a form is submitted' },
  { value: 'WEBHOOK_RECEIVED', label: 'When a webhook is received' },
];

// F4 event-driven triggers carrying a `triggerConfig`. Task-event triggers fire
// off live column events; dormant triggers persist now but only fire once their
// emitters ship (FORM_SUBMITTED → F13, WEBHOOK_RECEIVED → F7).
const TASK_EVENT_TRIGGERS = [
  'COLUMN_VALUE_CHANGED',
  'STATUS_BECAME',
  'CHECKBOX_CHECKED',
  'NUMBER_CROSSED',
  'ITEM_MOVED_TO_GROUP',
  'UPDATE_POSTED',
  'DATE_ARRIVED',
  'PERSON_ASSIGNED',
];
const DORMANT_TRIGGERS = ['FORM_SUBMITTED', 'WEBHOOK_RECEIVED'];
const NEW_EVENT_TRIGGERS = [...TASK_EVENT_TRIGGERS, ...DORMANT_TRIGGERS];

const DORMANT_TRIGGER_NOTE = {
  FORM_SUBMITTED: 'Available after Phase 4 (public forms)',
  WEBHOOK_RECEIVED: 'Available after Phase 3 (inbound webhooks)',
};

const DATE_COMPARISONS = [
  { value: 'before', label: 'before' },
  { value: 'on', label: 'on' },
  { value: 'after', label: 'after' },
];

// ----- Flexible-column helpers (F1 board.columns) --------------------------
const boardColumns = (board) =>
  board && Array.isArray(board.columns) ? board.columns : [];

const columnsOfType = (board, type) =>
  boardColumns(board).filter((c) => c.type === type);

const optionsForColumn = (col) =>
  (col?.settings?.options || [])
    .filter((o) => o && o.id != null)
    .map((o) => ({ value: o.id.toString(), label: o.label || o.id.toString() }));

const findColumn = (board, columnId) =>
  boardColumns(board).find((c) => c._id?.toString() === (columnId || '').toString()) ||
  null;

const CONDITION_TYPES = [
  { value: 'ITEM_IN_GROUP', label: 'item is in group' },
  { value: 'ITEM_IN_STATUS', label: 'item is in status' },
];

// Human labels for every F5 action type (the catalog returns only `type`).
const ACTION_LABELS = {
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

const PHASE3_NOTE = 'Available after Phase 3';

// Fallback catalog so the action picker still offers the two always-available
// actions before `GET /api/automations/action-catalog` resolves.
const FALLBACK_CATALOG = [
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

const catalogEntry = (catalog, type) =>
  (catalog && catalog.length ? catalog : FALLBACK_CATALOG).find((c) => c.type === type) ||
  FALLBACK_CATALOG.find((c) => c.type === type) ||
  null;

const fieldsForType = (catalog, type) => catalogEntry(catalog, type)?.configSchema?.fields || [];

/**
 * Seed a fresh `config` object for a newly-chosen action type from its schema
 * defaults (priority → medium, group → first group, booleans → false, …).
 */
const defaultConfigForType = (catalog, type, groups) => {
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
 * error string or null. Falls back to the legacy name/group checks for the two
 * core actions when the catalog hasn't loaded.
 */
const validateActionList = (actions, catalog) => {
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

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const WEEKDAY_CHIPS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const getTimezoneList = () => {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    // fall through
  }
  return null;
};

const describeSchedule = (s) => {
  if (!s) return '';
  const hh = String(s.hour ?? 9).padStart(2, '0');
  const tz = s.timezone && s.timezone !== 'UTC' ? ` (${s.timezone})` : '';
  if (s.frequency === 'daily') return `Daily at ${hh}:00${tz}`;
  if (s.frequency === 'weekly') {
    const days = (s.daysOfWeek || []).slice().sort();
    const labels = days.map((d) => WEEKDAY_SHORT[d]).join(', ');
    return `Weekly · ${labels || '—'} at ${hh}:00${tz}`;
  }
  if (s.frequency === 'monthly') {
    if (s.useLastDayOfMonth) {
      return `Monthly · last day at ${hh}:00${tz}`;
    }
    return `Monthly · day ${s.dayOfMonth} at ${hh}:00${tz}`;
  }
  return '';
};

const describeTemplate = (t) => {
  if (!t) return '';
  const groupName = t.group?.name || '—';
  const due =
    Number.isFinite(t.dueInDays) && t.dueInDays !== null
      ? `, due in ${t.dueInDays} day${t.dueInDays === 1 ? '' : 's'}`
      : '';
  return `→ "${t.name}" in ${groupName}${due}`;
};

/**
 * Lookup a group's name by id from the cached groups list. Conditions store
 * raw ObjectIds, so describing them requires the board's group catalog.
 */
const lookupName = (list, id, key = 'name') => {
  if (!id || !Array.isArray(list)) return '—';
  const target = id.toString();
  const found = list.find((it) => (it?._id || '').toString() === target);
  return found?.[key] || '—';
};

/**
 * One-line summary of an ITEM_CREATED automation, e.g.
 * "When item created in [Onboarding] → create 6 subitems".
 */
const describeEventDriven = (automation, groups = [], statuses = []) => {
  const conds = Array.isArray(automation.conditions) ? automation.conditions : [];
  const actions = Array.isArray(automation.actions) ? automation.actions : [];

  let when = 'When an item is created';
  if (conds.length > 0) {
    const parts = conds.map((c) => {
      if (c.type === 'ITEM_IN_GROUP') {
        return `group ${lookupName(groups, c.value)}`;
      }
      if (c.type === 'ITEM_IN_STATUS') {
        return `status ${lookupName(statuses, c.value)}`;
      }
      return '';
    }).filter(Boolean);
    if (parts.length > 0) when += ` in ${parts.join(' & ')}`;
  }

  if (actions.length === 0) return `${when} → (no actions)`;
  return `${when} → ${describeActionCount(automation)}`;
};

/**
 * One-line summary of a GROUP_CREATED automation, e.g.
 * "When a group is created matching \"^Deux\" → create 3 tasks".
 */
const describeGroupCreated = (automation) => {
  const conds = Array.isArray(automation.conditions) ? automation.conditions : [];
  const pattern = conds.find((c) => c.type === 'GROUP_NAME_MATCHES')?.value;
  const templates = Array.isArray(automation.groupCreatedTaskTemplates)
    ? automation.groupCreatedTaskTemplates
    : [];

  let when = 'When a group is created';
  if (pattern) when += ` matching "${pattern}"`;

  if (templates.length === 0) return `${when} → (no tasks)`;
  return `${when} → create ${templates.length} task${templates.length === 1 ? '' : 's'}`;
};

/**
 * Count the actions of an automation as a short phrase, e.g.
 * "create a subitem ×2 & set a column value".
 */
const describeActionCount = (automation) => {
  const actions = Array.isArray(automation.actions) ? automation.actions : [];
  if (actions.length === 0) return '(no actions)';
  const counts = {};
  for (const a of actions) counts[a.type] = (counts[a.type] || 0) + 1;
  return Object.entries(counts)
    .map(([t, n]) => `${(ACTION_LABELS[t] || t).toLowerCase()}${n > 1 ? ` ×${n}` : ''}`)
    .join(' & ');
};

/**
 * One-line summary for the six F4 event-driven triggers, e.g.
 * "When status becomes \"Viewing Scheduled\" → create 1 task".
 */
const describeNewTrigger = (automation, board) => {
  const cfg = automation.triggerConfig || {};
  const col = findColumn(board, cfg.columnId);
  const colName = col?.name || 'a column';
  let when = '';
  switch (automation.triggerType) {
    case 'COLUMN_VALUE_CHANGED':
      when = cfg.columnId ? `When ${colName} changes` : 'When any column changes';
      break;
    case 'STATUS_BECAME': {
      const opt = optionsForColumn(col).find((o) => o.value === (cfg.toValue || '').toString());
      when = `When ${colName} becomes "${opt?.label || cfg.toValue || '—'}"`;
      break;
    }
    case 'CHECKBOX_CHECKED':
      when = `When ${colName} is checked`;
      break;
    case 'NUMBER_CROSSED':
      when = `When ${colName} ${cfg.direction === 'below' ? 'falls to' : 'rises to'} ${cfg.threshold ?? '—'}`;
      break;
    case 'ITEM_MOVED_TO_GROUP':
      when = cfg.groupId ? 'When an item moves to a group' : 'When an item moves to any group';
      break;
    case 'UPDATE_POSTED':
      when = 'When an update is posted';
      break;
    case 'DATE_ARRIVED': {
      const n = Number(cfg.offsetDays || 0);
      const rel =
        n === 0 ? 'on the day' : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'}`;
      when = `When ${colName} arrives (${rel})`;
      break;
    }
    case 'PERSON_ASSIGNED':
      when = `When a person is assigned to ${colName}`;
      break;
    case 'FORM_SUBMITTED':
      when = 'When a form is submitted';
      break;
    case 'WEBHOOK_RECEIVED':
      when = 'When a webhook is received';
      break;
    default:
      when = 'When triggered';
  }
  return `${when} → ${describeActionCount(automation)}`;
};

/**
 * Top-level describe — branches on triggerType. Returns the schedule string
 * for SCHEDULE automations (preserves existing UI), the event-driven
 * summary for ITEM_CREATED, the group-created summary for GROUP_CREATED, or the
 * F4 trigger summary for the six new event triggers.
 */
const describeAutomation = (automation, groups = [], statuses = [], board = null) => {
  if (automation.triggerType === 'ITEM_CREATED') {
    return describeEventDriven(automation, groups, statuses);
  }
  if (automation.triggerType === 'GROUP_CREATED') {
    return describeGroupCreated(automation);
  }
  if (NEW_EVENT_TRIGGERS.includes(automation.triggerType)) {
    return describeNewTrigger(automation, board);
  }
  return describeSchedule(automation.schedule);
};

const formatNextRun = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Stable client-only key for an action row. ActionRow wraps a stateful
// TemplateVariableMenu, so list renders must key on a stable id (not the array
// index) — otherwise deleting/reordering a row carries the menu's open/query
// state onto the wrong row. Stripped from the payload (buildActionsPayload sends
// only { type, config }).
const newActionKey = () => `act_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Blank action row. CREATE_SUBITEM is the default (matches the original
 * "create N subitems" flow). The action is stored in `{ id, type, config }`
 * shape — `config` holds the per-type fields the F5 registry validates.
 */
const buildEmptyAction = () => ({
  id: newActionKey(),
  type: 'CREATE_SUBITEM',
  config: { name: '', priority: 'medium', assignedTo: [], note: '' },
});

/**
 * Blank task-template row for the GROUP_CREATED builder. These tasks land in
 * the triggering (new) group, so there's no group selector on the row.
 */
const buildEmptyGroupCreatedTemplate = () => ({
  name: '',
  priority: 'medium',
  assignedTo: [],
  dueInDays: '',
  note: '',
});

const buildInitialForm = (groups) => ({
  name: '',
  triggerType: 'SCHEDULE',
  // SCHEDULE fields
  frequency: 'weekly',
  daysOfWeek: [1],
  dayOfMonth: 1,
  useLastDayOfMonth: false,
  hour: 9,
  timezone: getBrowserTimezone(),
  templateName: '',
  group: groups?.[0]?._id || '',
  priority: 'medium',
  assignedTo: [],
  dueInDays: '',
  note: '',
  // ITEM_CREATED fields
  conditions: [],
  // §1b.3 AND/OR condition tree (Only run if…)
  conditionTree: null,
  actions: [buildEmptyAction(groups)],
  // GROUP_CREATED fields
  groupNamePattern: '',
  groupCreatedTemplates: [buildEmptyGroupCreatedTemplate()],
  // F4 event-trigger config (COLUMN_VALUE_CHANGED / STATUS_BECAME /
  // DATE_ARRIVED / PERSON_ASSIGNED / FORM_SUBMITTED / WEBHOOK_RECEIVED)
  triggerConfig: { offsetDays: -7, comparison: 'before' },
  enabled: true,
});

const idOf = (v) => (v && typeof v === 'object' ? v._id : v);

const formFromAutomation = (a, groups) => {
  const s = a.schedule || {};
  const t = a.taskTemplate || {};
  const triggerType = a.triggerType || 'SCHEDULE';
  const groupId = idOf(t.group);

  // GROUP_NAME_MATCHES conditions store a raw string, so don't force them
  // through `idOf` — that would clobber the regex pattern.
  const conditions = (a.conditions || []).map((c) => ({
    type: c.type,
    value:
      c.type === 'GROUP_NAME_MATCHES'
        ? c.value == null
          ? ''
          : String(c.value)
        : idOf(c.value) || '',
  }));

  // Actions load in `{ type, config }` shape — config is the raw per-type object
  // the F5 registry validated. Normalise any id refs (group / assignedTo) that
  // might arrive as objects so the form selects bind to ids.
  const actions = (a.actions || []).map((act) => {
    const c = { ...(act.config || {}) };
    if (c.group) c.group = idOf(c.group);
    if (Array.isArray(c.assignedTo)) c.assignedTo = c.assignedTo.map((u) => idOf(u));
    return { id: newActionKey(), type: act.type, config: c };
  });

  const groupCreatedTemplates = (a.groupCreatedTaskTemplates || []).map((tpl) => ({
    name: tpl.name || '',
    priority: tpl.priority || 'medium',
    assignedTo: (tpl.assignedTo || []).map((u) => idOf(u)),
    dueInDays:
      Number.isFinite(tpl.dueInDays) && tpl.dueInDays !== null
        ? String(tpl.dueInDays)
        : '',
    note: tpl.note || '',
  }));

  const groupNamePattern =
    (a.conditions || []).find((c) => c.type === 'GROUP_NAME_MATCHES')?.value || '';

  return {
    name: a.name || '',
    triggerType,
    frequency: s.frequency || 'weekly',
    daysOfWeek: Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0
      ? s.daysOfWeek
      : [1],
    dayOfMonth: s.dayOfMonth || 1,
    useLastDayOfMonth: s.useLastDayOfMonth === true,
    hour: typeof s.hour === 'number' ? s.hour : 9,
    timezone: s.timezone || getBrowserTimezone(),
    templateName: t.name || '',
    group: groupId || groups?.[0]?._id || '',
    priority: t.priority || 'medium',
    assignedTo: (t.assignedTo || []).map((u) => idOf(u)),
    dueInDays:
      Number.isFinite(t.dueInDays) && t.dueInDays !== null
        ? String(t.dueInDays)
        : '',
    note: t.note || '',
    conditions,
    conditionTree: a.conditionTree || null,
    actions: actions.length > 0 ? actions : [buildEmptyAction(groups)],
    groupNamePattern: String(groupNamePattern || ''),
    groupCreatedTemplates:
      groupCreatedTemplates.length > 0
        ? groupCreatedTemplates
        : [buildEmptyGroupCreatedTemplate()],
    triggerConfig: {
      offsetDays: -7,
      comparison: 'before',
      ...(a.triggerConfig && typeof a.triggerConfig === 'object'
        ? a.triggerConfig
        : {}),
    },
    enabled: a.enabled !== false,
  };
};

const SegmentedControl = ({ options, value, onChange, disabled }) => (
  <div
    className="inline-flex"
    style={{
      border: '1.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 2,
      background: 'var(--color-bg-input)',
    }}
  >
    {options.map((opt) => {
      const selected = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className="font-body"
          style={{
            fontSize: 13,
            fontWeight: selected ? 600 : 500,
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            background: selected ? 'var(--color-accent)' : 'transparent',
            color: selected ? '#FFFFFF' : 'var(--color-text-secondary)',
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

const WeekdayChips = ({ value, onChange, disabled }) => {
  const set = new Set(value || []);
  return (
    <div className="flex flex-wrap gap-2">
      {WEEKDAY_CHIPS.map((c) => {
        const selected = set.has(c.value);
        return (
          <button
            key={c.value}
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = new Set(set);
              if (next.has(c.value)) next.delete(c.value);
              else next.add(c.value);
              onChange(Array.from(next));
            }}
            className="font-body"
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              border: selected
                ? '1.5px solid var(--color-accent)'
                : '1.5px solid var(--color-border)',
              background: selected ? 'var(--color-accent-light)' : 'transparent',
              color: selected
                ? 'var(--color-accent-text)'
                : 'var(--color-text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
};

const SelectField = ({ label, value, onChange, options, disabled, listId }) => (
  <div>
    {label && (
      <label
        className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {label}
      </label>
    )}
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      list={listId}
      className="w-full font-body"
      style={{
        height: 38,
        padding: '0 10px',
        borderRadius: 'var(--radius-md)',
        border: '1.5px solid var(--color-border)',
        background: 'var(--color-bg-input)',
        color: 'var(--color-text-primary)',
        fontSize: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

const Toggle = ({ checked, onChange, disabled, label }) => (
  <label
    className="inline-flex items-center gap-2 select-none"
    style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
  >
    <span
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 999,
        background: checked
          ? 'var(--color-accent)'
          : 'var(--color-border-strong)',
        transition: 'background 150ms ease',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#FFFFFF',
          transition: 'left 150ms ease',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </span>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only"
    />
    {label && (
      <span
        className="font-body"
        style={{ fontSize: 13, color: 'var(--color-text-primary)' }}
      >
        {label}
      </span>
    )}
  </label>
);

/**
 * One row in the conditions list of an ITEM_CREATED automation. The type
 * select picks which task field to compare; the value select shows groups
 * or statuses depending on type. Both are required — empty rows fail
 * `validateLocal`.
 */
const ConditionRow = ({
  condition,
  onChange,
  onRemove,
  groups,
  statuses,
  disabled,
}) => {
  const { t } = useTranslation();
  const valueOptions =
    condition.type === 'ITEM_IN_STATUS'
      ? (statuses || []).map((s) => ({ value: s._id, label: s.name }))
      : (groups || []).map((g) => ({ value: g._id, label: g.name }));

  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: '10px 12px',
        border: '1.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-input)',
      }}
    >
      <select
        value={condition.type}
        disabled={disabled}
        onChange={(e) => onChange({ ...condition, type: e.target.value, value: '' })}
        className="font-body"
        style={{
          height: 32,
          padding: '0 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
          flex: '1 1 0',
          minWidth: 0,
        }}
      >
        {CONDITION_TYPES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        value={condition.value || ''}
        disabled={disabled || valueOptions.length === 0}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        className="font-body"
        style={{
          height: 32,
          padding: '0 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
          flex: '1 1 0',
          minWidth: 0,
        }}
      >
        <option value="">{valueOptions.length === 0 ? t('automation.noneAvailable') : t('automation.selectPlaceholder')}</option>
        {valueOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={t('automation.removeCondition')}
        onClick={onRemove}
        disabled={disabled}
        className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]"
        style={{
          width: 28,
          height: 28,
          border: '1.5px solid var(--color-border)',
          background: 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <X size={12} color="var(--color-text-secondary)" />
      </button>
    </div>
  );
};

const smallInputStyle = (disabled) => ({
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

/**
 * SET_COLUMN_VALUE value editor — adapts to the chosen column's type (status →
 * option select, checkbox → toggle, date → date input, person → assignee
 * picker, …).
 */
const ColumnValueField = ({ board, columnId, value, onChange, members, disabled }) => {
  const { t } = useTranslation();
  const col = findColumn(board, columnId);
  if (!col) {
    return (
      <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {t('automation.chooseColumnFirst')}
      </p>
    );
  }
  if (col.type === 'status' || col.type === 'dropdown') {
    const opts = optionsForColumn(col);
    return (
      <select
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle(disabled)}
        className="font-body"
      >
        <option value="">{t('automation.selectValue')}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (col.type === 'checkbox') {
    return <Toggle checked={!!value} onChange={onChange} disabled={disabled} label={value ? t('automation.checked') : t('automation.unchecked')} />;
  }
  if (col.type === 'person') {
    return (
      <AssigneePicker
        members={members}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  if (col.type === 'number' || col.type === 'rating') {
    return (
      <input
        type="number"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={smallInputStyle(disabled)}
        className="font-body"
      />
    );
  }
  if (col.type === 'date') {
    const dateVal = typeof value === 'string' ? value.slice(0, 10) : '';
    return (
      <input
        type="date"
        value={dateVal}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={smallInputStyle(disabled)}
        className="font-body"
      />
    );
  }
  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder={t('automation.valuePlaceholder')}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={smallInputStyle(disabled)}
      className="font-body"
    />
  );
};

/**
 * Minimal key/value editor (one `key=value` per line) for the SEND_WHATSAPP
 * `variables` contract field. Parses into an object on every change.
 */
const KeyValueField = ({ value, onChange, disabled }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    Object.entries(value || {}).map(([k, v]) => `${k}=${v}`).join('\n')
  );
  const handle = (t) => {
    setText(t);
    const obj = {};
    t.split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    onChange(obj);
  };
  return (
    <textarea
      rows={2}
      value={text}
      placeholder={t('automation.keyValuePlaceholder')}
      disabled={disabled}
      onChange={(e) => handle(e.target.value)}
      style={{ ...smallInputStyle(disabled), height: 'auto', padding: 8, resize: 'vertical' }}
      className="font-body"
    />
  );
};

/**
 * Render a single action-config field from the registry's `configSchema`. The
 * field `type` drives the control; `template: true` fields use the
 * TemplateVariableMenu so `{{Column Name}}` variables can be inserted.
 */
const ActionConfigField = ({ field, config, onPatch, board, groups, members, disabled }) => {
  const { t } = useTranslation();
  const value = config[field.key];
  const set = (v) => onPatch(field.key, v);

  let control;
  switch (field.type) {
    case 'text':
      control = field.template ? (
        <TemplateVariableMenu
          value={value || ''}
          onChange={set}
          board={board}
          placeholder={field.label}
          multiline={false}
          disabled={disabled}
          style={{ height: 32, padding: '0 8px' }}
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          placeholder={field.label}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
          style={smallInputStyle(disabled)}
          className="font-body"
        />
      );
      break;
    case 'textarea':
      control = field.template ? (
        <TemplateVariableMenu value={value || ''} onChange={set} board={board} placeholder={field.label} rows={3} disabled={disabled} />
      ) : (
        <textarea
          rows={3}
          value={value || ''}
          placeholder={field.label}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
          style={{ ...smallInputStyle(disabled), height: 'auto', padding: 8, resize: 'vertical' }}
          className="font-body"
        />
      );
      break;
    case 'group':
      control = (
        <select value={value || ''} disabled={disabled} onChange={(e) => set(e.target.value)} style={selectStyle(disabled)} className="font-body">
          <option value="">{t('automation.selectGroup')}</option>
          {groups.map((g) => (
            <option key={g._id} value={g._id}>{g.name}</option>
          ))}
        </select>
      );
      break;
    case 'priority':
      control = (
        <select value={value || 'medium'} disabled={disabled} onChange={(e) => set(e.target.value)} style={selectStyle(disabled)} className="font-body">
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      );
      break;
    case 'users':
      control = (
        <AssigneePicker members={members} value={Array.isArray(value) ? value : []} onChange={set} disabled={disabled} />
      );
      break;
    case 'column': {
      const cols = field.columnType ? columnsOfType(board, field.columnType) : boardColumns(board);
      control = (
        <select value={value || ''} disabled={disabled || cols.length === 0} onChange={(e) => set(e.target.value)} style={selectStyle(disabled)} className="font-body">
          <option value="">{cols.length === 0 ? t('automation.noMatchingColumns') : t('automation.selectColumn')}</option>
          {cols.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      );
      break;
    }
    case 'columnValue':
      control = (
        <ColumnValueField board={board} columnId={config.columnId} value={value} onChange={set} members={members} disabled={disabled} />
      );
      break;
    case 'userOrColumn': {
      const personCols = columnsOfType(board, 'person');
      control = (
        <select value={value || ''} disabled={disabled} onChange={(e) => set(e.target.value)} style={selectStyle(disabled)} className="font-body">
          <option value="">{t('automation.selectRecipient')}</option>
          {(members || []).length > 0 && (
            <optgroup label={t('automation.peopleGroup')}>
              {(members || []).map((m) => (
                <option key={m._id} value={m._id}>{m.name}</option>
              ))}
            </optgroup>
          )}
          {personCols.length > 0 && (
            <optgroup label={t('automation.fromPersonColumn')}>
              {personCols.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      );
      break;
    }
    case 'boolean':
      control = <Toggle checked={!!value} onChange={set} disabled={disabled} label={field.label} />;
      break;
    case 'number':
      control = (
        <input type="number" value={value ?? ''} placeholder={field.label} disabled={disabled} onChange={(e) => set(e.target.value)} style={smallInputStyle(disabled)} className="font-body" />
      );
      break;
    case 'select':
      control = (
        <select value={value || ''} disabled={disabled} onChange={(e) => set(e.target.value)} style={selectStyle(disabled)} className="font-body">
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    case 'keyValue':
      control = <KeyValueField value={value || {}} onChange={set} disabled={disabled} />;
      break;
    case 'whatsappTemplate':
      control = <WhatsAppTemplateField board={board} value={value} onChange={set} disabled={disabled} />;
      break;
    case 'endpoint':
    default:
      control = (
        <input type="text" value={value || ''} placeholder={field.label} disabled={disabled} onChange={(e) => set(e.target.value)} style={smallInputStyle(disabled)} className="font-body" />
      );
  }

  // Boolean fields carry their own inline label.
  if (field.type === 'boolean') return <div>{control}</div>;
  return (
    <div>
      <FieldLabel>
        {field.label}
        {field.required ? ' *' : ''}
      </FieldLabel>
      {control}
    </div>
  );
};

/**
 * One action row — a type picker plus the per-type config form rendered from the
 * F5 action catalog's `configSchema`. Disabled (un-shipped-channel) actions are
 * selectable so an automation can be authored ahead of time, but show an
 * "Available after Phase 3" banner.
 */
const ActionRow = ({
  action,
  index,
  onChange,
  onRemove,
  catalog,
  board,
  groups,
  members,
  disabled,
}) => {
  const { t } = useTranslation();
  const types = (catalog && catalog.length ? catalog : FALLBACK_CATALOG);
  const entry = catalogEntry(catalog, action.type);
  const fields = entry?.configSchema?.fields || [];
  const isDisabledAction = !!entry?.disabled;

  const patch = (key, value) => {
    const nextConfig = { ...(action.config || {}), [key]: value };
    // Changing the target column invalidates a previously-picked value (the new
    // column type may be incompatible) — clear it so the value editor re-binds
    // cleanly instead of saving a stale, mismatched value.
    if (action.type === 'SET_COLUMN_VALUE' && key === 'columnId') {
      nextConfig.value = '';
    }
    onChange({ ...action, config: nextConfig });
  };

  const changeType = (newType) =>
    onChange({ ...action, type: newType, config: defaultConfigForType(catalog, newType, groups) });

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        padding: '10px 12px',
        border: '1.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-input)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="font-body"
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 60 }}
        >
          {index === 0 ? t('automation.then') : t('automation.andThen')}
        </span>
        <select
          value={action.type}
          disabled={disabled}
          onChange={(e) => changeType(e.target.value)}
          className="font-body"
          style={{
            height: 32,
            padding: '0 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--color-border)',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            fontSize: 13,
            flex: '1 1 0',
            minWidth: 0,
          }}
        >
          {types.map((c) => (
            <option key={c.type} value={c.type}>
              {(c.describe || ACTION_LABELS[c.type] || c.type) + (c.disabled ? t('automation.phase3Suffix') : '')}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={t('automation.removeAction')}
          onClick={onRemove}
          disabled={disabled}
          className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]"
          style={{
            width: 28,
            height: 28,
            border: '1.5px solid var(--color-border)',
            background: 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <X size={12} color="var(--color-text-secondary)" />
        </button>
      </div>

      {isDisabledAction && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-subtle)',
            color: 'var(--color-text-muted)',
          }}
        >
          <Zap size={13} aria-hidden="true" />
          <span className="font-body" style={{ fontSize: 11 }}>
            {t('automation.phase3ActionNote')}
          </span>
        </div>
      )}

      {fields.length > 0 && (
        <div className="flex flex-col gap-2">
          {fields.map((f) => (
            <ActionConfigField
              key={f.key}
              field={f}
              config={action.config || {}}
              onPatch={patch}
              board={board}
              groups={groups}
              members={members}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Conditions + actions builder shown when triggerType is ITEM_CREATED.
 * Renders the "When item is created" header with an optional list of
 * conditions, a downward arrow, and the stacked actions list.
 */
const EventDrivenBuilder = ({
  form,
  setForm,
  saving,
  groups,
  members,
  statuses,
  board,
  catalog,
}) => {
  const { t } = useTranslation();
  const conditions = form.conditions || [];
  const actions = form.actions || [];

  const updateCondition = (idx, next) => {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, i) => (i === idx ? next : c)),
    }));
  };
  const removeCondition = (idx) => {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.filter((_, i) => i !== idx),
    }));
  };
  const addCondition = () => {
    setForm((f) => ({
      ...f,
      conditions: [...(f.conditions || []), { type: 'ITEM_IN_GROUP', value: '' }],
    }));
  };

  const updateAction = (idx, next) => {
    setForm((f) => ({
      ...f,
      actions: f.actions.map((a, i) => (i === idx ? next : a)),
    }));
  };
  const removeAction = (idx) => {
    setForm((f) => ({
      ...f,
      actions: f.actions.filter((_, i) => i !== idx),
    }));
  };
  const addAction = () => {
    setForm((f) => ({
      ...f,
      actions: [...(f.actions || []), buildEmptyAction(groups)],
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Trigger block */}
      <div
        style={{
          padding: '12px 14px',
          border: '1.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-surface)',
        }}
      >
        <p
          className="font-body"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {t('automation.whenItemCreated')}
        </p>
        {conditions.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {conditions.map((c, i) => (
              <ConditionRow
                key={i}
                condition={c}
                onChange={(next) => updateCondition(i, next)}
                onRemove={() => removeCondition(i)}
                groups={groups}
                statuses={statuses}
                disabled={saving}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addCondition}
          disabled={saving}
          className="font-body mt-2 inline-flex items-center gap-1"
          style={{
            fontSize: 12,
            color: 'var(--color-accent)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <Plus size={12} aria-hidden="true" />
          {t('automation.addCondition')}
        </button>
      </div>

      {/* Connector arrow */}
      <div className="flex justify-center">
        <ArrowDown
          size={18}
          color="var(--color-text-muted)"
          aria-hidden="true"
        />
      </div>

      {/* Actions block */}
      <div className="flex flex-col gap-2">
        {actions.map((a, i) => (
          <ActionRow
            key={a.id || i}
            action={a}
            index={i}
            onChange={(next) => updateAction(i, next)}
            onRemove={() => removeAction(i)}
            catalog={catalog}
            board={board}
            groups={groups}
            members={members}
            disabled={saving}
          />
        ))}
        <button
          type="button"
          onClick={addAction}
          disabled={saving}
          className="font-body inline-flex items-center gap-1 self-start"
          style={{
            fontSize: 13,
            color: 'var(--color-accent)',
            background: 'transparent',
            border: 'none',
            padding: '4px 0',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {t('automation.addAction')}
        </button>
      </div>
    </div>
  );
};

/**
 * Reusable "Then …" actions list shared by the F4 event-trigger builder. Renders
 * the full F5 action catalog (CREATE_TASK / SET_COLUMN_VALUE / NOTIFY_PERSON /
 * channel contracts / …). Mirrors the actions block inside EventDrivenBuilder.
 */
const ActionsSection = ({ form, setForm, groups, board, members, catalog, saving }) => {
  const { t } = useTranslation();
  const actions = form.actions || [];
  const updateAction = (idx, next) =>
    setForm((f) => ({
      ...f,
      actions: f.actions.map((a, i) => (i === idx ? next : a)),
    }));
  const removeAction = (idx) =>
    setForm((f) => ({ ...f, actions: f.actions.filter((_, i) => i !== idx) }));
  const addAction = () =>
    setForm((f) => ({ ...f, actions: [...(f.actions || []), buildEmptyAction()] }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-center">
        <ArrowDown size={18} color="var(--color-text-muted)" aria-hidden="true" />
      </div>
      {actions.map((a, i) => (
        <ActionRow
          key={a.id || i}
          action={a}
          index={i}
          onChange={(next) => updateAction(i, next)}
          onRemove={() => removeAction(i)}
          catalog={catalog}
          board={board}
          groups={groups}
          members={members}
          disabled={saving}
        />
      ))}
      <button
        type="button"
        onClick={addAction}
        disabled={saving}
        className="font-body inline-flex items-center gap-1 self-start"
        style={{
          fontSize: 13,
          color: 'var(--color-accent)',
          background: 'transparent',
          border: 'none',
          padding: '4px 0',
          cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        <Plus size={14} aria-hidden="true" />
        {t('automation.addAction')}
      </button>
    </div>
  );
};

const selectStyle = (disabled) => ({
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

const FieldLabel = ({ children }) => (
  <label
    className="block mb-1 font-body font-medium text-xs uppercase tracking-wide"
    style={{ color: 'var(--color-text-secondary)' }}
  >
    {children}
  </label>
);

/**
 * Per-type config form for the six F4 event triggers. Reads/writes
 * `form.triggerConfig`. Column-bound triggers pull from `board.columns` (F1
 * flexible columns); dormant triggers render a greyed "Available after Phase …"
 * notice but still save (so the automation is ready when the emitter ships).
 */
const TriggerConfigForm = ({ form, setForm, board, members, groups, saving }) => {
  const { t } = useTranslation();
  const tc = form.triggerConfig || {};
  const setTc = (patch) =>
    setForm((f) => ({ ...f, triggerConfig: { ...(f.triggerConfig || {}), ...patch } }));
  const type = form.triggerType;

  const wrap = (children) => (
    <div
      style={{
        padding: '12px 14px',
        border: '1.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {children}
    </div>
  );

  if (type === 'COLUMN_VALUE_CHANGED') {
    const cols = boardColumns(board);
    return wrap(
      <div>
        <FieldLabel>{t('automation.columnToWatch')}</FieldLabel>
        <select
          value={tc.columnId || ''}
          disabled={saving}
          onChange={(e) => setTc({ columnId: e.target.value })}
          style={selectStyle(saving)}
        >
          <option value="">{t('automation.anyColumn')}</option>
          {cols.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('automation.anyColumnHint')}
        </p>
      </div>
    );
  }

  if (type === 'STATUS_BECAME') {
    const statusCols = columnsOfType(board, 'status');
    const selectedCol = findColumn(board, tc.columnId);
    const valueOptions = optionsForColumn(selectedCol);
    return wrap(
      <>
        <div>
          <FieldLabel>{t('automation.statusColumn')}</FieldLabel>
          <select
            value={tc.columnId || ''}
            disabled={saving || statusCols.length === 0}
            onChange={(e) => setTc({ columnId: e.target.value, toValue: '', fromValue: '' })}
            style={selectStyle(saving || statusCols.length === 0)}
          >
            <option value="">{statusCols.length === 0 ? t('automation.noStatusColumns') : t('automation.selectColumn')}</option>
            {statusCols.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>{t('automation.fromOptional')}</FieldLabel>
            <select
              value={tc.fromValue || ''}
              disabled={saving || !tc.columnId}
              onChange={(e) => setTc({ fromValue: e.target.value })}
              style={selectStyle(saving || !tc.columnId)}
            >
              <option value="">{t('automation.anyValue')}</option>
              {valueOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>{t('automation.becomes')}</FieldLabel>
            <select
              value={tc.toValue || ''}
              disabled={saving || !tc.columnId}
              onChange={(e) => setTc({ toValue: e.target.value })}
              style={selectStyle(saving || !tc.columnId)}
            >
              <option value="">{t('automation.selectValue')}</option>
              {valueOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </>
    );
  }

  if (type === 'CHECKBOX_CHECKED') {
    const checkboxCols = columnsOfType(board, 'checkbox');
    return wrap(
      <div>
        <FieldLabel>{t('automation.checkboxColumn')}</FieldLabel>
        <select
          value={tc.columnId || ''}
          disabled={saving || checkboxCols.length === 0}
          onChange={(e) => setTc({ columnId: e.target.value })}
          style={selectStyle(saving || checkboxCols.length === 0)}
        >
          <option value="">{checkboxCols.length === 0 ? t('automation.noCheckboxColumns') : t('automation.selectColumn')}</option>
          {checkboxCols.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('automation.checkboxCheckedHint')}
        </p>
      </div>
    );
  }

  if (type === 'NUMBER_CROSSED') {
    const numberCols = columnsOfType(board, 'number');
    return wrap(
      <>
        <div>
          <FieldLabel>{t('automation.numberColumn')}</FieldLabel>
          <select
            value={tc.columnId || ''}
            disabled={saving || numberCols.length === 0}
            onChange={(e) => setTc({ columnId: e.target.value })}
            style={selectStyle(saving || numberCols.length === 0)}
          >
            <option value="">{numberCols.length === 0 ? t('automation.noNumberColumns') : t('automation.selectColumn')}</option>
            {numberCols.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>{t('automation.direction')}</FieldLabel>
            <SegmentedControl
              options={[
                { value: 'above', label: t('automation.risesTo') },
                { value: 'below', label: t('automation.fallsTo') },
              ]}
              value={tc.direction || 'above'}
              onChange={(v) => setTc({ direction: v })}
              disabled={saving}
            />
          </div>
          <div>
            <FieldLabel>{t('automation.threshold')}</FieldLabel>
            <input
              type="number"
              value={tc.threshold ?? ''}
              disabled={saving}
              onChange={(e) => setTc({ threshold: e.target.value === '' ? '' : Number(e.target.value) })}
              style={{ ...selectStyle(saving), cursor: 'text' }}
            />
          </div>
        </div>
        <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('automation.numberCrossedHint')}
        </p>
      </>
    );
  }

  if (type === 'ITEM_MOVED_TO_GROUP') {
    return wrap(
      <div>
        <FieldLabel>{t('automation.destinationGroup')}</FieldLabel>
        <select
          value={tc.groupId || ''}
          disabled={saving}
          onChange={(e) => setTc({ groupId: e.target.value })}
          style={selectStyle(saving)}
        >
          <option value="">{t('automation.anyGroup')}</option>
          {(groups || []).map((g) => (
            <option key={g._id} value={g._id}>
              {g.name}
            </option>
          ))}
        </select>
        <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('automation.movedToGroupHint')}
        </p>
      </div>
    );
  }

  if (type === 'UPDATE_POSTED') {
    return wrap(
      <div
        className="flex items-center gap-2"
        style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}
      >
        <Zap size={14} aria-hidden="true" />
        <span className="font-body" style={{ fontSize: 12 }}>
          {t('automation.updatePostedHint')}
        </span>
      </div>
    );
  }

  if (type === 'DATE_ARRIVED') {
    const dateCols = columnsOfType(board, 'date');
    const offset = Number.isFinite(Number(tc.offsetDays)) ? Number(tc.offsetDays) : 0;
    return wrap(
      <>
        <div>
          <FieldLabel>{t('automation.dateColumn')}</FieldLabel>
          <select
            value={tc.columnId || ''}
            disabled={saving || dateCols.length === 0}
            onChange={(e) => setTc({ columnId: e.target.value })}
            style={selectStyle(saving || dateCols.length === 0)}
          >
            <option value="">{dateCols.length === 0 ? t('automation.noDateColumns') : t('automation.selectColumn')}</option>
            {dateCols.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>{t('automation.daysOffset')}</FieldLabel>
            <input
              type="number"
              value={Number.isFinite(offset) ? offset : ''}
              disabled={saving}
              onChange={(e) =>
                setTc({ offsetDays: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
              }
              style={{ ...selectStyle(saving), cursor: 'text' }}
            />
          </div>
          <div>
            <FieldLabel>{t('automation.relativeToDate')}</FieldLabel>
            <SegmentedControl
              options={DATE_COMPARISONS}
              value={tc.comparison || 'on'}
              onChange={(v) => setTc({ comparison: v })}
              disabled={saving}
            />
          </div>
        </div>
        <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('automation.dateArrivedHint')}
        </p>
      </>
    );
  }

  if (type === 'PERSON_ASSIGNED') {
    const personCols = columnsOfType(board, 'person');
    return wrap(
      <>
        <div>
          <FieldLabel>{t('automation.personColumn')}</FieldLabel>
          <select
            value={tc.columnId || ''}
            disabled={saving || personCols.length === 0}
            onChange={(e) => setTc({ columnId: e.target.value })}
            style={selectStyle(saving || personCols.length === 0)}
          >
            <option value="">{personCols.length === 0 ? t('automation.noPersonColumns') : t('automation.selectColumn')}</option>
            {personCols.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>{t('automation.specificUserOptional')}</FieldLabel>
          <select
            value={tc.userId || ''}
            disabled={saving}
            onChange={(e) => setTc({ userId: e.target.value })}
            style={selectStyle(saving)}
          >
            <option value="">{t('automation.anyUser')}</option>
            {(members || []).map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </>
    );
  }

  // Dormant triggers — FORM_SUBMITTED / WEBHOOK_RECEIVED.
  const idKey = type === 'FORM_SUBMITTED' ? 'formId' : 'endpointId';
  const idLabel = type === 'FORM_SUBMITTED' ? t('automation.formLabel') : t('automation.endpointLabel');
  return wrap(
    <>
      <div
        className="flex items-center gap-2"
        style={{
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-subtle)',
          color: 'var(--color-text-muted)',
        }}
      >
        <Zap size={14} aria-hidden="true" />
        <span className="font-body" style={{ fontSize: 12 }}>
          {t('automation.dormantTriggerNote', { note: DORMANT_TRIGGER_NOTE[type] })}
        </span>
      </div>
      <div>
        <FieldLabel>{t('automation.idOptional', { label: idLabel })}</FieldLabel>
        <input
          type="text"
          value={tc[idKey] || ''}
          disabled
          placeholder={t('automation.idAvailableLater', { label: idLabel.toLowerCase() })}
          style={{ ...selectStyle(true), cursor: 'not-allowed' }}
        />
      </div>
    </>
  );
};

/**
 * Builder shown for the six F4 event triggers: a per-type trigger-config form
 * followed by the shared "Then …" actions list.
 */
const EventTriggerBuilder = ({ form, setForm, board, members, groups, catalog, saving }) => (
  <div className="flex flex-col gap-3">
    <TriggerConfigForm
      form={form}
      setForm={setForm}
      board={board}
      members={members}
      groups={groups}
      saving={saving}
    />
    <ConditionTreeBuilder
      board={board}
      tree={form.conditionTree}
      onChange={(tree) => setForm((f) => ({ ...f, conditionTree: tree }))}
    />
    <ActionsSection
      form={form}
      setForm={setForm}
      groups={groups}
      board={board}
      members={members}
      catalog={catalog}
      saving={saving}
    />
  </div>
);

/**
 * One task-template row in the GROUP_CREATED builder. Unlike ITEM_CREATED
 * actions, there's no group selector — the spawned task always lands in the
 * newly-created triggering group.
 */
const GroupCreatedTemplateRow = ({
  template,
  index,
  onChange,
  onRemove,
  members,
  disabled,
}) => {
  const { t } = useTranslation();
  return (
  <div
    className="flex flex-col gap-2"
    style={{
      padding: '10px 12px',
      border: '1.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-bg-input)',
    }}
  >
    <div className="flex items-center gap-2">
      <span
        className="font-body"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          minWidth: 60,
        }}
      >
        {index === 0 ? t('automation.taskWord') : t('automation.taskNumbered', { index: index + 1 })}
      </span>
      <input
        type="text"
        placeholder={t('automation.taskNamePlaceholder')}
        value={template.name}
        disabled={disabled}
        onChange={(e) => onChange({ ...template, name: e.target.value })}
        className="font-body"
        style={{
          height: 32,
          padding: '0 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
          flex: '1 1 0',
          minWidth: 0,
        }}
      />
      <button
        type="button"
        aria-label={t('automation.removeTask')}
        onClick={onRemove}
        disabled={disabled}
        className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]"
        style={{
          width: 28,
          height: 28,
          border: '1.5px solid var(--color-border)',
          background: 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <X size={12} color="var(--color-text-secondary)" />
      </button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <select
        value={template.priority || 'medium'}
        disabled={disabled}
        onChange={(e) => onChange({ ...template, priority: e.target.value })}
        className="font-body"
        style={{
          height: 32,
          padding: '0 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
        }}
      >
        {PRIORITIES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        placeholder={t('automation.dueInDaysShort')}
        value={template.dueInDays}
        disabled={disabled}
        onChange={(e) => onChange({ ...template, dueInDays: e.target.value })}
        className="font-body"
        style={{
          height: 32,
          padding: '0 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
        }}
      />
    </div>
    <AssigneePicker
      members={members}
      value={template.assignedTo || []}
      onChange={(ids) => onChange({ ...template, assignedTo: ids })}
      disabled={disabled}
    />
    <input
      type="text"
      placeholder={t('automation.noteOptional')}
      value={template.note}
      disabled={disabled}
      onChange={(e) => onChange({ ...template, note: e.target.value })}
      className="font-body"
      style={{
        height: 32,
        padding: '0 8px',
        borderRadius: 'var(--radius-sm)',
        border: '1.5px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
        fontSize: 13,
      }}
    />
  </div>
  );
};

/**
 * Trigger + actions builder shown when triggerType is GROUP_CREATED.
 * Renders a "When a group is created" header with an optional name-pattern
 * filter, an arrow, and a stacked list of task templates that will be
 * spawned into the new group.
 */
const GroupCreatedBuilder = ({
  form,
  setForm,
  saving,
  members,
}) => {
  const { t } = useTranslation();
  const templates = form.groupCreatedTemplates || [];

  const updateTemplate = (idx, next) => {
    setForm((f) => ({
      ...f,
      groupCreatedTemplates: f.groupCreatedTemplates.map((t, i) =>
        i === idx ? next : t
      ),
    }));
  };
  const removeTemplate = (idx) => {
    setForm((f) => ({
      ...f,
      groupCreatedTemplates: f.groupCreatedTemplates.filter((_, i) => i !== idx),
    }));
  };
  const addTemplate = () => {
    setForm((f) => ({
      ...f,
      groupCreatedTemplates: [
        ...(f.groupCreatedTemplates || []),
        buildEmptyGroupCreatedTemplate(),
      ],
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Trigger block */}
      <div
        style={{
          padding: '12px 14px',
          border: '1.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-surface)',
        }}
      >
        <p
          className="font-body"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {t('automation.whenGroupCreated')}
        </p>
        <p
          className="font-body mt-2"
          style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
        >
          {t('automation.groupNameMatchHint')}
        </p>
        <input
          type="text"
          placeholder={t('automation.groupPatternPlaceholder')}
          value={form.groupNamePattern || ''}
          disabled={saving}
          onChange={(e) =>
            setForm((f) => ({ ...f, groupNamePattern: e.target.value }))
          }
          className="font-body mt-1 w-full"
          style={{
            height: 32,
            padding: '0 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--color-border)',
            background: 'var(--color-bg-input)',
            color: 'var(--color-text-primary)',
            fontSize: 13,
          }}
        />
      </div>

      {/* Connector arrow */}
      <div className="flex justify-center">
        <ArrowDown
          size={18}
          color="var(--color-text-muted)"
          aria-hidden="true"
        />
      </div>

      {/* Templates block */}
      <p
        className="font-body"
        style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
      >
        {t('automation.thenCreateTasks')}
      </p>
      <div className="flex flex-col gap-2">
        {templates.map((t, i) => (
          <GroupCreatedTemplateRow
            key={i}
            template={t}
            index={i}
            onChange={(next) => updateTemplate(i, next)}
            onRemove={() => removeTemplate(i)}
            members={members}
            disabled={saving}
          />
        ))}
        <button
          type="button"
          onClick={addTemplate}
          disabled={saving}
          className="font-body inline-flex items-center gap-1 self-start"
          style={{
            fontSize: 13,
            color: 'var(--color-accent)',
            background: 'transparent',
            border: 'none',
            padding: '4px 0',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {t('automation.addTask')}
        </button>
      </div>
    </div>
  );
};

const AutomationsModal = ({
  isOpen,
  onClose,
  boardId,
  board = null,
  groups = [],
  members = [],
  isAdmin = false,
  // When true the builder renders inline inside the page (no modal overlay) and
  // opens straight into the form — used by AutomationsPage so "New automation"
  // (and editing a classic automation) stays on the same screen instead of
  // popping a dialog.
  embedded = false,
  // In embedded mode, the automation to edit (null → create a new one).
  editAutomation = null,
}) => {
  const { t } = useTranslation();
  const boardStatuses = useMemo(
    () => (board && Array.isArray(board.statuses) ? board.statuses : []),
    [board]
  );
  const [view, setView] = useState('list');
  const [editingId, setEditingId] = useState(null);
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [form, setForm] = useState(() => buildInitialForm(groups));
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [runLogFor, setRunLogFor] = useState(null);
  // F5 action catalog (the dynamic action picker reads configSchema from here).
  const [actionCatalog, setActionCatalog] = useState([]);

  const tzList = useMemo(() => getTimezoneList(), []);

  useEffect(() => {
    if (!isOpen || !boardId) return;
    if (embedded) {
      // Embedded mode skips the inner list and opens directly in the form.
      if (editAutomation) {
        setEditingId(editAutomation._id);
        setForm(formFromAutomation(editAutomation, groups));
      } else {
        setEditingId(null);
        setForm(buildInitialForm(groups));
      }
      setFormError(null);
      setView('form');
    } else {
      setView('list');
      setEditingId(null);
    }
    setListError(null);
    setLoading(true);
    automationService
      .listAutomations(boardId)
      .then((data) => setAutomations(data || []))
      .catch((err) => {
        console.error('Failed to load automations:', err);
        setListError(
          err?.response?.data?.error ||
            t('automation.loadAutomationsError')
        );
      })
      .finally(() => setLoading(false));
  }, [isOpen, boardId]);

  useEffect(() => {
    if (!isOpen) return;
    automationService
      .getActionCatalog()
      .then((catalog) => setActionCatalog(Array.isArray(catalog) ? catalog : []))
      .catch((err) => console.error('Failed to load action catalog:', err));
  }, [isOpen]);

  const groupOptions = useMemo(
    () => groups.map((g) => ({ value: g._id, label: g.name })),
    [groups]
  );

  const hourOptions = useMemo(
    () =>
      HOURS.map((h) => ({
        value: h,
        label: `${String(h).padStart(2, '0')}:00`,
      })),
    []
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(buildInitialForm(groups));
    setFormError(null);
    setView('form');
  };

  const openEdit = (automation) => {
    setEditingId(automation._id);
    setForm(formFromAutomation(automation, groups));
    setFormError(null);
    setView('form');
  };

  const backToList = () => {
    if (saving) return;
    // Embedded mode has no inner list — leaving the form returns to the page.
    if (embedded) {
      onClose?.();
      return;
    }
    setView('list');
    setEditingId(null);
    setFormError(null);
  };

  const handleClose = () => {
    if (saving) return;
    onClose?.();
  };

  // Strip a triggerConfig down to the fields the chosen trigger persists.
  const buildTriggerConfig = () => {
    const tc = form.triggerConfig || {};
    switch (form.triggerType) {
      case 'COLUMN_VALUE_CHANGED':
        return tc.columnId ? { columnId: tc.columnId } : {};
      case 'STATUS_BECAME': {
        const out = { columnId: tc.columnId, toValue: tc.toValue };
        if (tc.fromValue) out.fromValue = tc.fromValue;
        return out;
      }
      case 'CHECKBOX_CHECKED':
        return { columnId: tc.columnId };
      case 'NUMBER_CROSSED':
        return {
          columnId: tc.columnId,
          threshold: Number(tc.threshold),
          direction: tc.direction === 'below' ? 'below' : 'above',
        };
      case 'ITEM_MOVED_TO_GROUP':
        return tc.groupId ? { groupId: tc.groupId } : {};
      case 'UPDATE_POSTED':
        return {};
      case 'DATE_ARRIVED':
        return {
          columnId: tc.columnId,
          offsetDays: Number.isFinite(Number(tc.offsetDays)) ? Number(tc.offsetDays) : 0,
          comparison: tc.comparison || 'on',
        };
      case 'PERSON_ASSIGNED': {
        const out = { columnId: tc.columnId };
        if (tc.userId) out.userId = tc.userId;
        return out;
      }
      case 'FORM_SUBMITTED':
        return tc.formId ? { formId: tc.formId } : {};
      case 'WEBHOOK_RECEIVED':
        return tc.endpointId ? { endpointId: tc.endpointId } : {};
      default:
        return {};
    }
  };

  // Actions are stored in the form already as `{ type, config }` (config carries
  // the per-type fields the registry validates), so the payload passes config
  // through verbatim — the backend registry normalises (trims, Number()s, …).
  const buildActionsPayload = () =>
    (form.actions || []).map((a) => ({ type: a.type, config: a.config || {} }));

  const buildPayload = () => {
    if (NEW_EVENT_TRIGGERS.includes(form.triggerType)) {
      return {
        name: form.name.trim(),
        enabled: form.enabled,
        triggerType: form.triggerType,
        triggerConfig: buildTriggerConfig(),
        conditions: [],
        conditionTree: form.conditionTree || null,
        actions: buildActionsPayload(),
      };
    }

    if (form.triggerType === 'GROUP_CREATED') {
      const pattern = (form.groupNamePattern || '').trim();
      const conditions = pattern
        ? [{ type: 'GROUP_NAME_MATCHES', value: pattern }]
        : [];
      const templates = (form.groupCreatedTemplates || []).map((t) => {
        const dueInDays =
          t.dueInDays === '' || t.dueInDays === null || t.dueInDays === undefined
            ? null
            : Number(t.dueInDays);
        return {
          name: t.name.trim(),
          priority: t.priority || 'medium',
          assignedTo: t.assignedTo || [],
          note: t.note?.trim() || undefined,
          dueInDays,
        };
      });
      return {
        name: form.name.trim(),
        enabled: form.enabled,
        triggerType: 'GROUP_CREATED',
        conditions,
        groupCreatedTaskTemplates: templates,
      };
    }

    if (form.triggerType === 'ITEM_CREATED') {
      return {
        name: form.name.trim(),
        enabled: form.enabled,
        triggerType: 'ITEM_CREATED',
        conditions: (form.conditions || []).map((c) => ({
          type: c.type,
          value: c.value,
        })),
        actions: buildActionsPayload(),
      };
    }

    const schedule = {
      frequency: form.frequency,
      hour: Number(form.hour),
      timezone: form.timezone || 'UTC',
    };
    if (form.frequency === 'weekly') {
      schedule.daysOfWeek = form.daysOfWeek;
    }
    if (form.frequency === 'monthly') {
      if (form.useLastDayOfMonth) {
        schedule.useLastDayOfMonth = true;
      } else {
        schedule.dayOfMonth = Number(form.dayOfMonth);
      }
    }
    const dueInDays =
      form.dueInDays === '' || form.dueInDays === null
        ? null
        : Number(form.dueInDays);
    return {
      name: form.name.trim(),
      enabled: form.enabled,
      triggerType: 'SCHEDULE',
      schedule,
      taskTemplate: {
        name: form.templateName.trim(),
        group: form.group,
        priority: form.priority,
        assignedTo: form.assignedTo,
        note: form.note.trim() || undefined,
        dueInDays,
      },
    };
  };

  const validateActions = () => validateActionList(form.actions, actionCatalog);

  const validateLocal = () => {
    if (!form.name.trim()) return t('automation.errorNameRequired');

    if (NEW_EVENT_TRIGGERS.includes(form.triggerType)) {
      const tc = form.triggerConfig || {};
      if (form.triggerType === 'STATUS_BECAME') {
        if (!tc.columnId) return t('automation.errorChooseStatusColumn');
        if (!tc.toValue) return t('automation.errorChooseStatusValue');
      }
      if (form.triggerType === 'DATE_ARRIVED') {
        if (!tc.columnId) return t('automation.errorChooseDateColumn');
        const n = Number(tc.offsetDays);
        if (!Number.isInteger(n)) return t('automation.errorOffsetWholeNumber');
      }
      if (form.triggerType === 'PERSON_ASSIGNED' && !tc.columnId) {
        return t('automation.errorChoosePersonColumn');
      }
      if (form.triggerType === 'CHECKBOX_CHECKED' && !tc.columnId) {
        return t('automation.errorChooseCheckboxColumn');
      }
      if (form.triggerType === 'NUMBER_CROSSED') {
        if (!tc.columnId) return t('automation.errorChooseNumberColumn');
        if (!Number.isFinite(Number(tc.threshold))) return t('automation.errorThresholdRequired');
      }
      // COLUMN_VALUE_CHANGED: columnId optional. FORM/WEBHOOK: no config needed.
      return validateActions();
    }

    if (form.triggerType === 'GROUP_CREATED') {
      const templates = form.groupCreatedTemplates || [];
      if (templates.length === 0) return t('automation.errorAddTaskTemplate');
      for (let i = 0; i < templates.length; i++) {
        const tpl = templates[i];
        if (!tpl.name?.trim()) return t('automation.errorTaskNameRequired', { index: i + 1 });
        if (tpl.dueInDays !== '' && tpl.dueInDays !== null && tpl.dueInDays !== undefined) {
          const n = Number(tpl.dueInDays);
          if (!Number.isFinite(n) || n < 0) {
            return t('automation.errorTaskDueNonNegative', { index: i + 1 });
          }
        }
      }
      const pattern = (form.groupNamePattern || '').trim();
      if (pattern) {
        try {
          new RegExp(pattern);
        } catch (err) {
          return t('automation.errorInvalidRegex', { error: err.message });
        }
      }
      return null;
    }

    if (form.triggerType === 'ITEM_CREATED') {
      const actionsError = validateActionList(form.actions, actionCatalog);
      if (actionsError) return actionsError;
      const conds = form.conditions || [];
      for (let i = 0; i < conds.length; i++) {
        if (!conds[i].type) return t('automation.errorConditionType', { index: i + 1 });
        if (!conds[i].value) return t('automation.errorConditionValue', { index: i + 1 });
      }
      return null;
    }

    if (!form.templateName.trim()) return t('automation.errorTaskTitleRequired');
    if (!form.group) return t('automation.errorChooseGroup');
    if (form.frequency === 'weekly' && (!form.daysOfWeek || form.daysOfWeek.length === 0)) {
      return t('automation.errorPickWeekday');
    }
    if (form.frequency === 'monthly' && !form.useLastDayOfMonth) {
      const d = Number(form.dayOfMonth);
      if (!Number.isInteger(d) || d < 1 || d > 28) {
        return t('automation.errorDayOfMonthRange');
      }
    }
    if (form.dueInDays !== '' && form.dueInDays !== null) {
      const n = Number(form.dueInDays);
      if (!Number.isFinite(n) || n < 0) {
        return t('automation.errorDueNonNegative');
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validateLocal();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = buildPayload();
      if (editingId) {
        const updated = await automationService.updateAutomation(editingId, payload);
        setAutomations((list) =>
          list.map((a) => (a._id === updated._id ? updated : a))
        );
      } else {
        const created = await automationService.createAutomation(boardId, payload);
        setAutomations((list) => [created, ...list]);
      }
      // Embedded mode closes back to the page (which reloads its own list).
      if (embedded) {
        onClose?.();
        return;
      }
      setView('list');
      setEditingId(null);
    } catch (e) {
      setFormError(
        e?.response?.data?.error || t('automation.saveAutomationError')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (automation) => {
    if (!window.confirm(t('automation.confirmDelete', { name: automation.name }))) return;
    setBusyId(automation._id);
    try {
      await automationService.deleteAutomation(automation._id);
      setAutomations((list) => list.filter((a) => a._id !== automation._id));
    } catch (e) {
      setListError(
        e?.response?.data?.error || t('automation.deleteAutomationError')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (automation, enabled) => {
    setBusyId(automation._id);
    try {
      const updated = await automationService.updateAutomation(automation._id, {
        enabled,
      });
      setAutomations((list) =>
        list.map((a) => (a._id === updated._id ? updated : a))
      );
    } catch (e) {
      setListError(
        e?.response?.data?.error || t('automation.updateAutomationError')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (automation) => {
    setBusyId(automation._id);
    try {
      const data = await automationService.runAutomationNow(automation._id);
      if (data?.automation) {
        setAutomations((list) =>
          list.map((a) => (a._id === data.automation._id ? data.automation : a))
        );
      }
    } catch (e) {
      setListError(
        e?.response?.data?.error || t('automation.runAutomationError')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNowFromForm = async () => {
    if (!editingId) return;
    setSaving(true);
    setFormError(null);
    try {
      const data = await automationService.runAutomationNow(editingId);
      if (data?.automation) {
        setAutomations((list) =>
          list.map((a) => (a._id === data.automation._id ? data.automation : a))
        );
      }
    } catch (e) {
      setFormError(
        e?.response?.data?.error || t('automation.runAutomationError')
      );
    } finally {
      setSaving(false);
    }
  };

  const renderListView = () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p
          className="font-body"
          style={{ fontSize: 13, color: 'var(--color-text-muted)' }}
        >
          {t('automation.listIntro')}
        </p>
        {isAdmin && (
          <Button variant="primary" size="sm" icon={Plus} onClick={openCreate}>
            {t('automation.newAutomation')}
          </Button>
        )}
      </div>

      {listError && (
        <p
          className="font-body text-xs"
          style={{ color: 'var(--color-status-stuck)' }}
        >
          {listError}
        </p>
      )}

      {loading ? (
        <p
          className="font-body"
          style={{ fontSize: 13, color: 'var(--color-text-muted)' }}
        >
          {t('automation.loading')}
        </p>
      ) : automations.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{ padding: '32px 16px', color: 'var(--color-text-muted)' }}
        >
          <Zap size={28} aria-hidden="true" />
          <p className="font-body mt-2" style={{ fontSize: 14 }}>
            {t('automation.noAutomationsYet')}
          </p>
          <p className="font-body" style={{ fontSize: 12 }}>
            {t('automation.noAutomationsHint')}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {automations.map((a) => {
            const isBusy = busyId === a._id;
            return (
              <li
                key={a._id}
                style={{
                  border: '1.5px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  background: a.enabled
                    ? 'var(--color-bg-surface)'
                    : 'var(--color-bg-subtle)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-display font-semibold truncate"
                        style={{
                          fontSize: 14,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {a.name}
                      </span>
                      {!a.enabled && (
                        <span
                          className="font-body"
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-full)',
                            background: 'var(--color-bg-subtle)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {t('automation.paused')}
                        </span>
                      )}
                    </div>
                    <p
                      className="font-body mt-1"
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {describeAutomation(a, groups, boardStatuses, board)}
                    </p>
                    {a.triggerType === 'SCHEDULE' && (
                      <p
                        className="font-body"
                        style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
                      >
                        {describeTemplate(a.taskTemplate)}
                      </p>
                    )}
                    <p
                      className="font-body mt-1"
                      style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
                    >
                      {a.triggerType === 'ITEM_CREATED'
                        ? a.enabled
                          ? t('automation.runsOnItemCreation')
                          : t('automation.paused')
                        : a.triggerType === 'GROUP_CREATED'
                          ? a.enabled
                            ? t('automation.runsOnGroupCreation')
                            : t('automation.paused')
                          : NEW_EVENT_TRIGGERS.includes(a.triggerType)
                            ? a.enabled
                              ? DORMANT_TRIGGERS.includes(a.triggerType)
                                ? t('automation.readyFiresOnceShips')
                                : t('automation.runsOnTrigger')
                              : t('automation.paused')
                            : t('automation.nextRun', { value: a.enabled ? formatNextRun(a.nextRunAt) : t('automation.paused') })}
                      {a.lastRunAt && ` · ${t('automation.lastRun', { value: formatNextRun(a.lastRunAt) })}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Toggle
                      checked={a.enabled}
                      disabled={isBusy}
                      onChange={(v) => handleToggle(a, v)}
                    />
                    <button
                      type="button"
                      onClick={() => handleRunNow(a)}
                      disabled={isBusy}
                      aria-label={t('automation.runNow')}
                      title={t('automation.runNow')}
                      className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
                      style={{
                        width: 30,
                        height: 30,
                        border: '1.5px solid var(--color-border)',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                      <Play size={14} color="var(--color-text-secondary)" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRunLogFor(a)}
                      disabled={isBusy}
                      aria-label={t('automation.runLog')}
                      title={t('automation.runLog')}
                      className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
                      style={{
                        width: 30,
                        height: 30,
                        border: '1.5px solid var(--color-border)',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                      <History size={14} color="var(--color-text-secondary)" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(a)}
                      disabled={isBusy}
                      aria-label={t('automation.edit')}
                      title={t('automation.edit')}
                      className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
                      style={{
                        width: 30,
                        height: 30,
                        border: '1.5px solid var(--color-border)',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                      <Pencil size={14} color="var(--color-text-secondary)" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      disabled={isBusy}
                      aria-label={t('automation.delete')}
                      title={t('automation.delete')}
                      className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
                      style={{
                        width: 30,
                        height: 30,
                        border: '1.5px solid var(--color-border)',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                      <Trash2 size={14} color="#DC2626" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const setField = (k) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: value }));
  };

  const renderFormView = () => (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <button
          type="button"
          onClick={backToList}
          disabled={saving}
          className="inline-flex items-center gap-1 self-start font-body"
          style={{
            fontSize: 13,
            color: 'var(--color-text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          {t('automation.backToList')}
        </button>
      )}

      <Input
        label={t('automation.nameLabel')}
        placeholder={t('automation.namePlaceholder')}
        value={form.name}
        onChange={setField('name')}
        required
        disabled={saving}
        autoFocus
      />

      <div>
        <label
          className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('automation.triggerLabel')}
        </label>
        <SegmentedControl
          options={TRIGGER_OPTIONS}
          value={form.triggerType}
          onChange={(v) => setForm((f) => ({ ...f, triggerType: v }))}
          disabled={saving}
        />
      </div>

      {form.triggerType === 'SCHEDULE' && (
      <div>
        <label
          className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('automation.frequencyLabel')}
        </label>
        <SegmentedControl
          options={FREQUENCIES}
          value={form.frequency}
          onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
          disabled={saving}
        />
      </div>
      )}

      {form.triggerType === 'SCHEDULE' && form.frequency === 'weekly' && (
        <div>
          <label
            className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('automation.daysOfWeekLabel')}
          </label>
          <WeekdayChips
            value={form.daysOfWeek}
            onChange={(v) => setForm((f) => ({ ...f, daysOfWeek: v }))}
            disabled={saving}
          />
        </div>
      )}

      {form.triggerType === 'SCHEDULE' && form.frequency === 'monthly' && (
        <div>
          <label
            className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('automation.dayOfMonthLabel')}
          </label>
          <select
            value={form.useLastDayOfMonth ? 'last' : String(form.dayOfMonth)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'last') {
                setForm((f) => ({ ...f, useLastDayOfMonth: true }));
              } else {
                setForm((f) => ({
                  ...f,
                  useLastDayOfMonth: false,
                  dayOfMonth: Number(v),
                }));
              }
            }}
            disabled={saving}
            className="w-full font-body"
            style={{
              height: 38,
              padding: '0 10px',
              borderRadius: 'var(--radius-md)',
              border: '1.5px solid var(--color-border)',
              background: 'var(--color-bg-input)',
              color: 'var(--color-text-primary)',
              fontSize: 14,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
            <option value="last">{t('automation.lastDayOfMonth')}</option>
          </select>
        </div>
      )}

      {form.triggerType === 'SCHEDULE' && (
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={t('automation.timeOfDayLabel')}
          value={form.hour}
          onChange={(e) =>
            setForm((f) => ({ ...f, hour: Number(e.target.value) }))
          }
          options={hourOptions}
          disabled={saving}
        />
        <div>
          <label
            className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('automation.timezoneLabel')}
          </label>
          {tzList ? (
            <select
              value={form.timezone}
              onChange={(e) =>
                setForm((f) => ({ ...f, timezone: e.target.value }))
              }
              disabled={saving}
              className="w-full font-body"
              style={{
                height: 38,
                padding: '0 10px',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid var(--color-border)',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text-primary)',
                fontSize: 14,
              }}
            >
              {tzList.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={form.timezone}
              onChange={(e) =>
                setForm((f) => ({ ...f, timezone: e.target.value }))
              }
              disabled={saving}
              placeholder={t('automation.timezonePlaceholder')}
            />
          )}
        </div>
      </div>
      )}

      {form.triggerType === 'SCHEDULE' && (
      <div
        style={{
          height: 1,
          background: 'var(--color-border)',
          margin: '4px 0',
        }}
      />
      )}

      {form.triggerType === 'SCHEDULE' && (
      <Input
        label={t('automation.taskTitleLabel')}
        placeholder={t('automation.taskTitlePlaceholder')}
        value={form.templateName}
        onChange={setField('templateName')}
        required
        disabled={saving}
      />
      )}

      {form.triggerType === 'SCHEDULE' && (
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={t('automation.groupLabel')}
          value={form.group}
          onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
          options={groupOptions.length > 0 ? groupOptions : [{ value: '', label: t('automation.noGroups') }]}
          disabled={saving || groupOptions.length === 0}
        />
        <SelectField
          label={t('automation.priorityLabel')}
          value={form.priority}
          onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
          options={PRIORITIES}
          disabled={saving}
        />
      </div>
      )}

      {form.triggerType === 'SCHEDULE' && (
      <div>
        <label
          className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('automation.assigneesLabel')}
        </label>
        <AssigneePicker
          members={members}
          value={form.assignedTo}
          onChange={(ids) => setForm((f) => ({ ...f, assignedTo: ids }))}
          disabled={saving}
        />
      </div>
      )}

      {form.triggerType === 'SCHEDULE' && (
      <Input
        label={t('automation.dueInDaysLabel')}
        type="number"
        min={0}
        placeholder={t('automation.dueInDaysPlaceholder')}
        value={form.dueInDays}
        onChange={setField('dueInDays')}
        disabled={saving}
      />
      )}

      {form.triggerType === 'SCHEDULE' && (
      <Input
        label={t('automation.noteLabel')}
        placeholder={t('automation.notePlaceholder')}
        value={form.note}
        onChange={setField('note')}
        disabled={saving}
        multiline
        rows={3}
      />
      )}

      {form.triggerType === 'ITEM_CREATED' && (
        <EventDrivenBuilder
          form={form}
          setForm={setForm}
          saving={saving}
          groups={groups}
          members={members}
          statuses={boardStatuses}
          board={board}
          catalog={actionCatalog}
        />
      )}

      {form.triggerType === 'GROUP_CREATED' && (
        <GroupCreatedBuilder
          form={form}
          setForm={setForm}
          saving={saving}
          members={members}
        />
      )}

      {NEW_EVENT_TRIGGERS.includes(form.triggerType) && (
        <EventTriggerBuilder
          form={form}
          setForm={setForm}
          board={board}
          members={members}
          groups={groups}
          catalog={actionCatalog}
          saving={saving}
        />
      )}

      <Toggle
        checked={form.enabled}
        onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
        disabled={saving}
        label={t('automation.enabled')}
      />

      {formError && (
        <p
          className="text-xs font-body"
          style={{ color: 'var(--color-status-stuck)' }}
        >
          {formError}
        </p>
      )}
    </div>
  );

  const footer = view === 'list' ? (
    <Button variant="secondary" onClick={handleClose}>
      {t('automation.close')}
    </Button>
  ) : (
    <>
      {editingId && (
        <Button
          variant="secondary"
          onClick={handleRunNowFromForm}
          disabled={saving}
        >
          {t('automation.runNow')}
        </Button>
      )}
      <Button variant="secondary" onClick={backToList} disabled={saving}>
        {t('automation.cancel')}
      </Button>
      <Button variant="primary" onClick={handleSave} disabled={saving}>
        {saving ? t('automation.saving') : editingId ? t('automation.saveChanges') : t('automation.createAutomation')}
      </Button>
    </>
  );

  // Embedded mode: render the create form inline inside the page (no overlay),
  // wrapped in a card with its own header + footer instead of a modal chrome.
  if (embedded) {
    if (!isOpen) return null;
    return (
      <>
        <div
          style={{
            border: '1.5px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-surface)',
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{
              padding: '14px 18px',
              borderBottom: '1.5px solid var(--color-border)',
            }}
          >
            <h2
              className="font-display font-semibold"
              style={{ fontSize: 16, color: 'var(--color-text-primary)' }}
            >
              {editingId ? t('automation.editAutomation') : t('automation.newAutomation')}
            </h2>
          </div>
          <div style={{ padding: '18px' }}>{renderFormView()}</div>
          <div
            className="flex items-center justify-end gap-2"
            style={{
              padding: '14px 18px',
              borderTop: '1.5px solid var(--color-border)',
            }}
          >
            {footer}
          </div>
        </div>
        <AutomationRunLog
          isOpen={!!runLogFor}
          onClose={() => setRunLogFor(null)}
          automationId={runLogFor?._id}
          automationName={runLogFor?.name}
        />
      </>
    );
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={view === 'list' ? t('automation.automationsTitle') : editingId ? t('automation.editAutomation') : t('automation.newAutomation')}
        maxWidth={620}
        footer={footer}
      >
        {view === 'list' ? renderListView() : renderFormView()}
      </Modal>
      <AutomationRunLog
        isOpen={!!runLogFor}
        onClose={() => setRunLogFor(null)}
        automationId={runLogFor?._id}
        automationName={runLogFor?.name}
      />
    </>
  );
};

export default AutomationsModal;
