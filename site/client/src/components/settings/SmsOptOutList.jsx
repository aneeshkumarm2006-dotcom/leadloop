import { useCallback, useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import * as smsService from '../../services/smsService';
import { formatDate } from '../../utils/dateUtils';

/**
 * SmsOptOutList — read-only viewer of numbers that have replied STOP (F10.5).
 *
 * These numbers are blocked from all SMS (and F11 WhatsApp) sends for the
 * workspace. A number is removed automatically when it replies START/UNSTOP.
 *
 * Props: workspaceId — the current workspace.
 */
const SmsOptOutList = ({ workspaceId }) => {
  const [optOuts, setOptOuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    smsService
      .listOptOuts(workspaceId)
      .then(setOptOuts)
      .catch((err) => setError(err?.response?.data?.error || 'Failed to load opt-outs'))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="mt-10 pt-8" style={{ borderTop: '1px solid var(--color-border)' }}>
      <h3 className="font-display font-semibold text-[color:var(--color-text-primary)]" style={{ fontSize: 15 }}>
        Opted-out numbers
      </h3>
      <p className="mt-1 font-body text-xs text-[color:var(--color-text-muted)]">
        Numbers that replied STOP. They are blocked from SMS and WhatsApp sends until they reply START.
      </p>

      {error && (
        <p className="font-body text-[12px] mt-3" style={{ color: 'var(--color-status-stuck)' }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-body mt-3" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Loading…
        </p>
      ) : optOuts.length === 0 ? (
        <div className="flex items-center gap-2 mt-4" style={{ color: 'var(--color-text-muted)' }}>
          <Ban size={16} aria-hidden="true" />
          <span className="font-body" style={{ fontSize: 13 }}>
            No opt-outs yet.
          </span>
        </div>
      ) : (
        <ul
          className="mt-4 flex flex-col"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            maxWidth: 480,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          {optOuts.map((o, i) => (
            <li
              key={o._id}
              className="flex items-center justify-between"
              style={{
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <span className="font-mono" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                {o.phone}
              </span>
              <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {formatDate(o.optedOutAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SmsOptOutList;
