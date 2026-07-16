import { useEffect, useRef, useState } from 'react';
import { focusedInputStyle, cellWrapperStyle } from './cellShared';
import CellPlaceholder from './CellPlaceholder';

/**
 * LongTextCell — multi-line text. Inline edit expands into a textarea on
 * focus; commits on blur. Ctrl/Cmd+Enter also commits.
 */
const LongTextCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => setDraft(value || ''), [value]);
  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const commit = () => {
    if (draft !== (value || '')) onChange?.(draft);
    setEditing(false);
  };

  if (readOnly || !editing) {
    return (
      <div
        style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'text' }}
        onClick={() => !readOnly && setEditing(true)}
        title={value || ''}
      >
        {value ? (
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {value}
          </span>
        ) : !readOnly ? (
          <CellPlaceholder text="Add text" />
        ) : null}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
        if (e.key === 'Escape') {
          setDraft(value || '');
          setEditing(false);
        }
      }}
      rows={3}
      style={{ ...focusedInputStyle, resize: 'vertical', minHeight: 60 }}
      maxLength={20000}
    />
  );
};

export default LongTextCell;
