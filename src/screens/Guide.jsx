import { getAppName, locale, t, tx } from '../i18n.js';
import { ErrorState, Icon, Loading, PhotoHero, useApp } from '../components.jsx';
import Tips from './Tips.jsx';
import { AskStudents } from './Ask.jsx';
import { FeedbackSheet } from './Market.jsx';
import { useState } from 'react';
import { MARKET_PHOTOS, PHOTOS } from '../../shared/photos.js';
import { useApi } from '../util.js';

// Plain-text names and our own one-line descriptions, checked against each organisation's own page on 21 Nov 2026. No logos.
// "Organised by" names who runs it; each card links to that organisation's own page.
const COMMUNITIES = [
  { name: 'ULPGC Buddy Programme', by: 'ESN Las Palmas, funded by ULPGC', url: 'https://esnlaspalmas.org/buddy-program',
    text: 'Pairs incoming exchange students at ULPGC with a local student volunteer who helps during the first weeks. ESN Las Palmas also runs events and the ESNcard.' },
  { name: 'Erasmus Life Las Palmas', by: 'International Students Life Association', url: 'https://internationalstudentslife.org/erasmus-life-las-palmas/',
    text: 'A separate student community with WhatsApp groups, weekly social events, trips around the island and member discounts.' },
];

// Sections, in order. Health, insurance and emergency cards were removed: Help has one short emergencies note.
const SECTIONS = [['transport', 'bus'], ['housing', 'home'], ['university', 'school'], ['links', 'link']];
const checked = (d) => new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

export default function Guide() {
  const { city } = useApp();
  const [fb, setFb] = useState(false);
  const { data, error, loading, reload } = useApi(`/guide?city=${city.slug}`);
  return (
    <div className="page">
      <PhotoHero photoKey="cathedral" height={170}>
        <span className="eyebrow">{tx("Settling in")}</span><h1>{t('guide.title')}: {city.name.split(' de ')[0]}</h1>
      </PhotoHero>
      <p className="small muted">{t('guide.lead')}</p>
      <a className="small row" style={{ gap: 6, alignSelf: 'flex-start' }} href="#/help"><Icon name="shield" size={16} />{tx('Help and emergencies')}</a>
      <AskStudents />
      <section className="stack-sm" aria-labelledby="g-communities">
        <h2 id="g-communities" className="row"><Icon name="group" />{tx('Student communities in Las Palmas')}</h2>
        <p className="tiny muted">{tx('Separate organisations, each with its own activities. {app} is not part of either of them.', { app: getAppName() })}</p>
        <div className="card">
          {COMMUNITIES.map((c) => (
            <a key={c.name} className="guide-item" href={c.url} target="_blank" rel="noopener noreferrer">
              <strong>{c.name}</strong>
              <p className="small" style={{ color: 'var(--ink-2)', marginTop: 4 }}>{tx(c.text)}</p>
              <div className="row wrap tiny muted" style={{ marginTop: 6, gap: 10 }}>
                <span>{tx('Organised by {name}', { name: tx(c.by) })}</span>
                <span>{t('guide.checked', { date: checked('2026-11-21') })}</span>
                <span className="row" style={{ gap: 3, color: 'var(--blue-ink)' }}>{tx('Open')} <Icon name="external" size={13} /></span>
              </div>
            </a>
          ))}
        </div>
      </section>
      <Tips />
      {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : SECTIONS.map(([key, icon]) => {
        const items = data.items.filter((i) => i.section === key);
        if (!items.length) return null;
        const sorted = items;
        return (
          <section key={key} className="stack-sm" aria-labelledby={`g-${key}`}>
            <h2 id={`g-${key}`} className="row"><Icon name={icon} />{t(`guide.${key}`)}</h2>
            <div className="card">
              {sorted.map((i) => {
                const Tag = i.url ? 'a' : 'div';
                return (
                  <Tag key={i.title} className="guide-item" {...(i.url ? { href: i.url, target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    <strong>{tx(i.title)}</strong>
                    <p className="small" style={{ color: 'var(--ink-2)', marginTop: 4 }}>{tx(i.summary)}</p>
                    <div className="row wrap tiny muted" style={{ marginTop: 6, gap: 10 }}>
                      {i.source_name && <span>{t('guide.source', { name: i.source_name })}</span>}
                      {i.checked_at && <span>{t('guide.checked', { date: checked(i.checked_at) })}</span>}
                      {i.url && <span className="row" style={{ gap: 3, color: 'var(--blue-ink)' }}>{tx("Open")} <Icon name="external" size={13} /></span>}
                    </div>
                  </Tag>
                );
              })}
            </div>
          </section>
        );
      })}
      <details className="tiny muted">
        <summary>{tx('Photo credits')}</summary>
        <ul style={{ paddingLeft: 18 }}>
          {[...PHOTOS, ...MARKET_PHOTOS].map((p) => <li key={p.key}>{tx(p.alt)}: {p.author}, {p.license_url ? <a href={p.license_url} target="_blank" rel="noopener noreferrer">{p.license}</a> : p.license}{p.source && <>, <a href={p.source} target="_blank" rel="noopener noreferrer">{tx('source')}</a>{tx(' (resized)')}</>}</li>)}
          <li>{tx('Sample profile pictures are drawn avatars (“Notionists” by Zoish, CC0, via DiceBear), not photos of real people.')}</li>
          <li>{tx('Map: © OpenStreetMap contributors.')}</li>
        </ul>
      </details>
      <p className="tiny muted">{tx("We link to official pages instead of copying timetables, prices or medical guidance, because those change. Spotted something outdated? Tell the project team.")} <button className="link-btn" onClick={() => setFb(true)}>{tx('Send feedback')}</button></p>
      {fb && <FeedbackSheet onClose={() => setFb(false)} />}
    </div>
  );
}
