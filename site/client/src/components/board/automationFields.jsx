import { useEffect, useState } from 'react';
import AssigneePicker from './AssigneePicker';
import TemplateVariableMenu from './TemplateVariableMenu';
import * as webhookService from '../../services/webhookService';
import * as whatsappService from '../../services/whatsappService';
import {
  boardColumns,
  columnsOfType,
  optionsForColumn,
  findColumn,
  PRIORITIES,
  selectStyle,
  smallInputStyle,
} from './automationFieldUtils';

/**
 * automationFields.jsx — shared, schema-driven action-config field renderers for
 * the F5/F6 automation UI (canonical home, used by AutomationChainEditor).
 *
 * Each entry the action-catalog endpoint returns carries a `configSchema.fields`
 * list; `ActionConfigField` renders one control per field `type`. `template:true`
 * fields use TemplateVariableMenu so `{{Column Name}}` variables can be inserted.
 * Pure helpers/constants live in [automationFieldUtils.js](./automationFieldUtils.js).
 *
 * NOTE: AutomationsModal currently keeps its own copies of these for the F5
 * picker; this module is the version new code builds on, and the modal migrates
 * to it when the legacy SCHEDULE/GROUP builders are folded into the chain editor.
 */

export const FieldLabel = ({ children }) => (
  <label
    className="block mb-1 font-body font-medium text-xs uppercase tracking-wide"
    style={{ color: 'var(--color-text-secondary)' }}
  >
    {children}
  </label>
);

export const Toggle = ({ checked, onChange, disabled, label }) => (
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
        background: checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
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
      <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
        {label}
      </span>
    )}
  </label>
);

/**
 * SET_COLUMN_VALUE value editor — adapts to the chosen column's type (status →
 * option select, checkbox → toggle, date → date input, person → assignee
 * picker, …).
 */
export const ColumnValueField = ({ board, columnId, value, onChange, members, disabled }) => {
  const col = findColumn(board, columnId);
  if (!col) {
    return (
      <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        Choose a column first.
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
        <option value="">Select value…</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (col.type === 'checkbox') {
    return (
      <Toggle checked={!!value} onChange={onChange} disabled={disabled} label={value ? 'Checked' : 'Unchecked'} />
    );
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
      placeholder="Value"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={smallInputStyle(disabled)}
      className="font-body"
    />
  );
};

/**
 * Minimal key/value editor (one `key=value` per line) for the SEND_WHATSAPP
 * `variables` contract field.
 */
export const KeyValueField = ({ value, onChange, disabled }) => {
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
      placeholder="key=value (one per line)"
      disabled={disabled}
      onChange={(e) => handle(e.target.value)}
      style={{ ...smallInputStyle(disabled), height: 'auto', padding: 8, resize: 'vertical' }}
      className="font-body"
    />
  );
};

/**
 * POST_WEBHOOK endpoint picker — loads the board's OUTBOUND webhook endpoints
 * (created in the Integrations tab) and renders them as a select. Falls back to
 * a free-text endpoint-id input when none exist / the load fails, so the action
 * is still configurable. Stores the endpoint `_id` on `config.endpointId`.
 */
export const EndpointField = ({ board, value, onChange, disabled }) => {
  const [endpoints, setEndpoints] = useState(null); // null = loading
  const boardId = board && board._id;

  useEffect(() => {
    let cancelled = false;
    if (!boardId) {
      setEndpoints([]);
      return undefined;
    }
    webhookService
      .listEndpoints(boardId)
      .then((list) => {
        if (!cancelled) setEndpoints((list || []).filter((e) => e.direction === 'out'));
      })
      .catch(() => {
        if (!cancelled) setEndpoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // Free-text fallback when there are no saved outbound endpoints.
  if (endpoints !== null && endpoints.length === 0) {
    return (
      <input
        type="text"
        value={value || ''}
        placeholder="Outbound endpoint id (create one in Integrations)"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={smallInputStyle(disabled)}
        className="font-body"
      />
    );
  }

  return (
    <select
      value={value || ''}
      disabled={disabled || endpoints === null}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle(disabled)}
      className="font-body"
    >
      <option value="">{endpoints === null ? 'Loading endpoints…' : 'Select endpoint…'}</option>
      {(endpoints || []).map((ep) => (
        <option key={ep._id} value={ep._id}>
          {ep.url}
        </option>
      ))}
    </select>
  );
};

/**
 * SEND_WHATSAPP template picker — loads the workspace's synced WhatsApp templates
 * and renders them as a select (Content SID stored on `config.templateId`). Falls
 * back to a free-text input when none are synced / the load fails, so the action
 * is still configurable. Mirrors EndpointField.
 */
export const WhatsAppTemplateField = ({ board, value, onChange, disabled }) => {
  const [templates, setTemplates] = useState(null); // null = loading
  const workspaceId = board?.organisation?._id || board?.organisation || null;

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setTemplates([]);
      return undefined;
    }
    whatsappService
      .listTemplates(workspaceId)
      .then((list) => {
        if (!cancelled) setTemplates(list || []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Free-text fallback when there are no synced templates.
  if (templates !== null && templates.length === 0) {
    return (
      <input
        type="text"
        value={value || ''}
        placeholder="Template Content SID (sync templates in Settings → WhatsApp)"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={smallInputStyle(disabled)}
        className="font-body"
      />
    );
  }

  return (
    <select
      value={value || ''}
      disabled={disabled || templates === null}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle(disabled)}
      className="font-body"
    >
      <option value="">{templates === null ? 'Loading templates…' : 'Select template…'}</option>
      {(templates || []).map((t) => (
        <option key={t._id} value={t.providerTemplateId} disabled={t.status !== 'approved'}>
          {(t.name || t.providerTemplateId) + (t.status !== 'approved' ? ` (${t.status})` : '')}
        </option>
      ))}
    </select>
  );
};

/**
 * Render a single action-config field from the registry's `configSchema`. The
 * field `type` drives the control; `template: true` fields use the
 * TemplateVariableMenu so `{{Column Name}}` variables can be inserted.
 */
export const ActionConfigField = ({ field, config, onPatch, board, groups, members, disabled }) => {
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
          <option value="">Select group…</option>
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
          <option value="">{cols.length === 0 ? '— no matching columns —' : 'Select column…'}</option>
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
          <option value="">Select recipient…</option>
          {(members || []).length > 0 && (
            <optgroup label="People">
              {(members || []).map((m) => (
                <option key={m._id} value={m._id}>{m.name}</option>
              ))}
            </optgroup>
          )}
          {personCols.length > 0 && (
            <optgroup label="From a person column">
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
    case 'endpoint':
      control = <EndpointField board={board} value={value} onChange={set} disabled={disabled} />;
      break;
    case 'whatsappTemplate':
      control = <WhatsAppTemplateField board={board} value={value} onChange={set} disabled={disabled} />;
      break;
    default:
      control = (
        <input type="text" value={value || ''} placeholder={field.label} disabled={disabled} onChange={(e) => set(e.target.value)} style={smallInputStyle(disabled)} className="font-body" />
      );
  }

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
