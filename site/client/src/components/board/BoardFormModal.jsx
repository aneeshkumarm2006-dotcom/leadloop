import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';

/**
 * BoardFormModal — used for both creating and editing a board.
 * Matches Design doc Section 11 (Create Board form).
 *
 * Props:
 *   isOpen        — whether the modal is shown
 *   onClose       — fired when user cancels / closes
 *   onSubmit      — async ({ name, visibility, description }) => void
 *   initialValues — pre-fill values when editing
 *   mode          — "create" | "edit" (affects title + submit label)
 */
const DEFAULTS = { name: '', visibility: 'private', description: '', folderId: '' };

const BoardFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialValues,
  mode = 'create',
  folders = [],
}) => {
  const [values, setValues] = useState(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset / hydrate form whenever the modal opens or initialValues change
  useEffect(() => {
    if (!isOpen) return;
    setValues({
      name: initialValues?.name || '',
      visibility: initialValues?.visibility || 'private',
      description: initialValues?.description || '',
      folderId: initialValues?.folderId ? String(initialValues.folderId) : (folders.find((f) => f.isDefault)?._id ? String(folders.find((f) => f.isDefault)._id) : ''),
    });
    setError(null);
    setSubmitting(false);
  }, [isOpen, initialValues]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    const trimmed = values.name.trim();
    if (!trimmed) {
      setError('Board name is required');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        name: trimmed,
        visibility: values.visibility,
        description: values.description.trim(),
        folderId: values.folderId || null,
      });
    } catch (err) {
      const msg =
        err?.response?.data?.error || err?.message || 'Something went wrong';
      setError(msg);
      setSubmitting(false);
    }
  };

  const title = mode === 'edit' ? 'Edit Board' : 'Create Board';
  const submitLabel = mode === 'edit' ? 'Save Changes' : 'Create Board →';

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? undefined : onClose}
      title={title}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Input
          label="Board Name"
          required
          placeholder="e.g. DAVNOOT SEO"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          autoFocus
        />

        {/* Visibility radios */}
        <div>
          <label
            className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Visibility
          </label>
          <div className="flex items-center gap-5">
            {[
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
            ].map((opt) => {
              const checked = values.visibility === opt.value;
              return (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <span
                    className="flex items-center justify-center"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 'var(--radius-full)',
                      border: `1.5px solid ${
                        checked
                          ? 'var(--color-accent)'
                          : 'var(--color-border-strong)'
                      }`,
                      background: checked
                        ? 'var(--color-accent-light)'
                        : 'var(--color-bg-surface)',
                      transition:
                        'border-color 150ms ease, background 150ms ease',
                    }}
                  >
                    {checked && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--color-accent)',
                        }}
                      />
                    )}
                  </span>
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={checked}
                    onChange={() =>
                      setValues((v) => ({ ...v, visibility: opt.value }))
                    }
                    className="sr-only"
                  />
                  <span
                    className="font-body"
                    style={{
                      fontSize: 14,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {opt.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Folder (Phase 3.1) */}
        {folders.length > 0 && (
          <div>
            <label
              className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Folder
            </label>
            <select
              value={values.folderId}
              onChange={(e) => setValues((v) => ({ ...v, folderId: e.target.value }))}
              className="w-full font-body focus:outline-none"
              style={{ height: 40, padding: '0 10px', fontSize: 14, border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface, #fff)', color: 'var(--color-text-primary)' }}
            >
              {folders.map((f) => (
                <option key={f._id} value={String(f._id)}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        <Input
          label="Description (optional)"
          multiline
          rows={3}
          placeholder="What is this board for?"
          value={values.description}
          onChange={(e) =>
            setValues((v) => ({ ...v, description: e.target.value }))
          }
        />

        {error && (
          <p
            className="font-body text-xs"
            style={{ color: 'var(--color-status-stuck)' }}
          >
            {error}
          </p>
        )}

        {/* Hidden submit so <Enter> in inputs submits the form */}
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  );
};

export default BoardFormModal;
