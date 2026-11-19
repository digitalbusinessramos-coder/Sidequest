import { useMemo, useState } from 'react';
import { locale, tx } from '../i18n.js';
import { ErrorState, EventCard, Icon, Loading, TopBar, useApp } from '../components.jsx';
import { collapseSeries, useApi } from '../util.js';

/** Every upcoming event, grouped by month. Repeats of the same listing collapse into one card, so later dates are quick to reach. */
export default function Events() {
  const { city } = useApp();
  const { data, error, loading, reload } = useApi(`/events?city=${city.slug}&when=any`, { poll: 60000 });
  const [month, setMonth] = useState('all');
  const [expand, setExpand] = useState(false);

  const monthKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: city.timezone, year: 'numeric', month: '2-digit' }).format(new Date(iso));
  const monthName = (k) => new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${k}-15T12:00:00Z`));

  const events = data?.events || [];
  const months = useMemo(() => [...new Set(events.map((e) => monthKey(e.starts_at)))], [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = month === 'all' ? events : events.filter((e) => monthKey(e.starts_at) === month);
  const groups = useMemo(() => {
    const byMonth = new Map();
    // Within a month, repeats collapse unless the visitor asks for every date.
    for (const e of shown) { const k = monthKey(e.starts_at); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(e); }
    return [...byMonth.entries()].map(([k, list]) => [k, expand ? list.map((e) => ({ e, more: 0 })) : collapseSeries(list)]);
  }, [shown, expand]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TopBar title={tx('Events in Las Palmas')} />
      <div className="page">
        <div className="stack-sm">
          <span className="eyebrow">{tx('Run by outside organisers')}</span>
          <h1>{tx('Upcoming events')}</h1>
          <p className="small muted">{tx('Tickets and registration are with each organiser. Here you find someone to go with. Times are Canary Islands time.')}</p>
        </div>
        <div className="chips" role="group" aria-label={tx('Month')}>
          <button className="chip" aria-pressed={month === 'all'} onClick={() => setMonth('all')}>{tx('All upcoming')}</button>
          {months.map((k) => <button key={k} className="chip" aria-pressed={month === k} onClick={() => setMonth(k)}>{monthName(k)}</button>)}
        </div>
        <label className="check small" style={{ margin: 0 }}><input type="checkbox" checked={expand} onChange={(ev) => setExpand(ev.target.checked)} />{tx('Show every date of repeating events')}</label>
        {loading && !data ? <Loading rows={2} /> : error ? <ErrorState error={error} onRetry={reload} />
          : events.length === 0 ? <p className="small muted">{tx('No upcoming events listed.')}</p>
            : groups.map(([k, list]) => (
              <section key={k} className="stack" aria-labelledby={`m-${k}`}>
                <h2 id={`m-${k}`} className="month-h"><Icon name="plans" size={18} />{monthName(k)}</h2>
                <div className="card-list">{list.map(({ e, more }) => <EventCard key={e.id} e={e} more={more} />)}</div>
              </section>
            ))}
      </div>
    </>
  );
}
