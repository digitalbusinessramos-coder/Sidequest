import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { LANGUAGE_OPTIONS, t, tx } from './i18n.js';
import { fmtCost, fmtWhen } from './util.js';
import { PHOTOS, photo, photoFor } from '../shared/photos.js';
import { categoryLabel } from '../shared/catalog.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ---------- icons (simple stroke icons, 24px grid) ----------
export const P = {
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5 5.5-2 5-5 2 2-5 5-2Z',
  buddies: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .6 3.5 2.9 3.5 6',
  plans: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12ZM4 10h16M8 3v4M16 3v4M8 14h3',
  guide: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-7 7-7s7 3.1 7 7',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  euro: 'M17 6.5A6.5 6.5 0 1 0 17 17.5M4 10h9M4 14h9',
  group: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5m0-5.3c.6-.1 1.3-.2 2-.2 3.3 0 6 2.5 6 5.5',
  chat: 'M4 5h16v11H9l-5 4V5Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v5m0-8.5v.5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z',
  sprout: 'M12 21v-9m0 0C12 7 8 4 4 4c0 5 3.5 8 8 8Zm0 0c0-4 3-7 8-7 0 4.5-3.5 7-8 7Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  send: 'M4 12l16-8-6 16-3-7-7-1Z',
  heart: 'M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11Z',
  bus: 'M6 4h12a2 2 0 0 1 2 2v10H4V6a2 2 0 0 1 2-2Zm-2 8h16M7 19v-3m10 3v-3M7.5 14h.01M16.5 14h.01',
  home: 'M4 11l8-7 8 7v9H4v-9Zm6 9v-5h4v5',
  health: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v8m-4-4h8',
  school: 'M3 9l9-5 9 5-9 5-9-5Zm4 2.5V16c1.5 1.5 3 2 5 2s3.5-.5 5-2v-4.5',
  star: 'M12 4l2.5 5.2 5.5.6-4.1 3.8 1.2 5.4L12 16.3 6.9 19l1.2-5.4L4 9.8l5.5-.6L12 4Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  // categories
  coffee: 'M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Zm11 1h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2m3-2v2',
  museum: 'M3 9l9-5 9 5H3Zm2 0v9m4-9v9m6-9v9m4-9v9M3 20h18',
  culture: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  hiking: 'M3 20l6-10 4 6 3-4 5 8H3ZM15 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  beach: 'M4 18h16M6 18a6 6 0 0 1 12 0M12 8V4M5.6 9.6 4 8m14.4 1.6L20 8M3 21h18',
  surf: 'M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M17 4c-4 1-7 5-8 9',
  sports: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-6.4 2.6C9 8 10 12 9.5 20.6M18.4 5.6C15 8 14 12 14.5 20.6M3 12c5-1.5 13-1.5 18 0',
  daytrip: 'M4 19h16M6 19V9l6-5 6 5v10M10 19v-5h4v5',
  study: 'M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4V5Zm16 0h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7V5Z',
  nightout: 'M8 3h8l-4 7-4-7Zm4 7v7m-4 3h8M18.5 4.5a3 3 0 1 0 2 5.2 3.6 3.6 0 0 1-2-5.2Z',
  food: 'M7 3v8m-2.5-8v4.5a2.5 2.5 0 0 0 5 0V3M7 11v10m10-18c-2 0-3 2.5-3 6s1 4 3 4v8',
  wellness: 'M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-7 6c2 0 4.5-1 7-1s5 1 7 1M12 11v4m-5 6 5-6 5 6',
  games: 'M6 9h12a3 3 0 0 1 3 3v3a3 3 0 0 1-5.4 1.8L14 15h-4l-1.6 1.8A3 3 0 0 1 3 15v-3a3 3 0 0 1 3-3Zm2 2v3m-1.5-1.5h3M15.5 12h.01M17.5 14h.01',
  shopping: 'M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2',
  photo: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12ZM4 10h16M8 3v4M16 3v4',
  bookmark: 'M6 4h12v17l-6-4-6 4V4Z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  bolt: 'M13 3 5 13h6l-1 8 8-10h-6l1-8Z',
  other: 'M12 4l2 5 5 .5-3.8 3.4 1.1 5.1L12 15.5 7.7 18l1.1-5.1L5 9.5l5-.5 2-5Z',
};

