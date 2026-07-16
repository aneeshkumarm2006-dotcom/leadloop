import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { ChevronLeft, ChevronRight, List as ListIcon, LayoutGrid, AlertTriangle } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { SkeletonCalendarGrid } from '../components/ui/Skeleton';
import CommentPanel from '../components/board/CommentPanel';
import CalendarFilterBar, { UNASSIGNED_ID } from '../components/calendar/CalendarFilterBar';
import CalendarViewSidebar from '../components/calendar/CalendarViewSidebar';
import CalendarViewForm from '../components/calendar/CalendarViewForm';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import useBoardStore from '../store/boardStore';
import { getCalendarTasks, getTasks, updateTask } from '../services/taskService';
import * as calendarViewService from '../services/calendarViewService';
import { getPriorityColor } from '../utils/priorityColors';
import { isStatusDone } from '../utils/statusUtils';

// Canonical "done" green from globals.css → --color-status-done.
const DONE_GREEN = '#16A34A';

const localizer = momentLocalizer(moment);
// react-big-calendar's dragAndDrop addon is a CommonJS module. Under Vite's
// ESM interop the default import can arrive as the function itself or wrapped
// as { default: fn }, so normalise before calling it.
const withDnD =
  typeof withDragAndDrop === 'function' ? withDragAndDrop : withDragAndDrop.default;
const DnDCalendar = withDnD(Calendar);

// react-big-calendar built-in views we expose. The saved "resource" layout
// renders through the `day` time view with a `resources` roster.
const RBC_VIEWS = ['month', 'week', 'day', 'agenda'];
const UNASSIGNED_RESOURCE = '__unassigned__';

/** Map a saved view's layout to a concrete react-big-calendar view name. */
const layoutToRbcView = (layout) => (layout === 'resource' ? 'day' : layout || 'month');

/**
 * Map a legacy task (default calendar) to a react-big-calendar event. start/end
 * are the due date so it renders as a single-day block.
 */
const taskToEvent = (task) => {
  const due = task.dueDate ? new Date(task.dueDate) : null;
  return {
    id: task._id,
    title: task.name,
    start: due,
    end: due,
    allDay: true,
    resource: task,
  };
};

/** Map a normalized saved-view event to a react-big-calendar event. */
const normalizedToEvent = (e) => ({
  id: e.id,
  title: e.title,
  start: new Date(e.start),
  end: new Date(e.end),
  allDay: true,
  color: e.color,
  resourceId: e.resourceId == null ? UNASSIGNED_RESOURCE : e.resourceId,
});

/**
 * Style an event pill. Saved-view events carry an explicit `color`; the legacy
 * default calendar colours by priority (green when done).
 */
