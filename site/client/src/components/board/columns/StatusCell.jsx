import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, ChevronLeft } from 'lucide-react';
import { cellWrapperStyle, optionSorted, findOption } from './cellShared';
import { LabelEditor } from './labelShared';
import CellPlaceholder from './CellPlaceholder';

/**
 * StatusCell — Monday-style single-select colored status. The selected label
 * fills the cell full-bleed. Clicking opens a popover of colored label buttons;
 * an "Edit labels" footer flips to an inline editor that creates / renames /
 * recolors / deletes labels and persists them to the column settings via
 * `onUpdateColumn`.
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

  const solidBar = (label, color, full = false) => (
    <span
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: full ? '100%' : undefined, minHeight: full ? 36 : 32,
        padding: full ? '0 8px' : '0 10px', fontSize: full ? 13 : 12.5, fontWeight: 500,
        color: '#fff', background: color || 'var(--color-border-strong)',
        borderRadius: full ? 0 : 'var(--radius-sm)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {label}
    </span>
  );

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
        <div onClick={() => !readOnly && setOpen((v) => !v)} title={selected.label} style={{ width: '100%', height: '100%', cursor: readOnly ? 'default' : 'pointer' }}>
          {solidBar(selected.label, selected.color, true)}
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
              {options.map((opt) => (
                <button key={opt.id} type="button" onClick={() => { onChange?.(opt.id); setOpen(false); }} style={{ display: 'block', width: '100%', margin: '4px 0', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  {solidBar(opt.label, opt.color)}
                </button>
              ))}
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
