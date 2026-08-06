import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Pencil, Plus } from 'lucide-react';
import { focusedInputStyle, cellWrapperStyle } from './cellShared';

/**
 * ButtonCell — a per-row action button (Monday's button column). The stored
 * value is a destination URL; the label comes from `column.settings.buttonLabel`
 * (default "Open"). Clicking the button opens the link; a small pencil edits
 * it. Empty + editable → a "+ Add link" affordance.
 */

const normalizeUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  return `https://${s}`;
};

const ButtonCell = ({ value, column, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const ref = useRef(null);
  const label = (column?.settings?.buttonLabel || '').trim() || 'Open';

  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if ((next || null) !== (value || null)) onChange?.(next || null);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="url"
        placeholder="https://…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); setEditing(false); }
        }}
        style={focusedInputStyle}
      />
    );
  }

  if (!value) {
    if (readOnly) return <div style={cellWrapperStyle} />;
    return (
      <div style={{ ...cellWrapperStyle, cursor: 'pointer' }} onClick={() => setEditing(true)}>
        <span className="inline-flex items-center" style={{ gap: 5, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          <Plus size={13} /> Add link
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...cellWrapperStyle, gap: 6 }}>
      <button
        type="button"
        onClick={() => window.open(normalizeUrl(value), '_blank', 'noopener,noreferrer')}
        className="inline-flex items-center"
        style={{
          gap: 6, height: 26, padding: '0 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: column?.color || 'var(--color-accent)', color: '#fff', fontSize: 12.5, fontWeight: 600,
          fontFamily: 'var(--font-body)', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={normalizeUrl(value)}
      >
        {label} <ExternalLink size={13} />
      </button>
      {!readOnly && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit link"
          title="Edit link"
          style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
};

export default ButtonCell;
