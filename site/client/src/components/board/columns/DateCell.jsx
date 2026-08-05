import { useState } from 'react';
import { cellWrapperStyle, formatDateInput } from './cellShared';
import CellPlaceholder from './CellPlaceholder';
import DatePickerPopover from '../../ui/DatePickerPopover';

const DateCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);

  // Custom calendar (no native date input). Value is stored as an ISO datetime;
  // the picker speaks "YYYY-MM-DD" so we convert on the way in and out.
  const commit = (ymd) => {
    if (!ymd) {
      if (value) onChange?.(null);
    } else {
      const iso = new Date(ymd).toISOString();
      if (iso !== (value ? new Date(value).toISOString() : null)) onChange?.(iso);
    }
  };

  if (readOnly || !editing) {
    return (
      <div
        style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'pointer' }}
        onClick={() => !readOnly && setEditing(true)}
      >
        {value ? (
          <span>{new Date(value).toLocaleDateString()}</span>
        ) : !readOnly ? (
          <CellPlaceholder text="Set date" />
        ) : null}
      </div>
    );
  }

  return (
    <DatePickerPopover
      value={formatDateInput(value)}
      startOpen
      onChange={commit}
      onClose={() => setEditing(false)}
      placeholder="Set date"
    />
  );
};

export default DateCell;