const eventPropGetter = (event) => {
  let solid = event.color;
  if (!solid) {
    const task = event.resource || {};
    const done = isStatusDone(task.board, task.status);
    solid = done ? DONE_GREEN : getPriorityColor(task.priority || 'low').solid;
  }
  return {
    style: {
      backgroundColor: solid,
      borderColor: solid,
      color: '#FFFFFF',
      border: 'none',
      borderRadius: 4,
      padding: '1px 6px',
      fontSize: 11,
      fontWeight: 500,
      fontFamily: 'Familjen Grotesk, sans-serif',
      height: 22,
      lineHeight: '20px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  };
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Header toolbar — month/week toggle + month navigation + grid/list (mobile).
 */
const CalendarToolbar = ({
  view,
  onViewChange,
  date,
  onNavigate,
  mobileMode,
  onMobileModeChange,
  isMobile,
  showViewToggle = true,
}) => {
  const { t } = useTranslation();
  const label = view === 'week'
    ? moment(date).startOf('week').format('MMM D') +
      ' – ' +
      moment(date).endOf('week').format('MMM D, YYYY')
    : `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <h1
        className="font-display font-bold"
        style={{ fontSize: 28, color: 'var(--color-text-primary)', lineHeight: 1.2 }}
      >
        {t('pages.calendar')}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        {isMobile && (
          <PillToggle
            options={[
              { value: 'list', label: t('pages.list'), icon: ListIcon },
              { value: 'grid', label: t('pages.grid'), icon: LayoutGrid },
            ]}
            value={mobileMode}
            onChange={onMobileModeChange}
          />
        )}

        {showViewToggle && (!isMobile || mobileMode === 'grid') && (
          <PillToggle
            options={[
              { value: 'month', label: t('pages.month') },
              { value: 'week', label: t('pages.week') },
            ]}
            value={view === 'week' ? 'week' : 'month'}
            onChange={onViewChange}
          />
        )}

        <div
          className="flex items-center gap-1 bg-surface"
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-full)',
            padding: '2px 6px',
          }}
        >
          <NavArrow direction="prev" onClick={() => onNavigate('PREV')} />
          <span
            className="font-body font-medium"
            style={{
              fontSize: 13,
              color: 'var(--color-text-primary)',
              minWidth: 140,
              textAlign: 'center',
              padding: '0 8px',
            }}
          >
            {label}
          </span>
          <NavArrow direction="next" onClick={() => onNavigate('NEXT')} />
        </div>
      </div>
    </div>
  );
};

const NavArrow = ({ direction, onClick }) => {
  const { t } = useTranslation();
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'prev' ? t('pages.previous') : t('pages.next')}
      className="flex items-center justify-center rounded-full transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
      style={{ width: 28, height: 28 }}
    >
      <Icon size={16} color="var(--color-text-secondary)" aria-hidden="true" />
    </button>
  );
};

const PillToggle = ({ options, value, onChange }) => (
  <div
    className="flex items-center bg-surface"
    style={{
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-full)',
      padding: 2,
    }}
  >
    {options.map((opt) => {
      const active = opt.value === value;
      const Icon = opt.icon;
      return (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={active}
          className="font-body font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{
            fontSize: 12,
            height: 28,
            padding: Icon ? '0 10px' : '0 14px',
            borderRadius: 'var(--radius-full)',
            background: active ? 'var(--color-accent)' : 'transparent',
            color: active ? '#FFFFFF' : 'var(--color-text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          {Icon && <Icon size={13} aria-hidden="true" />}
          {opt.label}
        </button>
      );
    })}
  </div>
);

/**
 * Simplified list view — used as the default on mobile. Groups events by date.
 */
const TaskListView = ({ events, onSelect }) => {
  const { t } = useTranslation();
  const grouped = useMemo(() => {
    const byDate = new Map();
    for (const ev of events) {
      const key = moment(ev.start).format('YYYY-MM-DD');
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(ev);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (events.length === 0) {
    return (
      <div
        className="bg-surface text-center"
        style={{
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-card)',
          padding: '40px 20px',
        }}
      >
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
          {t('pages.noLeadsScheduled')}
        </p>
      </div>
    );
  }

  return (
    <div
      className="bg-surface overflow-hidden"
      style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}
    >
      {grouped.map(([dateKey, items], groupIdx) => (
        <div key={dateKey}>
          <div
            className="font-body font-semibold"
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-text-secondary)',
              padding: '10px 16px',
              background: 'var(--color-bg-subtle)',
              borderTop: groupIdx === 0 ? 'none' : '1px solid var(--color-border)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            {moment(dateKey).format('ddd, MMM D')}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((ev, i) => {
              const task = ev.resource;
              let solid = ev.color;
              if (!solid) {
                const done = isStatusDone(task?.board, task?.status);
                solid = done ? DONE_GREEN : getPriorityColor(task?.priority || 'low').solid;
              }
              return (
                <li
                  key={ev.id}
                  style={{
                    borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--color-border)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(ev)}
                    className="w-full flex items-center gap-3 text-left transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus:outline-none focus:bg-[color:var(--color-bg-subtle)]"
                    style={{ padding: '12px 16px' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ width: 10, height: 10, borderRadius: '50%', background: solid, flexShrink: 0 }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="font-body block truncate"
                        style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}
                      >
                        {ev.title}
                      </span>
                      {task?.board?.name && (
                        <span
                          className="font-body block truncate"
                          style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}
                        >
                          {task.board.name}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};

/** Compute the [from, to] window of tasks to fetch for the current view+date. */
const rangeForView = (date, rbcView) => {
  const m = moment(date);
  if (rbcView === 'week' || rbcView === 'day' || rbcView === 'agenda') {
    const unit = rbcView === 'day' ? 'day' : 'week';
    return { from: m.clone().startOf(unit).toDate(), to: m.clone().endOf(unit).toDate() };
  }
  // month — pad to the full visible grid (leading/trailing weeks).
  return {
    from: m.clone().startOf('month').startOf('week').toDate(),
    to: m.clone().endOf('month').endOf('week').toDate(),
  };
};

const CalendarPage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const orgMembers = useOrgStore((s) => s.members);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const currentUserId = useAuthStore((s) => s.user?._id);

  const isAdmin = useMemo(() => {
    if (!currentOrg || !currentUserId) return false;
    const adminId = typeof currentOrg.admin === 'object' ? currentOrg.admin?._id : currentOrg.admin;
    if (adminId && String(adminId) === String(currentUserId)) return true;
    return (
      Array.isArray(currentOrg.admins) &&
      currentOrg.admins.some((a) => String(typeof a === 'object' ? a._id : a) === String(currentUserId))
    );
  }, [currentOrg, currentUserId]);

  const [rbcView, setRbcView] = useState('month');
  const [date, setDate] = useState(() => new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);

  // Saved views
  const [views, setViews] = useState([]);
  const [resources, setResources] = useState(null);
  // task lookup for CommentPanel click-through on saved-view events
  const [taskById, setTaskById] = useState({});

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedViewId = searchParams.get('view') || null;
  const selectedView = useMemo(
    () => views.find((v) => String(v._id) === String(selectedViewId)) || null,
    [views, selectedViewId]
  );

  // --- URL-backed legacy filter state (default calendar only) -------------
  const boardFilter = useMemo(() => {
    const raw = searchParams.get('boards');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [searchParams]);
  const assigneeFilter = useMemo(() => {
    const raw = searchParams.get('assignees');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [searchParams]);

  const setParam = useCallback(
    (key, value) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value && (Array.isArray(value) ? value.length : true)) {
            next.set(key, Array.isArray(value) ? value.join(',') : value);
          } else {
            next.delete(key);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSelectView = useCallback(
    (id) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set('view', id);
            // A saved view filters server-side — drop the legacy filters.
            next.delete('boards');
            next.delete('assignees');
          } else {
            next.delete('view');
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Hydrate boards + members for the filter bar / view form.
  useEffect(() => {
    if (!orgId) return;
    if (boards.length === 0) fetchBoards(orgId).catch((e) => console.error(e));
    if (orgMembers.length === 0) fetchMembers(orgId).catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Load saved views for the workspace.
  const reloadViews = useCallback(async () => {
    if (!orgId) return [];
    try {
      const list = await calendarViewService.listViews(orgId);
      setViews(list);
      return list;
    } catch (err) {
      console.error('Failed to load calendar views:', err);
      return [];
    }
  }, [orgId]);

  useEffect(() => {
    reloadViews();
  }, [reloadViews]);

  // When a saved view is selected, align the RBC view with its layout.
  useEffect(() => {
    if (selectedView) setRbcView(layoutToRbcView(selectedView.layout));
    else setRbcView((v) => (v === 'month' || v === 'week' ? v : 'month'));
  }, [selectedView]);

  // Responsive: list view on mobile.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [mobileMode, setMobileMode] = useState('list');
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Source column type for the active saved view (drives drag write shape).
  const activeSourceColumn = useMemo(() => {
    if (!selectedView || !selectedView.boardId || !selectedView.sourceColumnId) return null;
    const board = boards.find((b) => String(b._id) === String(selectedView.boardId));
    if (!board || !Array.isArray(board.columns)) return null;
    return board.columns.find((c) => String(c._id) === String(selectedView.sourceColumnId)) || null;
  }, [selectedView, boards]);

  // --- Fetch events for the active view + range ---------------------------
  const fetchEvents = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setWarning('');
    try {
      if (!selectedView) {
        // Default calendar — legacy dueDate source.
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const tasks = await getCalendarTasks(month, year, orgId);
        const withDates = (tasks || []).filter((t) => t.dueDate);
        setEvents(withDates.map(taskToEvent));
        setTaskById(Object.fromEntries(withDates.map((t) => [String(t._id), t])));
        setResources(null);
        setError('');
        return;
      }

      const range = rangeForView(date, rbcView);
      const res = await calendarViewService.getEvents(selectedView._id, range);
      setEvents((res.events || []).map(normalizedToEvent));
      setWarning(res.warning || '');
      setError('');

      // Build resource roster for resource layouts.
      if (selectedView.layout === 'resource') {
        if (res.resources) {
          setResources([
            ...res.resources.filter((r) => r.id).map((r) => ({ id: r.id, title: r.title })),
            { id: UNASSIGNED_RESOURCE, title: t('pages.unassigned') },
          ]);
        } else {
          setResources([
            ...orgMembers.map((m) => ({ id: String(m._id), title: m.name })),
            { id: UNASSIGNED_RESOURCE, title: t('pages.unassigned') },
          ]);
        }
      } else {
        setResources(null);
      }

      // Best-effort: load the board's tasks so clicking an event opens the
      // full CommentPanel. Failure is non-fatal (falls back to a stub task).
      if (selectedView.boardId) {
        try {
          const tasks = await getTasks(selectedView.boardId);
          setTaskById(Object.fromEntries((tasks || []).map((t) => [String(t._id), t])));
        } catch {
          setTaskById({});
        }
      } else {
        setTaskById({});
      }
    } catch (err) {
      console.error('Failed to fetch calendar events:', err);
      setError(err?.response?.data?.error || t('pages.failedToLoadCalendar'));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedView, date, rbcView, orgMembers, t]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleNavigate = useCallback(
    (action) => {
      setDate((prev) => {
        const next = new Date(prev);
        const delta = action === 'PREV' ? -1 : 1;
        if (rbcView === 'week') next.setDate(prev.getDate() + delta * 7);
        else if (rbcView === 'day') next.setDate(prev.getDate() + delta);
        else {
          next.setMonth(prev.getMonth() + delta);
          next.setDate(1);
        }
        return next;
      });
    },
    [rbcView]
  );

  const handleSelectEvent = useCallback(
    (event) => {
      if (event.resource) {
        setSelectedTask(event.resource);
        return;
      }
      const full = taskById[String(event.id)];
      setSelectedTask(
        full || { _id: event.id, name: event.title, board: selectedView?.boardId || null }
      );
    },
    [taskById, selectedView]
  );

  // --- Drag-to-reschedule -------------------------------------------------
  const handleEventDrop = useCallback(
    async ({ event, start, end }) => {
      const startDate = start instanceof Date ? start : new Date(start);
      const endDate = end instanceof Date ? end : new Date(end);

      // Optimistic local move.
      setEvents((prev) =>
        prev.map((e) => (e.id === event.id ? { ...e, start: startDate, end: endDate } : e))
      );

      try {
        if (!selectedView) {
          await updateTask(event.id, { dueDate: startDate.toISOString() });
        } else if (activeSourceColumn) {
          const colId = String(activeSourceColumn._id);
          const value =
            activeSourceColumn.type === 'timeline'
              ? { start: startDate.toISOString(), end: endDate.toISOString() }
              : startDate.toISOString();
          await updateTask(event.id, { columnValues: { [colId]: value } });
        } else {
          // No writable source — revert.
          fetchEvents();
          return;
        }
        fetchEvents();
      } catch (err) {
        console.error('Failed to reschedule:', err);
        setError(t('pages.couldNotReschedule'));
        fetchEvents();
      }
    },
    [selectedView, activeSourceColumn, fetchEvents, t]
  );

  const handleEventResize = useCallback(
    ({ event, start, end }) => {
      // Resize only meaningful for timeline sources; reuse the drop handler.
      if (selectedView && activeSourceColumn?.type === 'timeline') {
        handleEventDrop({ event, start, end });
      }
    },
    [selectedView, activeSourceColumn, handleEventDrop]
  );

  const draggable = !selectedView || !!activeSourceColumn;

  // --- View CRUD ----------------------------------------------------------
  const openCreateForm = () => {
    setFormInitial(null);
    setFormError('');
    setFormOpen(true);
  };
  const openEditForm = (view) => {
    setFormInitial(view);
    setFormError('');
    setFormOpen(true);
  };

  const handleFormSubmit = async (payload) => {
    setFormSaving(true);
    setFormError('');
    try {
      let saved;
      if (formInitial) {
        saved = await calendarViewService.updateView(formInitial._id, payload);
      } else {
        saved = await calendarViewService.createView({ ...payload, workspaceId: orgId });
      }
      await reloadViews();
      setFormOpen(false);
      handleSelectView(saved._id);
    } catch (err) {
      setFormError(err?.response?.data?.error || t('pages.couldNotSaveView'));
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteView = async (view) => {
    if (!window.confirm(t('pages.deleteViewConfirm', { name: view.name }))) return;
    try {
      await calendarViewService.deleteView(view._id);
      const next = await reloadViews();
      if (String(selectedViewId) === String(view._id)) handleSelectView(null);
      else if (!next.length) handleSelectView(null);
    } catch (err) {
      console.error('Failed to delete view:', err);
      setError(t('pages.couldNotDeleteView'));
    }
  };

  // --- Legacy filter (default calendar only) ------------------------------
  const visibleEvents = useMemo(() => {
    if (selectedView) return events; // saved views filter server-side
    if (boardFilter.length === 0 && assigneeFilter.length === 0) return events;
    const boardSet = new Set(boardFilter);
    const assigneeSet = new Set(assigneeFilter);
    const matchUnassigned = assigneeSet.has(UNASSIGNED_ID);
    return events.filter((e) => {
      const task = e.resource || {};
      const boardId = task.board?._id || task.board || null;
      if (boardSet.size > 0 && !boardSet.has(boardId)) return false;
      if (assigneeSet.size > 0) {
        const assigned = task.assignedTo || [];
        const hasAny = assigned.length > 0;
        const matchesUser = assigned.some((a) => assigneeSet.has(a?._id || a));
        const matchesUnassignedRow = matchUnassigned && !hasAny;
        if (!matchesUser && !matchesUnassignedRow) return false;
      }
      return true;
    });
  }, [events, selectedView, boardFilter, assigneeFilter]);

  const showList = isMobile && mobileMode === 'list';
  const isResourceLayout = selectedView?.layout === 'resource' && !!resources;

  return (
    <>
      <PageWrapper>
        <CalendarToolbar
          view={rbcView}
          onViewChange={setRbcView}
          date={date}
          onNavigate={handleNavigate}
          mobileMode={mobileMode}
          onMobileModeChange={setMobileMode}
          isMobile={isMobile}
          showViewToggle={!selectedView || selectedView.layout === 'month' || selectedView.layout === 'week'}
        />

        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start">
          {!isMobile && (
            <CalendarViewSidebar
              views={views}
              activeViewId={selectedViewId}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onSelect={handleSelectView}
              onNew={openCreateForm}
              onEdit={openEditForm}
              onDelete={handleDeleteView}
            />
          )}

          <div className="flex-1 min-w-0">
            {/* Legacy filter bar only for the default calendar. */}
            {!selectedView ? (
              <div className="mb-4 flex justify-end">
                <CalendarFilterBar
                  boards={boards}
                  members={orgMembers}
                  boardFilter={boardFilter}
                  onBoardFilterChange={(ids) => setParam('boards', ids)}
                  assigneeFilter={assigneeFilter}
                  onAssigneeFilterChange={(ids) => setParam('assignees', ids)}
                  isAdmin={isAdmin}
                />
              </div>
            ) : (
              <CalendarFilterBar activeView={selectedView} onEditView={() => openEditForm(selectedView)} />
            )}

            {warning === 'column_missing' && (
              <div
                role="alert"
                className="mb-4 flex items-center gap-2 font-body"
                style={{
                  background: 'var(--color-status-working-bg)',
                  color: 'var(--color-status-working)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  {t('pages.columnMissing')}{' '}
                  <button
                    type="button"
                    onClick={() => openEditForm(selectedView)}
                    style={{ textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                  >
                    {t('pages.editView')}
                  </button>
                </span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-4 font-body"
                style={{
                  background: 'var(--color-status-stuck-bg)',
                  color: 'var(--color-status-stuck)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            {showList ? (
              <TaskListView events={visibleEvents} onSelect={handleSelectEvent} />
            ) : (
              <div
                className="bg-surface macan-calendar-wrap"
                style={{
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-card)',
                  padding: 12,
                  position: 'relative',
                }}
              >
                {loading && events.length === 0 ? (
                  <SkeletonCalendarGrid />
                ) : (
                  <DnDCalendar
                    localizer={localizer}
                    events={visibleEvents}
                    date={date}
                    view={rbcView}
                    onNavigate={setDate}
                    onView={setRbcView}
                    onSelectEvent={handleSelectEvent}
                    onEventDrop={handleEventDrop}
                    onEventResize={handleEventResize}
                    draggableAccessor={() => draggable}
                    resizable={isResourceLayout || (selectedView && activeSourceColumn?.type === 'timeline')}
                    eventPropGetter={eventPropGetter}
                    views={RBC_VIEWS}
                    popup
                    toolbar={false}
                    resources={isResourceLayout ? resources : undefined}
                    resourceIdAccessor={isResourceLayout ? 'id' : undefined}
                    resourceTitleAccessor={isResourceLayout ? 'title' : undefined}
                    style={{ height: rbcView === 'week' || rbcView === 'day' ? 640 : 720 }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </PageWrapper>

      <CommentPanel
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
      />

      {formOpen && (
        <CalendarViewForm
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          boards={boards}
          initial={formInitial}
          saving={formSaving}
          error={formError}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* react-big-calendar theming overrides to match Macan design system */}
      <style>{`
        .macan-calendar-wrap .rbc-calendar {
          font-family: 'Familjen Grotesk', sans-serif;
          color: var(--color-text-primary);
        }
        .macan-calendar-wrap .rbc-month-view,
        .macan-calendar-wrap .rbc-time-view {
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          overflow: hidden;
          background: var(--color-bg-surface);
        }
        .macan-calendar-wrap .rbc-header {
          background: var(--color-bg-subtle);
          text-transform: uppercase;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--color-text-secondary);
          padding: 10px 8px;
          border-bottom: 1px solid var(--color-border);
          border-left: 1px solid var(--color-border);
        }
        .macan-calendar-wrap .rbc-header:first-child { border-left: none; }
        .macan-calendar-wrap .rbc-month-row {
          border-top: 1px solid var(--color-border);
          min-height: 100px;
          overflow: visible;
        }
        .macan-calendar-wrap .rbc-day-bg {
          border-left: 1px solid var(--color-border);
          background: var(--color-bg-surface);
        }
        .macan-calendar-wrap .rbc-day-bg:first-child { border-left: none; }
        .macan-calendar-wrap .rbc-off-range-bg { background: var(--color-bg-base); }
        .macan-calendar-wrap .rbc-off-range { color: var(--color-text-muted); }
        .macan-calendar-wrap .rbc-today { background: var(--color-accent-light); }
        .macan-calendar-wrap .rbc-date-cell {
          text-align: right;
          padding: 6px 8px;
          font-size: 12px;
          color: var(--color-text-secondary);
        }
        .macan-calendar-wrap .rbc-date-cell.rbc-now > button,
        .macan-calendar-wrap .rbc-date-cell.rbc-now > a {
          color: var(--color-accent);
          font-weight: 700;
        }
        .macan-calendar-wrap .rbc-date-cell > button,
        .macan-calendar-wrap .rbc-date-cell > a {
          background: transparent;
          border: none;
          color: inherit;
          font: inherit;
          cursor: pointer;
          padding: 0;
        }
        .macan-calendar-wrap .rbc-event {
          padding: 1px 6px !important;
          margin-top: 1px !important;
          margin-bottom: 1px !important;
        }
        .macan-calendar-wrap .rbc-event:focus {
          outline: 2px solid var(--color-accent);
          outline-offset: 1px;
        }
        .macan-calendar-wrap .rbc-show-more {
          font-size: 11px;
          font-weight: 500;
          color: var(--color-accent);
          background: transparent;
          padding: 2px 6px;
        }
        .macan-calendar-wrap .rbc-show-more:hover { color: var(--color-accent-hover); }
        .macan-calendar-wrap .rbc-time-header-content,
        .macan-calendar-wrap .rbc-time-content {
          border-left: 1px solid var(--color-border);
        }
        .macan-calendar-wrap .rbc-time-slot,
        .macan-calendar-wrap .rbc-timeslot-group { border-color: var(--color-border); }
        .macan-calendar-wrap .rbc-time-view .rbc-label {
          font-size: 11px;
          color: var(--color-text-muted);
        }
        .macan-calendar-wrap .rbc-allday-cell { min-height: 40px; }
        .macan-calendar-wrap .rbc-row-segment { padding: 0 2px; }
        .macan-calendar-wrap .rbc-addons-dnd .rbc-addons-dnd-resize-ns-icon,
        .macan-calendar-wrap .rbc-addons-dnd .rbc-addons-dnd-resize-ew-icon {
          opacity: 0.6;
        }
      `}</style>
    </>
  );
};

export default CalendarPage;
