// Pop-up notifications: service worker registration and the browser's push subscription.
import { api } from './api.js';

let regPromise = null;
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (!regPromise) regPromise = navigator.serviceWorker.register('/sw.js').catch(() => null);
  return regPromise;
}

/**
 * What this device can do right now:
 * 'on' | 'off' | 'denied' (blocked in the browser settings) | 'ios-install' (iPhone: only from the home screen app) | 'unsupported'
 */
export async function pushState() {
  const ua = navigator.userAgent || '';
  const ctx = {
    ios: /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true,
  };
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return ctx.ios && !ctx.standalone ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registerServiceWorker();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const b64 = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Asks the browser for permission (only ever after a tap), then registers this device with the server. */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const { key } = await api.get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  await api.post('/push/subscribe', sub.toJSON());
  return 'on';
}

export async function disablePush() {
  const reg = await registerServiceWorker();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return 'off';
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  return 'off';
}

/** On every app open: make sure this device is linked to whoever is logged in now (e.g. after logging in). */
export async function syncPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
    const reg = await registerServiceWorker();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await api.post('/push/subscribe', sub.toJSON());
  } catch { /* not important enough to bother anyone */ }
}
