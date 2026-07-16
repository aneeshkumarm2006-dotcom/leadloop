import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Search, ChevronLeft,
  CircleDot, List, Type, Calendar, Users, Hash,
  Paperclip, CalendarRange, CheckSquare, Sigma, Boxes,
  AlignLeft, Link as LinkIcon, Mail, Phone, Star, Tags, MapPin, Copy,
} from 'lucide-react';
import useBoardStore from '../../store/boardStore';
import useToastStore from '../../store/toastStore';

/**
 * AddColumnButton — opens a type picker and creates a new column via the
 * boardStore. Categories mirror the grouping in the phase doc.
 *
 * Cross-board types (F2) carry extra configuration:
 *   - connect_boards → pick target board(s) + allow-multiple
 *   - mirror         → pick a source connect column + a source column +
 *                      aggregation (disabled until a connect column exists)
 *
 * Props:
 *   board   — current board doc (with `columns`); preferred
 *   boardId — fallback board id (back-compat)
 */

const MIRROR_AGGREGATIONS = ['first', 'concat', 'sum', 'min', 'max', 'count'];

// Monday-style column-type catalogue: each entry carries an icon + a coloured
// icon tile. `keywords` widens search matching (e.g. "people" finds Person).
const TYPE_META = {
  status: { label: 'Status', icon: CircleDot, bg: '#00C875', keywords: 'label state stage' },
  dropdown: { label: 'Dropdown', icon: List, bg: '#7E5EF2', keywords: 'select choice list' },
  text: { label: 'Text', icon: Type, bg: '#00A9FF', keywords: 'string note' },
  date: { label: 'Date', icon: Calendar, bg: '#7E5EF2', keywords: 'day calendar' },
  person: { label: 'People', icon: Users, bg: '#3C42E0', keywords: 'person owner assignee assigned' },
  number: { label: 'Numbers', icon: Hash, bg: '#FDAB3D', keywords: 'amount count value' },
  file: { label: 'Files', icon: Paperclip, bg: '#FF158A', keywords: 'attachment upload document' },
  timeline: { label: 'Timeline', icon: CalendarRange, bg: '#A25DDC', keywords: 'range duration gantt' },
  checkbox: { label: 'Checkbox', icon: CheckSquare, bg: '#00C875', keywords: 'tick done toggle' },
  formula: { label: 'Formula', icon: Sigma, bg: '#FF642E', keywords: 'calc compute read-only' },
  connect_boards: { label: 'Connect boards', icon: Boxes, bg: '#FF158A', keywords: 'link relation board' },
  long_text: { label: 'Long Text', icon: AlignLeft, bg: '#00A9FF', keywords: 'paragraph notes' },
  link: { label: 'Link', icon: LinkIcon, bg: '#00A9FF', keywords: 'url web' },
  email: { label: 'Email', icon: Mail, bg: '#00A9FF', keywords: 'mail address' },
  phone: { label: 'Phone', icon: Phone, bg: '#00A9FF', keywords: 'mobile call number' },
  rating: { label: 'Rating', icon: Star, bg: '#FDAB3D', keywords: 'stars score' },
  tags: { label: 'Tags', icon: Tags, bg: '#7E5EF2', keywords: 'labels multi keywords' },
  location: { label: 'Location', icon: MapPin, bg: '#00C875', keywords: 'place address map' },
  mirror: { label: 'Mirror column', icon: Copy, bg: '#A25DDC', keywords: 'reflect connect lookup' },
};

const GROUPS = [
  { key: 'essentials', label: 'Essentials', types: ['status', 'dropdown', 'text', 'date', 'person', 'number'] },
  { key: 'super', label: 'Super useful', types: ['file', 'timeline', 'checkbox', 'formula', 'connect_boards'] },
  { key: 'more', label: 'More columns', types: ['long_text', 'link', 'email', 'phone', 'rating', 'tags', 'location', 'mirror'] },
];

// Optional per-column accent colours offered when naming a new column.
const COLUMN_SWATCHES = [
  '#00C875', '#9D50DD', '#00A9FF', '#FDAB3D', '#FF642E',
  '#E8517B', '#A25DDC', '#037F4C', '#0073EA', '#FB275D', '#66CCFF',
];

