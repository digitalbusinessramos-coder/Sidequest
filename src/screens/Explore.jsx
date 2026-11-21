import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { t, tx } from '../i18n.js';
import { InstallNudge, installContext } from './Install.jsx';
import { NotifyNudge } from './Notify.jsx';
import { ActivityCard, ChoiceChips, Empty, ErrorState, EventCard, Icon, Loading, PeopleStrip, PhotoHero, Sheet, useApp } from '../components.jsx';

const MapView = lazy(() => import('../MapView.jsx'));
const HERO = ['canteras', 'vegueta', 'cathedral', 'auditorio', 'roque', 'dunes'];
import { areaName, collapseSeries, fmtPlaces, fmtPlanWhen, useApi } from '../util.js';

const WHEN = ['any', 'weekend', 'today', 'tomorrow', 'week'];

/** Plain-language reason why a card might suit the viewer. Simple rules, no scores. */
function reasonFor(a, me, myAreaName) {
  const interest = me.interests?.includes(a.category);
  const area = myAreaName && a.meeting_area === myAreaName;
  // Language alone is too common to be a useful reason; show it only alongside an interest or area match.
  if (!interest && !area) return null;
  const bits = [];
  if (interest) bits.push(tx('matches your interests'));
  const shared = (a.languages || []).filter((l) => me.languages?.includes(l));
  if (shared.length) bits.push(tx('in {langs}', { langs: shared.slice(0, 2).map((l) => tx(l)).join(tx(' or ')) }));
  if (area) bits.push(tx('in your area'));
  const out = bits.join(', ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export default function Explore() {
  const { me, meta, city, openTour } = useApp();
  const [newHere, setNewHere] = useState(() => { try { return localStorage.getItem('sq_tour_done') !== '1'; } catch { return false; } });
  const hideNewHere = () => { setNewHere(false); try { localStorage.setItem('sq_tour_done', '1'); } catch { /* ignore */ } };
  const [when, setWhen] = useState('any');
  const [quick, setQuick] = useState({ free: false, beginner: false });
  const [more, setMore] = useState({ category: '', size: '', lang: '', budget: '', open: false });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // search text, sent to the server after a short pause
  useEffect(() => { const id = setTimeout(() => setDq(q), 300); return () => clearTimeout(id); }, [q]);
  const [view, setView] = useState(() => { try { return localStorage.getItem('sq_explore_view') || 'list'; } catch { return 'list'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('sq_explore_view', v); } catch { /* ignore */ } };
  const [showTips, setShowTips] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const params = new URLSearchParams({ city: city.slug, when });
  if (quick.free) params.set('budget', 'free');
  else if (more.budget) params.set('budget', more.budget);
  if (quick.beginner) params.set('beginner', '1');
  if (more.category) params.set('category', more.category);
  if (more.size) params.set('size', more.size);
  if (more.lang) params.set('lang', more.lang);
  if (more.open) params.set('open', '1');
  if (dq.trim()) params.set('q', dq.trim());
  const acts = useApi(`/activities?${params}`, { poll: 30000 });
  const evParams = new URLSearchParams({ city: city.slug, when });
  if (more.category) evParams.set('category', more.category);
  const evs = useApi(`/events?${evParams}`, { poll: 30000 });

  const moreCount = ['category', 'size', 'lang', 'budget'].filter((k) => more[k]).length + (more.open ? 1 : 0);
  const anyFilter = when !== 'any' || Object.values(quick).some(Boolean) || moreCount || q;
  const clear = () => { setWhen('any'); setQuick({ free: false, beginner: false }); setMore({ category: '', size: '', lang: '', budget: '', open: false }); setQ(''); };
  const myArea = areaName(city.areas, me.area);
  const showEvents = !quick.beginner && !quick.free && !more.size && !more.lang && !more.open && !dq;

  const list = acts.data?.activities || [];
  const sorted = useMemo(() => list, [list]);
  const tips = useApi(view === 'map' && showTips ? `/recommendations?city=${city.slug}` : null);
  const mapItems = useMemo(() => {
    const out = [];
    for (const a of sorted) if (a.approx) out.push({ key: `a${a.id}`, kind: 'activity', lat: a.approx.lat, lng: a.approx.lng, title: a.title, sub: [a.meeting_area, fmtPlanWhen(a), fmtPlaces(a)].filter(Boolean).join(' · '), href: `#/activity/${a.id}`, category: a.category });
    if (showEvents) for (const e of evs.data?.events || []) if (e.approx) out.push({ key: `e${e.id}`, kind: 'event', lat: e.approx.lat, lng: e.approx.lng, title: e.title, sub: e.venue, href: `#/event/${e.id}`, category: e.category });
    if (showTips) for (const r of tips.data?.recommendations || []) if (r.approx) out.push({ key: `t${r.id}`, kind: 'tip', lat: r.approx.lat, lng: r.approx.lng, title: r.title, sub: tx('Tip from {name} · {n} likes', { name: r.author.first_name, n: r.likes }), href: '#/guide', category: 'other' });
    return out;
  }, [sorted, evs.data, tips.data, showEvents, showTips]);
  const heroKey = HERO[new Date().getDate() % HERO.length];
  const people = useApi('/people');

  return (
    <div className="page">
      <PhotoHero photoKey={heroKey} height={120} className="hero-compact">
        <div className="row hero-row">
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">{t('explore.eyebrow')}</span>
            <h1>{t('explore.title')}</h1>
          </div>
          <span className="spacer" />
          <a className="btn btn-sm hero-help" href="#/help" aria-label={tx('Help')}><Icon name="info" size={15} /><span className="hide-narrow">{tx('How it works')}</span></a>
        </div>
      </PhotoHero>

      {newHere && (
        <div className="card card-pad row new-here" role="region" aria-label={tx('New here?')}>
          <Icon name="info" />
          <div className="new-here-text"><strong>{tx('New here?')}</strong> <span className="small muted">{tx('See how it works in 4 quick steps.')}</span></div>
          <button className="btn btn-primary btn-sm" onClick={() => { hideNewHere(); openTour(); }}>{tx('Take the tour')}</button>
          <button className="icon-btn" onClick={hideNewHere} aria-label={tx('Close')}><Icon name="x" size={16} /></button>
        </div>
      )}

      {/* One small card at a time: install first on phones (it brings notifications on iPhone too), then notifications. */}
      {!newHere && (installContext().mobile && !installContext().standalone ? <InstallNudge /> : <NotifyNudge />)}

      <div className="explore-tools">
        <div className="row tools-row tools-top">
          <form className="search" role="search" data-tour="search" onSubmit={(e) => e.preventDefault()}>
            <label className="sr-only" htmlFor="q">{t('explore.search')}</label>
            <input id="q" type="search" placeholder={tx("Surf, night out, coffee…")} value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="seg" role="group" data-tour="view-toggle" aria-label={tx('View')}>
            <button className={view === 'list' ? 'on' : ''} aria-label={tx('List')} aria-pressed={view === 'list'} onClick={() => pickView('list')}><Icon name="list" size={16} /><span className="seg-label">{tx('List')}</span></button>
            <button className={view === 'map' ? 'on' : ''} aria-label={tx('Map')} aria-pressed={view === 'map'} onClick={() => pickView('map')}><Icon name="map" size={16} /><span className="seg-label">{tx('Map')}</span></button>
          </div>
        </div>
        <div className="row wrap tools-row">
          <div className="chips" role="group" aria-label={tx("When")}>
            {WHEN.map((w) => (
              <button key={w} className={`chip ${w === 'weekend' ? 'chip-weekend' : ''}`} aria-pressed={when === w} onClick={() => setWhen(w)}>{w === 'weekend' && <Icon name="beach" size={15} />}{t(`when.${w}`)}</button>
            ))}
          </div>
          <div className="chips" role="group" aria-label={tx("Quick filters")}>
            {[['free', 'filter.free'], ['beginner', 'filter.beginner']].map(([k, label]) => (
              <button key={k} className="chip" aria-pressed={quick[k]} onClick={() => setQuick({ ...quick, [k]: !quick[k] })}>{t(label)}</button>
            ))}
            <button className="chip" aria-pressed={showFilters || moreCount > 0} onClick={() => setShowFilters(true)}>
              <Icon name="filter" size={16} />{t('explore.moreFilters')}{moreCount > 0 && ` (${moreCount})`}
            </button>
          </div>
        </div>
        {view === 'map' && <label className="check small" style={{ margin: 0 }}><input type="checkbox" checked={showTips} onChange={(e) => setShowTips(e.target.checked)} />{tx('Show student tips')}</label>}
      </div>

      {view === 'map' && (
        <Suspense fallback={<Loading rows={2} />}>
          <MapView items={mapItems} center={[28.12, -15.43]} height={window.innerWidth >= 1000 ? 620 : 460} />
        </Suspense>
      )}

      {view === 'list' && <section className="stack" aria-labelledby="act-h" data-tour="plans-list">
        <div className="section-title">
          <h2 id="act-h">{t('explore.activities')}</h2>
          {acts.data && <span className="small muted">{tx('{n} found', { n: sorted.length })}</span>}
        </div>
        {acts.loading && !acts.data ? <Loading /> : acts.error ? <ErrorState error={acts.error} onRetry={acts.reload} />
          : sorted.length === 0 ? (
            <Empty icon="search" title={anyFilter ? t('explore.noResults') : tx('No upcoming plans yet')} hint={anyFilter ? t('explore.noResultsHint') : tx('Be the first: post what you feel like doing and people can join you.')}>
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                {anyFilter && <button className="btn btn-primary btn-sm" onClick={clear}>{tx('See all upcoming plans')}</button>}
                <a className={`btn btn-sm ${anyFilter ? 'btn-secondary' : 'btn-primary'}`} href="#/create">{tx("Create a plan")}</a>
              </div>
            </Empty>
          ) : <div className="card-list">{sorted.map((a) => <ActivityCard key={a.id} a={a} reason={a.my_status ? null : reasonFor(a, me, myArea)} />)}</div>}
      </section>}

      {view === 'list' && people.data?.people.length > 0 && (
        <section className="stack-sm" aria-labelledby="ppl-h" data-tour="people">
          <div className="section-title"><h2 id="ppl-h">{tx('Students in {city}', { city: 'Las Palmas' })}</h2><a className="small" href="#/buddies">{tx('See all')}</a></div>
          <PeopleStrip people={people.data.people.slice(0, 10)} />
        </section>
      )}

      {view === 'list' && showEvents && (
        <section className="stack" aria-labelledby="ev-h" data-tour="events">
          <div className="stack-sm">
            <div className="section-title"><h2 id="ev-h">{t('explore.events')}</h2><a className="small" href="#/events">{tx('See all')}</a></div>
            <p className="small muted">{t('explore.eventsHint')}</p>
          </div>
          {evs.loading && !evs.data ? <Loading rows={1} /> : evs.error ? <ErrorState error={evs.error} onRetry={evs.reload} />
            : evs.data.events.length === 0 ? <p className="small muted">{tx("No upcoming events listed for this time.")}</p>
              : <div className="card-list">{collapseSeries(evs.data.events).slice(0, 4).map(({ e, more }) => <EventCard key={e.id} e={e} more={more} />)}</div>}
          <a className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} href="#/events"><Icon name="plans" size={16} />{tx('All upcoming events, by month')}</a>
        </section>
      )}


      <a href="#/create" className="btn btn-primary fab" data-tour="create"><Icon name="plus" />{t('explore.create')}</a>

      {showFilters && (
        <Sheet title={t('explore.moreFilters')} onClose={() => setShowFilters(false)}>
          <div className="field"><span className="label">{tx("Activity")}</span>
            <ChoiceChips label={tx("Activity")} value={more.category} onChange={(category) => setMore({ ...more, category })} options={meta.categories.filter((c) => c.key !== 'other').map((c) => ({ key: c.key, label: c.label }))} />
          </div>
          <div className="field"><span className="label">{tx("Budget per person")}</span>
            <ChoiceChips label={tx("Budget")} value={more.budget} onChange={(budget) => setMore({ ...more, budget })} options={meta.budgets} />
          </div>
          <div className="field"><span className="label">{tx("Group size")}</span>
            <ChoiceChips label={tx("Group size")} value={more.size} onChange={(size) => setMore({ ...more, size })}
              options={[{ key: 'buddy', label: tx("One buddy") }, { key: 'small', label: tx("Small group (3–5)") }, { key: 'group', label: tx("Bigger group (6+)") }]} />
          </div>
          <label className="field"><span>{tx("Language")}</span>
            <select className="select" value={more.lang} onChange={(e) => setMore({ ...more, lang: e.target.value })}>
              <option value="">{tx("Any language")}</option>
              {meta.languages.map((l) => <option key={l} value={l}>{tx(l)}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={more.open} onChange={(e) => setMore({ ...more, open: e.target.checked })} />{tx("Only show activities with free places")}</label>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setMore({ category: '', size: '', lang: '', budget: '', open: false })}>{tx("Reset")}</button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => setShowFilters(false)}>{tx("Show results")}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
