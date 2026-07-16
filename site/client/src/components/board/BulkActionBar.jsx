import { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Trash2,
  FolderInput,
  X,
  ChevronDown,
  CircleDot,
  Flag,
} from 'lucide-react';

/**
 * BulkActionBar — floating bottom-center toolbar shown when one or more
 * tasks are ticked anywhere on the board. Exposes:
 *   - Status (popover with the board's status chips)
 *   - Priority (popover with critical/high/medium/low chips)
 *   - Move to group (popover with the board's groups)
 *   - Delete (parent owns the confirm modal)
 *   - Clear selection
 *
 * Selection state lives on BoardDetailPage so this bar can aggregate ticks
 * across every group's TaskTable. The bar itself is presentational — all
 * mutations are dispatched via the props.
 *
 * Props:
 *   count            — number of selected task IDs
 *   groups           — board groups (used to populate the move-to-group menu)
 *   statusOptions    — [{ id, label, bg, text }] from board.statuses, in display order
 *   priorityOptions  — [{ key, label, bg, text }] from PRIORITY_COLORS
 *   onChangeStatus   — (statusId) => void
 *   onChangePriority — (priorityKey) => void
 *   onMoveToGroup    — (groupId) => void
 *   onDelete         — () => void (parent shows confirmation)
 *   onClear          — () => void
 *   busy             — disables actions while a bulk operation is in flight
 */
