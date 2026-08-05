import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';

/**
 * TimePickerPopover — custom time picker (no native `type="time"`), matching
 * DatePickerPopover / Dropdown styling and portaled so it's never clipped.
 *
 * Props:
 *   value       — "HH:MM" 24-hour string (e.g. "09:30") or empty string
 *   onChange    — (newValue: "HH:MM") => void
 *   step        — minutes between options (default 15)
 *   placeholder — shown when no time is selected
 *   disabled    — disables the trigger
 */

const pad = (n) => String(n).padStart(2, '0');

/** "HH:MM" (24h) → "h:mm AM/PM" for display. */
const formatDisplay = (hhmm) => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
};

const TimePickerPopover = ({
  value = '',
  onChange,
  step = 15,
  placeholder = 'Select time',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const listRef = useRef(null);

  // Build the option list once per step.
  const options = useMemo(() => {
    const out = [];
    const s = Math.max(1, Math.min(60, step || 15));
    for (let mins = 0; mins < 24 * 60; mins += s) {
      const hhmm = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
      out.push(hhmm);
    }
    return out;
  }, [step]);

  const display = formatDisplay(value);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Position the portaled popover relative to the trigger.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    const compute = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const ph = popRef.current?.offsetHeight || 240;
      const up = window.innerHeight - r.bottom < ph + 8 && r.top > ph + 8;
      setPos({
        top: up ? Math.max(8, r.top - ph - 6) : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 160)),
        up,
      });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  // Scroll the selected (or nearest) option into view when opening.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('[data-selected="true"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [open]);

  const pick = (hhmm) => { onChange?.(hhmm); setOpen(false); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen((v) => !v); }}
        className="inline-flex items-center gap-2 font-body text-[13px]"
        style={{
          height: 36,
          padding: '0 10px',
          minWidth: 104,
          border: open ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: '#fff',
          color: display ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          boxShadow: open ? '0 0 0 3px rgba(62,107,78,0.15)' : 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 150ms, box-shadow 150ms',
          whiteSpace: 'nowrap',
        }}
      >
        <Clock size={13} aria-hidden="true" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{display || placeholder}</span>
      </button>

      {open && createPortal(
        <ul
          ref={popRef}
          role="listbox"
          aria-label="Time picker"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 200,
            width: 150,
            maxHeight: 240,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            margin: 0,
            listStyle: 'none',
            animation: pos.up ? 'tp-enter-up 150ms ease-out' : 'tp-enter 150ms ease-out',
          }}
        >
          <div ref={listRef}>
            {options.map((hhmm) => {
              const isSel = hhmm === value;
              return (
                <li key={hhmm} role="option" aria-selected={isSel} data-selected={isSel}>
                  <button
                    type="button"
                    onClick={() => pick(hhmm)}
                    className="w-full text-left font-body text-[13px] transition-colors duration-100 hover:bg-[color:var(--color-bg-subtle)]"
                    style={{
                      height: 32,
                      padding: '0 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: isSel ? 'var(--color-accent)' : 'transparent',
                      color: isSel ? '#fff' : 'var(--color-text-primary)',
                      fontWeight: isSel ? 600 : 400,
                      cursor: 'pointer',
                      border: 'none',
                    }}
                  >
                    {formatDisplay(hhmm)}
                  </button>
                </li>
              );
            })}
          </div>
        </ul>,
        document.body
      )}

      <style>{`
        @keyframes tp-enter { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tp-enter-up { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </>
  );
};

export default TimePickerPopover;
