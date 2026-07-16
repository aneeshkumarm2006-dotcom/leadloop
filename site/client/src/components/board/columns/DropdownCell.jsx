import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check, Plus, Settings2, ChevronLeft } from 'lucide-react';
import { cellWrapperStyle, optionSorted } from './cellShared';
import { LabelEditor, toIdArray, newOptionId, paletteAt } from './labelShared';
import CellPlaceholder from './CellPlaceholder';

/**
 * DropdownCell — Monday-style MULTI-select. The cell shows the selected labels
 * as chips; clicking opens a searchable popover where you toggle multiple
 * labels, create a new one on the fly ("Create 'x'"), or flip to an inline
 * label editor. Value is an option-id array (tolerates a legacy single id).
 */
const DropdownCell = ({ value, column, readOnly, onChange, onUpdateColumn }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('pick');
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const options = optionSorted(column?.settings?.options);
  const ids = toIdArray(value);
  const selectedOptions = ids.map((id) => options.find((o) => String(o.id) === id)).filter(Boolean);

  const persist = (nextOptions) =>
    onUpdateColumn?.({ settings: { ...(column?.settings || {}), options: nextOptions } });

  useEffect(() => { if (!open) { setMode('pick'); setQuery(''); } }, [open]);

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
      const ph = popRef.current?.offsetHeight || 260;
      const up = window.innerHeight - r.bottom < ph + 8 && r.top > ph + 8;
      setPos({ top: up ? Math.max(8, r.top - ph - 6) : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 250)) });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => { window.removeEventListener('resize', compute); window.removeEventListener('scroll', compute, true); };
  }, [open, mode, query, options.length]);

  const chip = (opt, key) => (
    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap', background: opt.color ? `color-mix(in srgb, ${opt.color} 16%, transparent)` : 'var(--color-bg-subtle)', color: opt.color || 'var(--color-text-secondary)' }}>{opt.label}</span>
  );

  const toggle = (id) => onChange?.(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const createLabel = async (label) => {
    const id = newOptionId();
    const order = options.reduce((m, o) => Math.max(m, o.order || 0), 0) + 1;
    await persist([...options, { id, label, color: paletteAt(options.length), order }]);
    onChange?.([...ids, id]);
    setQuery('');
  };

  const q = query.trim();
  const filtered = options.filter((o) => (o.label || '').toLowerCase().includes(q.toLowerCase()));
  const canCreate = !!onUpdateColumn && !!q && !options.some((o) => (o.label || '').toLowerCase() === q.toLowerCase());

  return (
    <div ref={triggerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {selectedOptions.length > 0 ? (
        <div onClick={() => !readOnly && setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap', overflow: 'hidden', width: '100%', height: '100%', padding: '0 8px', cursor: readOnly ? 'default' : 'pointer' }}>
          {selectedOptions.slice(0, 3).map((o, i) => chip(o, i))}
          {selectedOptions.length > 3 && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>+{selectedOptions.length - 3}</span>}
        </div>
      ) : (
        <div style={{ ...cellWrapperStyle, cursor: readOnly ? 'default' : 'pointer' }} onClick={() => !readOnly && setOpen((v) => !v)}>
          {!readOnly && <CellPlaceholder text="Select" />}
        </div>
      )}

      {open && !readOnly && createPortal(
        <div ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: 240, maxHeight: 340, overflowY: 'auto', zIndex: 200, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: 6 }}>
          {mode === 'pick' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px 8px' }}>
                <Search size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                <input
                  autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) createLabel(q); }}
                  placeholder="Search or create a label"
                  style={{ flex: 1, height: 28, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text-primary)' }}
                />
              </div>
              {canCreate && (
                <button type="button" onClick={() => createLabel(q)} style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px', fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <Plus size={15} /> Create “{q}”
                </button>
              )}
              {filtered.map((opt) => {
                const on = ids.includes(String(opt.id));
                return (
                  <button key={opt.id} type="button" onClick={() => toggle(String(opt.id))} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 8px', background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center', border: on ? 'none' : '1.5px solid var(--color-border-strong)', background: on ? (opt.color || 'var(--color-accent)') : 'transparent' }}>
                      {on && <Check size={12} color="#fff" />}
                    </span>
                    {chip(opt, opt.id)}
                  </button>
                );
              })}
              {filtered.length === 0 && !canCreate && <div style={{ padding: '8px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>No labels yet.</div>}
              {onUpdateColumn && (
                <button type="button" onClick={() => setMode('edit')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 6px', marginTop: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}>
                  <Settings2 size={14} /> Edit labels
                </button>
              )}
            </>
          ) : (
            <>
              <LabelEditor options={options} onChange={persist} />
              <button type="button" onClick={() => setMode('pick')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 6px', marginTop: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}>
                <ChevronLeft size={14} /> Done
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default DropdownCell;
