import { useMemo, useState } from 'react';
import { t, tx } from '../i18n.js';
import { ActivityCard, ChoiceChips, Empty, ErrorState, EventCard, Icon, Loading, Sheet, useApp } from '../components.jsx';
import { areaName, useApi } from '../util.js';

const WHEN = ['any', 'today', 'tomorrow', 'week', 'weekend'];

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
  const { me, meta, city } = useApp();
  const [when, setWhen] = useState('any');
  const [quick, setQuick] = useState({ free: false, beginner: false, solo: false });
  const [more, setMore] = useState({ category: '', size: '', lang: '', budget: '', open: false });
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const params = new URLSearchParams({ city: city.slug, when });
  if (quick.free) params.set('budget', 'free');
  else if (more.budget) params.set('budget', more.budget);
  if (quick.beginner) params.set('beginner', '1');
  if (quick.solo) params.set('solo', '1');
  if (more.category) params.set('category', more.category);
  if (more.size) params.set('size', more.size);
  if (more.lang) params.set('lang', more.lang);
  if (more.open) params.set('open', '1');
  if (q.trim()) params.set('q', q.trim());
  const acts = useApi(`/activities?${params}`, { poll: 30000 });
  const evParams = new URLSearchParams({ city: city.slug, when });
  if (more.category) evParams.set('category', more.category);
  const evs = useApi(`/events?${evParams}`, { poll: 30000 });

  const moreCount = ['category', 'size', 'lang', 'budget'].filter((k) => more[k]).length + (more.open ? 1 : 0);
  const anyFilter = when !== 'any' || Object.values(quick).some(Boolean) || moreCount || q;
  const clear = () => { setWhen('any'); setQuick({ free: false, beginner: false, solo: false }); setMore({ category: '', size: '', lang: '', budget: '', open: false }); setQ(''); };
  const myArea = areaName(city.areas, me.area);
  const showEvents = !quick.solo && !quick.beginner && !quick.free && !more.size && !more.lang && !more.open && !q;

  const list = acts.data?.activities || [];
  const sorted = useMemo(() => list, [list]);

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">{t('explore.eyebrow')}</span>
        <h1 style={{ marginTop: 6 }}>{t('explore.title')}</h1>
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="sr-only" htmlFor="q">{t('explore.search')}</label>
          <input id="q" type="search" placeholder={tx("Surf, museum, coffee…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </section>

      <div className="stack-sm">
        <div className="chips" role="group" aria-label={tx("When")}>
          {WHEN.map((w) => (
            <button key={w} className="chip" aria-pressed={when === w} onClick={() => setWhen(w)}>{t(`when.${w}`)}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label={tx("Quick filters")}>
          <button className="chip" aria-pressed={showFilters || moreCount > 0} onClick={() => setShowFilters(true)}>
            <Icon name="filter" size={16} />{t('explore.moreFilters')}{moreCount > 0 && ` (${moreCount})`}
          </button>
          {[['free', 'filter.free'], ['beginner', 'filter.beginner'], ['solo', 'filter.solo']].map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={quick[k]} onClick={() => setQuick({ ...quick, [k]: !quick[k] })}>{t(label)}</button>
          ))}
        </div>
      </div>

      {showEvents && (
        <section className="stack" aria-labelledby="ev-h">
          <div className="stack-sm">
            <h2 id="ev-h">{t('explore.events')}</h2>
            <p className="small muted">{t('explore.eventsHint')}</p>
          </div>
          {evs.loading && !evs.data ? <Loading rows={1} /> : evs.error ? <ErrorState error={evs.error} onRetry={evs.reload} />
            : evs.data.events.length === 0 ? <p className="small muted">{tx("No upcoming events listed for this time.")}</p>
              : evs.data.events.slice(0, 3).map((e) => <EventCard key={e.id} e={e} />)}
        </section>
      )}

      <section className="stack" aria-labelledby="act-h">
        <div className="section-title">
          <h2 id="act-h">{t('explore.activities')}</h2>
          {acts.data && <span className="small muted">{sorted.length} found</span>}
        </div>
        {acts.loading && !acts.data ? <Loading /> : acts.error ? <ErrorState error={acts.error} onRetry={acts.reload} />
          : sorted.length === 0 ? (
            <Empty icon="search" title={t('explore.noResults')} hint={t('explore.noResultsHint')}>
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                {anyFilter && <button className="btn btn-secondary btn-sm" onClick={clear}>{t('explore.clear')}</button>}
                <a className="btn btn-primary btn-sm" href="#/create">{tx("Create a plan")}</a>
              </div>
            </Empty>
          ) : sorted.map((a) => <ActivityCard key={a.id} a={a} reason={a.my_status ? null : reasonFor(a, me, myArea)} />)}
      </section>

      <a href="#/create" className="btn btn-primary fab"><Icon name="plus" />{t('explore.create')}</a>

      {showFilters && (
        <Sheet title={t('explore.moreFilters')} onClose={() => setShowFilters(false)}>
          <div className="field"><span className="label">{tx("Activity")}</span>
            <ChoiceChips label={tx("Activity")} value={more.category} onChange={(category) => setMore({ ...more, category })} options={meta.categories.map((c) => ({ key: c.key, label: c.label }))} />
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
