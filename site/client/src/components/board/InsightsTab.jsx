import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Dropdown from '../ui/Dropdown';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import ChartWidgetRenderer from './ChartWidgetRenderer';
import * as chartService from '../../services/chartService';

/**
 * InsightsTab — the per-board Insights surface (F13.5). Renders the board's
 * `ChartWidget` rows through the shared `ChartWidgetRenderer`, each fed by
 * `chartService.getChartData`. Admins can add / edit / delete widgets via the
 * inline widget editor. Props: `{ boardId, board, isAdmin }`.
 */

const TYPE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line (over time)' },
  { value: 'pie', label: 'Pie' },
  { value: 'funnel', label: 'Funnel (stage conversion)' },
  { value: 'number', label: 'Number (single KPI)' },
  { value: 'stacked_bar', label: 'Stacked bar' },
];
const AGG_OPTIONS = [
  { value: 'count', label: 'Count of items' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
];
const BUCKET_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
const VISIBILITY_OPTIONS = [
  { value: 'everyone', label: 'Everyone (all members)' },
  { value: 'admins', label: 'Admins only' },
];

const GROUP_TYPES = ['status', 'dropdown', 'tags', 'person'];
const DATE_TYPES = ['date', 'timeline'];
const NUMBER_TYPES = ['number', 'rating'];

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-bg-surface)',
  boxShadow: 'var(--shadow-card)',
  padding: 16,
};

/**
 * Widget create/edit modal. Adapts visible fields to the chosen type.
 *
 * Two modes:
 *   - board-scoped (InsightsTab): pass `board` (with columns).
 *   - workspace dashboard: pass `boards` (array, each with columns) → a board
 *     picker appears and the payload carries the chosen `boardId`.
 */
export const ChartWidgetForm = ({ isOpen, onClose, board, boards, initial, saving, error, onSubmit }) => {
  const pickBoard = Array.isArray(boards) && boards.length > 0;
  const [boardId, setBoardId] = useState(
    initial?.boardId ? String(initial.boardId) : pickBoard ? String(boards[0]._id) : ''
  );
  const activeBoard = pickBoard ? boards.find((b) => String(b._id) === String(boardId)) || null : board;
  const columns = useMemo(() => activeBoard?.columns || [], [activeBoard]);
  const [type, setType] = useState(initial?.type || 'bar');
  const [title, setTitle] = useState(initial?.title || '');
  const q = initial?.query || {};
  const [columnId, setColumnId] = useState(q.columnId || '');
  const [aggregate, setAggregate] = useState(q.aggregate || 'count');
  const [aggregateColumnId, setAggregateColumnId] = useState(q.aggregateColumnId || '');
  const [splitBy, setSplitBy] = useState(q.splitBy || '');
  const [timeBucket, setTimeBucket] = useState(q.timeBucket || 'month');
  const [visibility, setVisibility] = useState(initial?.visibility || 'everyone');
  const [localError, setLocalError] = useState('');

  const colOpts = (types) =>
    columns.filter((c) => types.includes(c.type)).map((c) => ({ value: String(c._id), label: c.name }));

  const needsGroup = type !== 'number';
  const groupTypes = type === 'line' ? DATE_TYPES : GROUP_TYPES;
  const groupLabel = type === 'line' ? 'Date column (x-axis)' : 'Group by column';
  const needsAggCol = aggregate !== 'count';

  const handleSubmit = () => {
    setLocalError('');
    if (needsGroup && !columnId) {
      setLocalError(type === 'line' ? 'Pick a date column for the x-axis.' : 'Pick a column to group by.');
      return;
    }
    if (needsAggCol && !aggregateColumnId) {
      setLocalError('Pick a number column to aggregate.');
      return;
    }
    if (type === 'stacked_bar' && !splitBy) {
      setLocalError('Pick a second column to split by.');
      return;
    }
    if (pickBoard && !boardId) {
      setLocalError('Pick a board for this widget.');
      return;
    }
    onSubmit?.({
      ...(pickBoard ? { boardId } : {}),
      type,
      title: title.trim(),
      visibility,
      query: {
        columnId: needsGroup ? columnId || null : null,
        aggregate,
        aggregateColumnId: needsAggCol ? aggregateColumnId || null : null,
        splitBy: type === 'stacked_bar' ? splitBy || null : null,
        timeBucket,
        filter: Array.isArray(initial?.query?.filter) ? initial.query.filter : [],
      },
    });
  };

  // Switching boards invalidates column-based selections.
  const changeBoard = (id) => {
    setBoardId(id);
    setColumnId('');
    setAggregateColumnId('');
    setSplitBy('');
  };

  const shownError = localError || error;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? 'Edit widget' : 'New widget'}
      maxWidth={520}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create widget'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {pickBoard && (
          <Dropdown
            label="Board"
            options={boards.map((b) => ({ value: String(b._id), label: b.name }))}
            value={boardId}
            onChange={changeBoard}
            placeholder="Pick a board"
          />
        )}
        <Input label="Title" placeholder="e.g. Stage funnel" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <Dropdown label="Chart type" options={TYPE_OPTIONS} value={type} onChange={setType} />

        {needsGroup && (
          <Dropdown
            label={groupLabel}
            options={colOpts(groupTypes)}
            value={columnId}
            onChange={setColumnId}
            placeholder={`Pick a ${type === 'line' ? 'date' : 'group'} column`}
          />
        )}

        {type === 'stacked_bar' && (
          <Dropdown
            label="Split by column"
            options={colOpts(GROUP_TYPES)}
            value={splitBy}
            onChange={setSplitBy}
            placeholder="Second dimension"
          />
        )}

        <Dropdown label="Measure" options={AGG_OPTIONS} value={aggregate} onChange={setAggregate} />

        {needsAggCol && (
          <Dropdown
            label="Number column to aggregate"
            options={colOpts(NUMBER_TYPES)}
            value={aggregateColumnId}
            onChange={setAggregateColumnId}
            placeholder="Pick a number column"
          />
        )}

        {type === 'line' && (
          <Dropdown label="Bucket by" options={BUCKET_OPTIONS} value={timeBucket} onChange={setTimeBucket} />
        )}

        <Dropdown label="Who can see this" options={VISIBILITY_OPTIONS} value={visibility} onChange={setVisibility} />

        {shownError && (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>
            {shownError}
          </p>
        )}
      </div>
    </Modal>
  );
};

