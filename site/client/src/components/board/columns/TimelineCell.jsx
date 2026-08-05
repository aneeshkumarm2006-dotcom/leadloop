import { useEffect, useRef, useState } from 'react';
import { cellWrapperStyle, formatDateInput } from './cellShared';
import CellPlaceholder from './CellPlaceholder';
import DatePickerPopover from '../../ui/DatePickerPopover';

/**
 * TimelineCell — a span between two dates. Click to edit, then pick start/end
 * with the custom calendar (no native date inputs).
 */
const TimelineCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const wrapRef = useRef(null);

  const startYmd = formatDateInput(value?.start);
  const endYmd = formatDateInput(value?.end);

  const commit = (start, end) => {
    const next = {};
    if (start) next.start = new Date(start).toISOString();
    if (end) next.end = new Date(end).toISOString();
    const payload = Object.keys(next).length ? next : null;
    if (JSON.stringify(payload) !== JSON.stringify(value || null)) onChange?.(payload);
  };

  // Exit editing on outside click. The pickers portal their calendars to body
  // (role="dialog"), so ignore clicks landing inside an open calendar.
  useEffect(() => {
    if (!editing) return undefined;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[role="dialog"]')) return;
      setEditing(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editing]);

  if (readOnly || !editing) {
    const label =
      value?.start && value?.end
        ? `${new Date(value.start).toLocaleDateString()} → ${new Date(value.end).toLocaleDateString()}`
        : value?.start
        ? new Date(value.start).toLocaleDateString()
        : '';
    return (
      <div
        style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'pointer' }}
        onClick={() => !readOnly && setEditing(true)}
      >
        {label ? <span>{label}</span> : !readOnly ? <CellPlaceholder text="Set timeline" /> : null}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ display: 'flex', gap: 4, padding: 4 }}>
      <DatePickerPopover value={startYmd} placeholder="Start" onChange={(v) => commit(v, endYmd)} />
      <DatePickerPopover value={endYmd} placeholder="End" onChange={(v) => commit(startYmd, v)} />
    </div>
  );
};

export default TimelineCell;
