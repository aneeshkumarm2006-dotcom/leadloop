import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Mail, UserCheck, CalendarClock } from 'lucide-react';
import * as intakeService from '../../services/intakeService';

/**
 * IntakeEventsPanel — read-only last-N executed lead intakes (F9.5).
 *
 * Each row shows the resolved owner (+ round-robin/geo strategy and any geo
 * fallback), whether the stage was set, the welcome-email status, and links to
 * the created follow-up subtask. Props: { boardId }.
 */

const STATUS_COLORS = {
  ok: 'var(--color-status-done)',
  skipped: 'var(--color-status-working)',
  failed: 'var(--color-status-stuck)',
};

const fmtTime = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
};

const WELCOME_LABEL = {
  ok: 'Email sent',
  skipped: 'Email skipped',
  failed: 'Email failed',
};

const IntakeEventsPanel = ({ boardId }) => {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    intakeService
      .getIntakeEvents(boardId, 10)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => { if (boardId) reload(); }, [boardId, reload]);

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 720 }}>
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
          Recent intakes
        </h3>
        <button
          type="button"
          onClick={reload}
          aria-label="Refresh intake events"
          title="Refresh"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {loading && !events ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : !events || events.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No leads have been processed yet. New leads arriving via webhook or form will appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((ev) => (
            <li
              key={ev._id}
              style={{
                border: '1.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                background: 'var(--color-bg-surface)',
              }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {ev.taskName || 'Lead'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{fmtTime(ev.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                <span className="inline-flex items-center gap-1.5">
                  <UserCheck size={13} />
                  {ev.ownerName || (ev.ownerId ? 'Assigned' : 'No owner')}
                  {ev.strategy ? (
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      ({ev.strategy === 'geo' ? `geo${ev.city ? ` · ${ev.city}` : ''}` : ev.strategy}
                      {ev.fallback ? ' · fallback' : ''})
                    </span>
                  ) : null}
                </span>
                {ev.stageSet && <span>Stage set</span>}
                <span
                  className="inline-flex items-center gap-1.5"
                  style={{ color: STATUS_COLORS[ev.welcomeStatus] || 'var(--color-text-muted)' }}
                >
                  <Mail size={13} />
                  {WELCOME_LABEL[ev.welcomeStatus] || 'No email'}
                </span>
                {ev.followupTaskId && (
                  <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    <CalendarClock size={13} /> Follow-up created
                  </span>
                )}
                <span style={{ color: STATUS_COLORS[ev.status] || 'var(--color-text-muted)', fontWeight: 600 }}>
                  {ev.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default IntakeEventsPanel;
