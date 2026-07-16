import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  GripVertical,
  Plus,
  X,
  ArrowDown,
  Zap,
  AlertTriangle,
  ChevronLeft,
} from 'lucide-react';
import SortableItem from '../dnd/SortableItem';
import Input from '../ui/Input';
import Button from '../ui/Button';
import ConditionTreeBuilder from './ConditionTreeBuilder';
import { ActionConfigField, FieldLabel, Toggle } from './automationFields';
import {
  catalogEntry,
  defaultConfigForType,
  validateActionList,
  ACTION_LABELS,
  FALLBACK_CATALOG,
  PHASE3_NOTE,
  columnsOfType,
  optionsForColumn,
  findColumn,
  selectStyle,
} from './automationFieldUtils';

/**
 * AutomationChainEditor — the F6.4 drag-drop chain editor.
 *
 * Renders an automation as a vertical chain: a Trigger chip → optional Condition
 * chips → Action chips. Action chips live inside a dnd-kit `<SortableContext>`
 * (reusing [SortableItem.jsx](../dnd/SortableItem.jsx)); the array order is the
 * render order, so a drag persists the new action order on save (AC3). Each chip
 * is configurable inline via the shared schema-driven [automationFields](./automationFields.jsx).
 *
 * Only the `actions[]`-shaped automations are edited here (ITEM_CREATED + the six
 * F4 event triggers — exactly what recipes clone into). SCHEDULE / GROUP_CREATED
 * automations use the classic builder.
 *
 * Props:
 *   automation — the automation being edited (already cloned/saved)
 *   board, groups, members, catalog
 *   onSave(payload) → Promise (parent persists; editor owns saving/error state)
 *   onCancel()
 *   saving (optional external flag)
 */

// F4 event-driven triggers carrying a `triggerConfig`.
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

const DATE_COMPARISONS = [
  { value: 'before', label: 'before' },
  { value: 'on', label: 'on' },
  { value: 'after', label: 'after' },
];

const CONDITION_TYPES = [
  { value: 'ITEM_IN_GROUP', label: 'item is in group' },
  { value: 'ITEM_IN_STATUS', label: 'item is in status' },
];

const TRIGGER_TITLES = {
  ITEM_CREATED: 'When an item is created',
  COLUMN_VALUE_CHANGED: 'When a column changes',
  STATUS_BECAME: 'When status becomes…',
  CHECKBOX_CHECKED: 'When a checkbox is checked',
  NUMBER_CROSSED: 'When a number crosses a threshold',
  ITEM_MOVED_TO_GROUP: 'When an item moves to a group',
  UPDATE_POSTED: 'When an update is posted',
  DATE_ARRIVED: 'When a date arrives',
  PERSON_ASSIGNED: 'When a person is assigned',
  FORM_SUBMITTED: 'When a form is submitted',
  WEBHOOK_RECEIVED: 'When a webhook is received',
};

const newActionKey = () => `act_${Math.random().toString(36).slice(2, 10)}`;

const idOf = (v) => (v && typeof v === 'object' ? v._id : v);

