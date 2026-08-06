import { useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findOption, optionSorted } from './columns/cellShared';
import { getAvatarColor } from '../../utils/avatarColors';
import { formatDate } from '../../utils/dateUtils';

/**
 * BoardKanbanView — a stage-column Kanban. Columns are the board's groups
 * (pipeline stages); cards are leads. Dragging a card reorders it within a
 * stage or moves it to another stage — persisted via `onReorder(targetGroupId,
 * orderedIds)` (the store's reorder action, which handles both). "+ Add lead"
 * creates a card in that stage. Read-only derived cards (name + status + person
 * + a date); clicking a card opens the detail panel.
 */

// columnValues may be a Map or a plain object (varies by task source).
const cellVal = (task, colId) => {
  if (!task || !task.columnValues || !colId) return undefined;
  const key = colId.toString();
  return typeof task.columnValues.get === 'function' ? task.columnValues.get(key) : task.columnValues[key];
};

const initials = (name) => (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Avatars({ ids, memberById }) {
  const list = (Array.isArray(ids) ? ids : ids != null ? [ids] : []).map(String).filter(Boolean).slice(0, 3);
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex' }}>
      {list.map((id, n) => {
        const m = memberById.get(id);
        const name = m?.name || m?.email || '';
        return m?.profilePic ? (
          <img key={id} src={m.profilePic} alt="" title={name}
            style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--color-bg-surface,#fff)', marginLeft: n ? -6 : 0 }} />
        ) : (
          <span key={id} title={name}
            style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700, color: '#fff',
              background: getAvatarColor(name || id), border: '2px solid var(--color-bg-surface,#fff)', marginLeft: n ? -6 : 0, fontFamily: 'var(--font-display)' }}>
            {initials(name || '·')}
          </span>
        );
      })}
    </div>
  );
}

function KanbanCard({ task, fields, memberById }) {
  const name = cellVal(task, fields.primary?._id) || task.name || '—';
  const statusVal = fields.status ? cellVal(task, fields.status._id) : undefined;
  const statusOpt = fields.status ? findOption(optionSorted(fields.status.settings?.options), statusVal) : null;
  const personVal = fields.person ? cellVal(task, fields.person._id) : undefined;
  const dateVal = fields.date ? cellVal(task, fields.date._id) : undefined;

  return (
    <div style={{
      background: 'var(--color-bg-surface,#fff)', border: '1px solid var(--color-border)', borderRadius: 10,
      padding: '11px 12px', boxShadow: '0 1px 2px rgba(41,47,76,.05)', display: 'flex', flexDirection: 'column', gap: 9,
    }}>
      <div className="font-body" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>{String(name)}</div>
      {(statusOpt || dateVal) && (
        <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
          {statusOpt && (
            <span className="inline-flex items-center" style={{ gap: 6, height: 22, padding: '0 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
              background: `color-mix(in srgb, ${statusOpt.color || '#8A8273'} 16%, transparent)`, color: 'var(--color-text-primary)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: statusOpt.color || '#8A8273' }} />
              {statusOpt.label}
            </span>
          )}
          {dateVal && <span className="font-body" style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{formatDate(dateVal)}</span>}
        </div>
      )}
      {fields.person && <Avatars ids={personVal} memberById={memberById} />}
    </div>
  );
}

function SortableCard({ task, fields, memberById, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task._id });
  const [moved, setMoved] = useState(false);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={() => setMoved(false)}
      onPointerMove={() => setMoved(true)}
      onClick={() => { if (!moved) onOpen?.(task); }}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.35 : 1, cursor: 'pointer', touchAction: 'none',
      }}
    >
      <KanbanCard task={task} fields={fields} memberById={memberById} />
    </div>
  );
}

