/**
 * Skeleton — reusable shimmer placeholder primitives.
 *
 * Base blocks use the `.skeleton` class from globals.css which applies the
 * shimmer gradient animation. Each variant mirrors a real UI element's
 * dimensions so the loading state looks like a ghosted version of the
 * actual content.
 */
import { useTranslation } from 'react-i18next';

/* ------------------------------------------------------------------ */
/*  PRIMITIVES                                                         */
/* ------------------------------------------------------------------ */

/** Rectangular skeleton block */
export const SkeletonBlock = ({
  width,
  height = 14,
  borderRadius,
  style,
  className = '',
}) => (
  <div
    className={`skeleton ${className}`}
    aria-hidden="true"
    style={{
      width: width ?? '100%',
      height,
      borderRadius: borderRadius ?? 'var(--radius-sm)',
      flexShrink: 0,
      ...style,
    }}
  />
);

/** Circular skeleton (avatars, dots) */
export const SkeletonCircle = ({ size = 32, style, className = '' }) => (
  <div
    className={`skeleton ${className}`}
    aria-hidden="true"
    style={{
      width: size,
      height: size,
      borderRadius: '9999px',
      flexShrink: 0,
      ...style,
    }}
  />
);

/** Full-width text line */
export const SkeletonText = ({ width = '100%', height = 12, style }) => (
  <SkeletonBlock width={width} height={height} style={style} />
);

/* ------------------------------------------------------------------ */
/*  STAT CARD SKELETON                                                 */
/* ------------------------------------------------------------------ */

const STAT_CARD_ACCENTS = [
  'var(--color-card-blue)',
  'var(--color-card-green)',
  'var(--color-card-orange)',
  'var(--color-card-purple)',
];

export const SkeletonStatCard = ({ index = 0 }) => (
  <div
    className="surface-card"
    style={{
      padding: '18px 20px',
      minHeight: 116,
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    {/* Accent stripe — mirrors the real card's left edge */}
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        opacity: 0.5,
        background: STAT_CARD_ACCENTS[index % STAT_CARD_ACCENTS.length],
      }}
    />
    <div className="flex items-start justify-between">
      <div>
        <SkeletonBlock width={72} height={10} style={{ opacity: 0.5 }} />
        <SkeletonBlock
          width={64}
          height={28}
          style={{ marginTop: 12, borderRadius: 'var(--radius-sm)' }}
        />
      </div>
      <SkeletonBlock width={40} height={40} borderRadius="var(--radius-md)" />
    </div>
    <SkeletonBlock width={88} height={10} style={{ marginTop: 16, opacity: 0.4 }} />
  </div>
);

/* ------------------------------------------------------------------ */
/*  BOARD CARD SKELETON (Grid)                                         */
/* ------------------------------------------------------------------ */

const BOARD_ACCENT_CYCLE = [
  'var(--color-card-blue)',
  'var(--color-card-green)',
  'var(--color-card-orange)',
  'var(--color-card-purple)',
];

export const SkeletonBoardCard = ({ index = 0 }) => (
  <div
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
    }}
  >
    {/* Top accent bar */}
    <div
      aria-hidden="true"
      style={{
        height: 4,
        background: BOARD_ACCENT_CYCLE[index % BOARD_ACCENT_CYCLE.length],
        opacity: 0.35,
      }}
    />
    <div style={{ padding: '20px 20px 16px' }}>
      {/* Icon + title */}
      <div className="flex items-center gap-3">
        <SkeletonCircle size={32} />
        <SkeletonBlock width="55%" height={14} />
      </div>
      {/* Description */}
      <SkeletonText width="80%" height={10} style={{ marginTop: 12 }} />
      <SkeletonText width="40%" height={10} style={{ marginTop: 6 }} />
      {/* Footer row */}
      <div
        className="flex items-center justify-between"
        style={{ marginTop: 20 }}
      >
        <SkeletonBlock width={60} height={18} borderRadius="var(--radius-full)" />
        <SkeletonBlock width={72} height={12} />
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  BOARD LIST ROW SKELETON                                            */
/* ------------------------------------------------------------------ */

