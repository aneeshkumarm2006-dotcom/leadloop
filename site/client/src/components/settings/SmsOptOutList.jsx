import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import * as smsService from '../../services/smsService';
import { formatDate } from '../../utils/dateUtils';
import { SettingsCard, CardTitle, CardText } from './SettingsLayout';

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

  // The list is loaded once per workspace (the tab remounts on switch).
  useEffect(() => {
    if (!workspaceId) return undefined;
    let alive = true;
    smsService
      .listOptOuts(workspaceId)
      .then((list) => alive && setOptOuts(Array.isArray(list) ? list : []))
      .catch((err) => alive && setError(err?.response?.data?.error || 'Failed to load opt-outs'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const isLoading = !!workspaceId && loading;

  return (
    <SettingsCard aria-labelledby="sms-optouts-title" style={{ gap: 12 }}>
      <div>
        <CardTitle id="sms-optouts-title" size={17}>
          Opted-out numbers
        </CardTitle>
        <CardText style={{ marginTop: 4 }}>
          Numbers that replied STOP. They are blocked from SMS and WhatsApp sends until they reply START.
        </CardText>
      </div>

      {error && (
        <p className="font-body text-[12px]" style={{ margin: 0, color: 'var(--color-status-stuck)' }} role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="font-body" role="status" style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Loading…
        </p>
      ) : optOuts.length === 0 ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
          <Ban size={16} aria-hidden="true" />
          <span className="font-body" style={{ fontSize: 13 }}>
            No opt-outs yet.
          </span>
        </div>
      ) : (
        <ul
          className="grid gap-2"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {optOuts.map((o) => (
            <li
              key={o._id}
              className="flex items-center justify-between gap-3"
              style={{
                padding: '10px 14px',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                background: 'var(--color-bg-input)',
              }}
            >
              <span className="font-mono" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                {o.phone}
              </span>
              <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {formatDate(o.optedOutAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
};

export default SmsOptOutList;
