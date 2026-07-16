import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import Dropdown from '../ui/Dropdown';

const localizer = momentLocalizer(moment);

/**
 * BoardCalendarView (Phase 3.0) — a board-scoped calendar view tab. Plots the
 * board's leads on a calendar by a chosen date/timeline column (falling back to
 * the legacy due date). Clicking an event opens that lead.
 */
const readDateFrom = (task, colId) => {
  if (colId === '__due__') return task.dueDate ? new Date(task.dueDate) : null;
  const v = task.columnValues ? task.columnValues[colId] : undefined;
  const raw = v && typeof v === 'object' ? v.start || v.date || v.value : v;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const BoardCalendarView = ({ board, tasks = [], onOpenTask }) => {
  const { t } = useTranslation();

  // Date-type columns the user can plot by (+ the legacy due date).
  const dateColumns = useMemo(
    () => (board?.columns || []).filter((c) => c.type === 'date' || c.type === 'timeline'),
    [board]
  );
  const options = useMemo(
    () => [
      ...dateColumns.map((c) => ({ value: String(c._id), label: c.name })),
      { value: '__due__', label: t('grid.dueDate') },
    ],
    [dateColumns, t]
  );
  const [colId, setColId] = useState(options[0]?.value || '__due__');

  const events = useMemo(
    () =>
      (tasks || [])
        .map((task) => {
          const d = readDateFrom(task, colId);
          if (!d) return null;
          return { id: task._id, title: task.name || '—', start: d, end: d, allDay: true, task };
        })
        .filter(Boolean),
    [tasks, colId]
  );

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('pages.colorBy')}
        </span>
        <div style={{ width: 200 }}>
          <Dropdown size="sm" options={options} value={colId} onChange={setColId} />
        </div>
      </div>
      <div
        className="bg-surface"
        style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 12 }}
      >
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          views={['month', 'week', 'day', 'agenda']}
          popup
          style={{ height: '68vh' }}
          onSelectEvent={(e) => onOpenTask?.(e.task)}
        />
      </div>
    </div>
  );
};

export default BoardCalendarView;
