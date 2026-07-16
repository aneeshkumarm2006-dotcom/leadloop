import { useTranslation } from 'react-i18next';
import { Plus, X, FolderPlus } from 'lucide-react';
import {
  OPERATORS_BY_TYPE,
  OP_INPUT,
  advancedFilterableColumns,
  optionsForColumn,
} from '../../utils/columnFilter';
import { getColorPair } from '../../utils/priorityColors';
import Dropdown from '../ui/Dropdown';
import DatePickerPopover from '../ui/DatePickerPopover';

/**
 * AdvancedFilterPanel — Monday-style filter builder (Phase 1.5). Edits a
 * recursive tree `{ conjunction, rules: [condition | group] }` where a condition
 * is `{ columnId, op, value }`. Conditions/groups in a group combine by the
 * group's AND/OR; groups can nest via "+ New group".
 */

let _nid = 0;
const nid = () => `n${(_nid += 1)}`;

const firstOpFor = (col) => {
  const ops = col ? OPERATORS_BY_TYPE[col.type] || [] : [];
  return ops[0] || '';
};
const newCondition = (cols) => {
  const col = cols[0];
  return { id: nid(), columnId: col?._id?.toString() || '', op: firstOpFor(col), value: null };
};
const newGroup = () => ({ id: nid(), conjunction: 'and', rules: [] });

// --- Immutable tree edits by path (array of indices into nested `rules`) -----
export const updateNode = (root, path, fn) => {
  if (path.length === 0) return fn(root);
  const [i, ...rest] = path;
  const rules = root.rules.slice();
  rules[i] = updateNode(rules[i], rest, fn);
  return { ...root, rules };
};
export const removeNode = (root, path) => {
  const [i, ...rest] = path;
  const rules = root.rules.slice();
  if (rest.length === 0) rules.splice(i, 1);
  else rules[i] = removeNode(rules[i], rest);
  return { ...root, rules };
};
const isGroup = (n) => n && Array.isArray(n.rules);

const inputStyle = {
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-surface, #FFFFFF)',
  color: 'var(--color-text-primary)',
};

const ValueEditor = ({ column, cond, allTasks, onChange, optionLabels }) => {
  const { t } = useTranslation();
  const kind = OP_INPUT[cond.op] || 'text';
  if (kind === 'none') return null;

  if (kind === 'options') {
    const opts = optionsForColumn(column, allTasks, optionLabels);
    const sel = Array.isArray(cond.value) ? cond.value : [];
    const toggle = (id) =>
      onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    return (
      <div className="flex items-center gap-1.5 flex-wrap" style={{ maxWidth: 320 }}>
        {opts.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('boardMisc.noOptions')}</span>
        ) : (
          opts.map((opt) => {
            const on = sel.includes(opt.id);
            const pair = opt.color ? getColorPair(opt.color) : null;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggle(opt.id)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  border: on ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)',
                  background: pair ? pair.bg : on ? 'var(--color-accent-light)' : 'var(--color-bg-subtle)',
                  color: pair ? pair.text : on ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
                  opacity: on ? 1 : 0.7,
                }}
              >
                {opt.label}
              </button>
            );
          })
        )}
      </div>
    );
  }

  if (kind === 'range') {
    const isDate = column?.type === 'date' || column?.type === 'timeline';
    const arr = Array.isArray(cond.value) ? cond.value : ['', ''];
    const set = (i, v) => {
      const next = [arr[0] ?? '', arr[1] ?? ''];
      next[i] = v;
      onChange(next);
    };
    return (
      <div className="flex items-center gap-1.5">
        {isDate ? (
          <DatePickerPopover value={arr[0] ?? ''} onChange={(v) => set(0, v)} />
        ) : (
          <input type="number" value={arr[0] ?? ''} onChange={(e) => set(0, e.target.value)} style={{ ...inputStyle, width: 90 }} />
        )}
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>–</span>
        {isDate ? (
          <DatePickerPopover value={arr[1] ?? ''} onChange={(v) => set(1, v)} />
        ) : (
          <input type="number" value={arr[1] ?? ''} onChange={(e) => set(1, e.target.value)} style={{ ...inputStyle, width: 90 }} />
        )}
      </div>
    );
  }

  if (kind === 'date') {
    return <DatePickerPopover value={cond.value || ''} onChange={(v) => onChange(v)} />;
  }

  // single text / number
  const isNum = column?.type === 'number' || column?.type === 'rating';
  return (
    <input
      type={isNum ? 'number' : 'text'}
      value={cond.value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('filter.value')}
      style={{ ...inputStyle, width: 180 }}
    />
  );
};