function KanbanColumn({ group, tasks, fields, memberById, onOpen, onAddCard, canAdd, t }) {
  const { setNodeRef, isOver } = useDroppable({ id: group._id });
  const ids = tasks.map((tk) => tk._id);
  return (
    <div style={{ width: 288, flex: '0 0 288px', display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
      <div className="flex items-center" style={{ gap: 8, padding: '0 4px 10px' }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: group.color || 'var(--color-accent)' }} />
        <span className="font-body" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{group.name}</span>
        <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className="flex flex-col"
        style={{
          gap: 8, padding: 8, borderRadius: 12, minHeight: 80, flex: 1, overflowY: 'auto',
          background: isOver ? 'var(--color-accent-light,#EEF3EA)' : 'var(--color-bg-subtle)',
          border: isOver ? '1.5px dashed var(--color-accent)' : '1.5px dashed transparent', transition: 'background .12s, border-color .12s',
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableCard key={task._id} task={task} fields={fields} memberById={memberById} onOpen={onOpen} />
          ))}
        </SortableContext>
      </div>
      {canAdd && (
        <button
          type="button"
          onClick={() => onAddCard?.(group._id)}
          className="flex items-center justify-center gap-1.5 font-body"
          style={{ marginTop: 8, height: 34, borderRadius: 9, border: '1.5px dashed var(--color-border-strong,#D2C7B0)', background: 'transparent',
            color: 'var(--color-text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <Plus size={14} /> {t('board.kanbanAddLead', 'Add lead')}
        </button>
      )}
    </div>
  );
}

const BoardKanbanView = ({ board, groups = [], tasksByGroup = {}, members = [], isAdmin = false, onOpenTask, onReorder, onAddCard }) => {
  const { t } = useTranslation();
  const [activeTask, setActiveTask] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const memberById = useMemo(() => new Map((members || []).map((m) => [String(m._id), m])), [members]);
  const cols = board?.columns || [];
  const fields = useMemo(() => ({
    primary: cols.find((c) => c.isPrimary),
    status: cols.find((c) => c.type === 'status'),
    person: cols.find((c) => c.type === 'person'),
    date: cols.find((c) => c.type === 'date' || c.type === 'timeline'),
  }), [cols]);

  const groupOfTask = (id) => {
    for (const g of groups) {
      if ((tasksByGroup[g._id] || []).some((tk) => tk._id === id)) return g._id;
    }
    return null;
  };

  const onDragStart = (e) => {
    const id = e.active.id;
    setActiveTask((tasksByGroup[groupOfTask(id)] || []).find((tk) => tk._id === id) || null);
  };

  const onDragEnd = (e) => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = active.id;
    const fromGroup = groupOfTask(activeId);
    if (!fromGroup) return;
    const overIsGroup = groups.some((g) => g._id === over.id);
    const toGroup = overIsGroup ? over.id : groupOfTask(over.id);
    if (!toGroup) return;

    const targetIds = (tasksByGroup[toGroup] || []).map((tk) => tk._id);
    if (fromGroup === toGroup) {
      const oldIndex = targetIds.indexOf(activeId);
      const newIndex = overIsGroup ? targetIds.length - 1 : targetIds.indexOf(over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      onReorder?.(toGroup, arrayMove(targetIds, oldIndex, newIndex));
    } else {
      const insertAt = overIsGroup ? targetIds.length : Math.max(0, targetIds.indexOf(over.id));
      const next = [...targetIds];
      next.splice(insertAt, 0, activeId);
      onReorder?.(toGroup, next);
    }
  };

  if (groups.length === 0) {
    return <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 4px' }}>{t('board.kanbanNoStages', 'Add stages (groups) to use the Kanban view.')}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
      <div className="flex" style={{ gap: 14, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start', maxHeight: 'calc(100vh - 240px)' }}>
        {groups.map((g) => (
          <KanbanColumn key={g._id} group={g} tasks={tasksByGroup[g._id] || []} fields={fields} memberById={memberById}
            onOpen={onOpenTask} onAddCard={onAddCard} canAdd={isAdmin} t={t} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div style={{ width: 272, transform: 'rotate(2deg)' }}>
            <KanbanCard task={activeTask} fields={fields} memberById={memberById} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default BoardKanbanView;
