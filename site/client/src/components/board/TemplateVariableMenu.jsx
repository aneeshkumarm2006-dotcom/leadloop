import { useMemo, useRef, useState } from 'react';

/**
 * TemplateVariableMenu — a text input/textarea that opens an inline variable
 * picker when the user types `{{` (Phase 2, F5.7).
 *
 * The menu lists the triggering task's columns (from `board.columns`) plus the
 * `{{user.*}}` tokens; selecting one inserts `{{Column Name}}` at the caret. The
 * server-side `templateInterpolate.js` engine substitutes these at run time for
 * NOTIFY_PERSON / SEND_EMAIL / SEND_SMS / SEND_WHATSAPP action bodies.
 *
 * Reusable inside any action-config field that accepts template variables — pass
 * the same `value` / `onChange` you'd give a plain input.
 *
 * Props: value, onChange(nextString), board, placeholder, multiline, rows,
 *        disabled, style.
 */
const USER_VARIABLES = [
  { token: 'user.displayName', label: 'Recipient name' },
  { token: 'user.email', label: 'Recipient email' },
];

const buildVariables = (board) => {
  const cols = (board && Array.isArray(board.columns) ? board.columns : []).map((c) => ({
    token: c.name,
    label: `${c.name}`,
    hint: c.type,
  }));
  return [...cols, ...USER_VARIABLES.map((u) => ({ ...u, hint: 'user' }))];
};

const baseFieldStyle = (disabled) => ({
  width: '100%',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  resize: 'vertical',
  cursor: disabled ? 'not-allowed' : 'text',
  opacity: disabled ? 0.6 : 1,
  fontFamily: 'inherit',
});

const TemplateVariableMenu = ({
  value = '',
  onChange,
  board,
  placeholder,
  multiline = true,
  rows = 3,
  disabled = false,
  style,
}) => {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState(0);
  const variables = useMemo(() => buildVariables(board), [board]);

  // Detect an unclosed `{{` immediately before the caret → open the picker and
  // capture the partial query typed after it.
  const detect = (text, caret) => {
    const before = text.slice(0, caret);
    const lastOpen = before.lastIndexOf('{{');
    if (lastOpen === -1) return null;
    const between = before.slice(lastOpen + 2);
    if (between.includes('}}') || between.includes('{{') || between.includes('\n')) {
      return null;
    }
    // Trim so `{{ Lead` still matches the "Lead Name" column (the menu shows all
    // variables for a bare `{{`). The whole `{{…caret` span is replaced on insert,
    // so the dropped whitespace never lingers in the output.
    return { anchor: lastOpen, query: between.trim() };
  };

  const handleChange = (e) => {
    const text = e.target.value;
    onChange?.(text);
    const caret = e.target.selectionStart ?? text.length;
    const d = detect(text, caret);
    if (d) {
      setOpen(true);
      setQuery(d.query);
      setAnchor(d.anchor);
    } else {
      setOpen(false);
    }
  };

  const insert = (token) => {
    const el = ref.current;
    const text = value || '';
    const caret = el ? el.selectionStart ?? text.length : text.length;
    const before = text.slice(0, anchor);
    const after = text.slice(caret);
    const insertion = `{{${token}}}`;
    onChange?.(`${before}${insertion}${after}`);
    setOpen(false);
    requestAnimationFrame(() => {
      if (el) {
        const pos = (before + insertion).length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const filtered = variables
    .filter((v) => v.token.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const commonProps = {
    ref,
    value,
    placeholder,
    disabled,
    onChange: handleChange,
    onBlur: () => setTimeout(() => setOpen(false), 120),
    onKeyDown: (e) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        e.stopPropagation();
      }
    },
    style: { ...baseFieldStyle(disabled), ...style },
    className: 'font-body',
  };

  return (
    <div style={{ position: 'relative' }}>
      {multiline ? (
        <textarea rows={rows} {...commonProps} />
      ) : (
        <input type="text" {...commonProps} />
      )}
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          aria-label="Insert variable"
          style={{
            position: 'absolute',
            zIndex: 30,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight: 200,
            overflowY: 'auto',
            background: 'var(--color-bg-surface)',
            border: '1.5px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 4,
            listStyle: 'none',
            margin: 0,
          }}
        >
          {filtered.map((v) => (
            <li key={v.token}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the textarea blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(v.token);
                }}
                className="font-body w-full flex items-center justify-between gap-2 rounded-md hover:bg-[color:var(--color-bg-subtle)]"
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-primary)',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>{`{{${v.label}}}`}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{v.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TemplateVariableMenu;
