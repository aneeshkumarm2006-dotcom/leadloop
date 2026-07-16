import { Fragment, useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  MoreHorizontal,
  MessageSquarePlus,
  GripVertical,
  ChevronRight,
  ArrowRight,
  Plus,
} from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cellComponentFor } from './columns';
import AddColumnButton from './AddColumnButton';
import SortableItem from '../dnd/SortableItem';
import useBoardStore from '../../store/boardStore';
import useTaskStore from '../../store/taskStore';
import useToastStore from '../../store/toastStore';
import * as taskService from '../../services/taskService';
import { getStatusPalette } from '../../utils/priorityColors';
import {
  AGG_CYCLE,
  summarizeNumber,
  summarizeStatus,
  formatAgg,
  hasSummarisableColumn,
} from '../../utils/columnSummary';

// Uniform column sizing — every data column is the same width and stretches
// to fill the grid; the control tracks (drag handle, checkbox, row actions)
// and the trailing add-column cell are fixed.
const COLUMN_WIDTH = 180;
const DRAG_WIDTH = 24;
const CHECK_WIDTH = 40;
// Trailing control tracks: a 48px row-actions column and the 44px add-column
// cell (the comments ⊕ now lives inside the Name cell, so it has no track).
const ACTIONS_WIDTH = 48;
const ADD_COLUMN_WIDTH = 44;
const ROW_HEIGHT = 40;

// Accent colours offered for column headers (Monday-style column colouring).
const COLUMN_HEADER_SWATCHES = [
  '#00C875', '#9D50DD', '#00A9FF', '#FDAB3D', '#FF642E',
  '#E8517B', '#A25DDC', '#037F4C', '#0073EA', '#FB275D', '#66CCFF',
];

/**
 * DataGrid — generic grid driven by `board.columns` and a flat `tasks`
 * array. Used for boards with `useFlexibleColumns: true`.
 *
 * Each task renders as a single draggable row (its own CSS grid sharing the
 * header's column template) so it has full row-level parity with the classic
 * TaskTable: a drag handle, a selection checkbox, open + actions buttons, and
 * inline subitems. The fixed control tracks sit on either side of the dynamic
 * data columns.
 *
 * Props:
 *   board        — current board doc (with `columns`)
 *   tasks        — tasks to render (already filtered to the right group)
 *   readOnly     — disables editing/creating/selecting/dragging
 *   onSaveNew    — async ({ name }) => void — create a task in this group
 *   onOpenTask   — (task) => void — open a task's detail panel
 *   onActionsClick — (task, event) => void — open the row ⋯ menu
 *   selectedIds  — Set of selected task ids (bulk selection)
 *   onToggleSelect — (taskId, checked) => void
 *   onToggleSelectAll — (taskIds, checked) => void
 *   highlightedTaskId — id of a row to highlight
 *   groupId      — owning group id (drag payload)
 *   dndDisabled  — disables drag sensors
 */
