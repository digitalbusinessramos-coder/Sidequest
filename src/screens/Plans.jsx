import { t, tx } from '../i18n.js';
import { useState } from 'react';
import { ActivityCard, Empty, ErrorState, Icon, Loading, useApp } from '../components.jsx';
import { fmtWhen, useApi } from '../util.js';

const NOTE_TEXT = {
  request_received: ['{name} asked to join “{title}”.', 'group'],
  request_accepted: ['{name} accepted you for “{title}”. You’re confirmed.', 'check'],
  request_declined: ['Your request for “{title}” was not accepted.', 'info'],
  removed: ['You are no longer part of “{title}”.', 'info'],
  invited: ['{name} invited you to “{title}”.', 'heart'],
  invite_accepted: ['{name} accepted your invitation to “{title}”.', 'check'],
  left: ['{name} left “{title}”.', 'info'],
  cancelled: ['“{title}” was cancelled.', 'x'],
  changed: ['The organiser changed the time or meeting point of “{title}”.', 'clock'],
};

/** In-app notifications. Shown in the person's language because the server stores only the kind of event. */
function Updates() {
  const { api, reloadMe, city } = useApp();
  const { data, reload } = useApi('/notifications', { poll: 20000 });
  const [showAll, setShowAll] = useState(false);
  if (!data || data.notifications.length === 0) return null;
  const list = data.notifications;
  const unread = list.filter((n) => !n.read).length;
  const shown = showAll ? list : list.slice(0, Math.max(3, unread));
  const markAll = async () => { await api.post('/notifications/read', { all: true }); reload(true); reloadMe(); };
  const open = async (n) => {
    if (!n.read) api.post('/notifications/read', { ids: [n.id] }).then(() => reloadMe()).catch(() => {});
    if (n.activity) location.hash = `#/activity/${n.activity.id}`;
  };
  return (
    <section className="stack-sm" aria-labelledby="upd-h">
      <div className="section-title">
        <h2 id="upd-h">{tx('Updates')} {unread > 0 && <span className="tab-badge" style={{ position: 'static', display: 'inline-grid', verticalAlign: 'middle' }}>{unread}</span>}</h2>
        {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAll}>{tx('Mark all as read')}</button>}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {shown.map((n) => {
          const [text, icon] = NOTE_TEXT[n.kind] || ['{title}', 'info'];
          return (
            <button key={n.id} className={`note ${n.read ? '' : 'unread'}`} onClick={() => open(n)}>
              <Icon name={icon} size={18} />
              <span style={{ flex: 1 }}>
                {tx(text, { name: n.actor?.first_name || tx('Someone'), title: n.activity?.title || '' })}
                {n.kind === 'cancelled' && n.detail && <> {tx('Reason: {reason}', { reason: n.detail })}</>}
                <span className="tiny muted" style={{ display: 'block' }}>{fmtWhen(n.created_at, city.timezone)}</span>
              </span>
              {!n.read && <span className="dot" aria-label={tx('Unread')} />}
            </button>
          );
        })}
      </div>
      {list.length > shown.length && <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(true)}>{tx('Show older updates')}</button>}
    </section>
  );
}

const SECTIONS = [
  ['invited', 'plans.invited', "Someone invited you. You decide."],
  ['organising', 'plans.organising', null],
  ['confirmed', 'plans.confirmed', "You’re going. Open a plan for the meet-up card and chat."],
  ['waiting', 'plans.waiting', "Not confirmed yet. The organiser still has to accept."],
  ['history', 'plans.history', null],
];

export default function Plans() {
  const { data, error, loading, reload } = useApi('/plans', { poll: 15000 });
  const total = data ? SECTIONS.reduce((n, [k]) => n + data[k].length, 0) : 0;
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack-sm"><span className="eyebrow">{tx("Your week")}</span><h1>{t('plans.title')}</h1></div>
        <a className="btn btn-primary btn-sm" href="#/create"><Icon name="plus" size={16} />{tx("New plan")}</a>
      </div>
      <Updates />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : total === 0 ? (
        <Empty icon="plans" title={t('plans.empty')} hint={t('plans.emptyHint')}>
          <a className="btn btn-primary btn-sm" href="#/explore">{tx("Go to Explore")}</a>
        </Empty>
      ) : SECTIONS.map(([k, label, hint]) => data[k].length > 0 && (
        <section key={k} className="stack" aria-labelledby={`pl-${k}`}>
          <div className="stack-sm">
            <h2 id={`pl-${k}`}>{t(label)} <span className="muted small">({data[k].length})</span></h2>
            {hint && <p className="small muted">{tx(hint)}</p>}
          </div>
          {data[k].map((a) => <ActivityCard key={a.id} a={a} />)}
        </section>
      ))}
    </div>
  );
}
