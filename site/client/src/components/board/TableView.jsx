import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SlidersHorizontal,
  Columns3,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Save,
  Check,
} from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Dropdown from '../ui/Dropdown';
import * as savedViewService from '../../services/savedViewService';
import { formatDate } from '../../utils/dateUtils';

/**
 * TableView — a generic per-board table with column filters, group-by,
 * multi-column sort, and column-visibility toggles, persisted per user as a
 * `SavedTableView` (F13.5). Selecting a saved view restores its filter +
 * visible columns across sessions (AC4).
 *
 * The filter uses the shared shape `[{ columnId, op, value }]`; client-side
 * evaluation mirrors the server's `columnFilter.js` semantics so the live table
 * and a server-side query agree.
 *
 * Props: `{ board, tasks, members }` (tasks = flattened top-level rows). Saved
 * views are per-user, so any member can create/update their own — no admin gate.
 */

const OP_OPTIONS = [
  { value: 'eq', label: 'is' },
  { value: 'in', label: 'is any of' },
  { value: 'between', label: 'between' },
];

const DEFAULT_VIEW = '__default__';
const NONE_GROUP = '__none__';

// --- shared-shape client evaluator (mirrors server columnFilter.js) ---------
const readVal = (task, colId) => (task && task.columnValues ? task.columnValues[colId] : undefined);
const toStr = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v._id != null ? String(v._id) : null;
  return String(v);
};
const toArr = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(toStr).filter((s) => s != null);
  const s = toStr(v);
  return s == null ? [] : [s];
};
const toEpoch = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && !(v instanceof Date)) return toEpoch(v.start || v.end);
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};
const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const clauseMatch = (task, clause) => {
  if (!clause || !clause.columnId) return true;
  const v = readVal(task, clause.columnId);
  if (clause.op === 'eq') {
    const want = toStr(clause.value);
    if (want == null) return false;
    return Array.isArray(v) ? toArr(v).includes(want) : toStr(v) === want;
  }
  if (clause.op === 'in') {
    const list = Array.isArray(clause.value) ? clause.value : String(clause.value || '').split(',');
    const allowed = new Set(list.map((s) => String(s).trim()).filter(Boolean));
    return toArr(v).some((x) => allowed.has(x));
  }
  if (clause.op === 'between') {
    const arr = Array.isArray(clause.value) ? clause.value : [];
    const [lo, hi] = arr;
    const num = toNum(v);
    if (num != null && (toNum(lo) != null || toNum(hi) != null)) {
      if (toNum(lo) != null && num < toNum(lo)) return false;
      if (toNum(hi) != null && num > toNum(hi)) return false;
      return true;
    }
    const ep = toEpoch(v);
    if (ep == null) return false;
    if (toEpoch(lo) != null && ep < toEpoch(lo)) return false;
    if (toEpoch(hi) != null && ep > toEpoch(hi)) return false;
    return toEpoch(lo) != null || toEpoch(hi) != null;
  }
  return true;
};
const matchesFilter = (task, filter) =>
  !Array.isArray(filter) || filter.length === 0 || filter.every((c) => clauseMatch(task, c));

// --- cell rendering ---------------------------------------------------------
const optionFor = (column, id) => {
  const opts = column.settings && Array.isArray(column.settings.options) ? column.settings.options : [];
  return opts.find((o) => o && o.id != null && String(o.id) === String(id)) || null;
};
const Chip = ({ label, color }) => (
  <span
    className="inline-flex items-center font-body"
    style={{ fontSize: 12, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: color || 'var(--color-bg-subtle)', color: color ? '#fff' : 'var(--color-text-secondary)' }}
  >
    {label}
  </span>
);

