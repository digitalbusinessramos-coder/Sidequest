import { t } from '../i18n.js';
import { ErrorState, Icon, Loading, useApp } from '../components.jsx';
import { useApi } from '../util.js';

const SECTIONS = [['transport', 'bus'], ['health', 'health'], ['housing', 'home'], ['university', 'school'], ['students', 'star'], ['links', 'link']];

export default function Guide() {
  const { city } = useApp();
  const { data, error, loading, reload } = useApi(`/guide?city=${city.slug}`);
  return (
    <div className="page">
      <div className="stack-sm"><span className="eyebrow">Settling in</span><h1>{t('guide.title')}: {city.name.split(' de ')[0]}</h1>
        <p className="small muted">{t('guide.lead')}</p></div>
      <div className="notice coral"><Icon name="shield" /><span>In an emergency call <strong>112</strong>, the EU-wide emergency number (source: Your Europe, EU portal). This guide is not medical advice.</span></div>
      <div className="row wrap small" style={{ gap: 8 }}>
        <span className="badge badge-official">{t('guide.official')}</span><span className="muted">from the organisation itself</span>
        <span className="badge badge-community">{t('guide.community')}</span><span className="muted">from students</span>
        <span className="badge badge-placeholder">{t('guide.placeholder')}</span><span className="muted">to be completed</span>
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
                      <strong style={{ flex: 1 }}>{i.title}</strong>
                      <span className={`badge badge-${i.kind}`}>{t(`guide.${i.kind}`)}</span>
                    </div>
                    <p className="small" style={{ color: 'var(--ink-2)', marginTop: 4 }}>{i.summary}</p>
                    <div className="row wrap tiny muted" style={{ marginTop: 6, gap: 10 }}>
                      {i.source_name && <span>{t('guide.source', { name: i.source_name })}</span>}
                      {i.checked_at && <span>{t('guide.checked', { date: new Date(i.checked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>}
                      {i.url && <span className="row" style={{ gap: 3, color: 'var(--blue-ink)' }}>Open <Icon name="external" size={13} /></span>}
                    </div>
                  </Tag>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="tiny muted">We link to official pages instead of copying timetables, prices or medical guidance, because those change. Spotted something outdated? Tell the project team.</p>
    </div>
  );
}
