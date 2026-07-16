import { useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import DatePickerPopover from '../ui/DatePickerPopover';
import { createTask } from '../../services/taskService';

/**
 * PersonalTaskModal — simplified create-task form for personal (non-board) tasks.
 *
 * Personal tasks have no group, board, or assignee. The current user is always
 * the creator and sole viewer. See Macan_PDR.md Section 4.4 and
 * Macan_TechStack.md Section 8.9.
 *
 * Props:
 *   isOpen    — boolean
 *   onClose   — () => void
 *   onCreated — (task) => void — called after the task is saved
 */

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUSES = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'working_on_it', label: 'Working on it' },
  { value: 'done', label: 'Done' },
  { value: 'stuck', label: 'Stuck' },
];

const INITIAL_FORM = {
  name: '',
  priority: 'medium',
  status: 'not_started',
  dueDate: '',
  note: '',
};

const SelectField = ({ label, value, onChange, options, disabled }) => (
  <div>
    <label
      className="block mb-2 font-body font-medium text-xs uppercase tracking-wide"
      style={{ color: 'var(--color-text-secondary)' }}
    >
      {label}
    </label>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full font-body"
      style={{
        height: 38,
        padding: '0 10px',
        borderRadius: 'var(--radius-md)',
        border: '1.5px solid var(--color-border)',
        background: 'var(--color-bg-input)',
        color: 'var(--color-text-primary)',
        fontSize: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

const PersonalTaskModal = ({ isOpen, onClose, onCreated }) => {
  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const reset = () => {
    setForm(INITIAL_FORM);
    setError('');
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Task name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const task = await createTask({
        name: form.name.trim(),
        priority: form.priority,
        status: form.status,
        dueDate: form.dueDate || undefined,
        note: form.note.trim() || undefined,
        isPersonal: true,
      });
      onCreated?.(task);
      reset();
      onClose();
    } catch (err) {
      setError(
        err?.response?.data?.error || 'Failed to create task. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Personal Task"
      maxWidth={480}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Task'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Task Name"
          placeholder="What needs to get done?"
          value={form.name}
          onChange={set('name')}
          required
          disabled={saving}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={set('priority')}
            options={PRIORITIES}
            disabled={saving}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={set('status')}
            options={STATUSES}
            disabled={saving}
          />
        </div>

        <div>
          <label
            className="font-body font-semibold block"
            style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}
          >
            Due Date
          </label>
          <DatePickerPopover
            value={form.dueDate}
            onChange={(val) => setForm((f) => ({ ...f, dueDate: val }))}
            disabled={saving}
            placeholder="Set due date"
          />
        </div>

        <Input
          label="Note"
          placeholder="Any additional context…"
          value={form.note}
          onChange={set('note')}
          disabled={saving}
          multiline
          rows={3}
        />

        {error && (
          <p
            className="text-xs font-body"
            style={{ color: 'var(--color-status-stuck)' }}
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default PersonalTaskModal;
