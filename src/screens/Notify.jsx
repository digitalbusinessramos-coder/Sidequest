import { useEffect, useState } from 'react';
import { tx } from '../i18n.js';
import { Icon, useApp } from '../components.jsx';
import { disablePush, enablePush, pushState } from '../push.js';

/**
 * Turn pop-up notifications on or off for this device. The browser only asks for permission after a tap here,
 * never on its own, and the text says honestly what each device can do.
 */
export function NotifySettings({ compact = false, onChange }) {
  const { api, toast, reloadMe } = useApp();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
  const run = async (fn) => {
    setBusy(true);
    try {
      const s = await fn();
      setState(s);
      onChange?.(s);
      if (s === 'on') toast(tx('Notifications are on for this device.'));
      if (s === 'denied') toast(tx('Notifications are blocked in your browser settings.'), true);
      reloadMe().catch(() => {});
    } catch (x) { toast(tx(x.message || 'Something went wrong. Please try again.'), true); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { await api.post('/push/test', {}); toast(tx('Test sent. It should pop up in a few seconds.')); } catch (x) { toast(tx(x.message), true); } finally { setBusy(false); }
  };
  if (state === null) return null;
  return (
    <div className="stack-sm">
      {!compact && <p className="small muted">{tx('Get a pop-up when someone joins your plan, accepts you, invites you or writes in a plan chat. Busy chats send at most one every 10 minutes.')}</p>}
      {state === 'on' && (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="badge badge-open"><Icon name="check" size={12} />{tx('On for this device')}</span>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={test}>{tx('Send a test')}</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(disablePush)}>{tx('Turn off')}</button>
        </div>
      )}
      {state === 'off' && <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(enablePush)}><Icon name="bell" size={16} />{tx('Turn on notifications')}</button>}
      {state === 'denied' && <p className="small">{tx('Notifications are blocked for this site. To allow them, open your browser’s site settings (the icon next to the address), allow Notifications, then come back here.')}</p>}
      {state === 'ios-install' && <p className="small">{tx('On iPhone, notifications only work once the app is on your home screen. Add it first (Share, then “Add to Home Screen”), open it from the icon, and turn them on here.')}</p>}
      {state === 'unsupported' && <p className="small muted">{tx('This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari, or add the app to your home screen.')}</p>}
    </div>
  );
}