const renderCell = (column, value, membersById) => {
  if (value == null || value === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  switch (column.type) {
    case 'status':
    case 'dropdown': {
      const opt = optionFor(column, value);
      return opt ? <Chip label={opt.label} color={opt.color} /> : <span>{String(value)}</span>;
    }
    case 'tags': {
      const arr = Array.isArray(value) ? value : [value];
      return (
        <span className="inline-flex flex-wrap gap-1">
          {arr.map((id) => {
            const opt = optionFor(column, id);
            return <Chip key={id} label={opt ? opt.label : String(id)} color={opt ? opt.color : null} />;
          })}
        </span>
      );
    }
    case 'person': {
      const arr = Array.isArray(value) ? value : [value];
      return (
        <span className="font-body" style={{ fontSize: 13 }}>
          {arr.map((id) => (membersById.get(String(id)) || {}).name || 'Unknown').join(', ')}
        </span>
      );
    }
    case 'date':
      return <span className="font-body" style={{ fontSize: 13 }}>{formatDate(value)}</span>;
    case 'timeline':
      return (
        <span className="font-body" style={{ fontSize: 13 }}>
          {value.start ? formatDate(value.start) : '—'} → {value.end ? formatDate(value.end) : '—'}
        </span>
      );
    case 'checkbox':
      return value ? <Check size={15} color="var(--color-status-done)" /> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
    case 'link':
      return <a href={typeof value === 'object' ? value.url : value} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', fontSize: 13 }}>{(typeof value === 'object' ? value.label || value.url : value)}</a>;
    case 'number':
    case 'rating':
      return <span className="font-body" style={{ fontSize: 13 }}>{String(value)}</span>;
    case 'location':
      return <span className="font-body" style={{ fontSize: 13 }}>{typeof value === 'object' ? value.label || `${value.lat}, ${value.lng}` : String(value)}</span>;
    default:
      return <span className="font-body" style={{ fontSize: 13 }}>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>;
  }
};

/** Sort comparator for a single clause over two tasks. */
const compareBy = (a, b, columnId, dir) => {
  const va = readVal(a, columnId);
  const vb = readVal(b, columnId);
  const na = toNum(va);
  const nb = toNum(vb);
  let cmp;
  if (na != null && nb != null) cmp = na - nb;
  else {
    const ea = toEpoch(va);
    const eb = toEpoch(vb);
    if (ea != null && eb != null) cmp = ea - eb;
    else cmp = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb));
  }
  return dir === 'desc' ? -cmp : cmp;
};

const th = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
const td = { padding: '8px 12px', fontSize: 13, color: 'var(--color-text-primary)', borderTop: '1px solid var(--color-border)', verticalAlign: 'middle' };

