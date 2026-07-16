import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, ChevronLeft } from 'lucide-react';
import { cellWrapperStyle, optionSorted, findOption } from './cellShared';
import { LabelEditor } from './labelShared';
import { getColorPair } from '../../../utils/priorityColors';
import CellPlaceholder from './CellPlaceholder';

/**
 * StatusCell — single-select status rendered as a "ledger chip": a soft tint
 * of the label's hue with a solid color dot and ink-dark text, instead of the
 * old Monday-style full-bleed saturated fill. Works for any user-picked color.
 * Clicking opens a popover of chips; an "Edit labels" footer flips to an
 * inline editor that persists to the column settings via `onUpdateColumn`.
 */
const StatusCell = ({ value, column, readOnly, onChange, onUpdateColumn }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('pick'); // pick | edit
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const options = optionSorted(column?.settings?.options);
  const selected = findOption(options, value);
  const isDropdownPlaceholder = column?.type === 'dropdown';

  const persist = (nextOptions) =>
    onUpdateColumn?.({ settings: { ...(column?.settings || {}), options: nextOptions } });

  useEffect(() => { if (!open) setMode('pick'); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    const compute = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const ph = popRef.current?.offsetHeight || 240;
      const up = window.innerHeight - r.bottom < ph + 8 && r.top > ph + 8;
      setPos({
        top: up ? Math.max(8, r.top - ph - 6) : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 240)),
      });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, mode, options.length]);

  // Ledger chip — soft tint + color dot + ink text, derived from any hue.
  const chip = (label, color, inCell = false) => {
    const pair = getColorPair(color || '#B7AE9C');
    return (
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          maxWidth: '100%', minHeight: inCell ? undefined : 26,
          padding: '3px 10px 3px 8px', fontSize: 12, fontWeight: 600,
          color: pair.text, background: pair.bg,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${pair.solid} 28%, transparent)`,
          borderRadius: 'var(--radius-full)',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: '50%', background: pair.solid, flexShrink: 0 }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </span>
    );
  };

  const footerBtn = (onClick, icon, text) => (
    <button
      type="button" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 6px', marginTop: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}
    >
      {icon}{text}
    </button>
  );

  return (
    <div ref={triggerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {selected ? (
        <div
          onClick={() => !readOnly && setOpen((v) => !v)}
          title={selected.label}
          style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%', minHeight: 36, padding: '0 8px', cursor: readOnly ? 'default' : 'pointer', overflow: 'hidden' }}
        >
          {chip(selected.label, selected.color, true)}
        </div>
      ) : (
        <div style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'pointer' }} onClick={() => !readOnly && setOpen((v) => !v)}>
          {!readOnly && <CellPlaceholder text={isDropdownPlaceholder ? 'Select' : 'Set status'} />}
        </div>
      )}

      {open && !readOnly && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 230, maxHeight: 320, overflowY: 'auto', zIndex: 200, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: 6 }}
        >
          {mode === 'pick' ? (
            <>
              {options.map((opt) => {
                const isCurrent = selected && String(selected.id) === String(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onChange?.(opt.id); setOpen(false); }}
                    className="hover:bg-[color:var(--color-bg-subtle)]"
                    style={{ display: 'flex', alignItems: 'center', width: '100%', margin: '2px 0', padding: '4px 6px', background: isCurrent ? 'var(--color-bg-subtle)' : 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    {chip(opt.label, opt.color)}
                  </button>
                );
              })}
              {options.length === 0 && <div style={{ padding: '8px 6px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>No labels yet — add one below.</div>}
              {value != null && value !== '' && (
                <button type="button" onClick={() => { onChange?.(null); setOpen(false); }} style={{ display: 'block', width: '100%', margin: '6px 0 2px', padding: '7px 10px', fontSize: 12.5, background: 'var(--color-bg-subtle)', border: '1px dashed var(--color-border-strong)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>Clear</button>
              )}
              {onUpdateColumn && footerBtn(() => setMode('edit'), <Settings2 size={14} />, 'Edit labels')}
            </>
          ) : (
            <>
              <LabelEditor options={options} onChange={persist} />
              {footerBtn(() => setMode('pick'), <ChevronLeft size={14} />, 'Done')}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default StatusCell;