const ChipCard = ({ children, accent }) => (
  <div
    style={{
      padding: '12px 14px',
      border: `1.5px solid ${accent ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-bg-surface)',
    }}
  >
    {children}
  </div>
);

const Connector = () => (
  <div className="flex justify-center">
    <ArrowDown size={18} color="var(--color-text-muted)" aria-hidden="true" />
  </div>
);

/**
 * Inline trigger configuration for the column-bound task-event triggers. Mirrors
 * the modal's TriggerConfigForm but compact. ITEM_CREATED / dormant triggers
 * render a summary line only.
 */
const TriggerChip = ({ triggerType, tc, setTc, board, groups = [], saving }) => {
  const title = TRIGGER_TITLES[triggerType] || 'When triggered';

  let body = null;
  if (triggerType === 'COLUMN_VALUE_CHANGED') {
    const cols = (board && board.columns) || [];
    body = (
      <div>
        <FieldLabel>Column to watch</FieldLabel>
        <select value={tc.columnId || ''} disabled={saving} onChange={(e) => setTc({ columnId: e.target.value })} style={selectStyle(saving)}>
          <option value="">Any column</option>
          {(cols || []).map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  } else if (triggerType === 'STATUS_BECAME') {
    const statusCols = columnsOfType(board, 'status');
    const col = findColumn(board, tc.columnId);
    const opts = optionsForColumn(col);
    body = (
      <div className="flex flex-col gap-2">
        <div>
          <FieldLabel>Status column</FieldLabel>
          <select
            value={tc.columnId || ''}
            disabled={saving || statusCols.length === 0}
            onChange={(e) => setTc({ columnId: e.target.value, toValue: '' })}
            style={selectStyle(saving || statusCols.length === 0)}
          >
            <option value="">{statusCols.length === 0 ? '— no status columns —' : 'Select column…'}</option>
            {statusCols.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>Becomes</FieldLabel>
          <select value={tc.toValue || ''} disabled={saving || !tc.columnId} onChange={(e) => setTc({ toValue: e.target.value })} style={selectStyle(saving || !tc.columnId)}>
            <option value="">Select value…</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    );
  } else if (triggerType === 'CHECKBOX_CHECKED') {
    const checkboxCols = columnsOfType(board, 'checkbox');
    body = (
      <div>
        <FieldLabel>Checkbox column</FieldLabel>
        <select value={tc.columnId || ''} disabled={saving || checkboxCols.length === 0} onChange={(e) => setTc({ columnId: e.target.value })} style={selectStyle(saving || checkboxCols.length === 0)}>
          <option value="">{checkboxCols.length === 0 ? '— no checkbox columns —' : 'Select column…'}</option>
          {checkboxCols.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  } else if (triggerType === 'NUMBER_CROSSED') {
    const numberCols = columnsOfType(board, 'number');
    body = (
      <div className="flex flex-col gap-2">
        <div>
          <FieldLabel>Number column</FieldLabel>
          <select value={tc.columnId || ''} disabled={saving || numberCols.length === 0} onChange={(e) => setTc({ columnId: e.target.value })} style={selectStyle(saving || numberCols.length === 0)}>
            <option value="">{numberCols.length === 0 ? '— no number columns —' : 'Select column…'}</option>
            {numberCols.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Direction</FieldLabel>
            <select value={tc.direction || 'above'} disabled={saving} onChange={(e) => setTc({ direction: e.target.value })} style={selectStyle(saving)}>
              <option value="above">rises to ≥</option>
              <option value="below">falls to ≤</option>
            </select>
          </div>
          <div>
            <FieldLabel>Threshold</FieldLabel>
            <input
              type="number"
              value={tc.threshold ?? ''}
              disabled={saving}
              onChange={(e) => setTc({ threshold: e.target.value === '' ? '' : Number(e.target.value) })}
              style={{ ...selectStyle(saving), cursor: 'text' }}
            />
          </div>
        </div>
      </div>
    );
  } else if (triggerType === 'ITEM_MOVED_TO_GROUP') {
    body = (
      <div>
        <FieldLabel>Destination group</FieldLabel>
        <select value={tc.groupId || ''} disabled={saving} onChange={(e) => setTc({ groupId: e.target.value })} style={selectStyle(saving)}>
          <option value="">Any group</option>
          {(groups || []).map((g) => (
            <option key={g._id} value={g._id}>{g.name}</option>
          ))}
        </select>
      </div>
    );
  } else if (triggerType === 'UPDATE_POSTED') {
    body = (
      <div className="flex items-center gap-2" style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
        <Zap size={13} aria-hidden="true" />
        <span className="font-body" style={{ fontSize: 11 }}>Fires whenever an update is posted to the item.</span>
      </div>
    );
  } else if (triggerType === 'DATE_ARRIVED') {
    const dateCols = columnsOfType(board, 'date');
    const offset = Number.isFinite(Number(tc.offsetDays)) ? Number(tc.offsetDays) : 0;
    body = (
      <div className="flex flex-col gap-2">
        <div>
          <FieldLabel>Date column</FieldLabel>
          <select value={tc.columnId || ''} disabled={saving || dateCols.length === 0} onChange={(e) => setTc({ columnId: e.target.value })} style={selectStyle(saving || dateCols.length === 0)}>
            <option value="">{dateCols.length === 0 ? '— no date columns —' : 'Select column…'}</option>
            {dateCols.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Days offset</FieldLabel>
            <input
              type="number"
              value={Number.isFinite(offset) ? offset : ''}
              disabled={saving}
              onChange={(e) => setTc({ offsetDays: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })}
              style={{ ...selectStyle(saving), cursor: 'text' }}
            />
          </div>
          <div>
            <FieldLabel>Relative to date</FieldLabel>
            <select value={tc.comparison || 'on'} disabled={saving} onChange={(e) => setTc({ comparison: e.target.value })} style={selectStyle(saving)}>
              {DATE_COMPARISONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  } else if (triggerType === 'PERSON_ASSIGNED') {
    const personCols = columnsOfType(board, 'person');
    body = (
      <div>
        <FieldLabel>Person column</FieldLabel>
        <select value={tc.columnId || ''} disabled={saving || personCols.length === 0} onChange={(e) => setTc({ columnId: e.target.value })} style={selectStyle(saving || personCols.length === 0)}>
          <option value="">{personCols.length === 0 ? '— no person columns —' : 'Select column…'}</option>
          {personCols.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  } else if (DORMANT_TRIGGERS.includes(triggerType)) {
    body = (
      <div className="flex items-center gap-2" style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
        <Zap size={13} aria-hidden="true" />
        <span className="font-body" style={{ fontSize: 11 }}>
          This trigger fires once its feature ships. You can build the chain now.
        </span>
      </div>
    );
  }

  return (
    <ChipCard accent>
      <p className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: body ? 8 : 0 }}>
        {title}
      </p>
      {body}
    </ChipCard>
  );
};

/**
 * One condition chip (type + value selects). Value options switch between groups
 * and statuses based on the chosen type.
 */
const ConditionChip = ({ condition, onChange, onRemove, groups, statuses, saving }) => {
  const valueOptions =
    condition.type === 'ITEM_IN_STATUS'
      ? (statuses || []).map((s) => ({ value: s._id, label: s.name }))
      : (groups || []).map((g) => ({ value: g._id, label: g.name }));
  return (
    <div className="flex items-center gap-2" style={{ padding: '8px 10px', border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-input)' }}>
      <select value={condition.type} disabled={saving} onChange={(e) => onChange({ type: e.target.value, value: '' })} style={{ ...selectStyle(saving), height: 30, flex: 1 }}>
        {CONDITION_TYPES.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select value={condition.value || ''} disabled={saving || valueOptions.length === 0} onChange={(e) => onChange({ ...condition, value: e.target.value })} style={{ ...selectStyle(saving), height: 30, flex: 1 }}>
        <option value="">{valueOptions.length === 0 ? '— none —' : 'Select…'}</option>
        {valueOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button type="button" aria-label="Remove condition" onClick={onRemove} disabled={saving} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 26, height: 26, border: '1.5px solid var(--color-border)', background: 'transparent', cursor: saving ? 'not-allowed' : 'pointer' }}>
        <X size={11} color="var(--color-text-secondary)" />
      </button>
    </div>
  );
};

/**
 * A draggable action chip. The grip handle (left) is the only drag activator so
 * the inner form controls stay interactive.
 */
const ActionChip = ({ action, index, onChange, onRemove, catalog, board, groups, members, saving }) => {
  const types = catalog && catalog.length ? catalog : FALLBACK_CATALOG;
  const entry = catalogEntry(catalog, action.type);
  const fields = entry?.configSchema?.fields || [];
  const isDisabledAction = !!entry?.disabled;

  const patch = (key, value) => {
    const nextConfig = { ...(action.config || {}), [key]: value };
    if (action.type === 'SET_COLUMN_VALUE' && key === 'columnId') nextConfig.value = '';
    onChange({ ...action, config: nextConfig });
  };
  const changeType = (newType) =>
    onChange({ ...action, type: newType, config: defaultConfigForType(catalog, newType, groups) });

  return (
    <SortableItem id={action.id} disabled={saving} data={{ type: 'action' }}>
      {({ ref, setActivatorNodeRef, style, attributes, listeners, isDragging }) => (
        <div
          ref={ref}
          style={{
            ...style,
            padding: '10px 12px',
            border: '1.5px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-input)',
            boxShadow: isDragging ? 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.18))' : 'none',
          }}
          className="flex flex-col gap-2"
          {...attributes}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...listeners}
              aria-label="Drag to reorder"
              title="Drag to reorder"
              disabled={saving}
              className="flex items-center justify-center"
              style={{ width: 22, height: 28, cursor: saving ? 'not-allowed' : 'grab', background: 'transparent', border: 'none', color: 'var(--color-text-muted)' }}
            >
              <GripVertical size={15} aria-hidden="true" />
            </button>
            <span className="font-body" style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 54 }}>
              {index === 0 ? 'Then' : 'and then'}
            </span>
            <select
              value={action.type}
              disabled={saving}
              onChange={(e) => changeType(e.target.value)}
              className="font-body"
              style={{ ...selectStyle(saving), height: 30, flex: '1 1 0' }}
            >
              {types.map((c) => (
                <option key={c.type} value={c.type}>
                  {(c.describe || ACTION_LABELS[c.type] || c.type) + (c.disabled ? ' · Phase 3' : '')}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Remove action" onClick={onRemove} disabled={saving} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 26, height: 26, border: '1.5px solid var(--color-border)', background: 'transparent', cursor: saving ? 'not-allowed' : 'pointer' }}>
              <X size={11} color="var(--color-text-secondary)" />
            </button>
          </div>

          {isDisabledAction && (
            <div className="flex items-center gap-2" style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
              <Zap size={13} aria-hidden="true" />
              <span className="font-body" style={{ fontSize: 11 }}>
                {PHASE3_NOTE}. Configure it now — it runs once the channel is connected.
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
                  disabled={saving}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </SortableItem>
  );
};

/** Strip a triggerConfig down to the fields the chosen trigger persists. */
const buildTriggerConfig = (triggerType, tc = {}) => {
  switch (triggerType) {
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
    default:
      return {};
  }
};

const AutomationChainEditor = ({
  automation,
  board,
  groups = [],
  members = [],
  catalog = [],
  onSave,
  onCancel,
}) => {
  const statuses = useMemo(
    () => (board && Array.isArray(board.statuses) ? board.statuses : []),
    [board]
  );

  const [name, setName] = useState(automation.name || '');
  const [enabled, setEnabled] = useState(automation.enabled !== false);
  const [tc, setTcState] = useState(() => ({
    offsetDays: -7,
    comparison: 'before',
    ...(automation.triggerConfig && typeof automation.triggerConfig === 'object'
      ? automation.triggerConfig
      : {}),
  }));
  const [conditions, setConditions] = useState(() =>
    (automation.conditions || []).map((c) => ({
      type: c.type,
      value: c.type === 'GROUP_NAME_MATCHES' ? String(c.value ?? '') : idOf(c.value) || '',
    }))
  );
  const [actions, setActions] = useState(() =>
    (automation.actions || []).map((act) => {
      const config = { ...(act.config || {}) };
      if (config.group) config.group = idOf(config.group);
      if (Array.isArray(config.assignedTo)) config.assignedTo = config.assignedTo.map((u) => idOf(u));
      return { id: newActionKey(), type: act.type, config };
    })
  );
  const [conditionTree, setConditionTree] = useState(() => automation.conditionTree || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const triggerType = automation.triggerType;
  const supportsConditions = triggerType === 'ITEM_CREATED' || NEW_EVENT_TRIGGERS.includes(triggerType);
  const isIncomplete = automation.validation === 'incomplete';

  const setTc = (patch) => setTcState((prev) => ({ ...prev, ...patch }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const actionIds = useMemo(() => actions.map((a) => a.id), [actions]);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id || saving) return;
    const oldIndex = actions.findIndex((a) => a.id === active.id);
    const newIndex = actions.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setActions((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const validate = () => {
    if (!name.trim()) return 'Automation name is required';
    if (triggerType === 'STATUS_BECAME') {
      if (!tc.columnId) return 'Choose a status column';
      if (!tc.toValue) return 'Choose the value the status should become';
    }
    if (triggerType === 'DATE_ARRIVED') {
      if (!tc.columnId) return 'Choose a date column';
      if (!Number.isInteger(Number(tc.offsetDays))) return 'Days offset must be a whole number';
    }
    if (triggerType === 'PERSON_ASSIGNED' && !tc.columnId) return 'Choose a person column';
    if (triggerType === 'CHECKBOX_CHECKED' && !tc.columnId) return 'Choose a checkbox column';
    if (triggerType === 'NUMBER_CROSSED') {
      if (!tc.columnId) return 'Choose a number column';
      if (!Number.isFinite(Number(tc.threshold))) return 'Enter a numeric threshold';
    }
    for (let i = 0; i < conditions.length; i++) {
      if (!conditions[i].value) return `Condition ${i + 1}: choose a value`;
    }
    return validateActionList(actions, catalog);
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const payload = {
      name: name.trim(),
      enabled,
      conditions: conditions.map((c) => ({ type: c.type, value: c.value })),
      conditionTree: conditionTree || null,
      actions: actions.map((a) => ({ type: a.type, config: a.config || {} })),
    };
    if (NEW_EVENT_TRIGGERS.includes(triggerType)) {
      payload.triggerConfig = buildTriggerConfig(triggerType, tc);
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to save automation. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const addCondition = () =>
    setConditions((prev) => [...prev, { type: 'ITEM_IN_GROUP', value: '' }]);
  const updateCondition = (i, next) =>
    setConditions((prev) => prev.map((c, idx) => (idx === i ? next : c)));
  const removeCondition = (i) =>
    setConditions((prev) => prev.filter((_, idx) => idx !== i));

  const addAction = () =>
    setActions((prev) => [
      ...prev,
      { id: newActionKey(), type: 'NOTIFY_PERSON', config: defaultConfigForType(catalog, 'NOTIFY_PERSON', groups) },
    ]);
  const updateAction = (i, next) =>
    setActions((prev) => prev.map((a, idx) => (idx === i ? next : a)));
  const removeAction = (i) =>
    setActions((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 self-start font-body"
        style={{ fontSize: 13, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        Back
      </button>

      {isIncomplete && (
        <div className="flex items-start gap-2" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-subtle)', border: '1.5px solid var(--color-border)' }}>
          <AlertTriangle size={15} color="var(--color-status-stuck)" aria-hidden="true" />
          <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            This automation was created from a recipe and needs finishing — bind any empty
            columns/groups and connect required channels, then save and enable it.
          </span>
        </div>
      )}

      <Input
        label="Automation Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        disabled={saving}
      />

      {/* Trigger */}
      <TriggerChip triggerType={triggerType} tc={tc} setTc={setTc} board={board} groups={groups} saving={saving} />

      {supportsConditions && (
        <>
          <Connector />
          <div className="flex flex-col gap-2">
            {conditions.map((c, i) => (
              <ConditionChip
                key={i}
                condition={c}
                onChange={(next) => updateCondition(i, next)}
                onRemove={() => removeCondition(i)}
                groups={groups}
                statuses={statuses}
                saving={saving}
              />
            ))}
            <button
              type="button"
              onClick={addCondition}
              disabled={saving}
              className="font-body inline-flex items-center gap-1 self-start"
              style={{ fontSize: 12, color: 'var(--color-accent)', background: 'transparent', border: 'none', padding: 0, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              <Plus size={12} aria-hidden="true" />
              Add condition
            </button>
          </div>
          <ConditionTreeBuilder board={board} tree={conditionTree} onChange={setConditionTree} />
        </>
      )}

      <Connector />

      {/* Actions — drag-drop sortable chain */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={actionIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {actions.map((a, i) => (
              <ActionChip
                key={a.id}
                action={a}
                index={i}
                onChange={(next) => updateAction(i, next)}
                onRemove={() => removeAction(i)}
                catalog={catalog}
                board={board}
                groups={groups}
                members={members}
                saving={saving}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={addAction}
        disabled={saving}
        className="font-body inline-flex items-center gap-1 self-start"
        style={{ fontSize: 13, color: 'var(--color-accent)', background: 'transparent', border: 'none', padding: '4px 0', cursor: saving ? 'not-allowed' : 'pointer' }}
      >
        <Plus size={14} aria-hidden="true" />
        Add action
      </button>

      <Toggle checked={enabled} onChange={setEnabled} disabled={saving} label="Enabled" />

      {error && (
        <p className="text-xs font-body" style={{ color: 'var(--color-status-stuck)' }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default AutomationChainEditor;
