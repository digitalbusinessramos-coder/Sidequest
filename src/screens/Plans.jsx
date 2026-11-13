import { t, tx } from '../i18n.js';
import { useMemo, useState } from 'react';
import { ActivityCard, Empty, ErrorState, Icon, Loading, Stamp, useApp } from '../components.jsx';
import { locale } from '../i18n.js';
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
  joined: ['{name} joined “{title}”.', 'bolt'],
  market_message: ['{name} sent you a message about “{title}”.', 'shopping'],
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
    else if (n.listing) location.hash = `#/market/${n.listing.id}`;
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
                {tx(text, { name: n.actor?.first_name || tx('Someone'), title: n.activity?.title || n.listing?.title || '' })}
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

// ---------- calendar ----------
const HOUR_PX = 48;
function localParts(iso, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (day) => { const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; return addDays(day, -wd); };
const KIND_LABEL = { organising: 'Organising', confirmed: 'Going', waiting: 'Waiting', invited: 'Invited', event: 'Event' };

function Calendar({ data, tz }) {
  const today = localParts(new Date().toISOString(), tz).day;
  const [week, setWeek] = useState(mondayOf(today));
  const [day, setDay] = useState(today);
  const items = useMemo(() => {
    const out = [];
    for (const k of ['organising', 'confirmed', 'waiting', 'invited']) for (const a of data[k]) out.push({ kind: k, id: a.id, title: a.title, category: a.category, starts_at: a.starts_at, duration: a.duration_min, href: `#/activity/${a.id}`, where: a.meeting_area });
    for (const e of data.events || []) out.push({ kind: 'event', id: `e${e.id}`, title: e.title, category: e.category, starts_at: e.starts_at, duration: e.duration_min, href: `#/event/${e.id}`, where: e.venue });
    return out.map((x) => ({ ...x, ...localParts(x.starts_at, tz) })).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [data, tz]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const fmt = (d, o) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...o }).format(new Date(`${d}T12:00:00Z`));
  const todays = items.filter((x) => x.day === day);
  const startH = Math.min(8, ...todays.map((x) => Math.floor(x.mins / 60)));
  const endH = Math.min(24, Math.max(22, ...todays.map((x) => Math.ceil((x.mins + x.duration) / 60))));
  // Side-by-side columns for overlapping plans.
  const cols = [];
  const placed = todays.map((x) => {
    const end = x.mins + x.duration;
    let c = cols.findIndex((colEnd) => colEnd <= x.mins);
    if (c === -1) { c = cols.length; cols.push(end); } else cols[c] = end;
    return { ...x, col: c };
  });
  const nCols = Math.max(1, cols.length);
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return (
    <section className="stack" aria-label={tx('Calendar')}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="icon-btn" onClick={() => { const w = addDays(week, -7); setWeek(w); setDay(w); }} aria-label={tx('Previous week')}><Icon name="back" /></button>
        <strong>{fmt(days[0], { day: 'numeric', month: 'short' })} – {fmt(days[6], { day: 'numeric', month: 'short' })}</strong>
        <button className="icon-btn" onClick={() => { const w = addDays(week, 7); setWeek(w); setDay(w); }} aria-label={tx('Next week')}><Icon name="back" style={{ transform: 'scaleX(-1)' }} /></button>
      </div>
      <div className="week-strip" role="tablist" aria-label={tx('Days')}>
        {days.map((d) => {
          const n = items.filter((x) => x.day === d).length;
          return (
            <button key={d} role="tab" aria-selected={d === day} className={`week-day ${d === day ? 'on' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDay(d)}
              aria-label={`${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${n ? `, ${tx(n === 1 ? '1 plan' : '{n} plans', { n })}` : ''}`}>
              <span className="tiny">{fmt(d, { weekday: 'short' })}</span>
              <strong>{fmt(d, { day: 'numeric' })}</strong>
              <span className="dots">{Array.from({ length: Math.min(n, 3) }, (_, i) => <i key={i} />)}</span>
            </button>
          );
        })}
      </div>
      <h3 className="small">{fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      {todays.length === 0 ? (
        <p className="small muted card card-pad">{tx('Nothing planned this day.')} <a href="#/explore">{tx('Find something to do')}</a></p>
      ) : (
        <div className="timetable card" style={{ height: (endH - startH) * HOUR_PX }}>
          {Array.from({ length: endH - startH }, (_, i) => (
            <div key={i} className="tt-hour" style={{ top: i * HOUR_PX }}><span>{String(startH + i).padStart(2, '0')}:00</span></div>
          ))}
          {placed.map((x) => {
            const top = (x.mins / 60 - startH) * HOUR_PX;
            const h = Math.max(34, Math.min(x.duration, endH * 60 - x.mins) / 60 * HOUR_PX - 3);
            return (
              <a key={x.id} href={x.href} className={`tt-item k-${x.kind}`} style={{ top, height: h, left: `calc(54px + (100% - 60px) * ${x.col / nCols})`, width: `calc((100% - 60px) / ${nCols} - 4px)` }}>
                <span className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Stamp category={x.category} size="sm" />
                  <span style={{ minWidth: 0 }}>
                    <strong className="tt-title">{x.title}</strong>
                    <span className="tiny" style={{ display: 'block' }}>{hhmm(x.mins)}–{hhmm(x.mins + x.duration)} · {tx(KIND_LABEL[x.kind])}</span>
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      )}
      <div className="row wrap tiny muted" style={{ gap: 10 }}>
        {Object.entries(KIND_LABEL).map(([k, l]) => <span key={k} className="row" style={{ gap: 4 }}><i className={`legend k-${k}`} />{tx(l)}</span>)}
      </div>
    </section>
  );
}

export default function Plans() {
  const { city } = useApp();
  const { data, error, loading, reload } = useApi('/plans', { poll: 15000 });
  const [view, setView] = useState(() => { try { return localStorage.getItem('sq_plans_view') || 'list'; } catch { return 'list'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('sq_plans_view', v); } catch { /* ignore */ } };
  const total = data ? SECTIONS.reduce((n, [k]) => n + data[k].length, 0) + (data.events?.length || 0) : 0;
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
      ) : (<>
        <div className="seg" role="group" aria-label={tx('View')}>
          <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => pickView('list')}><Icon name="list" size={16} />{tx('List')}</button>
          <button className={view === 'calendar' ? 'on' : ''} aria-pressed={view === 'calendar'} onClick={() => pickView('calendar')}><Icon name="calendar" size={16} />{tx('Calendar')}</button>
        </div>
        {view === 'calendar' ? <Calendar data={data} tz={city.timezone} /> : <>
        {data.events?.length > 0 && (
          <section className="stack-sm" aria-labelledby="pl-events">
            <h2 id="pl-events">{tx('Events you’re going to')} <span className="muted small">({data.events.length})</span></h2>
            {data.events.map((e) => (
              <a key={e.id} href={`#/event/${e.id}`} className="card card-pad row" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
                <Stamp category={e.category} />
                <span style={{ flex: 1, minWidth: 0 }}><strong>{e.title}</strong><span className="tiny muted" style={{ display: 'block' }}>{fmtWhen(e.starts_at, e.timezone)} · {e.venue}</span></span>
                <span className="badge badge-community"><Icon name="chat" size={12} />{e.chat_count}</span>
              </a>
            ))}
          </section>
        )}
        {SECTIONS.map(([k, label, hint]) => data[k].length > 0 && (
        <section key={k} className="stack" aria-labelledby={`pl-${k}`}>
          <div className="stack-sm">
            <h2 id={`pl-${k}`}>{t(label)} <span className="muted small">({data[k].length})</span></h2>
            {hint && <p className="small muted">{tx(hint)}</p>}
          </div>
          {data[k].map((a) => <ActivityCard key={a.id} a={a} />)}
        </section>
      ))}
      </>}
      </>)}
    </div>
  );
}