export const SkeletonBoardListRow = ({ isLast = false }) => (
  <div
    className="flex items-center gap-4"
    style={{
      padding: '14px 16px',
      borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
    }}
  >
    <SkeletonBlock width={4} height={32} borderRadius="var(--radius-sm)" />
    <SkeletonCircle size={32} />
    <div className="flex-1 min-w-0">
      <SkeletonBlock width="45%" height={13} />
      <SkeletonBlock width="30%" height={10} style={{ marginTop: 6 }} />
    </div>
    <SkeletonBlock width={56} height={18} borderRadius="var(--radius-full)" />
    <SkeletonBlock width={64} height={12} />
  </div>
);

/* ------------------------------------------------------------------ */
/*  TASK GROUP SKELETON                                                */
/* ------------------------------------------------------------------ */

export const SkeletonTaskGroup = ({ rowCount = 3, index = 0 }) => (
  <div
    className="bg-surface overflow-hidden"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
    }}
  >
    {/* Group header */}
    <div
      className="flex items-center gap-3"
      style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <SkeletonCircle size={10} />
      <SkeletonBlock width={120} height={14} />
      <SkeletonBlock width={40} height={12} style={{ marginLeft: 'auto' }} />
    </div>
    {/* Task rows */}
    {Array.from({ length: rowCount }).map((_, i) => (
      <div
        key={i}
        className="flex items-center gap-4"
        style={{
          padding: '12px 16px',
          borderBottom:
            i === rowCount - 1 ? 'none' : '1px solid var(--color-border)',
        }}
      >
        <SkeletonBlock width="35%" height={13} />
        <SkeletonBlock
          width={72}
          height={22}
          borderRadius="var(--radius-full)"
        />
        <SkeletonCircle size={24} />
        <SkeletonBlock width={70} height={11} style={{ marginLeft: 'auto' }} />
      </div>
    ))}
  </div>
);

/* ------------------------------------------------------------------ */
/*  RECENT BOARDS SKELETON (Dashboard)                                 */
/* ------------------------------------------------------------------ */