const BulkActionBar = ({
  count = 0,
  groups = [],
  statusOptions = [],
  priorityOptions = [],
  onChangeStatus,
  onChangePriority,
  onMoveToGroup,
  onDelete,
  onClear,
  busy = false,
}) => {
  const { t } = useTranslation();
  // Only one popover open at a time. `openMenu` is one of: null, 'status',
  // 'priority', 'move'.
  const [openMenu, setOpenMenu] = useState(null);
  const statusBtnRef = useRef(null);
  const priorityBtnRef = useRef(null);
  const moveBtnRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!openMenu) return undefined;
    const anchors = {
      status: statusBtnRef,
      priority: priorityBtnRef,
      move: moveBtnRef,
    };
    const handleClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (anchors[openMenu]?.current?.contains(e.target)) return;
      setOpenMenu(null);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenu]);

  const toggleMenu = (key) =>
    setOpenMenu((prev) => (prev === key ? null : key));

  if (count <= 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={t('grid.bulkActionsLabel', { count })}
      className="fixed left-1/2 flex items-center font-body"
      style={{
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 70,
        background: 'var(--color-text-primary)',
        color: '#FFFFFF',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))',
        padding: '6px 6px 6px 16px',
        gap: 6,
        animation: 'macan-bulkbar-enter 180ms ease-out',
      }}
    >
      <span
        aria-live="polite"
        style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}
      >
        {t('grid.selectedCount', { count })}
      </span>

      <span
        aria-hidden="true"
        style={{
          width: 1,
          height: 22,
          background: 'rgba(255,255,255,0.18)',
          marginRight: 2,
        }}
      />

      {/* Status */}
      <div style={{ position: 'relative' }}>
        <BarButton
          ref={statusBtnRef}
          icon={CircleDot}
          label={t('grid.status')}
          trailing={ChevronDown}
          disabled={busy || statusOptions.length === 0}
          onClick={() => toggleMenu('status')}
          aria-haspopup="listbox"
          aria-expanded={openMenu === 'status'}
        />
        {openMenu === 'status' && (
          <ChipPopover
            ref={popoverRef}
            label={t('grid.setStatusForSelected')}
            items={statusOptions}
            getKey={(opt) => opt.id}
            onPick={(opt) => {
              setOpenMenu(null);
              onChangeStatus?.(opt.id);
            }}
            emptyMessage={t('grid.noStatusesConfigured')}
          />
        )}
      </div>

      {/* Priority */}
      <div style={{ position: 'relative' }}>
        <BarButton
          ref={priorityBtnRef}
          icon={Flag}
          label={t('grid.priority')}
          trailing={ChevronDown}
          disabled={busy || priorityOptions.length === 0}
          onClick={() => toggleMenu('priority')}
          aria-haspopup="listbox"
          aria-expanded={openMenu === 'priority'}
        />
        {openMenu === 'priority' && (
          <ChipPopover
            ref={popoverRef}
            label={t('grid.setPriorityForSelected')}
            items={priorityOptions}
            getKey={(opt) => opt.key}
            onPick={(opt) => {
              setOpenMenu(null);
              onChangePriority?.(opt.key);
            }}
            emptyMessage={t('grid.noPrioritiesAvailable')}
          />
        )}
      </div>

      {/* Move to group */}
      <div style={{ position: 'relative' }}>
        <BarButton
          ref={moveBtnRef}
          icon={FolderInput}
          label={t('grid.moveTo')}
          trailing={ChevronDown}
          disabled={busy || groups.length === 0}
          onClick={() => toggleMenu('move')}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'move'}
        />
        {openMenu === 'move' && (
          <div
            ref={popoverRef}
            role="menu"
            aria-label={t('grid.moveSelectedToGroup')}
            className="bg-white"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              minWidth: 200,
              maxHeight: 280,
              overflowY: 'auto',
              padding: 4,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              color: 'var(--color-text-primary)',
              animation: 'macan-bulkbar-popover-enter 140ms ease-out',
            }}
          >
            {groups.length === 0 ? (
              <p
                style={{
                  padding: '8px 10px',
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                }}
              >
                {t('grid.noOtherGroups')}
              </p>
            ) : (
              groups.map((g) => (
                <button
                  key={g._id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onMoveToGroup?.(g._id);
                  }}
                  className="w-full text-left transition-colors duration-100 hover:bg-[color:var(--color-bg-subtle)] focus:outline-none focus:bg-[color:var(--color-bg-subtle)]"
                  style={{
                    padding: '8px 10px',
                    fontSize: 13,
                    fontWeight: 500,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {g.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <BarButton
        icon={Trash2}
        label={t('grid.delete')}
        disabled={busy}
        onClick={onDelete}
        danger
      />

      <span
        aria-hidden="true"
        style={{
          width: 1,
          height: 22,
          background: 'rgba(255,255,255,0.18)',
          marginLeft: 2,
        }}
      />

      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        aria-label={t('grid.clearSelection')}
        title={t('grid.clearSelection')}
        className="flex items-center justify-center transition-colors duration-150 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          width: 32,
          height: 32,
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          color: '#FFFFFF',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>

      <style>{`
        @keyframes macan-bulkbar-enter {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes macan-bulkbar-popover-enter {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

/**
 * ChipPopover — shared chip picker used by the Status and Priority buttons.
 * Renders each option as a chip styled with its own bg/text colors so the
 * popover looks identical to the per-row StatusMenu / PriorityMenu.
 */
const ChipPopover = forwardRef(function ChipPopover(
  { label, items, getKey, onPick, emptyMessage },
  ref
) {
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className="bg-white"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        minWidth: 180,
        maxHeight: 280,
        overflowY: 'auto',
        padding: 6,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        color: 'var(--color-text-primary)',
        animation: 'macan-bulkbar-popover-enter 140ms ease-out',
      }}
    >
      {items.length === 0 ? (
        <p
          style={{
            padding: '8px 10px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
          }}
        >
          {emptyMessage}
        </p>
      ) : (
        items.map((opt) => (
          <button
            key={getKey(opt)}
            type="button"
            role="option"
            onClick={() => onPick(opt)}
            className="w-full flex items-center text-left font-body font-medium transition-opacity duration-150 hover:opacity-90 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
            style={{
              margin: '2px 0',
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 'var(--radius-full)',
              backgroundColor: opt.bg,
              color: opt.text,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))
      )}
    </div>
  );
});

/**
 * Pill-style button used inside the dark bar. forwardRef so the Move-to
 * button can be used as a popover anchor.
 */
const BarButton = forwardRef(function BarButton(
  {
    icon: Icon,
    trailing: Trailing,
    label,
    onClick,
    disabled = false,
    danger = false,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 transition-colors duration-150 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        height: 32,
        padding: '0 12px',
        fontSize: 13,
        fontWeight: 600,
        background: 'transparent',
        color: danger ? '#FCA5A5' : '#FFFFFF',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        lineHeight: 1,
      }}
      {...rest}
    >
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span>{label}</span>
      {Trailing && <Trailing size={12} aria-hidden="true" />}
    </button>
  );
});

export default BulkActionBar;
