import { useEffect, useRef, useState } from 'react';
import { focusedInputStyle, cellWrapperStyle, formatDateInput } from './cellShared';
import CellPlaceholder from './CellPlaceholder';

const DateCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatDateInput(value));
  const ref = useRef(null);

  useEffect(() => setDraft(formatDateInput(value)), [value]);
  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const commit = () => {
    if (draft === '') {
      if (value) onChange?.(null);
    } else {
      const iso = new Date(draft).toISOString();
      if (iso !== (value ? new Date(value).toISOString() : null)) onChange?.(iso);
    }
    setEditing(false);
  };

  if (readOnly || !editing) {
    return (
      <div
        style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'text' }}
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
    <input
      ref={ref}
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(formatDateInput(value));
          setEditing(false);
        }
      }}
      style={focusedInputStyle}
    />
  );
};

export default DateCell;
