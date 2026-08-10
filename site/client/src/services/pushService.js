import api from './api';

/**
 * pushService — register this browser for lead alerts.
 *
 * The tricky part is the handshake: the browser needs the server's VAPID public
 * key as a Uint8Array before it will produce a subscription, and that
 * subscription is what the server later encrypts to.
 */

/** VAPID keys are base64url; PushManager wants raw bytes. */
const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const permission = () => (pushSupported() ? Notification.permission : 'unsupported');

/** GET /api/push/status?org= — is push configured, and which devices exist. */
export const getStatus = async (orgId) => {
  const { data } = await api.get('/api/push/status', { params: { org: orgId } });
  return data;
};

/**
 * Ask for permission, subscribe this browser, and register it server-side.
 * @returns {Promise<{ ok:boolean, reason?:string }>}
 */
export const enablePush = async (orgId) => {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const { data: key } = await api.get('/api/push/key');
  if (!key.enabled || !key.publicKey) return { ok: false, reason: 'not_configured' };

  const granted = await Notification.requestPermission();
  if (granted !== 'granted') return { ok: false, reason: granted };

  const reg = await navigator.serviceWorker.ready;
  // Reuse an existing subscription when the browser already has one.
  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true, // required by Chrome; we always show a notification
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    }));

  await api.post('/api/push/subscribe', { org: orgId, subscription: subscription.toJSON() });
  return { ok: true };
};

/** Unsubscribe this browser and forget it server-side. */
export const disablePush = async () => {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  return true;
};

/** Update what this device wants to be woken for. */
export const updatePrefs = async (prefs) => {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const { data } = await api.put('/api/push/prefs', { endpoint: sub.endpoint, prefs });
  return data.prefs;
};

/** Send yourself one, to prove it works. */
export const sendTest = async (orgId) => {
  const { data } = await api.post('/api/push/test', { org: orgId });
  return data;
};
