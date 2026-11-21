import { useEffect, useState } from 'react';
import { getAppName, tx } from '../i18n.js';
import { Icon, Sheet } from '../components.jsx';

// Chrome and Edge fire this when the app can be installed with one tap. We keep it for the moment the student asks.
let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}

/** Where is this page open? Decides which instructions are true for this device. */
export function installContext() {
  const ua = navigator.userAgent || '';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|WhatsApp|Snapchat|TikTok|musical_ly|Line\//i.test(ua) ? (/Instagram/i.test(ua) ? 'Instagram' : /WhatsApp/i.test(ua) ? 'WhatsApp' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : 'app') : null;
  return { standalone, ios, android, inApp, mobile: ios || android };
}

function useDeferred() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return deferred;
}

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

/** Steps that work on this device. Returns null where adding to the home screen isn't possible, so nothing is promised. */
export function InstallSteps() {
  const ctx = installContext();
  const prompt = useDeferred();
  const app = getAppName();
  if (ctx.standalone) return <p className="small">{tx('{app} is already on your home screen. You’re using it from there right now.', { app })}</p>;
  if (ctx.inApp) {
    return (
      <div className="stack-sm">
        <p className="small">{tx('You opened this inside {where}. Its built-in browser can’t add apps to your home screen.', { where: ctx.inApp === 'app' ? tx('another app') : ctx.inApp })}</p>
        <ol className="small install-steps">
          <li>{ctx.ios ? tx('Tap ••• or the share icon, then “Open in Safari” (or “Open in browser”).') : tx('Tap ⋮ or •••, then “Open in Chrome” (or “Open in browser”).')}</li>
          <li>{tx('Then follow the steps for your browser there. Your account and plans are kept once you log in.')}</li>
        </ol>
      </div>
    );
  }
  if (prompt) {
    const install = async () => { prompt.prompt(); try { await prompt.userChoice; } catch { /* ignore */ } deferred = null; };
    return <button className="btn btn-secondary" onClick={install}><Icon name="plus" size={16} />{tx('Add to home screen')}</button>;
  }
  if (ctx.ios) {
    return (
      <ol className="small install-steps">
        <li>{tx('Tap the Share button (the square with an arrow) in the browser bar.')}</li>
        <li>{tx('Scroll down and tap “Add to Home Screen”.')}</li>
        <li>{tx('Tap “Add”. {app} opens from its icon, without the browser bar.', { app })}</li>
      </ol>
    );
  }
  if (ctx.android) {
    return (
      <ol className="small install-steps">
        <li>{tx('Tap ⋮ (the menu) at the top right of Chrome.')}</li>
        <li>{tx('Tap “Add to Home screen” or “Install app”, then “Add”.')}</li>
      </ol>
    );
  }
  return null;
}

/** Can we honestly offer it here? Phones (including in-app browsers, with their own steps) and browsers that offer installing. */
export function canSuggestInstall() {
  const ctx = installContext();
  return !ctx.standalone && (ctx.mobile || !!deferred);
}

/**
 * Shown once, after someone creates or joins their first plan. "View my plan" stays the main action;
 * adding to the home screen is optional and easy to dismiss. Also available any time under Help.
 */
export function InstallSuggestion() {
  const [open, setOpen] = useState(() => store('sq_install_seen') !== '1' && canSuggestInstall());
  useDeferred();
  if (!open) return null;
  const close = () => { store('sq_install_seen', '1'); setOpen(false); };
  return (
    <Sheet title={tx('Add {app} to your home screen', { app: getAppName() })} onClose={close}>
      <div className="stack">
        <p className="small">{tx('Open your plans with one tap, like an app. Nothing to download from a store, and you can remove it any time.')}</p>
        <InstallSteps />
        <button className="btn btn-primary btn-block" onClick={close}>{tx('View my plan')}</button>
        <button className="btn btn-ghost btn-block" onClick={close}>{tx('Not now')}</button>
      </div>
    </Sheet>
  );
}
