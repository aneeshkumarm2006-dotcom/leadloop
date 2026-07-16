import { CalendarDays, Plus, Pencil, Trash2, Users, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * CalendarViewSidebar — lists saved calendar views (own + shared) plus a
 * built-in "All tasks" default. Highlights the active view and exposes
 * rename/delete affordances (F12.5).
 *
 * Props:
 *   views          — [{ _id, name, isShared, userId, boardId, ... }]
 *   activeViewId   — the selected view id, or null for the default calendar
 *   currentUserId  — to decide which shared views show owner actions
 *   isAdmin        — workspace admin (can edit/delete shared views)
 *   onSelect(id)   — id is null for the default calendar
 *   onNew()        — open the create form
 *   onEdit(view)   — open the edit form
 *   onDelete(view) — delete the view
 */
const CalendarViewSidebar = ({
  views = [],
  activeViewId = null,
  currentUserId = null,
  isAdmin = false,
  onSelect,
  onNew,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();
  const canManage = (view) =>
    String(view.userId) === String(currentUserId) || (view.isShared && isAdmin);

  return (
    <aside
      className="shrink-0"
      style={{
        width: 232,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        alignSelf: 'flex-start',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span
          className="font-body font-semibold"
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('pages.views')}
        </span>
        <button
          type="button"
          onClick={onNew}
          aria-label={t('pages.newCalendarView')}
          className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{ width: 26, height: 26 }}
        >
          <Plus size={15} color="var(--color-text-secondary)" aria-hidden="true" />
        </button>
      </div>

      <div className="py-1.5">
        {/* Built-in default — all tasks across the workspace by due date. */}
        <ViewRow
          icon={CalendarDays}
          label={t('pages.allLeads')}
          active={!activeViewId}
          onClick={() => onSelect?.(null)}
        />

        {views.map((view) => (
          <ViewRow
            key={view._id}
            icon={view.boardId ? CalendarDays : Globe}
            label={view.name}
            badge={view.isShared ? t('pages.shared') : null}
            active={String(activeViewId) === String(view._id)}
            onClick={() => onSelect?.(view._id)}
            actions={
              canManage(view) ? (
                <>
                  <RowAction
                    icon={Pencil}
                    label={t('pages.editNamed', { name: view.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit?.(view);
                    }}
                  />
                  <RowAction
                    icon={Trash2}
                    label={t('pages.deleteNamed', { name: view.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(view);
                    }}
                  />
                </>
              ) : null
            }
          />
        ))}

        {views.length === 0 && (
          <p
            className="font-body"
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              padding: '8px 14px',
            }}
          >
            {t('pages.noSavedViews')}
          </p>
        )}
      </div>

      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--color-border)' }}>
        <button
          type="button"
          onClick={onNew}
          className="w-full flex items-center justify-center gap-1.5 font-body font-medium transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          style={{
            fontSize: 13,
            color: 'var(--color-accent)',
            height: 34,
            border: '1px dashed var(--color-border-strong)',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {t('pages.newView')}
        </button>
      </div>
    </aside>
  );
};

const ViewRow = ({ icon: Icon, label, badge, active, onClick, actions }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.();
      }
    }}
    className="group w-full flex items-center gap-2.5 text-left transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)] focus:outline-none focus-visible:bg-[color:var(--color-bg-subtle)]"
    style={{
      padding: '8px 14px',
      cursor: 'pointer',
      background: active ? 'var(--color-accent-light)' : 'transparent',
      borderLeft: active
        ? '2px solid var(--color-accent)'
        : '2px solid transparent',
    }}
  >
    {Icon && (
      <Icon
        size={15}
        aria-hidden="true"
        color={active ? 'var(--color-accent)' : 'var(--color-text-secondary)'}
        style={{ flexShrink: 0 }}
      />
    )}
    <span
      className="flex-1 font-body truncate"
      style={{
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--color-accent-text)' : 'var(--color-text-primary)',
      }}
    >
      {label}
    </span>
    {badge && (
      <span
        className="inline-flex items-center gap-1 font-body"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-secondary)',
          background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-full)',
          padding: '1px 6px',
          flexShrink: 0,
        }}
      >
        <Users size={9} aria-hidden="true" />
        {badge}
      </span>
    )}
    {actions && (
      <span className="items-center gap-0.5 hidden group-hover:flex" style={{ flexShrink: 0 }}>
        {actions}
      </span>
    )}
  </div>
);

const RowAction = ({ icon: Icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="flex items-center justify-center rounded transition-colors duration-150 hover:bg-[color:var(--color-bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-accent)]"
    style={{ width: 22, height: 22 }}
  >
    {Icon && <Icon size={13} color="var(--color-text-secondary)" aria-hidden="true" />}
  </button>
);

export default CalendarViewSidebar;