export const WidgetCard = ({ widget, data, loading, error, isAdmin, onEdit, onDelete, onRefresh }) => (
  <div style={cardStyle} className="flex flex-col">
    <div className="flex items-start justify-between gap-2 mb-3">
      <h3 className="font-display font-semibold flex items-center gap-2" style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
        {widget.title || '(Untitled widget)'}
        {widget.visibility === 'admins' && (
          <span
            title="Visible to admins only"
            style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#A25DDC', background: '#A25DDC1A', borderRadius: 'var(--radius-full)', padding: '2px 7px' }}
          >
            Admins
          </span>
        )}
      </h3>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" aria-label="Refresh" title="Refresh" onClick={onRefresh} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 28, height: 28 }}>
          <RefreshCw size={13} color="var(--color-text-muted)" />
        </button>
        {isAdmin && (
          <>
            <button type="button" aria-label="Edit widget" title="Edit" onClick={onEdit} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 28, height: 28 }}>
              <Pencil size={13} color="var(--color-text-muted)" />
            </button>
            <button type="button" aria-label="Delete widget" title="Delete" onClick={onDelete} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 28, height: 28 }}>
              <Trash2 size={13} color="#DC2626" />
            </button>
          </>
        )}
      </div>
    </div>
    <ChartWidgetRenderer widget={widget} data={data} loading={loading} error={error} height={240} />
  </div>
);

const InsightsTab = ({ boardId, board, isAdmin }) => {
  const [widgets, setWidgets] = useState([]);
  const [dataById, setDataById] = useState({});
  const [loadingById, setLoadingById] = useState({});
  const [errorById, setErrorById] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  const fetchData = useCallback(async (widget) => {
    setLoadingById((m) => ({ ...m, [widget._id]: true }));
    setErrorById((m) => ({ ...m, [widget._id]: '' }));
    try {
      const data = await chartService.getChartData(widget._id);
      setDataById((m) => ({ ...m, [widget._id]: data }));
    } catch (err) {
      setErrorById((m) => ({ ...m, [widget._id]: err?.response?.data?.error || 'Failed to load data.' }));
    } finally {
      setLoadingById((m) => ({ ...m, [widget._id]: false }));
    }
  }, []);

  const reload = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    setError('');
    try {
      const list = await chartService.listCharts({ boardId });
      setWidgets(list);
      list.forEach((w) => fetchData(w));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load insights.');
    } finally {
      setLoading(false);
    }
  }, [boardId, fetchData]);

  useEffect(() => {
    reload();
  }, [reload]);

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    setFormOpen(true);
  };
  const openEdit = (widget) => {
    setEditing(widget);
    setFormError('');
    setFormOpen(true);
  };

  const handleSubmit = async (payload) => {
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        const updated = await chartService.updateChart(editing._id, payload);
        setWidgets((list) => list.map((w) => (w._id === updated._id ? updated : w)));
        await fetchData(updated);
      } else {
        const created = await chartService.createChart({ ...payload, boardId });
        setWidgets((list) => [...list, created]);
        await fetchData(created);
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err?.response?.data?.error || 'Could not save the widget.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    const widget = pendingDelete;
    setPendingDelete(null);
    if (!widget) return;
    try {
      await chartService.deleteChart(widget._id);
      setWidgets((list) => list.filter((w) => w._id !== widget._id));
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not delete the widget.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Charts over this board's data. {isAdmin ? 'Add widgets to build a board dashboard.' : ''}
        </p>
        {isAdmin && (
          <Button variant="primary" size="sm" icon={Plus} onClick={openCreate}>
            Add widget
          </Button>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>{error}</p>}

      {loading && widgets.length === 0 ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading insights…</p>
      ) : widgets.length === 0 ? (
        <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '48px 16px' }}>
          <EmptyState
            icon={BarChart3}
            title="No widgets yet"
            description={isAdmin ? 'Add a chart widget to visualise this board — try a Stage funnel over your status column.' : 'No insights have been set up on this board yet.'}
            actionLabel={isAdmin ? 'Add your first widget' : undefined}
            onAction={isAdmin ? openCreate : undefined}
          />
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {widgets.map((w) => (
            <WidgetCard
              key={w._id}
              widget={w}
              data={dataById[w._id]}
              loading={!!loadingById[w._id]}
              error={errorById[w._id]}
              isAdmin={isAdmin}
              onEdit={() => openEdit(w)}
              onDelete={() => setPendingDelete(w)}
              onRefresh={() => fetchData(w)}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <ChartWidgetForm
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          board={board}
          initial={editing}
          saving={saving}
          error={formError}
          onSubmit={handleSubmit}
        />
      )}

      <Modal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete widget?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleConfirmDelete}>Delete</Button>
          </>
        }
      >
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Delete <strong style={{ color: 'var(--color-text-primary)' }}>{pendingDelete?.title || 'this widget'}</strong>? This can't be undone.
        </p>
      </Modal>
    </div>
  );
};

export default InsightsTab;
