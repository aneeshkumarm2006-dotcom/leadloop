import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';

/**
 * labelShared — Monday-style label management shared by Status & Dropdown
 * cells: a color palette, a stable id generator, and an inline LabelEditor
 * (create / rename / recolor / delete) that the cell persists to the column's
 * `settings.options` via `onUpdateColumn`.
 */

export const LABEL_PALETTE = [
  '#16A34A', '#22C55E', '#65A30D', '#CA8A04', '#D97706', '#EA580C',
  '#DC2626', '#E11D48', '#DB2777', '#C026D3', '#9333EA', '#7C3AED',
  '#6366F1', '#2563EB', '#0EA5E9', '#0891B2', '#0D9488', '#059669',
  '#475569', '#64748B', '#78716C', '#1F2937',
];

export const newOptionId = () => 'o' + Math.random().toString(36).slice(2, 9);
export const paletteAt = (i) => LABEL_PALETTE[i % LABEL_PALETTE.length];

/** Normalise a status/dropdown cell value to a string-id array (back-compat). */
export const toIdArray = (value) =>
  (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).map(String);

function ColorGrid({ value, onPick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, padding: 8, width: 196 }}>
      {LABEL_PALETTE.map((c) => (
        <button
          key={c} type="button" onClick={() => onPick(c)}
          style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: value === c ? '2px solid var(--color-text-primary)' : '2px solid var(--color-bg-elevated)' }}
        />
      ))}
    </div>
  );
}

function LabelRow({ option, onRename, onRecolor, onDelete }) {
  const [text, setText] = useState(option.label || '');
  const [colorOpen, setColorOpen] = useState(false);
  useEffect(() => { setText(option.label || ''); }, [option.label]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
      <button
        type="button" onClick={() => setColorOpen((o) => !o)} title="Color"
        style={{ width: 22, height: 22, borderRadius: '50%', background: option.color || 'var(--color-border-strong)', border: 'none', cursor: 'pointer', flexShrink: 0 }}
      />
      <input
        value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { const v = text.trim(); if (v && v !== option.label) onRename(v); else if (!v) setText(option.label || ''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ flex: 1, height: 30, padding: '0 8px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', outline: 'none' }}
      />
      <button type="button" onClick={onDelete} title="Delete" style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}>
        <Trash2 size={14} />
      </button>
      {colorOpen && (
        <>
          <div onClick={() => setColorOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
          <div style={{ position: 'absolute', top: 26, left: 0, zIndex: 10, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)' }}>
            <ColorGrid value={option.color} onPick={(c) => { onRecolor(c); setColorOpen(false); }} />
          </div>
        </>
      )}
    </div>
  );
}

/** Inline label manager. `options` is the column's options; `onChange(next)`
 * receives the full new options array (the caller persists it). */
export function LabelEditor({ options, onChange }) {
  const rename = (id, label) => onChange(options.map((o) => (o.id === id ? { ...o, label } : o)));
  const recolor = (id, color) => onChange(options.map((o) => (o.id === id ? { ...o, color } : o)));
  const remove = (id) => onChange(options.filter((o) => o.id !== id));
  const add = () => {
    const order = options.reduce((m, o) => Math.max(m, o.order || 0), 0) + 1;
    onChange([...options, { id: newOptionId(), label: 'New label', color: paletteAt(options.length), order }]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '6px 4px' }}>
      {options.map((o) => (
        <LabelRow key={o.id} option={o} onRename={(l) => rename(o.id, l)} onRecolor={(c) => recolor(o.id, c)} onDelete={() => remove(o.id)} />
      ))}
      <button type="button" onClick={add} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 8px', fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}>
        <Plus size={15} /> Add label
      </button>
    </div>
  );
}
