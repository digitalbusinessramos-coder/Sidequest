import { useEffect, useState } from 'react';
import { getAppName, tx } from '../i18n.js';
import { Icon, Sheet } from '../components.jsx';
import { NotifySettings } from './Notify.jsx';

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

const ShareGlyph = () => <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const AddGlyph = () => <svg viewBox="0 0 24 24" width="22" height="22"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;

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
    // Apple doesn't let a website add itself to the home screen, so we show exactly where to tap, with the same symbols Safari uses.
    return (
      <>
        <ol className="install-steps ios-steps">
          <li><span className="ios-glyph" aria-hidden="true"><ShareGlyph /></span><span>{tx('Tap the Share button (a square with an arrow pointing up). If you don’t see it, tap ••• first, then Share.')}</span></li>
          <li><span className="ios-glyph" aria-hidden="true"><AddGlyph /></span><span>{tx('Scroll down and tap “Add to Home Screen”. If you don’t see it, tap “More” or “Edit Actions”.')}</span></li>
          <li><span className="ios-glyph" aria-hidden="true"><img src="/brand/icon-180.png" alt="" width="28" height="28" /></span><span>{tx('Tap “Add”. {app} now opens from its icon, like an app, and can send you notifications.', { app })}</span></li>
        </ol>
      </>
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
        <div className="card card-pad stack-sm">
          <strong className="row"><Icon name="bell" size={18} />{tx('Know when someone replies')}</strong>
          <NotifySettings compact />
        </div>
        <button className="btn btn-primary btn-block" onClick={close}>{tx('View my plan')}</button>
        <button className="btn btn-ghost btn-block" onClick={close}>{tx('Not now')}</button>
      </div>
    </Sheet>
  );
}

/**
 * Always-visible "Install app" button (header on phones, sidebar on computers), only where installing is possible.
 * Chrome, Edge and Samsung Internet install with one tap. Safari on iPhone does not let websites do that,
 * so there the button opens the three steps instead.
 */
export function InstallButton({ className = '' }) {
  const prompt = useDeferred();
  const [open, setOpen] = useState(false);
  if (!canSuggestInstall()) return null;
  const tap = async () => {
    if (prompt) { prompt.prompt(); try { await prompt.userChoice; } catch { /* ignore */ } deferred = null; listeners.forEach((f) => f()); return; }
    setOpen(true);
  };
  return (
    <>
      <button type="button" className={`btn btn-sm install-btn ${className}`} onClick={tap}><Icon name="install" size={16} />{tx('Install app')}</button>
      {open && (
        <Sheet title={tx('Add {app} to your home screen', { app: getAppName() })} onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="small">{tx('Open your plans with one tap, like an app. Nothing to download from a store, and you can remove it any time.')}</p>
            <InstallSteps />
            <button className="btn btn-primary btn-block" onClick={() => setOpen(false)}>{tx('Done')}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

const seenRecently = (k, days) => { const t = Number(store(k) || 0); return t && Date.now() - t < days * 864e5; };

/** On Explore, for phones not using the installed app yet: a small card with the one-tap install (or the iPhone steps). */
export function InstallNudge() {
  const prompt = useDeferred();
  const [hidden, setHidden] = useState(() => seenRecently('sq_install_nudge', 5));
  const [open, setOpen] = useState(false);
  const ctx = installContext();
  if (hidden || ctx.standalone || !(ctx.mobile || prompt)) return null;
  const hide = () => { store('sq_install_nudge', String(Date.now())); setHidden(true); };
  const tap = async () => {
    if (prompt) { prompt.prompt(); try { const c = await prompt.userChoice; if (c?.outcome === 'accepted') hide(); } catch { /* ignore */ } deferred = null; listeners.forEach((f) => f()); return; }
    setOpen(true);
  };
  return (
    <div className="card card-pad row new-here" role="region" aria-label={tx('Get the app')}>
      <img src="/brand/icon-180.png" alt="" width="40" height="40" className="nudge-icon" />
      <div className="new-here-text"><strong>{tx('Get {app} on your home screen', { app: getAppName() })}</strong> <span className="small muted">{tx('Opens like an app and tells you when someone joins or writes.')}</span></div>
      <button className="btn btn-primary btn-sm" onClick={tap}>{prompt ? tx('Install') : tx('Show me how')}</button>
      <button className="icon-btn" onClick={hide} aria-label={tx('Close')}><Icon name="x" size={16} /></button>
      {open && (
        <Sheet title={tx('Add {app} to your home screen', { app: getAppName() })} onClose={() => setOpen(false)}>
          <div className="stack"><InstallSteps /><button className="btn btn-primary btn-block" onClick={() => setOpen(false)}>{tx('Done')}</button></div>
        </Sheet>
      )}
    </div>
  );
}