const DataGrid = ({
  board,
  tasks = [],
  readOnly = false,
  onSaveNew,
  onOpenTask,
  onActionsClick,
  selectedIds = null,
  onToggleSelect,
  onToggleSelectAll,
  highlightedTaskId = null,
  groupId = null,
  dndDisabled = false,
  hiddenColumnIds = null,
}) => {
  const { t } = useTranslation();
  const [headerMenu, setHeaderMenu] = useState(null); // { columnId, anchor }
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Live width overrides while dragging a column's resize handle (colId → px).
  const [colWidths, setColWidths] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  // Per-column aggregation mode for the summary footer (columnId → agg).
  const [numAgg, setNumAgg] = useState(() => new Map());
  const cycleAgg = (columnId) =>
    setNumAgg((prev) => {
      const next = new Map(prev);
      const cur = next.get(columnId) || 'sum';
      const idx = AGG_CYCLE.indexOf(cur);
      next.set(columnId, AGG_CYCLE[(idx + 1) % AGG_CYCLE.length]);
      return next;
    });
  const setColumnValue = useBoardStore((s) => s.setColumnValue);
  const updateColumn = useBoardStore((s) => s.updateColumn);
  const deleteColumn = useBoardStore((s) => s.deleteColumn);
  const updateTaskLocal = useTaskStore((s) => s.updateTask);
  const fetchSubitems = useTaskStore((s) => s.fetchSubitems);
  const subitemsByParent = useTaskStore((s) => s.subitemsByParent);
  const toastError = useToastStore((s) => s.error);

  const columns = useMemo(
    () =>
      (board?.columns || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        // Hidden columns drop out of the grid (the primary column can't hide).
        .filter((c) => c.isPrimary || !hiddenColumnIds?.has?.(c._id?.toString())),
    [board?.columns, hiddenColumnIds]
  );

  const selectable = !readOnly && !!selectedIds && typeof onToggleSelect === 'function';
  const draggable = !readOnly && !dndDisabled && !!groupId;

  const taskIds = useMemo(() => tasks.map((t) => t._id), [tasks]);

  const allSelected =
    tasks.length > 0 && selectedIds != null && tasks.every((t) => selectedIds.has(t._id));

  // Resolved width for a column: a live drag override wins, then the persisted
  // `width`, then the default. Monday columns are fixed-width and resizable.
  const widthOf = (col) => colWidths[col._id] ?? (col.width > 0 ? col.width : COLUMN_WIDTH);

  // CSS grid template shared by the header and every row. Each data column is a
  // fixed pixel track (so it can be resized); the control + add-column tracks
  // are fixed too. A trailing flexible track fills any leftover space.
  const gridTemplate = useMemo(() => {
    const dataDefs = columns.map((c) => `${widthOf(c)}px`);
    return [
      `${DRAG_WIDTH}px`,
      `${CHECK_WIDTH}px`,
      ...dataDefs,
      `${ACTIONS_WIDTH}px`,
      `${ADD_COLUMN_WIDTH}px`,
      // Trailing filler so the row background fills the card instead of leaving
      // a hard-edged gap after the + button. Collapses to 0 when columns
      // overflow (then the grid scrolls horizontally).
      'minmax(0, 1fr)',
    ].join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, colWidths]);

  // Minimum width so the grid scrolls horizontally instead of squishing when
  // there are more columns than fit. (The Monday-style "write update" ⊕ now
  // lives inside the Name cell, so it has no track of its own.)
  const minRowWidth =
    DRAG_WIDTH +
    CHECK_WIDTH +
    columns.reduce((sum, c) => sum + widthOf(c), 0) +
    ACTIONS_WIDTH +
    ADD_COLUMN_WIDTH;

  // Drag-to-resize a column. Updates the live override on every mousemove and
  // persists the final width on mouseup.
  const startResize = (e, col) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(col);
    let lastW = startW;
    const onMove = (ev) => {
      lastW = Math.max(80, Math.min(800, startW + (ev.clientX - startX)));
      setColWidths((prev) => ({ ...prev, [col._id]: lastW }));
    };
    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (Math.round(lastW) !== Math.round(startW)) {
        try {
          await updateColumn(board._id, col._id, { width: Math.round(lastW) });
        } catch (err) {
          toastError(err?.response?.data?.error || t('grid.updateFailed'));
        }
      }
      // Drop the override once the persisted width is reflected in props.
      setColWidths((prev) => {
        const next = { ...prev };
        delete next[col._id];
        return next;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onCellChange = async (task, column, value) => {
    try {
      const updated = await setColumnValue(task._id, column._id, value);
      if (updated) updateTaskLocal(updated);
    } catch (err) {
      const message =
        err?.response?.data?.errors?.[0]?.message || err?.message || t('grid.updateFailed');
      toastError(message);
    }
  };

  const valueFor = (task, columnId) => {
    if (!task || !task.columnValues) return null;
    if (typeof task.columnValues.get === 'function') {
      return task.columnValues.get(columnId.toString());
    }
    return task.columnValues[columnId.toString()];
  };

  const toggleExpand = (taskId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
        if (!subitemsByParent[taskId]) {
          fetchSubitems(taskId).catch((err) => console.error('Failed to load subitems:', err));
        }
      }
      return next;
    });
  };

  // Drop expanded state for tasks that no longer exist.
  useEffect(() => {
    setExpanded((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(tasks.map((t) => t._id));
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const handleRenameCommit = async (columnId) => {
    const next = renameDraft.trim();
    if (!next) {
      setRenamingId(null);
      return;
    }
    try {
      await updateColumn(board._id, columnId, { name: next });
    } catch (err) {
      toastError(err?.response?.data?.error || t('grid.renameFailed'));
    }
    setRenamingId(null);
  };

  const handleSetColor = async (column, nextColor) => {
    try {
      await updateColumn(board._id, column._id, { color: nextColor });
    } catch (err) {
      toastError(err?.response?.data?.error || t('grid.updateFailed'));
    }
  };

  const handleDelete = async (column) => {
    if (column.isPrimary) {
      toastError(t('grid.primaryColumnCannotDelete'));
      return;
    }
    if (!window.confirm(t('grid.deleteColumnConfirm', { name: column.name }))) return;
    try {
      await deleteColumn(board._id, column._id);
    } catch (err) {
      toastError(err?.response?.data?.error || t('grid.deleteFailed'));
    }
    setHeaderMenu(null);
  };

  if (columns.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        {t('grid.noColumnsYet')} {!readOnly && <AddColumnButton boardId={board._id} board={board} />}
      </div>
    );
  }

  const sharedRowStyle = {
    display: 'grid',
    gridTemplateColumns: gridTemplate,
    width: '100%',
    minWidth: minRowWidth,
  };

  return (
    <div
      className="macan-thin-scrollbar"
      style={{ width: '100%', overflowX: 'auto' }}
    >
      {/* Header row */}
      <div style={sharedRowStyle}>
        <HeaderShell pad="0 0 0 8px" stickyLeft={FROZEN_DRAG_LEFT} />
        <HeaderShell pad="0 0 0 16px" divider stickyLeft={FROZEN_CHECK_LEFT}>
          {selectable && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) =>
                onToggleSelectAll?.(tasks.map((t) => t._id), e.target.checked)
              }
              aria-label={t('grid.selectAllLeads')}
              style={{ width: 16, height: 16, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
            />
          )}
        </HeaderShell>

        {columns.map((col) => (
          <HeaderShell
            key={col._id}
            align="space-between"
            className="group/col-header"
            divider
            accent={col.color || null}
            stickyLeft={col.isPrimary ? FROZEN_PRIMARY_LEFT : null}
          >
            {renamingId === col._id ? (
              <input
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => handleRenameCommit(col._id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameCommit(col._id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid var(--color-accent)',
                  padding: '2px 4px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}
              />
            ) : (
              <span
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}
              >
                {col.color && (
                  <span
                    style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }}
                    aria-hidden="true"
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</span>
                {col.isPrimary && (
                  <span style={{ opacity: 0.6 }} title={t('grid.primaryColumn')}>
                    *
                  </span>
                )}
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={(e) =>
                  setHeaderMenu(
                    headerMenu?.columnId === col._id
                      ? null
                      : { columnId: col._id, anchor: e.currentTarget }
                  )
                }
                className={[
                  'opacity-0 group-hover/col-header:opacity-100 focus-visible:opacity-100 transition-opacity duration-150',
                  headerMenu?.columnId === col._id ? '!opacity-100' : '',
                ].join(' ')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  color: 'var(--color-text-muted)',
                }}
                aria-label={t('grid.columnActionsFor', { name: col.name })}
              >
                <MoreHorizontal size={12} />
              </button>
            )}
            {/* Resize handle — drag the right edge to set column width. */}
            {!readOnly && (
              <div
                onMouseDown={(e) => startResize(e, col)}
                onClick={(e) => e.stopPropagation()}
                title={t('grid.resizeColumn')}
                className="opacity-0 group-hover/col-header:opacity-100 transition-opacity duration-150"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: -3,
                  width: 7,
                  height: '100%',
                  cursor: 'col-resize',
                  zIndex: 4,
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <span style={{ width: 2, height: '100%', background: 'var(--color-accent)' }} />
              </div>
            )}
          </HeaderShell>
        ))}

        {/* Actions + add-column headers (empty) */}
        <HeaderShell pad="0 8px 0 0" />
        <HeaderShell pad="0 4px" align="center">
          {!readOnly && <AddColumnButton boardId={board._id} board={board} />}
        </HeaderShell>
        {/* Trailing filler header */}
        <HeaderShell pad="0" />
      </div>

      {/* Body rows */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => {
          const isExpanded = expanded.has(task._id);
          const highlighted = highlightedTaskId === task._id;
          const commentCount =
            typeof task.commentCount === 'number' ? task.commentCount : 0;
          return (
            <SortableItem
              key={task._id}
              id={task._id}
              data={{ type: 'task', groupId }}
              disabled={!draggable}
            >
              {({ ref, setActivatorNodeRef, style, attributes, listeners, isDragging }) => (
                <Fragment>
                  <div
                    ref={ref}
                    {...attributes}
                    className={[
                      'group/datagrid-row transition-colors duration-100',
                      'hover:bg-[color:var(--color-bg-subtle)]',
                      highlighted ? 'macan-task-highlight' : '',
                    ].join(' ')}
                    style={{
                      ...style,
                      ...sharedRowStyle,
                      minHeight: ROW_HEIGHT,
                      alignItems: 'stretch',
                      borderBottom: '1px solid var(--color-border)',
                      background: highlighted ? 'var(--color-accent-light)' : undefined,
                      opacity: isDragging ? 0.4 : style?.opacity,
                    }}
                  >
                    {/* Drag handle — revealed on row hover, like the normal table */}
                    <Cellish pad="0 0 0 8px" stickyLeft={FROZEN_DRAG_LEFT} className={FROZEN_CELL_BG}>
                      {draggable && (
                        <button
                          ref={setActivatorNodeRef}
                          type="button"
                          aria-label={t('grid.dragToReorderLead')}
                          {...listeners}
                          className="flex items-center justify-center opacity-0 group-hover/datagrid-row:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
                          style={{
                            width: 16,
                            height: 24,
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'grab',
                            touchAction: 'none',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          <GripVertical size={14} aria-hidden="true" />
                        </button>
                      )}
                    </Cellish>

                    {/* Selection checkbox */}
                    <Cellish pad="0 0 0 16px" divider stickyLeft={FROZEN_CHECK_LEFT} className={FROZEN_CELL_BG}>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selectedIds?.has(task._id) || false}
                          onChange={(e) => onToggleSelect?.(task._id, e.target.checked)}
                          aria-label={t('grid.selectNamed', { name: task.name })}
                          style={{
                            width: 16,
                            height: 16,
                            accentColor: 'var(--color-accent)',
                            cursor: 'pointer',
                          }}
                        />
                      )}
                    </Cellish>

                    {/* Data cells */}
                    {columns.map((col) => {
                      const Cell = cellComponentFor(col.type);
                      const value = col.isPrimary
                        ? task.name || valueFor(task, col._id)
                        : valueFor(task, col._id);
                      // Status/dropdown render full-bleed (Monday-style colored
                      // cell): drop the cell padding and let the cell stretch.
                      const fullBleed = col.type === 'status' || col.type === 'dropdown';
                      return (
                        <div
                          key={col._id}
                          className={col.isPrimary ? FROZEN_CELL_BG : undefined}
                          style={{
                            minHeight: ROW_HEIGHT,
                            display: 'flex',
                            alignItems: fullBleed ? 'stretch' : 'center',
                            // 8px here + the cell renderer's own 8px inner pad
                            // lands content at 16px, matching the classic table.
                            padding: fullBleed ? 0 : '0 8px',
                            borderRight: '1px solid var(--color-border)',
                            // The primary "Lead" column stays pinned on the left
                            // while the rest of the columns scroll horizontally.
                            position: col.isPrimary ? 'sticky' : undefined,
                            left: col.isPrimary ? FROZEN_PRIMARY_LEFT : undefined,
                            zIndex: col.isPrimary ? 2 : undefined,
                          }}
                        >
                          {col.isPrimary && task.hasSubitems && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(task._id)}
                              aria-label={isExpanded ? t('grid.collapseSubitems') : t('grid.expandSubitems')}
                              aria-expanded={isExpanded}
                              className="flex items-center justify-center rounded hover:bg-[color:var(--color-bg-subtle)]"
                              style={{
                                width: 18,
                                height: 18,
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--color-text-secondary)',
                                flexShrink: 0,
                                padding: 0,
                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                transition: 'transform 150ms ease',
                              }}
                            >
                              <ChevronRight size={14} aria-hidden="true" />
                            </button>
                          )}
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              alignItems: fullBleed ? 'stretch' : 'center',
                              alignSelf: 'stretch',
                            }}
                          >
                            <Cell
                              value={value}
                              column={col}
                              task={task}
                              readOnly={readOnly || col.type === 'formula'}
                              onChange={(v) => onCellChange(task, col, v)}
                              onUpdateColumn={readOnly ? undefined : (patch) => updateColumn(board._id, col._id, patch)}
                            />
                          </div>
                          {/* Monday-style "write a new update" ⊕ — sits right of
                              the Name with a divider line. */}
                          {col.isPrimary && typeof onOpenTask === 'function' && (
                            <button
                              type="button"
                              onClick={() => onOpenTask(task)}
                              title={t('grid.writeUpdate')}
                              aria-label={
                                commentCount > 0
                                  ? t('grid.openCommentsCount', { count: commentCount })
                                  : t('grid.writeUpdate')
                              }
                              className="flex items-center justify-center transition-colors duration-150 hover:bg-[color:var(--color-accent-light)]"
                              style={{
                                position: 'relative',
                                width: 30,
                                height: 28,
                                marginLeft: 8,
                                paddingLeft: 8,
                                border: 'none',
                                borderLeft: '1px solid var(--color-border)',
                                background: 'transparent',
                                cursor: 'pointer',
                                flexShrink: 0,
                              }}
                            >
                              <MessageSquarePlus size={15} color="var(--color-text-muted)" aria-hidden="true" />
                              {commentCount > 0 && (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    right: 0,
                                    minWidth: 14,
                                    height: 14,
                                    padding: '0 3px',
                                    boxSizing: 'border-box',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 9999,
                                    background: 'var(--color-accent)',
                                    color: '#fff',
                                    fontSize: 9,
                                    fontWeight: 700,
                                    lineHeight: 1,
                                  }}
                                >
                                  {commentCount > 9 ? '9+' : commentCount}
                                </span>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Actions ⋯ */}
                    <Cellish center pad="0 8px 0 0">
                      {!readOnly && typeof onActionsClick === 'function' && (
                        <button
                          type="button"
                          onClick={(e) => onActionsClick(task, e)}
                          aria-label={t('grid.leadActions')}
                          title={t('grid.actions')}
                          className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                          style={{ ...actionBtnStyle, marginLeft: 'auto' }}
                        >
                          <MoreHorizontal size={16} color="var(--color-text-secondary)" aria-hidden="true" />
                        </button>
                      )}
                    </Cellish>

                    {/* Add-column trailing cell + filler (empty in body) */}
                    <div />
                    <div />
                  </div>

                  {isExpanded && (
                    <SubitemsBlock
                      parent={task}
                      board={board}
                      minWidth={minRowWidth}
                      onOpenTask={onOpenTask}
                      isAdmin={!readOnly}
                    />
                  )}
                </Fragment>
              )}
            </SortableItem>
          );
        })}
      </SortableContext>

      {tasks.length === 0 && !(onSaveNew && !readOnly) && (
        <div
          style={{
            minWidth: minRowWidth,
            padding: '20px 16px',
            color: 'var(--color-text-muted)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          {t('grid.noLeadsInGroup')}
        </div>
      )}

      {/* Inline "+ Add task" row */}
      {!readOnly && onSaveNew && <AddTaskRow minWidth={minRowWidth} onSaveNew={onSaveNew} />}

      {/* Per-group summary footer — numeric SUM/AVG and status distribution. */}
      {tasks.length > 0 && hasSummarisableColumn(columns) && (
        <GroupSummaryRow
          columns={columns}
          tasks={tasks}
          sharedRowStyle={sharedRowStyle}
          numAgg={numAgg}
          onCycleAgg={cycleAgg}
        />
      )}

      {/* Column actions menu (rename / delete) — portaled so it escapes the
          grid's scroll/overflow clipping. */}
      {headerMenu &&
        (() => {
          const col = columns.find((c) => c._id === headerMenu.columnId);
          if (!col) return null;
          return (
            <PortalMenu anchor={headerMenu.anchor} onClose={() => setHeaderMenu(null)}>
              <button
                type="button"
                style={menuItemStyle}
                onClick={() => {
                  setRenamingId(col._id);
                  setRenameDraft(col.name);
                  setHeaderMenu(null);
                }}
              >
                {t('grid.rename')}
              </button>

              {/* Column colour swatches */}
              <div style={{ padding: '6px 8px 2px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                {t('grid.columnColor')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 8px 8px' }}>
                <button
                  type="button"
                  title={t('grid.noColor')}
                  onClick={() => handleSetColor(col, null)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: !col.color ? '2px solid var(--color-text-primary)' : '1px solid var(--color-border)',
                    background: 'var(--color-bg-subtle)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ width: 12, height: 2, background: 'var(--color-text-muted)', transform: 'rotate(-45deg)' }} />
                </button>
                {COLUMN_HEADER_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => handleSetColor(col, c)}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: col.color === c ? '2px solid var(--color-text-primary)' : '1px solid var(--color-border)',
                      background: c,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>

              <button
                type="button"
                disabled={col.isPrimary}
                style={{
                  ...menuItemStyle,
                  color: col.isPrimary ? 'var(--color-text-muted)' : '#DC2626',
                  cursor: col.isPrimary ? 'not-allowed' : 'pointer',
                }}
                onClick={() => handleDelete(col)}
              >
                {t('grid.delete')}
              </button>
            </PortalMenu>
          );
        })()}
    </div>
  );
};

// Left offsets for the frozen (pinned) region: drag handle, checkbox, and the
// primary "Lead" column stay put while the rest of the columns scroll under.
const FROZEN_DRAG_LEFT = 0;
const FROZEN_CHECK_LEFT = DRAG_WIDTH;
const FROZEN_PRIMARY_LEFT = DRAG_WIDTH + CHECK_WIDTH;

// Opaque background for frozen body cells so scrolling columns pass underneath
// them, staying in sync with the row's hover / highlight states.
const FROZEN_CELL_BG =
  'bg-surface group-hover/datagrid-row:bg-[color:var(--color-bg-subtle)] ' +
  'group-[.macan-task-highlight]/datagrid-row:bg-[color:var(--color-accent-light)]';

/** Header cell shell with the shared header styling (matches TaskTable). */
const HeaderShell = ({
  children,
  align = 'flex-start',
  pad = '0 16px',
  className,
  divider = false,
  stickyLeft = null,
  accent = null,
}) => (
  <div
    className={className}
    style={{
      height: 40,
      padding: pad,
      borderBottom: accent ? `2px solid ${accent}` : '1px solid var(--color-border)',
      borderRight: divider ? '1px solid var(--color-border)' : undefined,
      background: accent ? `${accent}1A` : 'var(--color-bg-subtle)',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      color: 'var(--color-text-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: align,
      gap: 4,
      position: stickyLeft != null ? 'sticky' : 'relative',
      left: stickyLeft != null ? stickyLeft : undefined,
      zIndex: stickyLeft != null ? 3 : undefined,
    }}
  >
    {children}
  </div>
);

/** Body control cell (drag / checkbox / comments / actions). The row owns the border. */
const Cellish = ({ children, center = false, pad = '0 4px', divider = false, stickyLeft = null, className }) => (
  <div
    className={className}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: center ? 'center' : 'flex-start',
      padding: pad,
      borderRight: divider ? '1px solid var(--color-border)' : undefined,
      position: stickyLeft != null ? 'sticky' : undefined,
      left: stickyLeft != null ? stickyLeft : undefined,
      zIndex: stickyLeft != null ? 2 : undefined,
    }}
  >
    {children}
  </div>
);

/**
 * GroupSummaryRow — footer beneath a group's rows. Numeric columns show a
 * clickable SUM/AVG/COUNT/MIN/MAX aggregate; status & dropdown columns show a
 * "battery" distribution bar of their options. (Phase 1.6.)
 */
const GroupSummaryRow = ({ columns, tasks, sharedRowStyle, numAgg, onCycleAgg }) => {
  const { t, i18n } = useTranslation();
  const AGG_LABEL = {
    sum: t('grid.aggSum'),
    avg: t('grid.aggAvg'),
    count: t('grid.aggCount'),
    min: t('grid.aggMin'),
    max: t('grid.aggMax'),
  };
  const footerBg = 'var(--color-bg-subtle)';
  const frozen = (left) => ({ position: 'sticky', left, zIndex: 2, background: footerBg });
  const cellBase = {
    display: 'flex',
    alignItems: 'center',
    minHeight: 38,
    padding: '0 8px',
    borderRight: '1px solid var(--color-border)',
  };

  return (
    <div
      style={{
        ...sharedRowStyle,
        background: footerBg,
        borderTop: '2px solid var(--color-border-strong)',
      }}
    >
      <div style={frozen(FROZEN_DRAG_LEFT)} />
      <div style={frozen(FROZEN_CHECK_LEFT)} />
      {columns.map((col) => {
        if (col.isPrimary) {
          return <div key={col._id} style={{ ...cellBase, ...frozen(FROZEN_PRIMARY_LEFT) }} />;
        }
        if (col.type === 'number') {
          const agg = numAgg.get(col._id) || 'sum';
          const { value } = summarizeNumber(tasks, col._id, agg);
          return (
            <button
              key={col._id}
              type="button"
              onClick={() => onCycleAgg(col._id)}
              title={AGG_LABEL[agg]}
              style={{
                ...cellBase,
                justifyContent: 'flex-end',
                gap: 6,
                background: 'transparent',
                border: 'none',
                borderRight: '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-text-muted)',
                }}
              >
                {AGG_LABEL[agg]}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {formatAgg(value, agg, i18n.resolvedLanguage)}
              </span>
            </button>
          );
        }
        if (col.type === 'status' || col.type === 'dropdown') {
          const { segments, total } = summarizeStatus(tasks, col);
          return (
            <div key={col._id} style={cellBase}>
              {total > 0 ? (
                <div
                  style={{
                    display: 'flex',
                    width: '100%',
                    height: 14,
                    borderRadius: 7,
                    overflow: 'hidden',
                    background: 'var(--color-border)',
                  }}
                >
                  {segments.map((s) => (
                    <div
                      key={s.id}
                      title={t('grid.summaryDistribution', { label: s.label, count: s.count })}
                      style={{
                        width: `${(s.count / total) * 100}%`,
                        background: s.color || 'var(--color-border-strong)',
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        }
        return <div key={col._id} style={cellBase} />;
      })}
      {/* Trailing actions / add-column / filler tracks (empty). */}
      <div />
      <div />
      <div />
    </div>
  );
};

const iconBtnStyle = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 3,
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  display: 'inline-flex',
  alignItems: 'center',
};

// Row action buttons (open / ⋯) — 28×28, matching TaskRow.
const actionBtnStyle = {
  width: 28,
  height: 28,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

/**
 * SubitemsBlock — full-width block beneath an expanded row. Lists the parent's
 * subitems with a clickable status dot + name, and an admin "+ Add subitem"
 * affordance. Mirrors TaskTable's SubitemsRow behavior.
 */
const SubitemsBlock = ({ parent, board, minWidth, onOpenTask, isAdmin }) => {
  const { t } = useTranslation();
  const subitems = useTaskStore((s) => s.subitemsByParent[parent._id] || null);
  const addSubitem = useTaskStore((s) => s.addSubitem);
  const updateSubitem = useTaskStore((s) => s.updateSubitem);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [error, setError] = useState('');

  const boardStatuses = useMemo(() => {
    if (!board || !Array.isArray(board.statuses)) return [];
    return [...board.statuses].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [board]);

  const handleCycleStatus = async (sub) => {
    if (boardStatuses.length === 0) return;
    const currentId = sub.status ? sub.status.toString() : null;
    const idx = boardStatuses.findIndex((s) => s._id.toString() === currentId);
    const next = boardStatuses[(idx + 1) % boardStatuses.length];
    try {
      const updated = await taskService.updateTask(sub._id, { status: next._id });
      updateSubitem(updated);
    } catch (err) {
      setError(err?.response?.data?.error || t('grid.failedUpdateStatus'));
    }
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    const trimmed = newText.trim();
    if (!trimmed) return;
    try {
      await addSubitem(parent._id, { name: trimmed });
      setNewText('');
      setAdding(true);
    } catch (err) {
      setError(err?.response?.data?.error || t('grid.failedAddSubitem'));
    }
  };

  const items = Array.isArray(subitems) ? subitems : [];
  const loading = subitems == null;

  return (
    <div
      style={{
        minWidth,
        background: 'var(--color-bg-subtle)',
        borderBottom: '1px solid var(--color-border)',
        padding: '8px 16px 12px 56px',
      }}
    >
      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--color-status-stuck)', marginBottom: 6 }}>
          {error}
        </p>
      )}
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('grid.loadingSubitems')}</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('grid.noSubitems')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((sub) => {
            const palette = getStatusPalette(board, sub.status);
            return (
              <li key={sub._id} className="flex items-center gap-2" style={{ padding: '3px 0' }}>
                <button
                  type="button"
                  onClick={() => handleCycleStatus(sub)}
                  aria-label={t('grid.statusClickToChange', { label: palette.label })}
                  title={palette.label}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: palette.solid || palette.text,
                    border: '1.5px solid #FFFFFF',
                    boxShadow: '0 0 0 1px var(--color-border-strong)',
                    flexShrink: 0,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
                <button
                  type="button"
                  onClick={() => onOpenTask?.(sub)}
                  className="text-left truncate hover:underline"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {sub.name}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenTask?.(sub)}
                  aria-label={t('grid.openNamed', { name: sub.name })}
                  title={t('grid.openSubitem')}
                  style={{ ...iconBtnStyle, flexShrink: 0 }}
                >
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin &&
        (adding ? (
          <form onSubmit={handleAdd} className="flex items-center gap-2" style={{ marginTop: 6 }}>
            <span
              aria-hidden="true"
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                border: '1.5px solid var(--color-border-strong)',
                flexShrink: 0,
              }}
            />
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onBlur={() => {
                if (!newText.trim()) setAdding(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setNewText('');
                  setAdding(false);
                }
              }}
              placeholder={t('grid.newSubitem')}
              autoFocus
              className="flex-1 focus:outline-none"
              style={{
                fontSize: 13,
                padding: '4px 6px',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
              }}
            />
            <button
              type="submit"
              disabled={!newText.trim()}
              style={{
                height: 26,
                padding: '0 10px',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--color-accent)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: newText.trim() ? 'pointer' : 'not-allowed',
                opacity: newText.trim() ? 1 : 0.4,
              }}
            >
              {t('grid.add')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 hover:text-[color:var(--color-accent)]"
            style={{
              marginTop: 6,
              padding: '4px 0',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Plus size={12} aria-hidden="true" />
            {t('grid.addSubitem')}
          </button>
        ))}
    </div>
  );
};

/**
 * PortalMenu — a small floating menu rendered to document.body via a portal so
 * it escapes any `overflow:hidden`/`overflow:auto` ancestor.
 */
const PortalMenu = ({ anchor, onClose, children, width = 160 }) => {
  const [pos, setPos] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!anchor) return undefined;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const top = r.bottom + 4;
      setPos({ left, top });
    };
    place();

    const onScroll = () => onClose();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocClick = (e) => {
      if (anchor.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [anchor, onClose, width]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 1000,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: 4,
        minWidth: width,
      }}
    >
      {children}
    </div>,
    document.body
  );
};

/**
 * AddTaskRow — full-width input that creates a new task in the group. Commits
 * on Enter or blur (when non-empty), then clears for the next entry.
 */
const AddTaskRow = ({ minWidth, onSaveNew }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) {
      setName('');
      return;
    }
    setSaving(true);
    try {
      await onSaveNew({ name: trimmed });
      setName('');
    } catch {
      // onSaveNew surfaces its own error toast; keep the text so the user
      // can retry without retyping.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="hover:bg-[color:var(--color-bg-subtle)] transition-colors duration-100"
      style={{
        minWidth,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: `0 16px 0 ${DRAG_WIDTH + CHECK_WIDTH}px`,
        minHeight: ROW_HEIGHT,
      }}
    >
      <span style={{ color: 'var(--color-text-muted)', fontSize: 16, lineHeight: 1 }}>+</span>
      <input
        value={name}
        disabled={saving}
        placeholder={t('grid.addLead')}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setName('');
        }}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: 13,
          color: 'var(--color-text-primary)',
          padding: '8px 0',
        }}
      />
    </div>
  );
};

const menuItemStyle = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  fontSize: 12,
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-primary)',
  borderRadius: 'var(--radius-sm)',
};

export default DataGrid;