const labelStyle = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  display: 'block',
};

const controlStyle = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 10,
  background: 'var(--color-bg-surface, #fff)',
  color: 'var(--color-text-primary)',
};

const AddColumnButton = ({ boardId, board }) => {
  const id = boardId || (board && board._id);
  const [open, setOpen] = useState(false);
  // 'picker' | 'naming' | 'connect-config' | 'mirror-config'
  const [step, setStep] = useState('picker');
  const [pickedType, setPickedType] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);
  const [busy, setBusy] = useState(false);

  // picker UX
  const [query, setQuery] = useState('');
  const [showMore, setShowMore] = useState(false);

  // connect_boards config
  const [connectable, setConnectable] = useState([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState([]);
  const [allowMultiple, setAllowMultiple] = useState(true);

  // mirror config
  const [sourceConnectColumnId, setSourceConnectColumnId] = useState('');
  const [sourceColumnId, setSourceColumnId] = useState('');
  const [aggregation, setAggregation] = useState('first');

  const ref = useRef(null);
  const panelRef = useRef(null);
  const nameRef = useRef(null);
  const [panelPos, setPanelPos] = useState(null);
  const addColumn = useBoardStore((s) => s.addColumn);
  const fetchConnectable = useBoardStore((s) => s.fetchConnectable);
  const toastError = useToastStore((s) => s.error);

  const connectColumns = (board && Array.isArray(board.columns) ? board.columns : []).filter(
    (c) => c.type === 'connect_boards'
  );
  const hasConnectColumn = connectColumns.length > 0;

  const resetAll = () => {
    setStep('picker');
    setPickedType(null);
    setName('');
    setColor(null);
    setQuery('');
    setShowMore(false);
    setSelectedTargetIds([]);
    setAllowMultiple(true);
    setSourceConnectColumnId('');
    setSourceColumnId('');
    setAggregation('first');
  };

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
      resetAll();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // Position the portaled panel against the button. Recompute on scroll/resize
  // so it tracks the trigger. The panel lives in document.body (a portal) so it
  // is never clipped by the board's horizontal scroll container or the group
  // card's overflow:hidden.
  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return undefined;
    }
    const PANEL_WIDTH = step === 'picker' ? 340 : 280;
    const place = () => {
      const btn = ref.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8));
      const top = r.bottom + 6;
      setPanelPos({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, step]);

  useEffect(() => {
    if (step === 'naming' && nameRef.current) nameRef.current.focus();
  }, [step]);

  const loadConnectable = async () => {
    if (!id) return;
    try {
      const list = await fetchConnectable(id);
      setConnectable(list || []);
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not load connectable boards');
    }
  };

  const startWithType = (typeId, defaultName) => {
    setPickedType(typeId);
    setName(defaultName);
    if (typeId === 'connect_boards') {
      setStep('connect-config');
      loadConnectable();
    } else if (typeId === 'mirror') {
      if (!hasConnectColumn) return; // disabled — guard
      setStep('mirror-config');
      loadConnectable();
    } else {
      setStep('naming');
    }
  };

  const close = () => {
    setOpen(false);
    resetAll();
  };

  // Source columns available to a mirror: the columns of the FIRST target
  // board of the selected connect column (the common single-target case).
  const sourceColumnOptions = (() => {
    if (!sourceConnectColumnId) return [];
    const connectCol = connectColumns.find((c) => c._id.toString() === sourceConnectColumnId);
    const targetIds = connectCol?.settings?.targetBoardIds || [];
    if (targetIds.length === 0) return [];
    const firstTarget = connectable.find(
      (entry) => entry.board._id.toString() === targetIds[0].toString()
    );
    const cols = firstTarget?.board?.columns || [];
    // Mirroring another mirror is allowed by the server (cycle-checked); only
    // hide the trivially useless connect columns from the picker.
    return cols.filter((c) => c.type !== 'connect_boards');
  })();

  const createSimple = async () => {
    if (!name.trim() || !pickedType) return;
    const payload = { name: name.trim(), type: pickedType };
    if (color) payload.color = color;
    if (pickedType === 'status' || pickedType === 'dropdown' || pickedType === 'tags') {
      payload.settings = { options: [] };
    } else if (pickedType === 'rating') {
      payload.settings = { max: 5 };
    }
    await submit(payload);
  };

  // Flat, search-filtered list of {id, ...meta} for the picker.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.keys(TYPE_META);
    if (!q) return null; // null → render grouped view
    return all.filter((tid) => {
      const m = TYPE_META[tid];
      return (
        m.label.toLowerCase().includes(q) ||
        tid.includes(q) ||
        (m.keywords || '').includes(q)
      );
    });
  }, [query]);

  const createConnect = async () => {
    if (!name.trim()) return;
    if (selectedTargetIds.length === 0) {
      toastError('Pick at least one board to connect to');
      return;
    }
    await submit({
      name: name.trim(),
      type: 'connect_boards',
      settings: { targetBoardIds: selectedTargetIds, allowMultiple },
    });
  };

  const createMirror = async () => {
    if (!name.trim()) return;
    if (!sourceConnectColumnId || !sourceColumnId) {
      toastError('Pick a connect column and a source column');
      return;
    }
    await submit({
      name: name.trim(),
      type: 'mirror',
      settings: { sourceConnectColumnId, sourceColumnId, aggregation },
    });
  };

  const submit = async (payload) => {
    setBusy(true);
    try {
      await addColumn(id, payload);
      close();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not create column');
    } finally {
      setBusy(false);
    }
  };

  const toggleTarget = (bid) => {
    setSelectedTargetIds((prev) =>
      prev.includes(bid) ? prev.filter((x) => x !== bid) : [...prev, bid]
    );
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add column"
        style={{
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: '50%',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Plus size={14} />
      </button>
      {open && panelPos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            zIndex: 1000,
            minWidth: step === 'picker' ? 340 : 280,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 8,
          }}
        >
          {step === 'picker' && (
            <div>
              {/* Search box */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 36,
                  padding: '0 10px',
                  marginBottom: 10,
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-surface, #fff)',
                }}
              >
                <Search size={15} color="var(--color-text-muted)" aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search or describe your column"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>

              {matches ? (
                matches.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    No column types match “{query}”
                  </div>
                ) : (
                  <TileGrid
                    ids={matches}
                    hasConnectColumn={hasConnectColumn}
                    onPick={(tid) => startWithType(tid, TYPE_META[tid].label)}
                  />
                )
              ) : (
                <>
                  {GROUPS.filter((g) => g.key !== 'more' || showMore).map((g) => (
                    <div key={g.key} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--color-text-muted)',
                          padding: '0 2px 6px',
                        }}
                      >
                        {g.label}
                      </div>
                      <TileGrid
                        ids={g.types}
                        hasConnectColumn={hasConnectColumn}
                        onPick={(tid) => startWithType(tid, TYPE_META[tid].label)}
                      />
                    </div>
                  ))}
                  {!showMore && (
                    <button
                      type="button"
                      onClick={() => setShowMore(true)}
                      style={{
                        width: '100%',
                        marginTop: 2,
                        padding: '8px 0',
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        background: 'transparent',
                        border: 'none',
                        borderTop: '1px solid var(--color-border)',
                        cursor: 'pointer',
                      }}
                    >
                      More columns
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'naming' && (
            <div style={{ padding: 6 }}>
              <button
                type="button"
                onClick={resetAll}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginBottom: 10,
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                }}
              >
                <ChevronLeft size={14} /> Back
              </button>
              <label style={labelStyle}>{TYPE_META[pickedType]?.label || pickedType} column name</label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createSimple();
                  if (e.key === 'Escape') resetAll();
                }}
                style={controlStyle}
              />
              <label style={labelStyle}>Column color (optional)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                <SwatchButton active={color === null} onClick={() => setColor(null)} title="No color">
                  <span style={{ width: 14, height: 2, background: 'var(--color-text-muted)', transform: 'rotate(-45deg)' }} />
                </SwatchButton>
                {COLUMN_SWATCHES.map((c) => (
                  <SwatchButton
                    key={c}
                    active={color === c}
                    onClick={() => setColor(c)}
                    title={c}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <ConfigFooter onBack={resetAll} onSubmit={createSimple} disabled={!name.trim() || busy} />
            </div>
          )}

          {step === 'connect-config' && (
            <div style={{ padding: 6 }}>
              <label style={labelStyle}>Column name</label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={controlStyle}
              />
              <label style={labelStyle}>Connect to board(s)</label>
              <div
                style={{
                  maxHeight: 140,
                  overflowY: 'auto',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 4,
                  marginBottom: 10,
                }}
              >
                {connectable.length === 0 ? (
                  <div style={{ padding: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    No other boards in this workspace
                  </div>
                ) : (
                  connectable.map((entry) => {
                    const bid = entry.board._id.toString();
                    const checked = selectedTargetIds.includes(bid);
                    return (
                      <label
                        key={bid}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 6px',
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleTarget(bid)} />
                        <span>{entry.board.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={allowMultiple}
                  onChange={(e) => setAllowMultiple(e.target.checked)}
                />
                Allow linking multiple rows
              </label>
              <ConfigFooter
                onBack={resetAll}
                onSubmit={createConnect}
                disabled={!name.trim() || selectedTargetIds.length === 0 || busy}
              />
            </div>
          )}

          {step === 'mirror-config' && (
            <div style={{ padding: 6 }}>
              <label style={labelStyle}>Column name</label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={controlStyle}
              />
              <label style={labelStyle}>From connect column</label>
              <select
                value={sourceConnectColumnId}
                onChange={(e) => {
                  setSourceConnectColumnId(e.target.value);
                  setSourceColumnId('');
                }}
                style={controlStyle}
              >
                <option value="">Select a connect column…</option>
                {connectColumns.map((c) => (
                  <option key={c._id} value={c._id.toString()}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label style={labelStyle}>Mirror which column</label>
              <select
                value={sourceColumnId}
                onChange={(e) => setSourceColumnId(e.target.value)}
                disabled={!sourceConnectColumnId}
                style={controlStyle}
              >
                <option value="">
                  {sourceConnectColumnId ? 'Select a source column…' : 'Pick a connect column first'}
                </option>
                {sourceColumnOptions.map((c) => (
                  <option key={c._id} value={c._id.toString()}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label style={labelStyle}>Aggregation</label>
              <select
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value)}
                style={controlStyle}
              >
                {MIRROR_AGGREGATIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <ConfigFooter
                onBack={resetAll}
                onSubmit={createMirror}
                disabled={!name.trim() || !sourceConnectColumnId || !sourceColumnId || busy}
              />
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

// A 2-column grid of Monday-style column-type tiles (coloured icon + label).
const TileGrid = ({ ids, onPick, hasConnectColumn }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
    {ids.map((tid) => {
      const m = TYPE_META[tid];
      if (!m) return null;
      const Icon = m.icon;
      const disabled = tid === 'mirror' && !hasConnectColumn;
      return (
        <button
          key={tid}
          type="button"
          disabled={disabled}
          title={disabled ? 'Add a “Connect boards” column first to mirror data from it' : m.label}
          onClick={() => onPick(tid)}
          className="hover:bg-[color:var(--color-bg-subtle)]"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            width: '100%',
            padding: '7px 8px',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            textAlign: 'left',
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              flexShrink: 0,
              borderRadius: 6,
              background: m.bg,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={14} color="#fff" aria-hidden="true" />
          </span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.label}
          </span>
        </button>
      );
    })}
  </div>
);

// Small round colour swatch used in the naming step's colour picker.
const SwatchButton = ({ active, onClick, title, style, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      width: 22,
      height: 22,
      borderRadius: '50%',
      border: active ? '2px solid var(--color-text-primary)' : '1px solid var(--color-border)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      ...style,
    }}
  >
    {children}
  </button>
);

const ConfigFooter = ({ onBack, onSubmit, disabled }) => (
  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
    <button
      type="button"
      onClick={onBack}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        background: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
      }}
    >
      Back
    </button>
    <button
      type="button"
      onClick={onSubmit}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        background: 'var(--color-accent)',
        color: '#fff',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      Add
    </button>
  </div>
);

export default AddColumnButton;