export function Icon({ name, size = 20, label, className, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} className={className} style={style}>
      <path d={P[name] || P.other} />
    </svg>
  );
}

export const CAT_COLOR = {
  coffee: '#a8321f', museum: '#1a2fd0', culture: '#7a2fb0', hiking: '#3a6b00', beach: '#a35400',
  surf: '#0f6a8a', sports: '#1a2fd0', daytrip: '#3a5200', study: '#4a4f61', other: '#4a4f61',
  nightout: '#6b21a8', food: '#a8321f', wellness: '#0f6a5a', games: '#9a3412', shopping: '#a35400', photo: '#1e3a8a',
};
export function Stamp({ category, size }) {
  return (
    <span className={`stamp ${size || ''}`} style={{ color: CAT_COLOR[category] || CAT_COLOR.other }} aria-hidden="true">
      <Icon name={category} />
    </span>
  );
}

export function Avatar({ person, size = '' }) {
  const hue = person?.avatar_hue ?? 220;
  if (person?.photo) return <img className={`avatar photo ${size}`} src={person.photo} alt="" loading="lazy" />;
  return (
    <span className={`avatar ${size}`} style={{ background: `hsl(${hue} 55% 38%)` }} aria-hidden="true">
      {(person?.first_name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A Las Palmas photo with a readable overlay and its required credit line. */
export function PhotoHero({ photoKey, children, height = 200 }) {
  const ph = PHOTOS.find((p) => p.key === photoKey) || PHOTOS[0];
  return (
    <figure className="photo-hero" style={{ minHeight: height }}>
      <img src={ph.src} alt={tx(ph.alt)} loading="lazy" />
      <div className="photo-hero-body">{children}</div>
      <figcaption className="photo-credit">
        {tx(ph.alt)} · {tx('Photo')}: {ph.author}, <a href={ph.license_url} target="_blank" rel="noopener noreferrer">{ph.license}</a>, <a href={ph.source} target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>
      </figcaption>
    </figure>
  );
}

/** Photo strip on top of a card, with the category stamp on it. Decorative: the card text says everything. */
export function CardCover({ ph, category }) {
  return (
    <div className="card-cover" aria-hidden="true">
      {ph && <img src={ph.src} alt="" loading="lazy" />}
      <Stamp category={category} />
    </div>
  );
}

/** Wide photo at the top of a detail page, with its credit. */
export function DetailPhoto({ ph }) {
  if (!ph) return null;
  return (
    <figure className="detail-photo">
      <img src={ph.src} alt={tx(ph.alt)} />
      <figcaption className="photo-credit">{tx(ph.alt)} · {tx('Photo')}: {ph.author}, <a href={ph.license_url} target="_blank" rel="noopener noreferrer">{ph.license}</a></figcaption>
    </figure>
  );
}

/** Horizontal row of students, used on Explore and Buddies. */
export function PeopleStrip({ people }) {
  return (
    <ul className="people-strip">
      {people.map((p) => (
        <li key={p.id}>
          <a href={`#/person/${p.id}`} className="person-chip">
            <Avatar person={p} size="lg" />
            <strong>{p.first_name}</strong>
            <span className="tiny muted">{p.shared?.length ? tx('Also into {what}', { what: tx(categoryLabel(p.shared[0])).toLowerCase() }) : (p.area || '').split(' / ')[0]}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Google Maps view of a public place or neighbourhood (never a private address), plus a link to open it in Google Maps. */
export function GoogleMap({ query, title, note }) {
  const q = `${query}, Las Palmas de Gran Canaria`;
  return (
    <div className="gmap card">
      <iframe title={title || tx('Map')} src={`https://www.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <div className="row wrap gmap-foot">
        {note && <span className="tiny muted" style={{ flex: 1 }}>{note}</span>}
        <a className="btn btn-secondary btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer"><Icon name="map" size={15} />{tx('Open in Google Maps')}</a>
      </div>
    </div>
  );
}

export function SampleBadge() {
  return <span className="badge badge-sample" title={tx("Example content for this preview")}>{t('common.sample')}</span>;
}

export function StatusBadge({ status }) {
  if (!status) return null;
  const map = { organiser: 'org', accepted: 'confirmed', pending: 'pending', invited: 'invited', cancelled: 'cancelled', past: 'past', full: 'full', left: 'past', removed: 'past', declined: 'past' };
  return (
    <span className={`badge badge-${map[status] || 'past'}`}>
      {status === 'accepted' && <Icon name="check" size={13} />}
      {status === 'pending' && <Icon name="clock" size={13} />}
      {t(`status.${status}`)}
    </span>
  );
}

export function Spots({ going, max }) {
  if (max > 10) return null;
  return (
    <span className="spots" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < going ? 'on' : ''} />)}
    </span>
  );
}

/** Activity card: what, when, cost, places, group preferences, solo format, and the viewer's status. */
export function ActivityCard({ a, reason }) {
  const cls = a.state === 'cancelled' ? 'is-cancelled' : a.state === 'past' ? 'is-past' : '';
  const status = a.state === 'cancelled' || a.state === 'past' ? a.state : a.my_status;
  return (
    <a href={`#/activity/${a.id}`} className={`card act-card has-cover ${cls}`} aria-label={`${a.title}, ${fmtWhen(a.starts_at, a.timezone)}`}>
      <CardCover ph={photoFor(a.category)} category={a.category} />
      <div className="stack-sm" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="when">{fmtWhen(a.starts_at, a.timezone)}</span>
          <span className="spacer" />
          {a.is_sample && <SampleBadge />}
          {status && <StatusBadge status={status} />}
          {!status && a.state === 'full' && <StatusBadge status="full" />}
        </div>
        <div className="title">{a.title}</div>
        <div className="facts">
          <span><Icon name="pin" size={15} />{a.meeting_area}</span>
          <span><Icon name="euro" size={15} />{fmtCost(a.cost_eur)}</span>
          {a.languages?.length > 0 && <span><Icon name="globe" size={15} />{a.languages.slice(0, 3).map((l) => tx(l)).join(', ')}</span>}
        </div>
        <div className="row wrap ticket-edge" style={{ gap: 8 }}>
          <Spots going={a.going} max={a.max_participants} />
          <span className="small" style={{ fontWeight: 650 }}>
            {a.state === 'full' ? t('card.full') : a.max_participants === 2 ? tx("One buddy") : t('card.spots', { n: a.spots_left, max: a.max_participants })}
          </span>
          {a.solo_format && <span className="badge badge-solo">{t('card.solo')}</span>}
          {a.join_mode === 'open' && <span className="badge badge-open"><Icon name="bolt" size={12} />{tx('Join directly')}</span>}
          {a.beginner_friendly && <span className="badge badge-official" style={{ background: 'var(--paper-2)', color: 'var(--ink-2)' }}>{tx("Beginners welcome")}</span>}
          {a.unread > 0 && <span className="badge badge-invited"><Icon name="chat" size={13} />{tx(a.unread === 1 ? '1 new message' : '{n} new messages', { n: a.unread })}</span>}
          {a.organiser?.id && a.my_status === 'organiser' && a.pending_count > 0 && (
            <span className="badge badge-cancelled">{tx('{n} to review', { n: a.pending_count })}</span>
          )}
        </div>
        {reason && <span className="reason">{reason}</span>}
      </div>
    </a>
  );
}

export function EventCard({ e }) {
  return (
    <a href={`#/event/${e.id}`} className="card act-card has-cover">
      <CardCover ph={(e.photo_key && photo(e.photo_key)) || photoFor(e.category)} category={e.category} />
      <div className="stack-sm" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="when">{fmtWhen(e.starts_at, e.timezone)}</span>
          <span className="spacer" />
          {e.is_sample && <SampleBadge />}
          {e.i_am_seeking && <span className="badge badge-invited">{tx("You’re looking")}</span>}
        </div>
        <div className="title">{e.title}</div>
        <div className="facts">
          <span><Icon name="pin" size={15} />{e.venue}</span>
          <span><Icon name="flag" size={15} />{e.organiser_name.split(' (')[0]}</span>
        </div>
        <div className="row ticket-edge small" style={{ fontWeight: 650, color: e.seeking_count ? 'var(--lime-ink)' : 'var(--ink-3)' }}>
          <Icon name="group" size={16} />
          {e.seeking_count ? t('card.seeking', { n: e.seeking_count }) : tx("Be the first to look for company")}
        </div>
      </div>
    </a>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty" role="alert">
      <span className="stamp" style={{ color: 'var(--coral-ink)' }}><Icon name="info" /></span>
      <h3>{error?.status === 404 ? tx("Not found") : error?.code === 'offline' ? tx("You seem to be offline") : t('common.error')}</h3>
      <p className="muted small">{tx(error?.message || '')}</p>
      {onRetry && <button className="btn btn-secondary btn-sm" onClick={() => onRetry()}>{t('common.retry')}</button>}
    </div>
  );
}

export function Empty({ icon = 'other', title, hint, children }) {
  return (
    <div className="empty">
      <span className="stamp"><Icon name={icon} /></span>
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </div>
  );
}

export function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row">
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TopBar({ title, back = true, children }) {
  return (
    <header className="topbar">
      {back && (
        <button className="icon-btn" onClick={() => (history.length > 1 ? history.back() : (location.hash = '#/explore'))} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
      )}
      <span className="tb-title">{title}</span>
      {children}
    </header>
  );
}

export function ChoiceChips({ options, value, onChange, multiple = false, label }) {
  const isOn = (k) => (multiple ? value.includes(k) : value === k);
  const toggle = (k) => {
    if (!multiple) return onChange(value === k ? '' : k);
    onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  };
  return (
    <div className="choice-grid" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className="chip" aria-pressed={isOn(o.key)} onClick={() => toggle(o.key)}>
          {isOn(o.key) && multiple && <Icon name="check" size={15} />}{tx(o.label)}
        </button>
      ))}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  const node = toast ? <div className={`toast ${toast.error ? 'error' : ''}`} role="status" aria-live="polite">{toast.text}</div> : null;
  return [node, (text, error = false) => setToast({ text: tx(text), error, k: Math.random() })];
}

export function ReportSheet({ target, onClose }) {
  const { meta, api, toast } = useApp();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.post('/reports', { target_type: target.type, target_id: target.id, reason, details });
      toast(t('report.sent'));
      onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={t('report.title')} onClose={onClose}>
      <form className="stack" onSubmit={send}>
        <div className="notice coral"><Icon name="shield" />{t('report.note')}</div>
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>{t('report.reason')}</legend>
          {meta.reportReasons.map((r) => (
            <label key={r} className="check"><input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />{tx(r)}</label>
          ))}
        </fieldset>
        <label className="field"><span>{t('report.details')}</span>
          <textarea className="textarea" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        {err && <div className="form-error" role="alert">{tx(err)}</div>}
        <button className="btn btn-primary btn-block" disabled={!reason || busy}>{t('report.send')}</button>
        <p className="tiny muted">{tx("Reports are stored for review by the app team. In this student prototype there is no moderation team yet.")}</p>
      </form>
    </Sheet>
  );
}

export function LanguageSwitch() {
  const { lang, changeLanguage } = useApp();
  return (
    <div className="row" role="group" aria-label="Language / Idioma" style={{ gap: 6 }}>
      <Icon name="globe" size={18} />
      {LANGUAGE_OPTIONS.map((o) => (
        <button key={o.key} type="button" className="chip" lang={o.key} aria-pressed={lang === o.key} onClick={() => changeLanguage(o.key)} style={{ minHeight: 36 }}>{o.label}</button>
      ))}
    </div>
  );
}

export function EmailBadge() {
  return (
    <span className="badge badge-community" title={tx('They confirmed they can receive email at the address they signed up with. Student status is not verified.')}>
      <Icon name="check" size={13} />{tx('Email confirmed')}
    </span>
  );
}