const TableView = ({ board, tasks = [], members = [] }) => {
  const { t } = useTranslation();
  const opOptions = [
    { value: 'eq', label: t('grid.opIs') },
    { value: 'in', label: t('grid.opIsAnyOf') },
    { value: 'between', label: t('grid.opBetween') },
  ];
  const boardId = board?._id;
  const columns = useMemo(() => (board?.columns || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)), [board]);
  const membersById = useMemo(() => new Map((members || []).map((m) => [String(m._id), m])), [members]);

  const [savedViews, setSavedViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(DEFAULT_VIEW);
  const [visibleColumnIds, setVisibleColumnIds] = useState(() => new Set(columns.map((c) => String(c._id))));
  const [filterRows, setFilterRows] = useState([]);
  const [sort, setSort] = useState([]); // [{ columnId, dir }]
  const [groupBy, setGroupBy] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset visible columns when the board's columns change (e.g. board switch).
  useEffect(() => {
    setVisibleColumnIds(new Set(columns.map((c) => String(c._id))));
  }, [columns]);

  const reloadViews = useCallback(async () => {
    if (!boardId) return;
    try {
      setSavedViews(await savedViewService.listSavedViews(boardId));
    } catch (err) {
      console.error('Failed to load saved table views:', err);
    }
  }, [boardId]);

  useEffect(() => {
    reloadViews();
  }, [reloadViews]);

  // Apply a saved view's persisted config (AC4).
  const applyView = (id) => {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW) {
      setVisibleColumnIds(new Set(columns.map((c) => String(c._id))));
      setFilterRows([]);
      setSort([]);
      setGroupBy('');
      return;
    }
    const v = savedViews.find((x) => String(x._id) === String(id));
    if (!v) return;
    setVisibleColumnIds(new Set((v.visibleColumnIds && v.visibleColumnIds.length ? v.visibleColumnIds : columns.map((c) => c._id)).map(String)));
    setFilterRows(
      (v.filter || []).map((c) => ({
        columnId: c.columnId || '',
        op: c.op || 'eq',
        valueText: Array.isArray(c.value) ? c.value.join(', ') : c.value == null ? '' : String(c.value),
      }))
    );
    setSort(Array.isArray(v.sort) ? v.sort.map((s) => ({ columnId: s.columnId, dir: s.dir === 'desc' ? 'desc' : 'asc' })) : []);
    setGroupBy(v.groupBy || '');
  };

  // Serialize the current UI state into the SavedTableView shape.
  const currentViewPayload = (name) => ({
    name,
    visibleColumnIds: [...visibleColumnIds],
    filter: filterRows
      .filter((r) => r.columnId)
      .map((r) => ({
        columnId: r.columnId,
        op: r.op,
        value:
          r.op === 'in'
            ? r.valueText.split(',').map((s) => s.trim()).filter(Boolean)
            : r.op === 'between'
            ? r.valueText.split(',').map((s) => s.trim())
            : r.valueText.trim(),
      })),
    sort,
    groupBy: groupBy || null,
  });

  const handleSaveView = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await savedViewService.createSavedView(boardId, currentViewPayload(name));
      setSavedViews((list) => [...list, created]);
      setActiveViewId(String(created._id));
      setSaveName('');
    } catch (err) {
      console.error('Failed to save view:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateView = async () => {
    if (activeViewId === DEFAULT_VIEW) return;
    setSaving(true);
    try {
      const v = savedViews.find((x) => String(x._id) === String(activeViewId));
      const updated = await savedViewService.updateSavedView(activeViewId, currentViewPayload(v?.name || 'View'));
      setSavedViews((list) => list.map((x) => (String(x._id) === String(updated._id) ? updated : x)));
    } catch (err) {
      console.error('Failed to update view:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteView = async () => {
    if (activeViewId === DEFAULT_VIEW) return;
    try {
      await savedViewService.deleteSavedView(activeViewId);
      setSavedViews((list) => list.filter((x) => String(x._id) !== String(activeViewId)));
      applyView(DEFAULT_VIEW);
    } catch (err) {
      console.error('Failed to delete view:', err);
    }
  };

  const toggleSort = (columnId) => {
    setSort((prev) => {
      const idx = prev.findIndex((s) => s.columnId === columnId);
      if (idx < 0) return [...prev, { columnId, dir: 'asc' }];
      if (prev[idx].dir === 'asc') return prev.map((s, i) => (i === idx ? { ...s, dir: 'desc' } : s));
      return prev.filter((_, i) => i !== idx);
    });
  };
  const sortDir = (columnId) => sort.find((s) => s.columnId === columnId)?.dir || null;

  const activeFilter = filterRows
    .filter((r) => r.columnId)
    .map((r) => ({
      columnId: r.columnId,
      op: r.op,
      value:
        r.op === 'in'
          ? r.valueText.split(',').map((s) => s.trim()).filter(Boolean)
          : r.op === 'between'
          ? r.valueText.split(',').map((s) => s.trim())
          : r.valueText.trim(),
    }));

  const rows = useMemo(() => {
    let out = (tasks || []).filter((t) => matchesFilter(t, activeFilter));
    if (sort.length > 0) {
      out = out.slice().sort((a, b) => {
        for (const s of sort) {
          const cmp = compareBy(a, b, s.columnId, s.dir);
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, JSON.stringify(activeFilter), JSON.stringify(sort)]);

  const groupColumn = groupBy ? columns.find((c) => String(c._id) === String(groupBy)) : null;
  const grouped = useMemo(() => {
    if (!groupColumn) return [['__all__', rows]];
    const map = new Map();
    for (const t of rows) {
      const raw = readVal(t, groupBy);
      const keys = Array.isArray(raw) ? (raw.length ? raw : [NONE_GROUP]) : [raw == null || raw === '' ? NONE_GROUP : raw];
      for (const k of keys) {
        const key = String(k);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(t);
      }
    }
    return [...map.entries()];
  }, [rows, groupBy, groupColumn]);

  const visibleColumns = columns.filter((c) => visibleColumnIds.has(String(c._id)));

  const addFilterRow = () => setFilterRows((r) => [...r, { columnId: '', op: 'eq', valueText: '' }]);
  const updateFilterRow = (i, patch) => setFilterRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeFilterRow = (i) => setFilterRows((r) => r.filter((_, idx) => idx !== i));

  const groupLabel = (key) => {
    if (key === '__all__') return null;
    if (key === NONE_GROUP) return '(None)';
    const opt = groupColumn ? optionFor(groupColumn, key) : null;
    if (opt) return opt.label;
    if (groupColumn?.type === 'person') return (membersById.get(String(key)) || {}).name || 'Unknown';
    return String(key);
  };

  const viewOptions = [
    { value: DEFAULT_VIEW, label: 'All columns (default)' },
    ...savedViews.map((v) => ({ value: String(v._id), label: v.name })),
  ];
  const groupOptions = [
    { value: '', label: 'No grouping' },
    ...columns.filter((c) => ['status', 'dropdown', 'tags', 'person'].includes(c.type)).map((c) => ({ value: String(c._id), label: c.name })),
  ];

  if (!board?.useFlexibleColumns || columns.length === 0) {
    return (
      <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '32px 20px' }}>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
          The table view works on boards with custom columns. Enable custom columns on this board to use it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div style={{ width: 220 }}>
          <Dropdown options={viewOptions} value={activeViewId} onChange={applyView} size="sm" />
        </div>
        <div style={{ width: 180 }}>
          <Dropdown options={groupOptions} value={groupBy} onChange={setGroupBy} size="sm" placeholder="No grouping" />
        </div>
        <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setShowFilters((v) => !v)}>
          Filters{activeFilter.length ? ` (${activeFilter.length})` : ''}
        </Button>
        <Button variant="secondary" size="sm" icon={Columns3} onClick={() => setShowColumns((v) => !v)}>
          Columns
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          {activeViewId !== DEFAULT_VIEW && (
            <>
              <Button variant="secondary" size="sm" icon={Save} onClick={handleUpdateView} disabled={saving}>
                Update view
              </Button>
              <Button variant="secondary" size="sm" icon={Trash2} onClick={handleDeleteView} disabled={saving}>
                Delete
              </Button>
            </>
          )}
          <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Save as view…" style={{ height: 32, width: 150 }} />
          <Button variant="primary" size="sm" onClick={handleSaveView} disabled={saving || !saveName.trim()}>
            Save
          </Button>
        </div>
      </div>

      {/* Column visibility panel */}
      {showColumns && (
        <div className="bg-surface" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
          <div className="flex flex-wrap gap-3">
            {columns.map((c) => {
              const id = String(c._id);
              const on = visibleColumnIds.has(id);
              return (
                <label key={id} className="inline-flex items-center gap-2 cursor-pointer font-body" style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setVisibleColumnIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                        return next;
                      })
                    }
                    style={{ width: 15, height: 15, accentColor: 'var(--color-accent)' }}
                  />
                  {c.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter builder */}
      {showFilters && (
        <div className="bg-surface" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
          <div className="flex flex-col gap-2">
            {filterRows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div style={{ flex: '1 1 36%' }}>
                  <Dropdown size="sm" options={columns.map((c) => ({ value: String(c._id), label: c.name }))} value={row.columnId} onChange={(v) => updateFilterRow(idx, { columnId: v })} placeholder="Column" />
                </div>
                <div style={{ flex: '0 0 120px' }}>
                  <Dropdown size="sm" options={OP_OPTIONS} value={row.op} onChange={(v) => updateFilterRow(idx, { op: v })} />
                </div>
                <div style={{ flex: '1 1 36%' }}>
                  <Input value={row.valueText} onChange={(e) => updateFilterRow(idx, { valueText: e.target.value })} placeholder={row.op === 'in' ? 'a, b, c' : row.op === 'between' ? 'min, max' : 'value / option id'} style={{ height: 32 }} />
                </div>
                <button type="button" onClick={() => removeFilterRow(idx)} aria-label="Remove filter" className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 30, height: 30, flexShrink: 0 }}>
                  <Trash2 size={14} color="var(--color-text-secondary)" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addFilterRow} className="inline-flex items-center gap-1.5 self-start font-body" style={{ fontSize: 13, color: 'var(--color-accent)', background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer' }}>
              <Plus size={14} /> Add filter condition
            </button>
            <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Values use option ids for status/dropdown/tags and user ids for person columns.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-subtle)' }}>
              <th style={th}>Name</th>
              {visibleColumns.map((c) => {
                const dir = sortDir(String(c._id));
                return (
                  <th key={String(c._id)} style={th} onClick={() => toggleSort(String(c._id))} title="Click to sort">
                    <span className="inline-flex items-center gap-1">
                      {c.name}
                      {dir === 'asc' && <ArrowUp size={12} />}
                      {dir === 'desc' && <ArrowDown size={12} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={{ ...td, color: 'var(--color-text-muted)' }} colSpan={visibleColumns.length + 1}>
                  No rows match.
                </td>
              </tr>
            ) : (
              grouped.map(([key, groupRows]) => (
                <GroupBlock
                  key={key}
                  label={groupLabel(key)}
                  rows={groupRows}
                  visibleColumns={visibleColumns}
                  membersById={membersById}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const GroupBlock = ({ label, rows, visibleColumns, membersById }) => (
  <>
    {label != null && (
      <tr>
        <td colSpan={visibleColumns.length + 1} style={{ padding: '6px 12px', background: 'var(--color-bg-base)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)' }}>
          {label} · {rows.length}
        </td>
      </tr>
    )}
    {rows.map((t) => (
      <tr key={t._id} className="hover:bg-[color:var(--color-bg-subtle)]">
        <td style={{ ...td, fontWeight: 500 }}>{t.name}</td>
        {visibleColumns.map((c) => (
          <td key={String(c._id)} style={td}>
            {renderCell(c, readVal(t, String(c._id)), membersById)}
          </td>
        ))}
      </tr>
    ))}
  </>
);

export default TableView;
