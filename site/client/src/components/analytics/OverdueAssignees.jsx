import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, User as UserIcon, UserX } from 'lucide-react';

const Avatar = ({ user, size = 28 }) => {
  const [imgError, setImgError] = useState(false);
  const handleError = useCallback(() => setImgError(true), []);

  if (user?.profilePic && !imgError) {
    return (
      <img
        src={user.profilePic}
        alt={user.name || 'Avatar'}
        className="object-cover"
        style={{ width: size, height: size, borderRadius: 9999 }}
        onError={handleError}
      />
    );
  }
  const Icon = user?.unassigned ? UserX : UserIcon;
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: 'var(--color-bg-subtle)',
        border: user?.unassigned
          ? '1px dashed var(--color-border)'
          : '1px solid var(--color-border)',
      }}
      aria-hidden="true"
    >
      <Icon
        size={Math.round(size * 0.55)}
        color="var(--color-text-muted)"
        strokeWidth={2}
      />
    </div>
  );
};

const OverdueAssignees = ({ assignees = [] }) => {
  const [mounted, setMounted] = useState(false);

  const maxCount = useMemo(
    () => Math.max(1, ...assignees.map((a) => a.count || 0)),
    [assignees]
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section
      className="bg-surface"
      style={{
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: 24,
      }}
    >
      <div className="flex items-center gap-2">
        <Users
          size={16}
          color="var(--color-accent)"
          strokeWidth={2}
          aria-hidden="true"
        />
        <h3
          className="font-display font-semibold"
          style={{ fontSize: 15, color: 'var(--color-text-primary)' }}
        >
          Top Overdue Assignees
        </h3>
      </div>

      <div className="mt-4 flex flex-col" style={{ gap: 14 }}>
        {assignees.length === 0 ? (
          <p
            className="font-body"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              padding: '8px 0',
            }}
          >
            No overdue tasks assigned.
          </p>
        ) : (
          assignees.map((user, i) => {
            const pct = Math.round((user.count / maxCount) * 100);
            return (
              <div
                key={user._id}
                className="flex items-center"
                style={{ gap: 12 }}
              >
                <Avatar user={user} size={28} />
                <span
                  className="font-body truncate"
                  style={{
                    fontSize: 13,
                    color: user.unassigned
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-primary)',
                    fontStyle: user.unassigned ? 'italic' : 'normal',
                    width: 128,
                    flexShrink: 0,
                  }}
                  title={user.name}
                >
                  {user.name}
                </span>
                <div
                  className="flex-1"
                  style={{
                    position: 'relative',
                    height: 8,
                    background: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                  }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={maxCount}
                  aria-valuenow={user.count}
                  aria-label={`${user.name}: ${user.count} overdue`}
                >
                  <div
                    style={{
                      height: '100%',
                      width: mounted ? `${pct}%` : '0%',
                      background: 'var(--color-priority-critical)',
                      borderRadius: 'var(--radius-full)',
                      transition: `width 500ms ease-out ${i * 50}ms`,
                    }}
                  />
                </div>
                <span
                  className="font-body font-semibold"
                  style={{
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                    width: 32,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {user.count}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default OverdueAssignees;
