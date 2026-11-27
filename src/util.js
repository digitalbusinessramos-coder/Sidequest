import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { getLanguage, locale, tx } from './i18n.js';

/** Format a UTC time in the activity's own time zone (e.g. Atlantic/Canary), whatever the viewer's device zone is. */
export function fmtWhen(iso, tz, { withDay = true } = {}) {
  const d = new Date(iso);
  const dayKey = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 864e5));
  const time = new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  if (!withDay) return time;
  const k = dayKey(d);
  const day = k === today ? tx('Today') : k === tomorrow ? tx('Tomorrow')
    : new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${day}, ${time}`;
}

export function fmtDuration(min) {
  if (min < 60) return `${min} min`; // same in English and Spanish
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtCost(eur) {
  if (!eur) return tx('Free');
  return tx('est. €{n} pp', { n: Number(eur).toFixed(eur % 1 ? 2 : 0) });
}

// ---------- plans: only what the creator said ----------
export const WINDOW_LABEL = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };
export const DURATION_LABEL = { hour: 'About an hour', few: 'A few hours', open: 'Open-ended' };

function dayLabel(iso, tz) {
  const dayKey = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const k = dayKey(new Date(iso));
  if (k === dayKey(new Date())) return tx('Today');
  if (k === dayKey(new Date(Date.now() + 864e5))) return tx('Tomorrow');
  return new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

/** "Sat 28 Nov, 18:00", "Sat 28 Nov, afternoon" or "Sat 28 Nov, time to be agreed". */
export function fmtPlanWhen(a) {
  if (a.day_mode && a.day_mode !== 'day') {
    const span = { weekend: tx('This weekend'), week: tx('This week'), flex: tx('Day to be agreed') }[a.day_mode] || tx('Day to be agreed');
    if (a.time_mode === 'window') return tx('{day}, {part}', { day: span, part: tx(WINDOW_LABEL[a.time_window] || '') });
    return a.day_mode === 'flex' ? tx('Day and time to be agreed') : tx('{day}, time to be agreed', { day: span });
  }
  if (a.time_mode === 'window') return tx('{day}, {part}', { day: dayLabel(a.starts_at, a.timezone), part: tx(WINDOW_LABEL[a.time_window] || '') });
  if (a.time_mode === 'tbd') return tx('{day}, time to be agreed', { day: dayLabel(a.starts_at, a.timezone) });
  return fmtWhen(a.starts_at, a.timezone);
}

/** Cost line, or null when the creator did not say. A historical 0 is not guessed to mean free. */
export function fmtPlanCost(a) {
  if (a.cost_mode === 'free') return tx('Free');
  if (a.cost_mode === 'estimate' && a.cost_eur > 0) return fmtCost(a.cost_eur);
  if (a.cost_mode === 'unknown') return tx('There’s a cost, amount unknown');
  return null;
}

/** Duration line, or null when skipped. Older plans still show their exact duration. */
export function fmtPlanDuration(a) {
  if (a.duration_choice) return tx(DURATION_LABEL[a.duration_choice]);
  if (a.time_mode === 'exact' && a.duration_min) return fmtDuration(a.duration_min);
  return null;
}

/** Places line, only when there is a real limit. */
export function fmtPlaces(a) {
  if (!a.capped || a.max_participants == null) return null;
  if (a.state === 'full') return tx('Full');
  if (a.spots_left == null) return null; // guests don't see how many are going
  return tx(a.spots_left === 1 ? '1 place left' : '{n} places left', { n: a.spots_left });
}

export function tzLabel(tz) {
  return tz === 'Atlantic/Canary' ? tx('Canary Islands time') : tz;
}

export function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString(locale(), { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Load data from the API with loading / error states, optional polling while the tab is visible. */
export function useApi(url, { poll = 0, deps = [] } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const latest = useRef(0); // only the newest request may update the screen (fast typing sends several)
  const load = useCallback(async (quiet = false) => {
    if (!url) return;
    const n = ++latest.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(url);
      if (alive.current && n === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (alive.current && n === latest.current) setState((s) => ({ data: quiet ? s.data : null, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => {
    alive.current = true;
    load();
    let id;
    if (poll) id = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, poll);
    return () => { alive.current = false; clearInterval(id); };
  }, [load, poll]);
  return { ...state, reload: load };
}

export function nearestArea(areas, lat, lng) {
  let best = null; let bestD = Infinity;
  for (const a of areas) {
    const d = (a.lat - lat) ** 2 + ((a.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

export function areaName(areas, key) {
  return areas?.find((a) => a.key === key)?.name || null;
}

/** Resize a picture in the browser so uploads stay small. square: centre-crop to a square (profile pictures). */
export function resizeToJpeg(file, max = 512, square = true) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sw = square ? Math.min(img.width, img.height) : img.width;
      const sh = square ? sw : img.height;
      const scale = Math.min(1, max / Math.max(sw, sh));
      const c = document.createElement('canvas'); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
      c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tx('That file does not look like a picture.'))); };
    img.src = url;
  });
}

export function fmtPrice(l) {
  if (l.kind === 'wanted') return tx('Wanted');
  if (l.kind === 'free' || l.price_eur === 0) return tx('Free');
  return l.price_eur == null ? '' : `${Number(l.price_eur).toLocaleString(locale(), { maximumFractionDigits: 2 })} €`;
}

// ---------- Buddies status and plan prefill ----------
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PART_TIME = { morning: '10:00', afternoon: '16:00', evening: '19:00' };

/** Local calendar date "YYYY-MM-DD" in tz, `plus` days from now. */
export function localDate(tz, plus = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + plus * 864e5));
}

/** Next date (today or later) for a slot like "fri_afternoon", as "YYYY-MM-DD" and "HH:mm" in tz. */
export function nextSlot(slot, tz) {
  const [d, part] = (slot || '').split('_');
  const time = PART_TIME[part] || '17:00';
  if (!WEEKDAYS.includes(d)) return null;
  const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  for (let i = 0; i < 8; i++) {
    const date = localDate(tz, i);
    const wd = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    if (wd === d && (i > 0 || hourNow < Number(time.slice(0, 2)) - 1)) return { date, time };
  }
  return null;
}

// Short, natural invite labels for each activity type.
export const INVITE_FOR = {
  coffee: 'Invite for coffee', museum: 'Invite to a museum', culture: 'Invite to a concert', hiking: 'Invite for a hike', beach: 'Invite to the beach',
  surf: 'Invite to surf', sports: 'Invite for sports', daytrip: 'Invite on a day trip', nightout: 'Invite for a night out', food: 'Invite for dinner',
  study: 'Invite to study', wellness: 'Invite for yoga', games: 'Invite for games', shopping: 'Invite to a market', photo: 'Invite on a photo walk', other: 'Invite',
};

/** Link into the normal Create form with the activity, the buddy, and (if they set it) their day and area filled in. */
export function inviteHref(person, templates) {
  const st = person.status;
  const cat = st?.category || person.shared?.[0] || person.interests?.[0] || 'other';
  const tpl = templates.find((x) => x.category === cat)?.key || 'other';
  const q = new URLSearchParams({ template: tpl, category: cat, invite: String(person.id) });
  if (st?.slot) q.set('slot', st.slot);
  if (st?.area) q.set('area', st.area);
  return `#/create?${q}`;
}


