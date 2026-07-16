import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import useTaskStore from '../../store/taskStore';
import * as taskService from '../../services/taskService';
import { getStatusPalette } from '../../utils/priorityColors';

const RENAME_DEBOUNCE_MS = 500;

/**
 * SubitemsList — compact list rendered inside the task detail panel.
 *
 * Lists this task's direct subitems (children). Each row shows:
 *   - a small status indicator (clickable, cycles to the next board status)
 *   - an inline name input (debounce-saved)
 *   - an "open" arrow that re-focuses the panel on the subitem (recursive)
 *   - a delete button
 *
 * The "+ Add subitem" row at the bottom creates a new child task on the same
 * board/group as the parent. Subitems aren't shown in the board view's top
 * level — see [server/src/controllers/taskController.js] getTasks() which
 * filters `parent: null`.
 *
 * Props:
 *   task          — parent task doc
 *   board         — board doc (for status palette + chip colors)
 *   isAdmin       — whether the current user can add/delete subitems
 *   onOpenSubitem — (subitem) => void   pushes the subitem onto the panel's
 *                   focused-task stack so it can be edited like any task
 */
const SubitemsList = ({ task, board, isAdmin = false, onOpenSubitem }) => {
  const { t } = useTranslation();
  const parentId = task?._id || null;

  const subitems = useTaskStore((s) =>
    parentId ? s.subitemsByParent[parentId] || null : null
  );
  const fetchSubitems = useTaskStore((s) => s.fetchSubitems);
  const addSubitem = useTaskStore((s) => s.addSubitem);
  const updateSubitem = useTaskStore((s) => s.updateSubitem);
  const deleteSubitem = useTaskStore((s) => s.deleteSubitem);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const draftTimers = useRef({});
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const newInputRef = useRef(null);

  // Personal tasks (no board) can't have board-scoped subitems. Tasks that
  // are themselves subitems (have a parent) can't be nested further — the
  // server rejects that case anyway.
  const canHaveSubitems = !task?.isPersonal && !!task?.board && !task?.parent;

  // Load subitems when the panel opens for this task.
  useEffect(() => {
    if (!parentId || !canHaveSubitems) return;
    if (subitems != null) return; // cached
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSubitems(parentId)
      .catch((err) => {
        console.error('Failed to load subitems:', err);
        if (!cancelled) {
          setError(
            err?.response?.data?.error ||
              t('boardMisc.failedToLoadSubitems')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parentId, canHaveSubitems, subitems, fetchSubitems, t]);

  // Sync local drafts with the latest subitem list.
  useEffect(() => {
    if (!Array.isArray(subitems)) return;
    setDrafts((prev) => {
      const next = { ...prev };
      const liveIds = new Set();
      for (const it of subitems) {
        const id = it._id?.toString();
        if (!id) continue;
        liveIds.add(id);
        if (!(id in next)) next[id] = it.name || '';
      }
      for (const id of Object.keys(next)) {
        if (!liveIds.has(id)) delete next[id];
      }
      return next;
    });
  }, [subitems]);

  useEffect(() => {
    return () => {
      for (const t of Object.values(draftTimers.current)) clearTimeout(t);
      draftTimers.current = {};
    };
  }, []);

  const boardStatuses = useMemo(() => {
    if (!board || !Array.isArray(board.statuses)) return [];
    return [...board.statuses].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [board]);

  const doneStatus = useMemo(
    () => boardStatuses.find((s) => s.key === 'done') || null,
    [boardStatuses]
  );

  const scheduleRename = useCallback(
    (subitemId, value) => {
      if (draftTimers.current[subitemId]) {
        clearTimeout(draftTimers.current[subitemId]);
      }
      draftTimers.current[subitemId] = setTimeout(async () => {
        const trimmed = value.trim();
        if (!trimmed) return;
        try {
          const updated = await taskService.updateTask(subitemId, {
            name: trimmed,
          });
          updateSubitem(updated);
        } catch (err) {
          console.error('Failed to rename subitem:', err);
          setError(
            err?.response?.data?.error ||
              t('boardMisc.failedToSaveChange')
          );
        }
      }, RENAME_DEBOUNCE_MS);
    },
    [updateSubitem, t]
  );

  const handleDraftChange = (subitemId, value) => {
    setDrafts((prev) => ({ ...prev, [subitemId]: value }));
    scheduleRename(subitemId, value);
  };

  const handleCycleStatus = async (subitem) => {
    if (boardStatuses.length === 0) return;
    const currentId = subitem.status ? subitem.status.toString() : null;
    const currentIdx = boardStatuses.findIndex(
      (s) => s._id.toString() === currentId
    );
    const nextStatus =
      boardStatuses[(currentIdx + 1) % boardStatuses.length];
    try {
      const updated = await taskService.updateTask(subitem._id, {
        status: nextStatus._id,
      });
      updateSubitem(updated);
    } catch (err) {
      console.error('Failed to update subitem status:', err);
      setError(
        err?.response?.data?.error ||
          t('boardMisc.failedToUpdateStatus')
      );
    }
  };

  const handleDelete = async (subitemId) => {
    if (draftTimers.current[subitemId]) {
      clearTimeout(draftTimers.current[subitemId]);
      delete draftTimers.current[subitemId];
    }
    try {
      await taskService.deleteTask(subitemId);
      deleteSubitem(subitemId);
    } catch (err) {
      console.error('Failed to delete subitem:', err);
      setError(
        err?.response?.data?.error ||
          t('boardMisc.failedToDeleteSubitem')
      );
    }
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    const trimmed = newText.trim();
    if (!trimmed || !parentId) return;
    try {
      await addSubitem(parentId, { name: trimmed });
      setNewText('');
      setAdding(true);
      setTimeout(() => newInputRef.current?.focus(), 0);
    } catch (err) {
      console.error('Failed to add subitem:', err);
      setError(
        err?.response?.data?.error ||
          t('boardMisc.failedToAddSubitem')
      );
    }
  };

  if (!canHaveSubitems) return null;

  const items = Array.isArray(subitems) ? subitems : [];
  const doneCount = doneStatus
    ? items.filter(
        (it) => it.status?.toString() === doneStatus._id.toString()
      ).length
    : 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <p
          className="font-body"
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--color-text-muted)',
          }}
        >
          {t('boardMisc.subitems')}
        </p>
        {items.length > 0 && (
          <span
            className="font-body"
            style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
          >
            {doneStatus ? `${doneCount} / ${items.length}` : items.length}
          </span>
        )}
      </div>

      {error ? (
        <p
          className="font-body"
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--color-status-stuck)',
            marginBottom: 8,
          }}
        >
          {error}
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <p
          className="font-body"
          style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
        >
          {t('boardMisc.loadingSubitems')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((sub) => {
            const id = sub._id?.toString();
            if (!id) return null;
            const draftName = drafts[id] ?? sub.name ?? '';
            const palette = getStatusPalette(board, sub.status);
            return (
              <SubitemRow
                key={id}
                subitem={sub}
                draftName={draftName}
                palette={palette}
                onNameChange={(v) => handleDraftChange(id, v)}
                onCycleStatus={() => handleCycleStatus(sub)}
                onOpen={onOpenSubitem ? () => onOpenSubitem(sub) : undefined}
                onDelete={isAdmin ? () => handleDelete(id) : undefined}
              />
            );
          })}
        </ul>
      )}

      {isAdmin ? (
        adding ? (
          <form
            onSubmit={handleAdd}
            className="flex items-center gap-2"
            style={{ padding: '4px 0', marginTop: 4 }}
          >
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
              ref={newInputRef}
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
              placeholder={t('boardMisc.newSubitem')}
              autoFocus
              className="flex-1 font-body focus:outline-none"
              style={{
                fontSize: 13,
                padding: '4px 6px',
                background: 'transparent',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
              }}
            />
            <button
              type="submit"
              disabled={!newText.trim()}
              className="inline-flex items-center justify-center font-body disabled:opacity-40 disabled:cursor-not-allowed"
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
              }}
            >
              {t('boardMisc.add')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setTimeout(() => newInputRef.current?.focus(), 0);
            }}
            className="inline-flex items-center gap-1 font-body transition-colors duration-150 hover:text-[color:var(--color-accent)]"
            style={{
              marginTop: 6,
              padding: '4px 0',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Plus size={13} aria-hidden="true" />
            {t('boardMisc.addSubitem')}
          </button>
        )
      ) : null}
    </div>
  );
};

