import { locale, t, tx } from '../i18n.js';
import { ErrorState, Icon, Loading, PhotoHero, useApp } from '../components.jsx';
import Tips from './Tips.jsx';
import { FeedbackSheet } from './Market.jsx';
import { useState } from 'react';
import { MARKET_PHOTOS, PHOTOS } from '../../shared/photos.js';
import { useApi } from '../util.js';

// Student tips now have their own section with likes and saves, so the old "students" placeholder is not shown.
const SECTIONS = [['transport', 'bus'], ['health', 'health'], ['housing', 'home'], ['university', 'school'], ['links', 'link']];

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
      <div className="notice coral"><Icon name="shield" /><span><strong>112</strong>: {tx('In an emergency, call 112, the EU-wide emergency number (source: Your Europe, EU portal). This guide is not medical advice.')}</span></div>
      <Tips />
      <div className="row wrap small" style={{ gap: 8 }}>
        <span className="badge badge-official">{t('guide.official')}</span><span className="muted">{tx("from the organisation itself")}</span>
        <span className="badge badge-community">{t('guide.community')}</span><span className="muted">{tx("from students")}</span>
        <span className="badge badge-placeholder">{t('guide.placeholder')}</span><span className="muted">{tx("to be completed")}</span>
      </div>
      {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : SECTIONS.map(([key, icon]) => {
        const items = data.items.filter((i) => i.section === key);
        if (!items.length) return null;
        const sorted = [...items].sort((a, b) => (a.kind === 'official' ? -1 : 0) - (b.kind === 'official' ? -1 : 0));
        return (
          <section key={key} className="stack-sm" aria-labelledby={`g-${key}`}>
            <h2 id={`g-${key}`} className="row"><Icon name={icon} />{t(`guide.${key}`)}</h2>
            <div className="card">
              {sorted.map((i) => {
                const Tag = i.url ? 'a' : 'div';
                return (
                  <Tag key={i.title} className="guide-item" {...(i.url ? { href: i.url, target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <strong style={{ flex: 1 }}>{tx(i.title)}</strong>
                      <span className={`badge badge-${i.kind}`}>{t(`guide.${i.kind}`)}</span>
                    </div>
                    <p className="small" style={{ color: 'var(--ink-2)', marginTop: 4 }}>{tx(i.summary)}</p>
                    <div className="row wrap tiny muted" style={{ marginTop: 6, gap: 10 }}>
                      {i.source_name && <span>{t('guide.source', { name: i.source_name })}</span>}
                      {i.checked_at && <span>{t('guide.checked', { date: new Date(i.checked_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>}
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
          {[...PHOTOS, ...MARKET_PHOTOS].map((p) => <li key={p.key}>{tx(p.alt)}: {p.author}, <a href={p.license_url} target="_blank" rel="noopener noreferrer">{p.license}</a>, <a href={p.source} target="_blank" rel="noopener noreferrer">{tx('source')}</a>{tx(' (resized)')}</li>)}
          <li>{tx('Sample profile pictures are drawn avatars (“Notionists” by Zoish, CC0, via DiceBear), not photos of real people.')}</li>
          <li>{tx('Map: © OpenStreetMap contributors, © CARTO.')}</li>
        </ul>
      </details>
      <p className="tiny muted">{tx("We link to official pages instead of copying timetables, prices or medical guidance, because those change. Spotted something outdated? Tell the project team.")} <button className="link-btn" onClick={() => setFb(true)}>{tx('Send feedback')}</button></p>
      {fb && <FeedbackSheet onClose={() => setFb(false)} />}
    </div>
  );
}
