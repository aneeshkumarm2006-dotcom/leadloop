import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, User, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cellWrapperStyle } from './cellShared';
import useOrgStore from '../../../store/orgStore';

/**
 * PersonCell — Monday-style people picker over the org's members. The cell
 * shows stacked avatars (profile pics or initials) or an empty grey avatar; the
 * picker has a search box, a "Suggested people" list with name + secondary line,
 * and a checkmark on the selected.
 */
const initials = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

const Avatar = ({ member, size = 22, ring = true }) =>
  member?.profilePic ? (
    <img
      src={member.profilePic}
      alt=""
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        border: ring ? '1.5px solid var(--color-bg-elevated)' : undefined,
      }}
    />
  ) : (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--color-accent)',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.45),
        fontWeight: 600,
        border: ring ? '1.5px solid var(--color-bg-elevated)' : undefined,
      }}
    >
      {initials(member?.name)}
    </span>
  );

const PersonCell = ({ value, readOnly, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const members = useOrgStore((s) => s.members || []);
  const selected = Array.isArray(value) ? value.map((v) => (v && v._id ? v._id : v).toString()) : [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q)
    );
  }, [members, query]);

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
      const ph = popRef.current?.offsetHeight || 320;
      const up = window.innerHeight - r.bottom < ph + 8 && r.top > ph + 8;
      setPos({
        top: up ? Math.max(8, r.top - ph - 6) : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 280)),
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

  const toggle = (id) => {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange?.(Array.from(set));
  };

  const memberById = (id) => members.find((m) => (m._id || m.id || '').toString() === id);

  return (
    <div ref={triggerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        style={{ ...cellWrapperStyle, gap: 4, cursor: readOnly ? 'default' : 'pointer' }}
        onClick={() => !readOnly && setOpen((v) => !v)}
      >
        {selected.length === 0 ? (
          // Monday-style empty avatar placeholder.
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'var(--color-bg-subtle)',
              border: '1.5px dashed var(--color-border-strong)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label={t('grid.unassigned')}
          >
            <User size={14} color="var(--color-text-muted)" aria-hidden="true" />
          </span>
        ) : (
          selected.slice(0, 4).map((id) => (
            <span key={id} title={memberById(id)?.name || id} style={{ marginRight: -6 }}>
              <Avatar member={memberById(id)} />
            </span>
          ))
        )}
        {selected.length > 4 && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
            +{selected.length - 4}
          </span>
        )}
      </div>

      {open && !readOnly && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 264,
            zIndex: 200,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
          }}
        >
          {/* Search */}
          <div style={{ padding: 10, borderBottom: '1px solid var(--color-border)' }}>
            <div
              className="flex items-center gap-2"
              style={{ height: 32, padding: '0 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-surface, #fff)' }}
            >
              <Search size={14} color="var(--color-text-muted)" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('grid.searchPeople')}
                className="font-body focus:outline-none"
                style={{ border: 'none', background: 'transparent', fontSize: 13, flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}
              />
            </div>
          </div>

          <div style={{ maxHeight: 280, overflowY: 'auto', padding: 6 }}>
            <p className="px-2 pt-1 pb-1 font-body" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
              {t('grid.suggestedPeople')}
            </p>
            {filtered.length === 0 ? (
              <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>{t('grid.noMembers')}</div>
            ) : (
              filtered.map((m) => {
                const id = (m._id || m.id || '').toString();
                const checked = selected.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggle(id)}
                    className="hover:bg-[color:var(--color-bg-subtle)]"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '7px 8px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'left',
                    }}
                  >
                    <Avatar member={m} size={28} ring={false} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="block truncate" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{m.name || m.email}</span>
                      {m.email && (
                        <span className="block truncate" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{m.email}</span>
                      )}
                    </span>
                    {checked && <Check size={15} color="var(--color-accent)" aria-hidden="true" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PersonCell;