// ---------- real events ----------
/** Texts for the viewer's language. An unknown price is never shown as free. */
export function eventText(e) {
  const es = getLanguage() === 'es';
  return {
    description: (es && e.description_es) || e.description,
    price: (es && e.price_es) || e.price_note || (e.is_sample ? null : tx('Check with organiser')),
    note: (es ? e.note_es || e.note_en : e.note_en) || null,
  };
}

const dayFmt = (iso, tz) => new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

/** "Thu 19 Nov, 23:00 – 05:00 (next morning)", or "From Fri 4 Dec" when no time is published. */
export function fmtEventWhen(e, { withEnd = true } = {}) {
  if (e.time_known === false) return tx('From {date}', { date: dayFmt(e.starts_at, e.timezone) });
  const start = fmtWhen(e.starts_at, e.timezone);
  if (!withEnd || !e.duration_min) return start;
  const endIso = new Date(new Date(e.starts_at).getTime() + e.duration_min * 60e3).toISOString();
  const end = fmtWhen(endIso, e.timezone, { withDay: false });
  const dk = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: e.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
  return dk(endIso) !== dk(e.starts_at) ? `${start} – ${end} ${tx('(next morning)')}` : `${start} – ${end}`;
}

/** One card per listing: repeats (same series) collapse into the next date plus a count. */
export function collapseSeries(events) {
  const out = []; const seen = new Map();
  for (const e of events) {
    if (e.series_key && seen.has(e.series_key)) { seen.get(e.series_key).more += 1; continue; }
    const item = { e, more: 0 };
    if (e.series_key) seen.set(e.series_key, item);
    out.push(item);
  }
  return out;
}

export const fmtDay = dayFmt;