export const SkeletonRecentBoards = ({ rows = 4 }) => (
  <section
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 24,
    }}
  >
    {/* Header */}
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <SkeletonCircle size={20} />
        <div>
          <SkeletonBlock width={110} height={14} />
          <SkeletonBlock width={60} height={10} style={{ marginTop: 4 }} />
        </div>
      </div>
      <SkeletonBlock width={64} height={12} />
    </div>
    {/* Rows */}
    <div style={{ marginTop: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3"
          style={{
            height: 56,
            padding: '0 8px',
            borderBottom:
              i === rows - 1 ? 'none' : '1px solid var(--color-border)',
          }}
        >
          <SkeletonCircle size={32} />
          <div className="flex-1 min-w-0">
            <SkeletonBlock width="50%" height={13} />
            <SkeletonBlock width="30%" height={10} style={{ marginTop: 4 }} />
          </div>
          <SkeletonBlock width={56} height={18} borderRadius="var(--radius-full)" />
        </div>
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  RECENT ACTIVITY SKELETON (Dashboard sidebar)                       */
/* ------------------------------------------------------------------ */

export const SkeletonRecentActivity = ({ rows = 3 }) => (
  <section
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 20,
    }}
  >
    <div className="flex items-center gap-2">
      <SkeletonCircle size={18} />
      <SkeletonBlock width={110} height={13} />
    </div>
    <div style={{ marginTop: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3"
          style={{
            padding: '10px 0',
            borderBottom:
              i === rows - 1 ? 'none' : '1px solid var(--color-border)',
          }}
        >
          <SkeletonCircle size={28} />
          <div className="flex-1 min-w-0">
            <SkeletonBlock width="70%" height={12} />
            <SkeletonBlock width="35%" height={9} style={{ marginTop: 4 }} />
          </div>
        </div>
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  QUICK ACTIONS SKELETON (Dashboard sidebar)                         */
/* ------------------------------------------------------------------ */

export const SkeletonQuickActions = () => (
  <section
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 20,
    }}
  >
    <SkeletonBlock width={100} height={13} />
    <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
      {[1, 2, 3].map((i) => (
        <SkeletonBlock key={i} width="100%" height={36} borderRadius="var(--radius-md)" />
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  BAR CHART SKELETON (Analytics)                                     */
/* ------------------------------------------------------------------ */

export const SkeletonBarChart = ({ rows = 4, title = true }) => (
  <section
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 24,
    }}
  >
    {title && (
      <div className="flex items-center gap-2">
        <SkeletonCircle size={16} />
        <SkeletonBlock width={140} height={14} />
      </div>
    )}
    <div className="flex flex-col" style={{ gap: 14, marginTop: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center" style={{ gap: 12 }}>
          <SkeletonBlock width={112} height={12} />
          <div className="flex-1" style={{ height: 8, position: 'relative' }}>
            <SkeletonBlock
              width={`${65 - i * 12}%`}
              height={8}
              borderRadius="var(--radius-full)"
            />
          </div>
          <SkeletonBlock width={28} height={12} />
        </div>
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  BOARD PERFORMANCE SKELETON (Analytics)                             */
/* ------------------------------------------------------------------ */

export const SkeletonBoardPerformance = ({ rows = 3 }) => (
  <section
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 24,
    }}
  >
    <div className="flex items-center gap-2">
      <SkeletonCircle size={16} />
      <SkeletonBlock width={140} height={14} />
    </div>
    <div className="flex flex-col" style={{ marginTop: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center"
          style={{
            padding: '12px 0',
            gap: 14,
            borderBottom:
              i === rows - 1 ? 'none' : '1px solid var(--color-border)',
          }}
        >
          <SkeletonCircle size={8} />
          <SkeletonBlock width={140} height={13} />
          <div className="flex-1" style={{ height: 6, position: 'relative' }}>
            <SkeletonBlock
              width={`${70 - i * 15}%`}
              height={6}
              borderRadius="var(--radius-full)"
            />
          </div>
          <SkeletonBlock width={44} height={12} />
        </div>
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  OVERDUE ASSIGNEES SKELETON (Analytics)                             */
/* ------------------------------------------------------------------ */

export const SkeletonOverdueAssignees = ({ rows = 5 }) => (
  <section
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 24,
    }}
  >
    <div className="flex items-center gap-2">
      <SkeletonCircle size={16} />
      <SkeletonBlock width={160} height={14} />
    </div>
    <div className="flex flex-col" style={{ gap: 14, marginTop: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center" style={{ gap: 12 }}>
          <SkeletonCircle size={28} />
          <SkeletonBlock width={96} height={12} />
          <div className="flex-1" style={{ height: 8, position: 'relative' }}>
            <SkeletonBlock
              width={`${70 - i * 12}%`}
              height={8}
              borderRadius="var(--radius-full)"
            />
          </div>
          <SkeletonBlock width={28} height={12} />
        </div>
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  CALENDAR SKELETON                                                  */
/* ------------------------------------------------------------------ */

export const SkeletonCalendarGrid = () => {
  const { t } = useTranslation();
  return (
  <div
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: 12,
    }}
    role="status"
    aria-live="polite"
    aria-label={t('pages.loadingCalendar')}
  >
    {/* Day headers */}
    <div
      className="grid grid-cols-7"
      style={{
        background: 'var(--color-bg-subtle)',
        borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-center"
          style={{
            height: 40,
            borderLeft: i === 0 ? 'none' : '1px solid var(--color-border)',
          }}
        >
          <SkeletonBlock width={28} height={10} />
        </div>
      ))}
    </div>
    {/* Calendar rows (5 weeks) */}
    {Array.from({ length: 5 }).map((_, week) => (
      <div
        key={week}
        className="grid grid-cols-7"
        style={{
          minHeight: 100,
          borderBottom:
            week === 4 ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {Array.from({ length: 7 }).map((_, day) => (
          <div
            key={day}
            style={{
              padding: '6px 8px',
              borderLeft:
                day === 0 ? 'none' : '1px solid var(--color-border)',
            }}
          >
            <div className="flex justify-end">
              <SkeletonBlock width={16} height={10} />
            </div>
            {/* Random event placeholders */}
            {(week * 7 + day) % 3 === 0 && (
              <SkeletonBlock
                width="85%"
                height={18}
                borderRadius={4}
                style={{ marginTop: 6 }}
              />
            )}
            {(week * 7 + day) % 5 === 1 && (
              <SkeletonBlock
                width="70%"
                height={18}
                borderRadius={4}
                style={{ marginTop: 6 }}
              />
            )}
          </div>
        ))}
      </div>
    ))}
  </div>
  );
};

/* ------------------------------------------------------------------ */
/*  GREETING BANNER SKELETON (Dashboard)                               */
/* ------------------------------------------------------------------ */

export const SkeletonGreetingBanner = () => (
  <div
    className="bg-surface"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: '24px 28px',
    }}
  >
    <SkeletonBlock width={220} height={22} />
    <SkeletonBlock width={160} height={13} style={{ marginTop: 8 }} />
  </div>
);

export default SkeletonBlock;
