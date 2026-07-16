import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  Lock,
  Globe,
  Plus,
  Settings as SettingsIcon,
  Zap,
  UserPlus,
  Mail,
  MapPin,
  GripVertical,
  SearchX,
  Columns3,
  LayoutList,
  Table2,
  BarChart3,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonTaskGroup } from '../components/ui/Skeleton';
import TaskGroupHeader from '../components/board/TaskGroupHeader';
import TaskTable from '../components/board/TaskTable';
import { InlineAssigneeMenu } from '../components/board/AssigneePicker';
import DataGrid from '../components/board/DataGrid';
import SortableItem from '../components/dnd/SortableItem';
import StatusMenu from '../components/board/StatusMenu';
import PriorityMenu from '../components/board/PriorityMenu';
import TaskActionsMenu from '../components/board/TaskActionsMenu';
import CommentPanel from '../components/board/CommentPanel';
import LabelPicker from '../components/board/LabelPicker';
import EditChipsModal from '../components/board/EditChipsModal';
import BulkActionBar from '../components/board/BulkActionBar';
import BoardFilterBar from '../components/board/BoardFilterBar';
import BoardViewControls from '../components/board/BoardViewControls';
import { compareByColumn } from '../utils/boardSort';
import TableView from '../components/board/TableView';
import InsightsTab from '../components/board/InsightsTab';
import FormBoardView from '../components/board/FormBoardView';
import BoardCalendarView from '../components/board/BoardCalendarView';
// Lazy — keeps Leaflet (~158KB) out of the initial bundle until the Map tab opens.
const BoardMapView = lazy(() => import('../components/board/BoardMapView'));
import { FileText, CalendarDays } from 'lucide-react';
import * as formService from '../services/formService';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import useBoardStore from '../store/boardStore';
import useTaskStore from '../store/taskStore';
import useNotificationStore from '../store/notificationStore';
import useToastStore from '../store/toastStore';
import * as taskService from '../services/taskService';
import { formatDate } from '../utils/dateUtils';
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  taskMatchesFilters,
} from '../utils/taskFilters';
import { columnsById } from '../utils/columnFilter';

/**
 * Group color cycle — reuses the stat-card palette so groups are visually
 * distinct within a board.
 */
const GROUP_DOT_CYCLE = [
  'var(--color-card-blue)',
  'var(--color-card-green)',
  'var(--color-card-orange)',
  'var(--color-card-purple)',
];

// F13 — board view modes: the default grouped board, a generic table view, and
// the per-board Insights (charts) tab.
const VIEW_TABS = [
  { value: 'board', labelKey: 'board.viewBoard', icon: LayoutList },
  { value: 'table', labelKey: 'board.viewTable', icon: Table2 },
  { value: 'calendar', labelKey: 'board.viewCalendar', icon: CalendarDays },
  { value: 'map', labelKey: 'board.viewMap', icon: MapPin },
  { value: 'insights', labelKey: 'board.viewInsights', icon: BarChart3 },
];

/**
 * Determine whether the signed-in user is the admin of the current org.
 */
const useIsCurrentOrgAdmin = () => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  if (!user || !currentOrg) return false;
  const adminId =
    typeof currentOrg.admin === 'object' && currentOrg.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg.admin;
  const isMainAdmin = !!adminId && String(adminId) === String(user._id);
  const isExtraAdmin = Array.isArray(currentOrg.admins) &&
    currentOrg.admins.some((a) => {
      const id = typeof a === 'object' && a !== null ? a._id || a : a;
      return String(id) === String(user._id);
    });
  return isMainAdmin || isExtraAdmin;
};

