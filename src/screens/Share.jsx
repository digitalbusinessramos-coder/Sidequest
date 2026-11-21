import { useState } from 'react';
import { tx } from '../i18n.js';
import { Icon, useApp } from '../components.jsx';
import { fmtPlanWhen } from '../util.js';

/** Short link for Instagram and WhatsApp. /p/ID shows a preview card and then opens the plan. Old #/activity/ID links keep working. */
export function planLink(id) { return `${location.origin}/p/${id}`; }

export function ShareButton({ activity: a }) {
  const { toast } = useApp();
  const [copied, setCopied] = useState(false);
  const url = planLink(a.id);
  const share = async () => {
    const text = `${a.title} · ${fmtPlanWhen(a)} · ${a.meeting_area}`;
    if (navigator.share) {
      try { await navigator.share({ title: a.title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); toast(tx('Link copied. Paste it in WhatsApp or Instagram.')); } catch { window.prompt(tx('Copy this link:'), url); }
  };
  return (
    <div className="row wrap share-row">
      <button type="button" className="btn btn-secondary btn-sm" onClick={share}><Icon name="send" size={16} />{tx('Share plan')}</button>
      {copied && <span className="tiny muted">{url}</span>}
    </div>
  );
}
