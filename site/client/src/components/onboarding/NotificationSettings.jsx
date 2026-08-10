import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, Check, Send } from 'lucide-react';
import useOrgStore from '../../store/orgStore';
import * as push from '../../services/pushService';

/**
 * NotificationSettings — turn lead alerts on for this device.
 *
 * Deliberately per-device: an agent usually wants alerts on the phone in their
 * pocket, not on the laptop left open at the office, so the toggle reflects
 * THIS browser rather than the account.
 */

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 18,
};

const PREFS = ['leadAssigned', 'slaWarning', 'bookingChanged', 'leadReplied'];

const NotificationSettings = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [state, setState] = useState(null); // { enabled, devices }
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!orgId) return;
    push
      .getStatus(orgId)
      .then((s) => {
        setState(s);
        setPrefs(s.devices?.[0]?.prefs || null);
      })
      .catch(() => setState({ enabled: false, devices: [] }));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!state) return null;

  const supported = push.pushSupported();
  const on = push.permission() === 'granted' && (state.devices || []).length > 0;

  const enable = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await push.enablePush(orgId);
      if (!res.ok) {
        setMsg(
          res.reason === 'denied'
            ? t('push.denied', 'Notifications are blocked in your browser settings for this site.')
            : res.reason === 'not_configured'
              ? t('push.notConfigured', 'Push is not set up on the server yet.')
              : t('push.failed', 'Could not turn on notifications.')
        );
      } else {
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    await push.disablePush();
    setBusy(false);
    load();
  };

  const toggle = async (key) => {
    const next = { ...(prefs || {}), [key]: !(prefs || {})[key] };
    setPrefs(next);
    await push.updatePrefs(next).catch(() => {});
  };

  return (
    <div style={card}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--color-accent-light, #EEF3EA)', color: 'var(--color-accent)' }}
          >
            {on ? <Bell size={16} /> : <BellOff size={16} />}
          </span>
          <div>
            <div className="font-heading" style={{ fontSize: 15, fontWeight: 750, color: 'var(--color-text-primary)' }}>
              {t('push.title', 'Lead alerts on this device')}
            </div>
            <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              {on
                ? t('push.onBody', 'You’ll be told the moment a lead is yours — even with the app closed.')
                : t('push.offBody', 'Get told the moment a lead is yours, even with the app closed.')}
            </div>
          </div>
        </div>

        {!supported ? (
          <span className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {t('push.unsupported', 'Not supported by this browser')}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {on && (
              <button
                type="button"
                onClick={() => push.sendTest(orgId).then(() => setMsg(t('push.testSent', 'Sent — check your notifications.')))}
                className="font-body inline-flex items-center gap-1.5"
                style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >
                <Send size={13} /> {t('push.test', 'Send a test')}
              </button>
            )}
            <button
              type="button"
              onClick={on ? disable : enable}
              disabled={busy}
              className="font-body"
              style={{
                fontSize: 13,
                fontWeight: 650,
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: on ? 'var(--color-bg-subtle)' : 'var(--color-accent)',
                color: on ? 'var(--color-text-secondary)' : '#fff',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {busy ? t('push.working', 'Working…') : on ? t('push.turnOff', 'Turn off') : t('push.turnOn', 'Turn on')}
            </button>
          </div>
        )}
      </div>

      {msg && (
        <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 10 }}>
          {msg}
        </p>
      )}

      {on && prefs && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
          {PREFS.map((key) => (
            <label
              key={key}
              className="flex items-center justify-between gap-3"
              style={{ padding: '8px 0', cursor: 'pointer' }}
            >
              <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {t(`push.prefs.${key}`, key)}
              </span>
              <span
                className="inline-flex items-center justify-center"
                style={{
                  width: 19,
                  height: 19,
                  borderRadius: 5,
                  border: prefs[key] ? 'none' : '1.5px solid var(--color-border-strong)',
                  background: prefs[key] ? 'var(--color-accent)' : 'transparent',
                  color: '#fff',
                }}
              >
                {prefs[key] && <Check size={13} strokeWidth={3} />}
              </span>
              <input type="checkbox" checked={!!prefs[key]} onChange={() => toggle(key)} style={{ display: 'none' }} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;
