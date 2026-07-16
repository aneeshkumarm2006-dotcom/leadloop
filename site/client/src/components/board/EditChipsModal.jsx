import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Star } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import useBoardStore from '../../store/boardStore';
import useToastStore from '../../store/toastStore';

/**
 * EditChipsModal — admin-only modal for editing the labels OR statuses on
 * a board. `kind` toggles which collection is being managed:
 *
 *   <EditChipsModal kind="labels"   boardId={id} ... />
 *   <EditChipsModal kind="statuses" boardId={id} ... />
 *
 * The board doc is read from useBoardStore so it stays in sync with
 * optimistic updates triggered elsewhere (StatusMenu, LabelPicker, etc.).
 *
 * Each row has:
 *   - color swatch (HTML <input type="color">)
 *   - name input
 *   - star button (statuses only — marks the row as the default status)
 *   - delete button (statuses only: blocked for the default)
 *
 * Adds, renames, recolors, and deletes are persisted immediately via
 * boardStore actions; no per-modal save button.
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isValidHex = (v) => typeof v === 'string' && HEX_RE.test(v.trim());
const DEFAULT_NEW_COLOR = '#6B7280';

const EditChipsModal = ({ isOpen, onClose, boardId, kind = 'labels' }) => {
  const { t } = useTranslation();
  const isLabels = kind === 'labels';
  const title = isLabels ? t('boardMisc.editLabels') : t('boardMisc.editStatuses');

  const board = useBoardStore((s) => s.getBoardById(boardId));
  const addLabel = useBoardStore((s) => s.addLabel);
  const updateLabel = useBoardStore((s) => s.updateLabel);
  const deleteLabel = useBoardStore((s) => s.deleteLabel);
  const addStatus = useBoardStore((s) => s.addStatus);
  const updateStatusChip = useBoardStore((s) => s.updateStatusChip);
  const deleteStatus = useBoardStore((s) => s.deleteStatus);

  const toastError = useToastStore((s) => s.error);

  const collection = useMemo(() => {
    if (!board) return [];
    const list = isLabels ? board.labels : board.statuses;
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [board, isLabels]);

  // Local draft buffer so name/color edits don't fire a network call on
  // every keystroke. Flushed onBlur.
  const [drafts, setDrafts] = useState({});
  useEffect(() => {
    setDrafts({});
  }, [isOpen, kind, boardId]);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_NEW_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const draftFor = (id, field) => {
    const d = drafts[id];
    return d && Object.prototype.hasOwnProperty.call(d, field) ? d[field] : null;
  };

  const setDraft = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  };

  const clearDraft = (id, field) => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (next[id]) {
        const { [field]: _ignored, ...rest } = next[id];
        next[id] = rest;
        if (Object.keys(next[id]).length === 0) delete next[id];
      }
      return next;
    });
  };

  const flushField = async (item, field) => {
    const draft = draftFor(item._id, field);
    if (draft === null) return;
    const original = item[field];
    if (draft === original) {
      clearDraft(item._id, field);
      return;
    }
    if (field === 'name' && !draft.trim()) {
      clearDraft(item._id, field);
      return;
    }
    if (field === 'color' && !isValidHex(draft)) {
      clearDraft(item._id, field);
      return;
    }
    try {
      const payload = { [field]: field === 'name' ? draft.trim() : draft };
      if (isLabels) {
        await updateLabel(boardId, item._id, payload);
      } else {
        await updateStatusChip(boardId, item._id, payload);
      }
      clearDraft(item._id, field);
    } catch (err) {
      console.error('Failed to update chip:', err);
      toastError(err?.response?.data?.error || t('boardMisc.failedToSaveChanges'));
      clearDraft(item._id, field);
    }
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    const trimmed = newName.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const color = isValidHex(newColor) ? newColor : DEFAULT_NEW_COLOR;
      if (isLabels) {
        await addLabel(boardId, { name: trimmed, color });
      } else {
        await addStatus(boardId, { name: trimmed, color });
      }
      setNewName('');
      setNewColor(DEFAULT_NEW_COLOR);
    } catch (err) {
      console.error('Failed to add chip:', err);
      toastError(err?.response?.data?.error || t('boardMisc.failedToAdd'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkDefault = async (statusId) => {
    try {
      await updateStatusChip(boardId, statusId, { isDefault: true });
    } catch (err) {
      console.error('Failed to mark default:', err);
      toastError(err?.response?.data?.error || t('boardMisc.failedToUpdateDefault'));
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return;
    const item = pendingDelete;
    setPendingDelete(null);
    try {
      if (isLabels) {
        await deleteLabel(boardId, item._id);
      } else {
        await deleteStatus(boardId, item._id);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
      toastError(err?.response?.data?.error || t('boardMisc.failedToDelete'));
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth={520}
      footer={
        <Button variant="secondary" onClick={onClose}>{t('boardMisc.done')}</Button>
      }
    >
      <div className="flex flex-col gap-2">
        {collection.length === 0 ? (
          <p
            className="font-body"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              padding: '12px 0',
            }}
          >
            {t('boardMisc.noneYetAddBelow')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {collection.map((item) => {
              const nameDraft = draftFor(item._id, 'name');
              const colorDraft = draftFor(item._id, 'color');
              const displayName = nameDraft != null ? nameDraft : item.name;
              const displayColor = colorDraft != null ? colorDraft : item.color;
              const isDefault = !isLabels && item.isDefault;
              return (
                <li
                  key={item._id}
                  className="flex items-center gap-2"
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <input
                    type="color"
                    value={isValidHex(displayColor) ? displayColor : DEFAULT_NEW_COLOR}
                    onChange={(e) => setDraft(item._id, 'color', e.target.value)}
                    onBlur={() => flushField(item, 'color')}
                    aria-label={t('boardMisc.namedColor', { name: item.name })}
                    style={{
                      width: 32,
                      height: 28,
                      border: '1px solid var(--color-border-strong)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 0,
                      cursor: 'pointer',
                      background: 'transparent',
                    }}
                  />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDraft(item._id, 'name', e.target.value)}
                    onBlur={() => flushField(item, 'name')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    aria-label={t('boardMisc.namedName', { name: item.name })}
                    className="flex-1 font-body focus:outline-none"
                    style={{
                      fontSize: 14,
                      height: 32,
                      padding: '0 10px',
                      border: '1.5px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                  {!isLabels && (
                    <button
                      type="button"
                      onClick={() => !isDefault && handleMarkDefault(item._id)}
                      disabled={isDefault}
                      aria-label={isDefault ? t('boardMisc.defaultStatus') : t('boardMisc.markAsDefault')}
                      title={isDefault ? t('boardMisc.defaultStatus') : t('boardMisc.markAsDefault')}
                      className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                      style={{
                        width: 28,
                        height: 28,
                        background: 'transparent',
                        border: 'none',
                        cursor: isDefault ? 'default' : 'pointer',
                        color: isDefault
                          ? 'var(--color-accent)'
                          : 'var(--color-text-muted)',
                      }}
                    >
                      <Star size={14} fill={isDefault ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(item)}
                    disabled={!isLabels && item.isDefault}
                    aria-label={t('boardMisc.deleteNamed', { name: item.name })}
                    className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      width: 28,
                      height: 28,
                      background: 'transparent',
                      border: 'none',
                      cursor: !isLabels && item.isDefault ? 'not-allowed' : 'pointer',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={handleAdd}
          className="flex items-center gap-2"
          style={{ marginTop: 8 }}
        >
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label={t('boardMisc.newChipColor')}
            style={{
              width: 32,
              height: 28,
              border: '1px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-sm)',
              padding: 0,
              cursor: 'pointer',
              background: 'transparent',
            }}
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={isLabels ? t('boardMisc.newLabelName') : t('boardMisc.newStatusName')}
            aria-label={t('boardMisc.newChipName')}
            className="flex-1 font-body focus:outline-none"
            style={{
              fontSize: 14,
              height: 32,
              padding: '0 10px',
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
            }}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={Plus}
            disabled={!newName.trim() || submitting}
          >
            {t('boardMisc.add')}
          </Button>
        </form>
      </div>
    </Modal>

    <Modal
      isOpen={!!pendingDelete}
      onClose={() => setPendingDelete(null)}
      title={isLabels ? t('boardMisc.deleteLabelQuestion') : t('boardMisc.deleteStatusQuestion')}
      footer={
        <>
          <Button variant="secondary" onClick={() => setPendingDelete(null)}>
            {t('boardMisc.cancel')}
          </Button>
          <Button variant="danger" onClick={handleDeleteConfirmed}>
            {t('boardMisc.delete')}
          </Button>
        </>
      }
    >
      <p
        className="font-body"
        style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}
      >
        {isLabels ? (
          <>
            {t('boardMisc.deleteLabelPrefix')}{' '}
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {pendingDelete?.name}
            </strong>
            {t('boardMisc.deleteLabelSuffix')}
          </>
        ) : (
          <>
            {t('boardMisc.deleteStatusPrefix')}{' '}
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {pendingDelete?.name}
            </strong>
            {t('boardMisc.deleteStatusSuffix')}
          </>
        )}
      </p>
    </Modal>
    </>
  );
};

export default EditChipsModal;