/**
 * One subitem row. Pulled out so hover state and inline edit are isolated.
 */
const SubitemRow = ({
  subitem,
  draftName,
  palette,
  onNameChange,
  onCycleStatus,
  onOpen,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  return (
    <li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center gap-2"
      style={{ padding: '4px 0' }}
    >
      <button
        type="button"
        onClick={onCycleStatus}
        aria-label={t('boardMisc.statusClickToChange', { label: palette.label })}
        title={palette.label}
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: palette.solid || palette.text,
          border: '1.5px solid #FFFFFF',
          boxShadow: '0 0 0 1px var(--color-border-strong)',
          flexShrink: 0,
          cursor: 'pointer',
          padding: 0,
        }}
      />
      <input
        type="text"
        value={draftName}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={t('boardMisc.subitemName')}
        className="flex-1 font-body focus:outline-none min-w-0"
        style={{
          fontSize: 13,
          padding: '4px 6px',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-primary)',
          transition: 'border-color 150ms',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border-strong)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'transparent';
        }}
      />
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('boardMisc.openNamedSubitem', { name: subitem.name || t('boardMisc.subitem') })}
          title={t('boardMisc.openSubitem')}
          className="flex items-center justify-center rounded transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{
            width: 24,
            height: 24,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 150ms',
          }}
        >
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('boardMisc.deleteSubitem')}
          className="flex items-center justify-center rounded transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{
            width: 24,
            height: 24,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </li>
  );
};

export default SubitemsList;