const BoardDetailPage = () => {
  const { t } = useTranslation();
  const { id: boardId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawIsAdmin = useIsCurrentOrgAdmin();
  const currentUser = useAuthStore((s) => s.user);

  const currentOrg = useOrgStore((s) => s.currentOrg);
  const members = useOrgStore((s) => s.members);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);
  const sharedBoards = useOrgStore((s) => s.sharedBoards);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const getBoardById = useBoardStore((s) => s.getBoardById);
  const upsertBoardLocal = useBoardStore((s) => s.upsertBoardLocal);
  const enableFlexibleColumns = useBoardStore((s) => s.enableFlexibleColumns);

  const groups = useTaskStore((s) => s.groups);
  const tasksByGroup = useTaskStore((s) => s.tasksByGroup);
  const loading = useTaskStore((s) => s.loading);
  const fetchBoardData = useTaskStore((s) => s.fetchBoardData);
  const clearTasks = useTaskStore((s) => s.clear);
  const addTaskLocal = useTaskStore((s) => s.addTask);
  const updateTaskLocal = useTaskStore((s) => s.updateTask);
  const setCommentCount = useTaskStore((s) => s.setCommentCount);
  const deleteTaskLocal = useTaskStore((s) => s.deleteTask);
  const addGroupLocal = useTaskStore((s) => s.addGroup);
  const removeGroupLocal = useTaskStore((s) => s.removeGroup);
  const reorderGroupsAction = useTaskStore((s) => s.reorderGroups);
  const reorderTasksAction = useTaskStore((s) => s.reorderTasks);
  const refreshNotifications = useNotificationStore((s) => s.fetchNotifications);
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);
  const [enablingColumns, setEnablingColumns] = useState(false);

  // Collapse state, keyed by group id
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Track whether we've applied the initial collapse for the current board so
  // we don't re-collapse groups the user has manually opened.
  const initialCollapseApplied = useRef(false);

  // Reset the guard whenever the board changes
  useEffect(() => {
    initialCollapseApplied.current = false;
  }, [boardId]);

  // Collapse all groups on first load — gives the clean "categories only" view
  useEffect(() => {
    if (groups.length === 0 || initialCollapseApplied.current) return;
    initialCollapseApplied.current = true;
    setCollapsed(new Set(groups.map((g) => g._id)));
  }, [groups]);

  // Which group (if any) is currently creating a new task inline
  const [creatingInGroup, setCreatingInGroup] = useState(null);
  // Key counter per group — increment after each save to reset the inline creation row
  const [newTaskKeysByGroup, setNewTaskKeysByGroup] = useState({});
  // Task currently being edited inline
  const [editingTaskId, setEditingTaskId] = useState(null);
  // Status chip menu state
  const [statusMenu, setStatusMenu] = useState(null); // { task, anchor }
  // Priority chip menu state
  const [priorityMenu, setPriorityMenu] = useState(null); // { task, anchor }
  // Owner picker popover state
  const [ownerMenu, setOwnerMenu] = useState(null); // { task, anchor }
  // Labels picker popover state
  const [labelMenu, setLabelMenu] = useState(null); // { task, anchor }
  // Edit-chips modal — `kind` is 'labels' | 'statuses'
  const [editChipsModal, setEditChipsModal] = useState(null); // 'labels' | 'statuses' | null
  // Row actions menu state
  const [actionsMenu, setActionsMenu] = useState(null); // { task, anchor }
  // Delete confirmation
  const [taskPendingDelete, setTaskPendingDelete] = useState(null);
  // Comment panel — stack of task IDs the user has drilled into. Bottom of
  // the stack is the original task they clicked from the board; subitems
  // pushed via "Open subitem" land on top. The visible task is always the
  // last entry. The whole stack clears when the panel closes.
  const [selectedTaskStack, setSelectedTaskStack] = useState([]);
  const subitemsByParent = useTaskStore((s) => s.subitemsByParent);
  // New-group modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupModalError, setGroupModalError] = useState(null);
  // Delete-group confirmation state
  const [groupPendingDelete, setGroupPendingDelete] = useState(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  // --- Filtering ---------------------------------------------------------
  // Filter bar at the top of the board narrows the visible tasks by name,
  // status, priority, label, due date, and assignee. See utils/taskFilters.js.
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // --- View controls (sort + hidden columns) -----------------------------
  // Persisted per board in localStorage so the view sticks across reloads.
  const [sort, setSort] = useState(null); // { columnId, dir } | null
  const [hiddenColumnIds, setHiddenColumnIds] = useState(() => new Set());

  // Load persisted view state when the board changes.
  useEffect(() => {
    if (!boardId) return;
    try {
      const rawSort = localStorage.getItem(`macan:board:${boardId}:sort`);
      setSort(rawSort ? JSON.parse(rawSort) : null);
      const rawHidden = localStorage.getItem(`macan:board:${boardId}:hiddenCols`);
      setHiddenColumnIds(new Set(rawHidden ? JSON.parse(rawHidden) : []));
    } catch {
      setSort(null);
      setHiddenColumnIds(new Set());
    }
  }, [boardId]);

  const persistSort = useCallback(
    (next) => {
      setSort(next);
      try {
        if (next) localStorage.setItem(`macan:board:${boardId}:sort`, JSON.stringify(next));
        else localStorage.removeItem(`macan:board:${boardId}:sort`);
      } catch { /* ignore quota / privacy-mode errors */ }
    },
    [boardId]
  );

  const persistHidden = useCallback(
    (nextSet) => {
      setHiddenColumnIds(nextSet);
      try {
        localStorage.setItem(`macan:board:${boardId}:hiddenCols`, JSON.stringify([...nextSet]));
      } catch { /* ignore */ }
    },
    [boardId]
  );

  const toggleHiddenColumn = useCallback(
    (colId) => {
      setHiddenColumnIds((prev) => {
        const next = new Set(prev);
        if (next.has(colId)) next.delete(colId);
        else next.add(colId);
        try {
          localStorage.setItem(`macan:board:${boardId}:hiddenCols`, JSON.stringify([...next]));
        } catch { /* ignore */ }
        return next;
      });
    },
    [boardId]
  );

  // --- Bulk selection ----------------------------------------------------
  // Aggregated across every group on the board so the floating BulkActionBar
  // can act on tasks from multiple groups at once.
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  // Confirmation modal for bulk delete
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Disables the bar while an in-flight bulk mutation is resolving
  const [bulkBusy, setBulkBusy] = useState(false);

  // --- Notification highlight (scroll-to + glow) --------------------------
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);

  const board = getBoardById(boardId) || null;
  const orgId = currentOrg?._id || null;

  // F13 — which view mode is active (board | table | insights), backed by ?mode=.
  const viewMode = searchParams.get('mode') || 'board';
  const setViewMode = (mode) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (mode && mode !== 'board') next.set('mode', mode);
        else next.delete('mode');
        return next;
      },
      { replace: true }
    );

  // A board belonging to ANOTHER workspace (opened via a "Shared with me" grant)
  // is read-only here: structural + value edits are gated to members of the
  // board's own workspace (the server enforces this too). Forcing isAdmin off
  // disables every edit affordance — AddColumn, group management, cell edits.
  const isSharedBoard =
    !!board && !!currentOrg && String(board.organisation || '') !== String(currentOrg._id || '');
  const isAdmin = rawIsAdmin && !isSharedBoard;

  // If we navigated directly and the boards list is empty, fetch it so the
  // header can resolve the board metadata.
  useEffect(() => {
    if (!board && orgId && boards.length === 0) {
      fetchBoards(orgId).catch((err) =>
        console.error('Failed to fetch boards:', err)
      );
    }
  }, [board, orgId, boards.length, fetchBoards]);

  // Shared boards (other workspaces) aren't in the current org's board list, so
  // on a direct load/reload of `/boards/:id` seed it from the "Shared with me"
  // set if present, so the read-only grid can render.
  useEffect(() => {
    if (board || !boardId) return;
    const shared = sharedBoards.find((s) => s.board && s.board._id === boardId);
    if (shared) upsertBoardLocal(shared.board);
  }, [board, boardId, sharedBoards, upsertBoardLocal]);

  // Fetch groups + tasks for this board
  useEffect(() => {
    if (!boardId) return;
    fetchBoardData(boardId).catch((err) => {
      console.error('Failed to load board data:', err);
    });
    return () => {
      clearTasks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // The board's public forms — surfaced as extra view tabs (Board · Table view ·
  // Insights · <form>…). Refetched when the board changes.
  const [forms, setForms] = useState([]);
  useEffect(() => {
    if (!boardId) {
      setForms([]);
      return;
    }
    formService
      .listForms(boardId)
      .then((list) => setForms(Array.isArray(list) ? list : []))
      .catch(() => setForms([]));
  }, [boardId]);

  const activeForm =
    typeof viewMode === 'string' && viewMode.startsWith('form:')
      ? forms.find((f) => `form:${f._id}` === viewMode) || null
      : null;

  // --- Handle highlightTask query param from notification click -----------
  useEffect(() => {
    const taskId = searchParams.get('highlightTask');
    if (!taskId || loading || groups.length === 0) return;

    // Find which group contains the task and ensure it's expanded
    for (const group of groups) {
      const groupTasks = tasksByGroup[group._id] || [];
      if (groupTasks.some((t) => t._id === taskId)) {
        // Expand the group if collapsed
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(group._id);
          return next;
        });
        break;
      }
    }

    // Clear the query param so refreshing doesn't re-trigger
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('highlightTask');
      return next;
    }, { replace: true });

    // Set highlight — scroll + auto-remove are handled by separate effects below
    setHighlightedTaskId(taskId);
  }, [searchParams, loading, groups, tasksByGroup, setSearchParams]);

  // --- Auto-remove highlight after animation completes -------------------
  useEffect(() => {
    if (!highlightedTaskId) return;
    const timer = setTimeout(() => setHighlightedTaskId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightedTaskId]);

  // Fetch org members (used by assignee picker) — admin only actually needs
  // them, but caching them doesn't hurt and useful for future features.
  useEffect(() => {
    if (!orgId) return;
    if (!isAdmin) return;
    fetchMembers(orgId).catch((err) =>
      console.error('Failed to load members:', err)
    );
  }, [orgId, isAdmin, fetchMembers]);

  const totalTaskCount = useMemo(
    () =>
      Object.values(tasksByGroup).reduce(
        (acc, list) => acc + (list?.length || 0),
        0
      ),
    [tasksByGroup]
  );

  // Flattened list of every top-level task — used to derive the assignee
  // option list in the filter bar.
  const allTasks = useMemo(() => {
    const out = [];
    for (const list of Object.values(tasksByGroup)) {
      if (Array.isArray(list)) out.push(...list);
    }
    return out;
  }, [tasksByGroup]);

  const filtersActive = hasActiveFilters(filters);
  // Column lookup for the advanced filter tree evaluator (per-column-type ops).
  const colsById = useMemo(() => columnsById(board), [board]);

  // Apply the active filters per group. When nothing is active we hand back
  // the original buckets untouched so unfiltered boards skip the work.
  const filteredTasksByGroup = useMemo(() => {
    if (!filtersActive) return tasksByGroup;
    const now = new Date();
    const out = {};
    for (const [gid, list] of Object.entries(tasksByGroup)) {
      out[gid] = (list || []).filter((t) => taskMatchesFilters(t, filters, now, colsById));
    }
    return out;
  }, [tasksByGroup, filters, filtersActive, colsById]);

  const matchedTaskCount = useMemo(
    () =>
      Object.values(filteredTasksByGroup).reduce(
        (acc, list) => acc + (list?.length || 0),
        0
      ),
    [filteredTasksByGroup]
  );

  // Apply the active "Sort" toolbar control on top of the filtered buckets.
  // When no sort is set we return the filtered buckets untouched.
  const displayTasksByGroup = useMemo(() => {
    if (!sort?.columnId) return filteredTasksByGroup;
    const col = (board?.columns || []).find((c) => c._id.toString() === sort.columnId);
    if (!col) return filteredTasksByGroup;
    const out = {};
    for (const [gid, list] of Object.entries(filteredTasksByGroup)) {
      out[gid] = [...(list || [])].sort((a, b) => compareByColumn(a, b, col, sort.dir));
    }
    return out;
  }, [filteredTasksByGroup, sort, board?.columns]);

  const toggleGroup = (groupId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // --- Bulk selection callbacks ----------------------------------------
  // The checkboxes in every TaskTable dispatch through these so a single Set
  // tracks selections across all groups.

  const handleToggleSelectTask = useCallback((taskId, checked) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  // Header "select all" only applies to its own group's tasks. We OR them
  // into (or remove them from) the global set.
  const handleToggleSelectGroup = useCallback((taskIds, checked) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of taskIds) next.add(id);
      } else {
        for (const id of taskIds) next.delete(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  // Auto-prune selection: if a task disappears from the store (deleted by
  // any path — bulk, row action, server push) we drop its id from the set
  // so the floating bar's counter stays accurate.
  useEffect(() => {
    if (selectedTaskIds.size === 0) return;
    const liveIds = new Set();
    for (const list of Object.values(tasksByGroup)) {
      if (!Array.isArray(list)) continue;
      for (const t of list) liveIds.add(t._id);
    }
    let changed = false;
    const next = new Set();
    for (const id of selectedTaskIds) {
      if (liveIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedTaskIds(next);
  }, [tasksByGroup, selectedTaskIds]);

  const handleOpenTask = (task) => {
    if (!task?._id) return;
    setSelectedTaskStack([task._id]);
  };

  const handleCloseTask = () => setSelectedTaskStack([]);

  const handleOpenSubitem = useCallback((subitem) => {
    if (!subitem?._id) return;
    setSelectedTaskStack((prev) => [...prev, subitem._id]);
  }, []);

  const handleBackInStack = useCallback(() => {
    setSelectedTaskStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const selectedTaskId =
    selectedTaskStack.length > 0
      ? selectedTaskStack[selectedTaskStack.length - 1]
      : null;

  // Resolve the selected task from the live store so the panel reflects
  // updates (status change, edit, etc.) while open. Walks `tasksByGroup`
  // (top-level board tasks) and `subitemsByParent` (children) so subitems
  // opened via the recursive stack render correctly.
  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    for (const list of Object.values(tasksByGroup)) {
      if (!Array.isArray(list)) continue;
      const match = list.find((t) => t._id === selectedTaskId);
      if (match) return match;
    }
    for (const list of Object.values(subitemsByParent)) {
      if (!Array.isArray(list)) continue;
      const match = list.find((t) => t._id === selectedTaskId);
      if (match) return match;
    }
    return null;
  }, [selectedTaskId, tasksByGroup, subitemsByParent]);

  // Auto-close the panel (or pop one level) if the selected task disappears
  // (e.g. it or its parent was deleted).
  useEffect(() => {
    if (selectedTaskId && !selectedTask) {
      setSelectedTaskStack((prev) => prev.slice(0, -1));
    }
  }, [selectedTaskId, selectedTask]);

  // --- Inline creation --------------------------------------------------

  const handleStartCreate = (groupId) => {
    setEditingTaskId(null);
    setCreatingInGroup(groupId);
    // Auto-expand the group if it's collapsed
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  };

  const handleSaveNewTask = useCallback(
    async (groupId, payload) => {
      try {
        const created = await taskService.createTask({
          ...payload,
          board: boardId,
          group: groupId,
        });
        addTaskLocal(created);
        // Increment the key for this group so the creation row resets
        setNewTaskKeysByGroup((prev) => ({
          ...prev,
          [groupId]: (prev[groupId] || 0) + 1,
        }));
        refreshNotifications(currentOrg?._id);
      } catch (err) {
        console.error('Failed to create task:', err);
        toastError(
          err?.response?.data?.error ||
            t('board.createLeadError')
        );
        throw err;
      }
    },
    [boardId, addTaskLocal, refreshNotifications, toastError, t]
  );

  // Toolbar "New lead": create a lead at the top of the first group and open it
  // for editing. Expands the group first if it's collapsed.
  const [creatingTopLead, setCreatingTopLead] = useState(false);
  const handleNewLeadTop = useCallback(async () => {
    const first = groups[0];
    if (!first || creatingTopLead) return;
    setCollapsed((prev) => {
      if (!prev.has(first._id)) return prev;
      const next = new Set(prev);
      next.delete(first._id);
      return next;
    });
    setCreatingTopLead(true);
    try {
      const created = await taskService.createTask({
        name: t('boardMisc.newLeadName'),
        board: boardId,
        group: first._id,
      });
      addTaskLocal(created);
      refreshNotifications(currentOrg?._id);
      handleOpenTask(created);
    } catch (err) {
      console.error('Failed to create lead:', err);
      toastError(err?.response?.data?.error || t('board.createLeadError'));
    } finally {
      setCreatingTopLead(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, creatingTopLead, boardId, addTaskLocal, refreshNotifications, currentOrg?._id, t]);

  // --- Inline edit ------------------------------------------------------

  const handleStartEdit = (task) => {
    setCreatingInGroup(null);
    setEditingTaskId(task._id);
  };

  const handleSaveEditTask = useCallback(
    async (taskId, payload) => {
      try {
        const updated = await taskService.updateTask(taskId, payload);
        updateTaskLocal(updated);
        setEditingTaskId(null);
        refreshNotifications(currentOrg?._id);
      } catch (err) {
        console.error('Failed to update task:', err);
        if (!err?.response?.data?.field) {
          toastError(
            err?.response?.data?.error ||
              t('board.updateLeadError')
          );
        }
        throw err;
      }
    },
    [updateTaskLocal, refreshNotifications, toastError, t]
  );

  const handleCancelEdit = () => {
    setCreatingInGroup(null);
    setEditingTaskId(null);
  };

  // --- Inline status change --------------------------------------------

  const canChangeStatus = () => {
    // All org members can change task status
    return !!currentUser;
  };

  const handleStatusClick = (task, event) => {
    if (!canChangeStatus(task)) return;
    const anchor = event?.currentTarget || null;
    setStatusMenu({ task, anchor });
  };

  const handleStatusSelect = async (newStatus) => {
    if (!statusMenu) return;
    const { task } = statusMenu;
    setStatusMenu(null);
    const currentStatusStr = task.status ? task.status.toString() : null;
    const nextStatusStr = newStatus != null ? newStatus.toString() : null;
    if (currentStatusStr === nextStatusStr) return;
    // Optimistic update
    const prev = task;
    updateTaskLocal({ ...task, status: newStatus });
    try {
      const updated = await taskService.updateTask(task._id, {
        status: newStatus,
      });
      updateTaskLocal(updated);
      refreshNotifications();
    } catch (err) {
      console.error('Failed to update status:', err);
      updateTaskLocal(prev);
      toastError(
        err?.response?.data?.error ||
          t('board.updateStatusError')
      );
    }
  };

  // --- Labels picker -----------------------------------------------------

  const handleLabelsClick = (task, event) => {
    if (!currentUser) return;
    const anchor = event?.currentTarget || event?.target || null;
    setLabelMenu({ task, anchor });
  };

  const handleLabelToggle = async (labelId, nextChecked) => {
    if (!labelMenu || !isAdmin) return;
    const { task } = labelMenu;
    const current = (task.labels || []).map((id) => id.toString());
    const nextLabels = nextChecked
      ? Array.from(new Set([...current, labelId.toString()]))
      : current.filter((id) => id !== labelId.toString());
    const prev = task;
    updateTaskLocal({ ...task, labels: nextLabels });
    try {
      const updated = await taskService.updateTask(task._id, {
        labels: nextLabels,
      });
      updateTaskLocal(updated);
      // Update the popover's task ref so its checked-state stays in sync.
      setLabelMenu((cur) => (cur ? { ...cur, task: updated } : cur));
    } catch (err) {
      console.error('Failed to update labels:', err);
      updateTaskLocal(prev);
      toastError(
        err?.response?.data?.error ||
          t('board.updateLabelsError')
      );
    }
  };

  // --- Inline priority change ------------------------------------------

  const handlePriorityClick = (task, event) => {
    if (!currentUser) return;
    const anchor = event?.currentTarget || null;
    setPriorityMenu({ task, anchor });
  };

  const handlePrioritySelect = async (newPriority) => {
    if (!priorityMenu) return;
    const { task } = priorityMenu;
    setPriorityMenu(null);
    if (newPriority === task.priority) return;
    const prev = task;
    updateTaskLocal({ ...task, priority: newPriority });
    try {
      const updated = await taskService.updateTask(task._id, {
        priority: newPriority,
      });
      updateTaskLocal(updated);
    } catch (err) {
      console.error('Failed to update priority:', err);
      updateTaskLocal(prev);
      toastError(
        err?.response?.data?.error ||
          t('board.updatePriorityError')
      );
    }
  };

  // --- Inline owner change -----------------------------------------------

  const handleOwnerClick = (task, event) => {
    if (!currentUser) return;
    const anchor = event?.currentTarget || null;
    setOwnerMenu({ task, anchor });
  };

  const handleOwnerChange = async (newAssigneeIds) => {
    if (!ownerMenu) return;
    const { task } = ownerMenu;
    setOwnerMenu((cur) => cur ? { ...cur, task: { ...cur.task, assignedTo: newAssigneeIds } } : cur);
    const prev = task;
    updateTaskLocal({ ...task, assignedTo: newAssigneeIds });
    try {
      const updated = await taskService.updateTask(task._id, { assignedTo: newAssigneeIds });
      updateTaskLocal(updated);
      setOwnerMenu((cur) => cur ? { ...cur, task: updated } : cur);
    } catch (err) {
      console.error('Failed to update assignees:', err);
      updateTaskLocal(prev);
      toastError(err?.response?.data?.error || t('board.updateAssigneesError'));
    }
  };

  // --- Row actions menu (Edit / Delete) --------------------------------

  const handleActionsClick = (task, event) => {
    if (!isAdmin) return;
    const anchor = event?.currentTarget || null;
    setActionsMenu({ task, anchor });
  };

  const handleMenuEdit = () => {
    if (!actionsMenu) return;
    const task = actionsMenu.task;
    setActionsMenu(null);
    handleStartEdit(task);
  };

  const handleMenuDelete = () => {
    if (!actionsMenu) return;
    const task = actionsMenu.task;
    setActionsMenu(null);
    setTaskPendingDelete(task);
  };

  const handleConfirmDelete = async () => {
    if (!taskPendingDelete) return;
    const task = taskPendingDelete;
    setTaskPendingDelete(null);
    try {
      await taskService.deleteTask(task._id);
      deleteTaskLocal(task._id);
    } catch (err) {
      console.error('Failed to delete task:', err);
      toastError(
        err?.response?.data?.error ||
          t('board.deleteLeadError')
      );
    }
  };

  // --- Bulk delete ------------------------------------------------------
  // Fire one DELETE per task in parallel. Each success removes from the
  // store immediately so the UI shrinks task-by-task instead of jumping.
  // Failures are toasted but don't abort the rest.

  const handleConfirmBulkDelete = async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) {
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleteOpen(false);
    setBulkBusy(true);
    let failed = 0;
    await Promise.all(
      ids.map((id) =>
        taskService
          .deleteTask(id)
          .then(() => deleteTaskLocal(id))
          .catch((err) => {
            failed += 1;
            console.error('Failed to delete task in bulk:', id, err);
          })
      )
    );
    setBulkBusy(false);
    if (failed > 0) {
      toastError(
        failed === ids.length
          ? t('board.bulkDeleteAllError')
          : t('board.bulkDeletePartialError', { failed, total: ids.length })
      );
    }
  };

  // --- Bulk move-to-group ----------------------------------------------
  // We piggy-back on the existing /api/tasks/reorder endpoint: it supports
  // cross-group moves when we hand it a target group's full desired order.
  // That keeps the operation atomic on the server side.

  const handleBulkMoveToGroup = async (targetGroupId) => {
    if (!targetGroupId) return;
    const idsToMove = Array.from(selectedTaskIds).filter((id) => {
      // Skip tasks already in the destination so they don't get re-appended
      const list = tasksByGroup[targetGroupId] || [];
      return !list.some((t) => t._id === id);
    });
    if (idsToMove.length === 0) return;
    const targetTasks = tasksByGroup[targetGroupId] || [];
    const nextOrder = [...targetTasks.map((t) => t._id), ...idsToMove];
    setBulkBusy(true);
    try {
      await reorderTasksAction(targetGroupId, nextOrder);
      // Tasks now live in the new group; their ids stay in the store, so
      // selectedTaskIds remains valid and the bar can keep operating on them.
    } catch (err) {
      console.error('Failed to bulk-move tasks:', err);
      toastError(t('board.bulkMoveError'));
    } finally {
      setBulkBusy(false);
    }
  };

  // --- New group creation ----------------------------------------------

  const handleOpenGroupModal = () => {
    setNewGroupName('');
    setGroupModalError(null);
    setCreatingGroup(false);
    setGroupModalOpen(true);
  };

  // Convert a legacy (fixed-column) board to the flexible-columns engine.
  // Existing Name/Status/Priority/Owner/Due data is preserved and shown as
  // editable columns; the admin can then add custom columns from the grid.
  const handleEnableColumns = async () => {
    if (enablingColumns || !board) return;
    if (
      !window.confirm(
        t('board.enableColumnsConfirm')
      )
    ) {
      return;
    }
    setEnablingColumns(true);
    try {
      await enableFlexibleColumns(boardId);
      toastSuccess(t('board.enableColumnsSuccess'));
    } catch (err) {
      toastError(err?.response?.data?.error || t('board.enableColumnsError'));
    } finally {
      setEnablingColumns(false);
    }
  };

  const handleCloseGroupModal = () => {
    if (creatingGroup) return;
    setGroupModalOpen(false);
  };

  const handleSubmitNewGroup = async (e) => {
    e?.preventDefault?.();
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setGroupModalError(t('board.groupNameRequired'));
      return;
    }
    try {
      setCreatingGroup(true);
      setGroupModalError(null);
      const created = await taskService.createGroup(boardId, { name: trimmed });
      addGroupLocal(created);
      setGroupModalOpen(false);
      setNewGroupName('');
    } catch (err) {
      console.error('Failed to create group:', err);
      setGroupModalError(
        err?.response?.data?.error ||
          t('board.createGroupError')
      );
    } finally {
      setCreatingGroup(false);
    }
  };

  // --- Group deletion -----------------------------------------------------

  const handleDeleteGroup = (group) => {
    setGroupPendingDelete(group);
  };

  const handleConfirmDeleteGroup = async () => {
    if (!groupPendingDelete) return;
    const group = groupPendingDelete;
    setGroupPendingDelete(null);
    setDeletingGroup(true);
    try {
      await taskService.deleteGroup(group._id);
      removeGroupLocal(group._id);
    } catch (err) {
      console.error('Failed to delete group:', err);
      toastError(
        err?.response?.data?.error ||
          t('board.deleteGroupError')
      );
    } finally {
      setDeletingGroup(false);
    }
  };

  const isPublic = board?.visibility === 'public';
  const VisibilityIcon = isPublic ? Globe : Lock;
  const hasGroups = groups.length > 0;

  // --- Drag-and-drop wiring -------------------------------------------------
  // One DndContext covers BOTH the groups (sortable list) and every group's
  // tasks (each its own SortableContext). Each sortable carries `data` so
  // onDragEnd can branch on type and locate the correct target.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const groupIds = useMemo(() => groups.map((g) => g._id), [groups]);
  // DnD is disabled while an inline edit/create row is open in any group so
  // the form controls don't fight with the drag sensors. It's also disabled
  // while filters are active — reordering a filtered subset would write a
  // bogus order back to the full list.
  const dndDisabledGlobal =
    creatingInGroup != null || editingTaskId != null || filtersActive;

  const handleBoardDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current || {};
    const overData = over.data.current || {};

    // --- Group reorder ---
    if (activeData.type === 'group') {
      if (active.id === over.id) return;
      // Only respond if we dropped onto another group; ignore task drops here.
      if (overData.type && overData.type !== 'group') return;
      const oldIndex = groups.findIndex((g) => g._id === active.id);
      const newIndex = groups.findIndex((g) => g._id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(groups, oldIndex, newIndex);
      reorderGroupsAction(boardId, next.map((g) => g._id)).catch((err) => {
        console.error('Failed to reorder groups:', err);
        toastError(t('board.reorderGroupsError'));
      });
      return;
    }

    // --- Task reorder / move ---
    if (activeData.type === 'task') {
      const sourceGroupId = activeData.groupId;
      // Resolve target group: if dropped on a task, use that task's groupId;
      // if dropped on a group header/container, the group itself is the target.
      let targetGroupId = null;
      if (overData.type === 'task') targetGroupId = overData.groupId;
      else if (overData.type === 'group') targetGroupId = over.id;
      else if (overData.type === 'group-dropzone') targetGroupId = overData.groupId;
      if (!targetGroupId) return;

      const sourceTasks = tasksByGroup[sourceGroupId] || [];
      const targetTasks = tasksByGroup[targetGroupId] || [];

      // Intra-group reorder
      if (sourceGroupId === targetGroupId) {
        if (active.id === over.id) return;
        const oldIndex = sourceTasks.findIndex((t) => t._id === active.id);
        const newIndex = sourceTasks.findIndex((t) => t._id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        const next = arrayMove(sourceTasks, oldIndex, newIndex);
        reorderTasksAction(targetGroupId, next.map((t) => t._id)).catch((err) => {
          console.error('Failed to reorder tasks:', err);
          toastError(t('board.reorderLeadsError'));
        });
        return;
      }

      // Cross-group move: insert before the target task, or append if dropped
      // on the group container itself.
      const movingTask = sourceTasks.find((t) => t._id === active.id);
      if (!movingTask) return;
      let insertAt = targetTasks.length;
      if (overData.type === 'task') {
        const idx = targetTasks.findIndex((t) => t._id === over.id);
        if (idx >= 0) insertAt = idx;
      }
      const nextTargetIds = targetTasks.map((t) => t._id);
      nextTargetIds.splice(insertAt, 0, movingTask._id);
      reorderTasksAction(targetGroupId, nextTargetIds).catch((err) => {
        console.error('Failed to move task:', err);
        toastError(t('board.moveLeadError'));
      });
    }
  };

  return (
    <PageWrapper>
      {/* Breadcrumb */}
      <nav
        aria-label={t('board.breadcrumbAria')}
        className="flex items-center gap-1.5 font-body"
        style={{ fontSize: 13 }}
      >
        <Link
          to="/boards"
          className="transition-colors duration-150 hover:text-[color:var(--color-accent)]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('board.myBoards')}
        </Link>
        <ChevronRight
          size={14}
          color="var(--color-text-muted)"
          aria-hidden="true"
        />
        <span
          style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}
          className="truncate"
        >
          {board?.name || t('board.loading')}
        </span>
      </nav>

      {/* Board header */}
      <header className="mt-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1
              className="font-display truncate"
              style={{
                fontSize: 26,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '-0.01em',
                color: 'var(--color-text-primary)',
              }}
            >
              {board?.name || '—'}
            </h1>
            {board && (
              <span
                className="inline-flex items-center gap-1 font-body shrink-0"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: isPublic
                    ? 'var(--color-status-done-bg)'
                    : '#FFF0F0',
                  color: isPublic ? 'var(--color-status-done)' : '#DC2626',
                }}
              >
                <VisibilityIcon size={11} aria-hidden="true" />
                {isPublic ? t('board.visibilityPublic') : t('board.visibilityPrivate')}
              </span>
            )}
          </div>
          <p
            className="mt-1 font-body"
            style={{ fontSize: 13, color: 'var(--color-text-muted)' }}
          >
            {board
              ? `${t('board.createdOn', { date: formatDate(board.createdAt) })} · ${t('board.leadCount', { count: totalTaskCount })}`
              : t('board.loadingDetails')}
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            {board && !board.useFlexibleColumns && (
              <Button
                variant="secondary"
                icon={Columns3}
                onClick={handleEnableColumns}
                disabled={enablingColumns}
              >
                {enablingColumns ? t('board.enablingColumns') : t('board.enableColumns')}
              </Button>
            )}
            <Button
              variant="secondary"
              icon={Zap}
              onClick={() => navigate(`/boards/${boardId}/automations`)}
            >
              {t('board.automations')}
            </Button>
            <Button
              variant="secondary"
              icon={UserPlus}
              onClick={() => navigate(`/boards/${boardId}/intake`)}
            >
              {t('board.leadIntake')}
            </Button>
            <Button
              variant="secondary"
              icon={Mail}
              onClick={() => navigate(`/boards/${boardId}/sequences`)}
            >
              {t('board.sequences')}
            </Button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={handleOpenGroupModal}
            >
              {t('board.newGroup')}
            </Button>
            <button
              type="button"
              aria-label={t('board.settingsAria')}
              onClick={() => navigate('/settings')}
              className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
              style={{
                width: 38,
                height: 38,
                border: '1.5px solid var(--color-border-strong)',
              }}
            >
              <SettingsIcon
                size={16}
                color="var(--color-text-secondary)"
                aria-hidden="true"
              />
            </button>
          </div>
        )}
      </header>

      {/* F13 — view-mode tabs: Board / Table view / Insights */}
      <div
        className="mt-5 flex items-center gap-1 overflow-x-auto"
        role="tablist"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {VIEW_TABS.map((tab) => {
          const active = viewMode === tab.value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setViewMode(tab.value)}
              className="inline-flex items-center gap-1.5 font-body whitespace-nowrap transition-colors duration-150"
              style={{
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                padding: '8px 14px',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <Icon size={15} aria-hidden="true" />
              {t(tab.labelKey)}
            </button>
          );
        })}

        {/* Form tabs — one per public form on this board (like Monday). */}
        {forms.map((form) => {
          const value = `form:${form._id}`;
          const active = viewMode === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setViewMode(value)}
              className="inline-flex items-center gap-1.5 font-body whitespace-nowrap transition-colors duration-150"
              style={{
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                padding: '8px 14px',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <FileText size={15} aria-hidden="true" />
              {form.name}
            </button>
          );
        })}
      </div>

      {viewMode === 'table' ? (
        <div className="mt-5">
          <TableView board={board} tasks={allTasks} members={members} />
        </div>
      ) : viewMode === 'calendar' ? (
        <BoardCalendarView board={board} tasks={allTasks} onOpenTask={handleOpenTask} />
      ) : viewMode === 'map' ? (
        <Suspense fallback={<div className="skeleton mt-5" style={{ height: '68vh', borderRadius: 'var(--radius-lg)' }} />}>
          <BoardMapView board={board} tasks={allTasks} onOpenTask={handleOpenTask} />
        </Suspense>
      ) : viewMode === 'insights' ? (
        <div className="mt-5">
          <InsightsTab boardId={boardId} board={board} isAdmin={isAdmin} />
        </div>
      ) : activeForm ? (
        <FormBoardView form={activeForm} isAdmin={isAdmin} />
      ) : (
        <>
      {/* View controls (New lead · Sort · Hide columns) — flexible boards only */}
      {hasGroups && board?.useFlexibleColumns && (
        <BoardViewControls
          board={board}
          sort={sort}
          onSortChange={persistSort}
          hiddenColumnIds={hiddenColumnIds}
          onToggleColumn={toggleHiddenColumn}
          onShowAllColumns={() => persistHidden(new Set())}
          onNewLead={isAdmin ? handleNewLeadTop : undefined}
          creatingLead={creatingTopLead}
        />
      )}

      {/* Filter bar */}
      {hasGroups && board && (
        <BoardFilterBar
          board={board}
          allTasks={allTasks}
          filters={filters}
          onChange={setFilters}
          matchedCount={matchedTaskCount}
          totalCount={totalTaskCount}
        />
      )}

      {/* Task groups */}
      <section className="mt-6 flex flex-col gap-2">
        {loading && !hasGroups ? (
          <div
            role="status"
            aria-live="polite"
            aria-label={t('board.loadingBoardAria')}
            className="flex flex-col gap-4"
          >
            <SkeletonTaskGroup rowCount={4} index={0} />
            <SkeletonTaskGroup rowCount={3} index={1} />
          </div>
        ) : !hasGroups ? (
          <div
            className="bg-surface"
            style={{
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-card)',
              padding: '48px 16px',
            }}
          >
            <EmptyState
              icon={Plus}
              title={t('board.noGroupsTitle')}
              description={
                isAdmin
                  ? t('board.noGroupsAdminDesc')
                  : t('board.noGroupsMemberDesc')
              }
              actionLabel={isAdmin ? t('board.createFirstGroup') : undefined}
              onAction={isAdmin ? handleOpenGroupModal : undefined}
            />
          </div>
        ) : filtersActive && matchedTaskCount === 0 ? (
          <div
            className="bg-surface"
            style={{
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-card)',
              padding: '48px 16px',
            }}
          >
            <EmptyState
              icon={SearchX}
              title={t('board.noLeadsMatchTitle')}
              description={t('board.noLeadsMatchDesc')}
              actionLabel={t('board.clearAllFilters')}
              onAction={() => setFilters(EMPTY_FILTERS)}
            />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleBoardDragEnd}
          >
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {groups.map((group, idx) => {
                const groupTasks = displayTasksByGroup[group._id] || [];
                // Monday-style group accent colour (cycled).
                const groupColor = GROUP_DOT_CYCLE[idx % GROUP_DOT_CYCLE.length];
                // While filtering, groups with no surviving tasks drop out of
                // the view entirely to cut noise.
                if (filtersActive && groupTasks.length === 0) return null;
                const doneStatusId =
                  board && Array.isArray(board.statuses)
                    ? (board.statuses.find((s) => s.key === 'done')?._id || null)
                    : null;
                const doneCount = groupTasks.filter((t) => {
                  if (t.status == null) return false;
                  if (doneStatusId) {
                    return t.status.toString() === doneStatusId.toString();
                  }
                  return t.status === 'done';
                }).length;
                const isCollapsed = collapsed.has(group._id);
                // Disable task DnD inside this group while it's hosting an
                // inline create/edit row — but leave the group's own handle
                // sortable so users can still rearrange columns.
                const isEditingHere =
                  (editingTaskId != null && groupTasks.some((t) => t._id === editingTaskId)) ||
                  creatingInGroup === group._id;
                // Keep the card clipped to its rounded corners in the normal
                // state so the grey header and row backgrounds don't poke past
                // the 14px radius. Only lift the clip while an inline edit/create
                // row is open here, where the field dropdowns must escape the
                // card bounds. The inner table/grid wrappers clip their own
                // overflow, so this doesn't change popover or drag behaviour.
                const needsOverflowVisible = isEditingHere;

                return (
                  <SortableItem
                    key={group._id}
                    id={group._id}
                    data={{ type: 'group' }}
                    disabled={dndDisabledGlobal}
                  >
                    {({ ref, setActivatorNodeRef, style, attributes, listeners, isDragging }) => (
                      <div
                        ref={ref}
                        className={`bg-surface ${
                          needsOverflowVisible ? 'overflow-visible' : 'overflow-hidden'
                        }`}
                        style={{
                          ...style,
                          borderRadius: 'var(--radius-md)',
                          boxShadow: 'var(--shadow-card)',
                          // Monday-style colored left rail for the group.
                          borderLeft: `4px solid ${groupColor}`,
                          position: 'relative',
                          zIndex: isDragging ? 30 : 'auto',
                          // Give an expanded group a floor height so a sparse
                          // board (e.g. a freshly created template with only a
                          // row or two) still reads as a proper, full-bodied
                          // card instead of a thin strip. Collapsed groups stay
                          // header-only. Lay the card out as a flex column so the
                          // grid body can grow to fill the card and its
                          // horizontal scrollbar sits at the card's bottom edge
                          // rather than floating just under a short content area.
                          // Size to content (Monday-style) — no empty floor
                          // height. The summary footer sits directly under the
                          // last row instead of being pushed to the card bottom.
                          display: isCollapsed ? undefined : 'flex',
                          flexDirection: isCollapsed ? undefined : 'column',
                        }}
                      >
                        <TaskGroupHeader
                          name={group.name}
                          colorDot={groupColor}
                          totalCount={groupTasks.length}
                          doneCount={doneCount}
                          collapsed={isCollapsed}
                          onToggle={() => toggleGroup(group._id)}
                          onDeleteGroup={isAdmin ? () => handleDeleteGroup(group) : undefined}
                          dragHandle={
                            !dndDisabledGlobal && (
                              <button
                                ref={setActivatorNodeRef}
                                type="button"
                                aria-label={t('board.dragReorderGroupAria', { name: group.name })}
                                {...attributes}
                                {...listeners}
                                className="flex items-center justify-center opacity-0 group-hover/group-header:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
                                style={{
                                  width: 20,
                                  height: 24,
                                  cursor: 'grab',
                                  touchAction: 'none',
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 0,
                                  marginLeft: -4,
                                }}
                              >
                                <GripVertical
                                  size={14}
                                  color="var(--color-text-muted)"
                                  aria-hidden="true"
                                />
                              </button>
                            )
                          }
                        />
                        {!isCollapsed && (
                          board?.useFlexibleColumns ? (
                            <DataGrid
                              board={board}
                              tasks={groupTasks}
                              readOnly={!isAdmin}
                              onSaveNew={
                                isAdmin
                                  ? (payload) => handleSaveNewTask(group._id, payload)
                                  : undefined
                              }
                              onOpenTask={handleOpenTask}
                              onActionsClick={isAdmin ? handleActionsClick : undefined}
                              selectedIds={selectedTaskIds}
                              onToggleSelect={handleToggleSelectTask}
                              onToggleSelectAll={handleToggleSelectGroup}
                              highlightedTaskId={highlightedTaskId}
                              groupId={group._id}
                              dndDisabled={dndDisabledGlobal || isEditingHere || !!sort?.columnId}
                              hiddenColumnIds={hiddenColumnIds}
                            />
                          ) : (
                            <TaskTable
                              tasks={groupTasks}
                              board={board}
                              members={members}
                              editingTaskId={editingTaskId}
                              isCreating={isAdmin && !filtersActive}
                              createKey={newTaskKeysByGroup[group._id] || 0}
                              isAdmin={isAdmin}
                              highlightedTaskId={highlightedTaskId}
                              onOpenTask={handleOpenTask}
                              onStatusClick={handleStatusClick}
                              onPriorityClick={handlePriorityClick}
                              onLabelsClick={handleLabelsClick}
                              onOwnerClick={handleOwnerClick}
                              onActionsClick={isAdmin ? handleActionsClick : undefined}
                              onSaveNew={(payload) => handleSaveNewTask(group._id, payload)}
                              onSaveEdit={handleSaveEditTask}
                              onCancelEdit={handleCancelEdit}
                              groupId={group._id}
                              dndDisabled={dndDisabledGlobal || isEditingHere || !!sort?.columnId}
                              selectedIds={selectedTaskIds}
                              onToggleSelect={handleToggleSelectTask}
                              onToggleSelectAll={handleToggleSelectGroup}
                            />
                          )
                        )}
                      </div>
                    )}
                  </SortableItem>
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </section>
        </>
      )}

      {/* Status chip menu */}
      {statusMenu && (
        <StatusMenu
          anchorEl={statusMenu.anchor}
          board={board}
          value={statusMenu.task.status}
          onSelect={handleStatusSelect}
          onEditChips={
            isAdmin
              ? () => {
                  setStatusMenu(null);
                  setEditChipsModal('statuses');
                }
              : undefined
          }
          onClose={() => setStatusMenu(null)}
        />
      )}

      {/* Labels picker */}
      {labelMenu && (
        <LabelPicker
          anchorEl={labelMenu.anchor}
          board={board}
          selectedIds={labelMenu.task.labels || []}
          onToggle={isAdmin ? handleLabelToggle : undefined}
          onEditChips={
            isAdmin
              ? () => {
                  setLabelMenu(null);
                  setEditChipsModal('labels');
                }
              : undefined
          }
          onClose={() => setLabelMenu(null)}
        />
      )}

      {/* Inline owner picker */}
      {ownerMenu && (
        <InlineAssigneeMenu
          anchorEl={ownerMenu.anchor}
          members={members}
          value={(ownerMenu.task.assignedTo || []).map((u) =>
            typeof u === 'string' ? u : u._id
          )}
          onChange={handleOwnerChange}
          onClose={() => setOwnerMenu(null)}
        />
      )}

      {/* Edit chips (labels / statuses) modal */}
      {isAdmin && editChipsModal && (
        <EditChipsModal
          isOpen={!!editChipsModal}
          onClose={() => setEditChipsModal(null)}
          boardId={boardId}
          kind={editChipsModal}
        />
      )}

      {/* Priority chip menu */}
      {priorityMenu && (
        <PriorityMenu
          anchorEl={priorityMenu.anchor}
          value={priorityMenu.task.priority}
          onSelect={handlePrioritySelect}
          onClose={() => setPriorityMenu(null)}
        />
      )}

      {/* Row actions menu (Edit / Delete) */}
      {actionsMenu && (
        <TaskActionsMenu
          anchorEl={actionsMenu.anchor}
          onEdit={handleMenuEdit}
          onDelete={handleMenuDelete}
          onClose={() => setActionsMenu(null)}
        />
      )}

      {/* Delete confirmation */}
      <Modal
        isOpen={!!taskPendingDelete}
        onClose={() => setTaskPendingDelete(null)}
        title={t('board.deleteLeadTitle')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setTaskPendingDelete(null)}
            >
              {t('board.cancel')}
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete}>
              {t('board.delete')}
            </Button>
          </>
        }
      >
        <p
          className="font-body"
          style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}
        >
          {t('board.deleteLeadConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {taskPendingDelete?.name}
          </strong>
          {t('board.deleteLeadConfirmSuffix')}
        </p>
      </Modal>

      {/* Delete group confirmation */}
      <Modal
        isOpen={!!groupPendingDelete}
        onClose={() => { if (!deletingGroup) setGroupPendingDelete(null); }}
        title={t('board.deleteGroupTitle')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setGroupPendingDelete(null)}
              disabled={deletingGroup}
            >
              {t('board.cancel')}
            </Button>
            <Button variant="danger" onClick={handleConfirmDeleteGroup} disabled={deletingGroup}>
              {deletingGroup ? t('board.deleting') : t('board.delete')}
            </Button>
          </>
        }
      >
        <p
          className="font-body"
          style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}
        >
          {t('board.deleteGroupConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {groupPendingDelete?.name}
          </strong>
          {t('board.deleteGroupConfirmSuffix')}
        </p>
      </Modal>

      {/* New group modal */}
      <Modal
        isOpen={groupModalOpen}
        onClose={handleCloseGroupModal}
        title={t('board.newGroup')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleCloseGroupModal}
              disabled={creatingGroup}
            >
              {t('board.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmitNewGroup}
              disabled={creatingGroup}
            >
              {creatingGroup ? t('board.creating') : t('board.createGroup')}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitNewGroup} className="flex flex-col gap-3">
          <Input
            label={t('board.groupNameLabel')}
            required
            placeholder={t('board.groupNamePlaceholder')}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            autoFocus
          />
          {groupModalError && (
            <p
              className="font-body text-xs"
              style={{ color: 'var(--color-status-stuck)' }}
            >
              {groupModalError}
            </p>
          )}
          {/* Hidden submit so <Enter> submits the form */}
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
      </Modal>

      {/* Dim overlay for notification highlight */}
      {highlightedTaskId && (
        <div
          className="macan-highlight-overlay"
          onClick={() => setHighlightedTaskId(null)}
        />
      )}

      {/* Floating bulk-action bar (visible while >=1 task is ticked) */}
      {isAdmin && (
        <BulkActionBar
          count={selectedTaskIds.size}
          groups={groups}
          busy={bulkBusy}
          onMoveToGroup={handleBulkMoveToGroup}
          onDelete={() => setBulkDeleteOpen(true)}
          onClear={handleClearSelection}
        />
      )}

      {/* Bulk delete confirmation */}
      <Modal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={t('board.bulkDeleteTitle', { count: selectedTaskIds.size })}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkBusy}
            >
              {t('board.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmBulkDelete}
              disabled={bulkBusy}
            >
              {bulkBusy ? t('board.deleting') : t('board.delete')}
            </Button>
          </>
        }
      >
        <p
          className="font-body"
          style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}
        >
          {t('board.bulkDeleteConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {t('board.leadCount', { count: selectedTaskIds.size })}
          </strong>{' '}
          {t('board.bulkDeleteConfirmSuffix')}
        </p>
      </Modal>

      {/* Task comment panel */}
      <CommentPanel
        task={selectedTask}
        board={board}
        isOpen={!!selectedTask}
        onClose={handleCloseTask}
        isAdmin={isAdmin}
        onUpdateTask={async (taskId, payload) => {
          // Locate the task in the store so we can roll back on failure.
          // Search both the board buckets and the subitem cache — the panel
          // can be open on either.
          const store = useTaskStore.getState();
          let prev = null;
          for (const list of Object.values(store.tasksByGroup)) {
            if (!Array.isArray(list)) continue;
            const m = list.find((t) => t._id === taskId);
            if (m) {
              prev = m;
              break;
            }
          }
          if (!prev) {
            for (const list of Object.values(store.subitemsByParent)) {
              if (!Array.isArray(list)) continue;
              const m = list.find((t) => t._id === taskId);
              if (m) {
                prev = m;
                break;
              }
            }
          }

          // Apply the change optimistically so the UI feels instant. For
          // `assignedTo` we hydrate the id list into populated member objects
          // so the avatar stack renders without flicker until the server
          // response (with full populate) lands.
          if (prev) {
            const optimisticPatch = { ...payload };
            if (Array.isArray(payload.assignedTo)) {
              const idToMember = new Map(
                (members || []).map((m) => [String(m._id), m])
              );
              optimisticPatch.assignedTo = payload.assignedTo.map(
                (id) =>
                  idToMember.get(String(id)) || {
                    _id: id,
                    name: '',
                  }
              );
            }
            updateTaskLocal({ ...prev, ...optimisticPatch });
          }

          try {
            const updated = await taskService.updateTask(taskId, payload);
            updateTaskLocal(updated);
            return updated;
          } catch (err) {
            if (prev) updateTaskLocal(prev);
            console.error('Failed to update task from panel:', err);
            toastError(
              err?.response?.data?.error ||
                'Failed to update task. Please try again.'
            );
            throw err;
          }
        }}
        onEditLabels={isAdmin ? () => setEditChipsModal('labels') : undefined}
        onOpenSubitem={handleOpenSubitem}
        onBack={handleBackInStack}
        canGoBack={selectedTaskStack.length > 1}
        onCommentCountChange={setCommentCount}
      />

    </PageWrapper>
  );
};

export default BoardDetailPage;
