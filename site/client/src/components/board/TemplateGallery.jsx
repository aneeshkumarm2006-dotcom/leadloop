import { useEffect, useState } from 'react';
import {
  LayoutGrid, Building2, Home, Users, Plus, ArrowRight, Layers, Columns3, FileText,
  Tag, HeartHandshake, DoorOpen, Wrench, TrendingUp, Briefcase,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { getBoardTemplates } from '../../services/boardService';

/**
 * TemplateGallery — the "Start from a template" picker shown when creating a
 * board. Real-estate teams pick a ready pipeline (stages + lead columns + a
 * public intake form, all seeded server-side) instead of a blank board.
 *
 * Props:
 *   isOpen
 *   onClose
 *   onPick(template | null)  — a template object, or null for "Blank board"
 *   busy                      — disables cards while a board is being created
 */

// Each template gets its own icon + accent so nine cards stay scannable
// instead of turning into a wall of identical tiles.
const ICONS = {
  real_estate_crm:     { Icon: LayoutGrid,     tint: 'var(--color-accent)' },
  real_estate_leads:   { Icon: Users,          tint: '#96578A' },
  seller_listings:     { Icon: Tag,            tint: '#C4632B' },
  listings_inventory:  { Icon: Building2,      tint: '#3E8FA0' },
  past_clients:        { Icon: HeartHandshake, tint: '#A63D57' },
  open_house:          { Icon: DoorOpen,       tint: '#C79A3E' },
  property_management: { Icon: Wrench,         tint: '#3E6B8F' },
  investor_deals:      { Icon: TrendingUp,     tint: '#4E9068' },
  commercial_leasing:  { Icon: Briefcase,      tint: '#8A8273' },
};
const iconFor = (tpl) => ICONS[tpl.id] || { Icon: Home, tint: 'var(--color-accent)' };

const TemplateGallery = ({ isOpen, onClose, onPick, busy = false }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    getBoardTemplates()
      .then((t) => { if (!cancelled) setTemplates(t); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const card = {
    textAlign: 'left',
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--color-bg-surface, #fff)',
    padding: 16,
    cursor: busy ? 'default' : 'pointer',
    transition: 'border-color .15s, box-shadow .15s, transform .15s',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minHeight: 148,
    opacity: busy ? 0.6 : 1,
  };
  const hover = (e, on) => {
    if (busy) return;
    e.currentTarget.style.borderColor = on ? 'var(--color-accent)' : 'var(--color-border)';
    e.currentTarget.style.boxShadow = on ? 'var(--shadow-md)' : 'none';
    e.currentTarget.style.transform = on ? 'translateY(-2px)' : 'none';
  };
  const meta = { fontSize: 11.5, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start a new board" maxWidth={860}>
      <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: -6, marginBottom: 16 }}>
        Pick a ready-made real-estate template — the stages, columns and (where it makes sense) a public intake form are set up for you — or start from a blank board.
      </p>

      {loading ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '16px 2px' }}>Loading templates…</p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
          {error && (
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)', gridColumn: '1 / -1' }}>
              Couldn’t load templates — you can still start a blank board.
            </p>
          )}

          {templates.map((tpl, i) => {
            const { Icon, tint } = iconFor(tpl);
            const stages = Array.isArray(tpl.groups) ? tpl.groups.length : 0;
            const cols = Array.isArray(tpl.columns) ? tpl.columns.length : 0;
            return (
              <button
                type="button"
                key={tpl.id}
                disabled={busy}
                onClick={() => onPick(tpl)}
                style={card}
                onMouseEnter={(e) => hover(e, true)}
                onMouseLeave={(e) => hover(e, false)}
              >
                <div className="flex items-center justify-between">
                  <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--color-accent-light, #EEF3EA)', color: tint, display: 'grid', placeItems: 'center' }}>
                    <Icon size={19} />
                  </span>
                  {i === 0 && (
                    <span className="font-body" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--color-accent)', background: 'var(--color-accent-light, #EEF3EA)', padding: '3px 8px', borderRadius: 999 }}>
                      Recommended
                    </span>
                  )}
                </div>
                <div className="font-display" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 10 }}>{tpl.name}</div>
                <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.4, flex: 1 }}>{tpl.description}</div>
                <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
                  {stages > 0 && <span style={meta}><Layers size={12} />{stages} stages</span>}
                  <span style={meta}><Columns3 size={12} />{cols} columns</span>
                  {tpl.hasForm && <span style={meta}><FileText size={12} />intake form</span>}
                </div>
              </button>
            );
          })}

          {/* Blank board */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(null)}
            style={{ ...card, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}
            onMouseEnter={(e) => hover(e, true)}
            onMouseLeave={(e) => hover(e, false)}
          >
            <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center' }}>
              <Plus size={19} />
            </span>
            <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 8 }}>Blank board</div>
            <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Start from scratch</div>
            <span className="font-body inline-flex items-center gap-1" style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 600, marginTop: 6 }}>
              Set up manually <ArrowRight size={13} />
            </span>
          </button>
        </div>
      )}
    </Modal>
  );
};

export default TemplateGallery;
