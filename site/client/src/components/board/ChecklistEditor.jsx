import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import useTaskStore from '../../store/taskStore';

const RENAME_DEBOUNCE_MS = 500;

/**
 * ChecklistEditor — renders inside the task detail panel between Notes and
 * Comments. Lists existing items as `[checkbox] [text input] [delete]` rows,
 * with a `+ Add item` row at the bottom.
 *
 * Mutations go through useTaskStore so the board view's progress badge stays
 * in sync. Text edits debounce a rename so we don't spam the API per keystroke.
 *
 * For personal tasks (no board), behaves identically — the controller scopes
 * by creator instead of board membership.
 */
const ChecklistEditor = ({ task }) => {
  const { t } = useTranslation();
  const addChecklistItem = useTaskStore((s) => s.addChecklistItem);
  const toggleChecklistItem = useTaskStore((s) => s.toggleChecklistItem);
  const renameChecklistItem = useTaskStore((s) => s.renameChecklistItem);
  const deleteChecklistItem = useTaskStore((s) => s.deleteChecklistItem);
  const updateTaskLocal = useTaskStore((s) => s.updateTask);

  const items = useMemo(
    () => (Array.isArray(task?.checklist) ? task.checklist : []),
    [task?.checklist]
  );

  // Local draft text per item to keep input responsive while we debounce save.
  const [drafts, setDrafts] = useState({});
  const draftTimers = useRef({});
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [error, setError] = useState('');
  const newInputRef = useRef(null);

  // Sync drafts whenever the underlying items list changes (e.g. after
  // server response). Preserve drafts that diverge from server text — those
  // are in-flight edits the user is still typing.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      const liveIds = new Set();
      for (const it of items) {
        const id = it._id?.toString();
        if (!id) continue;
        liveIds.add(id);
        if (!(id in next)) next[id] = it.text || '';
      }
      // Drop drafts for items that were deleted.
      for (const id of Object.keys(next)) {
        if (!liveIds.has(id)) delete next[id];
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    return () => {
      for (const t of Object.values(draftTimers.current)) clearTimeout(t);
      draftTimers.current = {};
    };
  }, []);

  const { total, done } = useMemo(() => {
    return {
      total: items.length,
      done: items.filter((it) => it.done).length,
    };
  }, [items]);

  const taskId = task?._id;

  const scheduleRename = useCallback(
    (itemId, value) => {
      if (!taskId) return;
      if (draftTimers.current[itemId]) {
        clearTimeout(draftTimers.current[itemId]);
      }
      draftTimers.current[itemId] = setTimeout(async () => {
        try {
          await renameChecklistItem(taskId, itemId, value.trim());
        } catch (err) {
          console.error('Failed to rename checklist item:', err);
          setError(
            err?.response?.data?.error ||
              t('automation.checklistSaveError')
          );
        }
      }, RENAME_DEBOUNCE_MS);
    },
    [taskId, renameChecklistItem, t]
  );

  const handleDraftChange = (itemId, value) => {
    setDrafts((prev) => ({ ...prev, [itemId]: value }));
    scheduleRename(itemId, value);
  };

  const handleToggle = async (itemId, done) => {
    if (!taskId) return;
    // Optimistic local update so the board badge feels instant.
    const optimistic = {
      ...task,
      checklist: items.map((it) =>
        it._id?.toString() === itemId.toString() ? { ...it, done } : it
      ),
    };
    updateTaskLocal(optimistic);
    try {
      await toggleChecklistItem(taskId, itemId, done);
    } catch (err) {
      console.error('Failed to toggle checklist item:', err);
      setError(
        err?.response?.data?.error ||
          t('automation.checklistSaveError')
      );
      // Revert to original task on failure.
      updateTaskLocal(task);
    }
  };

  const handleDelete = async (itemId) => {
    if (!taskId) return;
    if (draftTimers.current[itemId]) {
      clearTimeout(draftTimers.current[itemId]);
      delete draftTimers.current[itemId];
    }
    try {
      await deleteChecklistItem(taskId, itemId);
    } catch (err) {
      console.error('Failed to delete checklist item:', err);
      setError(
        err?.response?.data?.error ||
          t('automation.checklistDeleteError')
      );
    }
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    const trimmed = newText.trim();
    if (!trimmed || !taskId) return;
    try {
      await addChecklistItem(taskId, trimmed);
      setNewText('');
      setAdding(true);
      setTimeout(() => newInputRef.current?.focus(), 0);
    } catch (err) {
      console.error('Failed to add checklist item:', err);
      setError(
        err?.response?.data?.error ||
          t('automation.checklistAddError')
      );
    }
  };

  return (
    <div className="mt-4">
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
          {t('automation.checklistTitle')}
        </p>
        {total > 0 && (
          <span
            className="font-body"
            style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
          >
            {done} / {total}
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

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((item) => {
          const id = item._id?.toString();
          if (!id) return null;
          const draftText = drafts[id] ?? item.text ?? '';
          return (
            <li
              key={id}
              className="flex items-center gap-2"
              style={{ padding: '4px 0' }}
            >
              <input
                type="checkbox"
                checked={!!item.done}
                onChange={(e) => handleToggle(id, e.target.checked)}
                aria-label={
                  item.done
                    ? t('automation.checklistMarkIncomplete', {
                        item: item.text || t('automation.checklistItemFallback'),
                      })
                    : t('automation.checklistMarkComplete', {
                        item: item.text || t('automation.checklistItemFallback'),
                      })
                }
                style={{
                  width: 16,
                  height: 16,
                  accentColor: 'var(--color-status-done, #00C875)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <input
                type="text"
                value={draftText}
                onChange={(e) => handleDraftChange(id, e.target.value)}
                placeholder={t('automation.checklistItemTextPlaceholder')}
                className="flex-1 font-body focus:outline-none"
                style={{
                  fontSize: 14,
                  padding: '4px 6px',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  color: item.done
                    ? 'var(--color-text-muted)'
                    : 'var(--color-text-primary)',
                  textDecoration: item.done ? 'line-through' : 'none',
                  transition: 'border-color 150ms',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border-strong)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              />
              <button
                type="button"
                onClick={() => handleDelete(id)}
                aria-label={t('automation.checklistDeleteItem')}
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
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form
          onSubmit={handleAdd}
          className="flex items-center gap-2"
          style={{ padding: '4px 0', marginTop: 4 }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
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
            placeholder={t('automation.checklistNewItemPlaceholder')}
            autoFocus
            className="flex-1 font-body focus:outline-none"
            style={{
              fontSize: 14,
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
            {t('automation.add')}
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
          {t('automation.checklistAddItem')}
        </button>
      )}
    </div>
  );
};

export default ChecklistEditor;
