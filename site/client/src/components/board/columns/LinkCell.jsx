import { useEffect, useRef, useState } from 'react';
import { focusedInputStyle, cellWrapperStyle } from './cellShared';
import CellPlaceholder from './CellPlaceholder';

const LinkCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const initial = typeof value === 'string' ? { url: value, label: '' } : value || {};
  const [url, setUrl] = useState(initial.url || '');
  const [label, setLabel] = useState(initial.label || '');
  const ref = useRef(null);

  useEffect(() => {
    const v = typeof value === 'string' ? { url: value, label: '' } : value || {};
    setUrl(v.url || '');
    setLabel(v.label || '');
  }, [value]);
  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const commit = () => {
    const next = { url: url.trim(), label: label.trim() };
    if (!next.url && !next.label) {
      if (value) onChange?.(null);
    } else if (next.url !== initial.url || next.label !== initial.label) {
      onChange?.(next);
    }
    setEditing(false);
  };

  if (readOnly || !editing) {
    const display = initial.label || initial.url || '';
    return (
      <div
        style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'text' }}
        onClick={() => !readOnly && setEditing(true)}
      >
        {initial.url ? (
          <a
            href={initial.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
          >
            {display}
          </a>
        ) : !readOnly ? (
          <CellPlaceholder text="Add link" />
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, padding: 4 }}>
      <input
        ref={ref}
        type="url"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={focusedInputStyle}
      />
    </div>
  );
};

export default LinkCell;