const ConditionRow = ({ cond, cols, allTasks, onUpdate, onRemove, optionLabels }) => {
  const { t } = useTranslation();
  const column = cols.find((c) => c._id?.toString() === cond.columnId) || null;
  const ops = column ? OPERATORS_BY_TYPE[column.type] || [] : [];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div style={{ minWidth: 150 }}>
        <Dropdown
          size="sm"
          options={cols.map((c) => ({ value: c._id?.toString(), label: c.name }))}
          value={cond.columnId}
          placeholder={t('filter.column')}
          onChange={(v) => {
            const nextCol = cols.find((c) => c._id?.toString() === v) || null;
            onUpdate({ columnId: v, op: firstOpFor(nextCol), value: null });
          }}
        />
      </div>

      <div style={{ minWidth: 130 }}>
        <Dropdown
          size="sm"
          options={ops.map((op) => ({ value: op, label: t(`filter.op.${op}`) }))}
          value={cond.op}
          placeholder={t('filter.condition')}
          onChange={(v) => onUpdate({ op: v, value: null })}
        />
      </div>

      <ValueEditor
        column={column}
        cond={cond}
        allTasks={allTasks}
        optionLabels={optionLabels}
        onChange={(value) => onUpdate({ value })}
      />

      <button
        type="button"
        onClick={onRemove}
        aria-label={t('filter.removeCondition')}
        className="flex items-center justify-center rounded transition-colors hover:bg-[color:var(--color-bg-subtle)]"
        style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}
      >
        <X size={14} />
      </button>
    </div>
  );
};

export const GroupEditor = ({ group, path, depth, cols, allTasks, optionLabels, onUpdate, onRemove, onAdd }) => {
  const { t } = useTranslation();
  const rules = group.rules || [];

  return (
    <div
      style={{
        border: depth > 0 ? '1px solid var(--color-border)' : 'none',
        borderRadius: depth > 0 ? 'var(--radius-md)' : 0,
        padding: depth > 0 ? 10 : 0,
        background: depth > 0 ? 'var(--color-bg-subtle)' : 'transparent',
      }}
    >
      {depth > 0 && (
        <div className="flex items-center justify-end mb-1">
          <button type="button" onClick={onRemove} aria-label={t('filter.removeGroup')} style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rules.length === 0 && (
          <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('filter.noConditions')}</p>
        )}
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="flex items-start gap-2">
            {/* Conjunction prefix: "Where" for the first, AND/OR selector after. */}
            <div style={{ width: 74, flexShrink: 0, paddingTop: i === 0 ? 6 : 0 }}>
              {i === 0 ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{t('filter.where')}</span>
              ) : (
                <Dropdown
                  size="sm"
                  options={[
                    { value: 'and', label: t('filter.and') },
                    { value: 'or', label: t('filter.or') },
                  ]}
                  value={group.conjunction}
                  onChange={(v) => onUpdate(path, (g) => ({ ...g, conjunction: v }))}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {isGroup(rule) ? (
                <GroupEditor
                  group={rule}
                  path={[...path, i]}
                  depth={depth + 1}
                  cols={cols}
                  allTasks={allTasks}
                  optionLabels={optionLabels}
                  onUpdate={onUpdate}
                  onRemove={() => onRemove([...path, i])}
                  onAdd={onAdd}
                />
              ) : (
                <ConditionRow
                  cond={rule}
                  cols={cols}
                  allTasks={allTasks}
                  optionLabels={optionLabels}
                  onUpdate={(patch) => onUpdate([...path, i], (c) => ({ ...c, ...patch }))}
                  onRemove={() => onRemove([...path, i])}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={() => onAdd(path, newCondition(cols))} className="inline-flex items-center gap-1 font-body" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
          <Plus size={13} /> {t('filter.newFilter')}
        </button>
        {depth < 2 && (
          <button type="button" onClick={() => onAdd(path, newGroup())} className="inline-flex items-center gap-1 font-body" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <FolderPlus size={13} /> {t('filter.newGroup')}
          </button>
        )}
      </div>
    </div>
  );
};

const AdvancedFilterPanel = ({ board, allTasks, tree, onChange, onClear, onSwitchToQuick, matchedCount = 0, totalCount = 0 }) => {
  const { t } = useTranslation();
  const cols = advancedFilterableColumns(board);
  const root = tree || { conjunction: 'and', rules: [] };
  const optionLabels = {
    checked: t('boardMisc.checked'),
    unchecked: t('boardMisc.unchecked'),
    unassigned: t('boardMisc.unassigned'),
  };

  const handleUpdate = (path, fn) => onChange(updateNode(root, path, fn));
  const handleRemove = (path) => onChange(removeNode(root, path));
  const handleAdd = (path, node) =>
    onChange(updateNode(root, path, (g) => ({ ...g, rules: [...(g.rules || []), node] })));

  return (
    <div
      className="bg-white"
      style={{
        width: 'min(680px, 92vw)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: 16,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {t('filter.advancedTitle')}
          </span>
          <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {t('filter.showing', { matched: matchedCount, count: totalCount })}
          </span>
        </div>
        <button type="button" onClick={onClear} className="font-body" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
          {t('filter.clearAll')}
        </button>
      </div>

      <GroupEditor
        group={root}
        path={[]}
        depth={0}
        cols={cols}
        allTasks={allTasks}
        optionLabels={optionLabels}
        onUpdate={handleUpdate}
        onRemove={handleRemove}
        onAdd={handleAdd}
      />

      <div className="flex items-center justify-end mt-3" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
        <button type="button" onClick={onSwitchToQuick} className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>
          {t('filter.switchToQuick')}
        </button>
      </div>
    </div>
  );
};

export default AdvancedFilterPanel;
