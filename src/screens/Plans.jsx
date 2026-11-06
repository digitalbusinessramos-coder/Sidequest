import { t } from '../i18n.js';
import { ActivityCard, Empty, ErrorState, Icon, Loading } from '../components.jsx';
import { useApi } from '../util.js';

const SECTIONS = [
  ['invited', 'plans.invited', 'Someone invited you. You decide.'],
  ['organising', 'plans.organising', null],
  ['confirmed', 'plans.confirmed', 'You’re going. Open a plan for the meet-up card and chat.'],
  ['waiting', 'plans.waiting', 'Not confirmed yet. The organiser still has to accept.'],
  ['history', 'plans.history', null],
];

export default function Plans() {
  const { data, error, loading, reload } = useApi('/plans', { poll: 15000 });
  const total = data ? SECTIONS.reduce((n, [k]) => n + data[k].length, 0) : 0;
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack-sm"><span className="eyebrow">Your week</span><h1>{t('plans.title')}</h1></div>
        <a className="btn btn-primary btn-sm" href="#/create"><Icon name="plus" size={16} />New plan</a>
      </div>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : total === 0 ? (
        <Empty icon="plans" title={t('plans.empty')} hint={t('plans.emptyHint')}>
          <a className="btn btn-primary btn-sm" href="#/explore">Go to Explore</a>
        </Empty>
      ) : SECTIONS.map(([k, label, hint]) => data[k].length > 0 && (
        <section key={k} className="stack" aria-labelledby={`pl-${k}`}>
          <div className="stack-sm">
            <h2 id={`pl-${k}`}>{t(label)} <span className="muted small">({data[k].length})</span></h2>
            {hint && <p className="small muted">{hint}</p>}
          </div>
          {data[k].map((a) => <ActivityCard key={a.id} a={a} />)}
        </section>
      ))}
    </div>
  );
}
