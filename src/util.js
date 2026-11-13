import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { locale, tx } from './i18n.js';

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
