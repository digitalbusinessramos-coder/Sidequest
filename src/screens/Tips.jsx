import { useState } from 'react';
import { tx } from '../i18n.js';
import { Avatar, ChoiceChips, Empty, Icon, Loading, ReportSheet, SampleBadge, Sheet, useApp } from '../components.jsx';
import { useApi } from '../util.js';

const REC_ICON = { food: 'food', nightlife: 'nightout', beach: 'beach', culture: 'museum', study: 'study', practical: 'info' };

/** Student recommendations: anyone can post a tip, like it, and save it for later. */
export default function Tips() {
  const { api, city, meta, toast } = useApp();
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('top');
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [report, setReport] = useState(null);
  const [all, setAll] = useState(false);
  const q = `/recommendations?city=${city.slug}&sort=${sort}${cat ? `&category=${cat}` : ''}${saved ? '&saved=1' : ''}`;
  const { data, loading, reload } = useApi(q);

  const toggle = async (r, kind, on) => {
    try {
      if (on) await api.del(`/recommendations/${r.id}/${kind}`); else await api.put(`/recommendations/${r.id}/${kind}`, {});
      if (kind === 'save' && !on) toast(tx('Saved. Find it under “Saved”.'));
      reload(true);
    } catch (x) { toast(x.message, true); }
  };
  const remove = async (r) => {
    if (!confirm(tx('Delete your recommendation “{title}”?', { title: r.title }))) return;
    try { await api.del(`/recommendations/${r.id}`); reload(true); } catch (x) { toast(x.message, true); }
  };

  return (
    <section className="stack" aria-labelledby="tips-h" data-tour="tips">
      <div className="section-title">
        <h2 id="tips-h" className="row"><Icon name="star" />{tx('Tips from students')}</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{tx('Add a tip')}</button>
      </div>
      <p className="small muted">{tx('Places and tips shared by students. Like the ones you agree with and save the ones you want to try.')}</p>
      <div className="chip-scroll">
        <ChoiceChips label={tx('Category')} value={cat} onChange={(v) => setCat(v || '')}
          options={[{ key: '', label: tx('All') }, ...meta.recCategories.map((c) => ({ key: c.key, label: c.label }))]} />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label={tx('Sort')}>
          <button className={sort === 'top' ? 'on' : ''} aria-pressed={sort === 'top'} onClick={() => setSort('top')}>{tx('Most liked')}</button>
          <button className={sort === 'new' ? 'on' : ''} aria-pressed={sort === 'new'} onClick={() => setSort('new')}>{tx('Newest')}</button>
        </div>
        <button className={`chip ${saved ? 'on' : ''}`} aria-pressed={saved} onClick={() => setSaved(!saved)}><Icon name="bookmark" size={15} />{tx('Saved')}</button>
      </div>
      {loading && !data ? <Loading rows={2} /> : data?.recommendations.length === 0 ? (
        <Empty icon="star" title={saved ? tx('Nothing saved yet') : tx('No tips here yet')} hint={saved ? tx('Tap the bookmark on a tip to keep it here.') : tx('Be the first to share one.')} />
      ) : (
        <div className="stack-sm">
          {data?.recommendations.slice(0, all ? undefined : 3).map((r) => (
            <article key={r.id} className="card card-pad stack-sm tip" data-tour="tip">
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="tip-icon"><Icon name={REC_ICON[r.category] || 'star'} size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{r.title}</strong>
                  <div className="tiny muted">{tx(meta.recCategories.find((c) => c.key === r.category)?.label || '')}{r.area ? ` · ${r.area}` : ''}</div>
                </div>
                {r.is_sample && <SampleBadge />}
              </div>
              {r.body && <p className="small" style={{ color: 'var(--ink-2)' }}>{r.body}</p>}
              {r.url && <a className="tiny" href={r.url} target="_blank" rel="noopener noreferrer nofollow">{tx('Link')} <Icon name="external" size={12} /></a>}
              <div className="row" style={{ gap: 6 }}>
                <a href={`#/person/${r.author.id}`} className="row tiny muted" style={{ gap: 6, flex: 1, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                  <Avatar person={r.author} size="xs" />{r.author.first_name}
                </a>
                <button className={`chip ${r.liked ? 'on' : ''}`} aria-pressed={r.liked} onClick={() => toggle(r, 'like', r.liked)}
                  aria-label={tx(r.liked ? 'Unlike ({n} likes)' : 'Like ({n} likes)', { n: r.likes })}><Icon name="heart" size={15} />{r.likes}</button>
                <button className={`chip ${r.saved ? 'on' : ''}`} aria-pressed={r.saved} onClick={() => toggle(r, 'save', r.saved)} aria-label={tx(r.saved ? 'Remove from saved' : 'Save')}><Icon name="bookmark" size={15} /></button>
                {r.mine
                  ? <button className="icon-btn" onClick={() => remove(r)} aria-label={tx('Delete')}><Icon name="trash" size={16} /></button>
                  : <button className="icon-btn" onClick={() => setReport({ type: 'recommendation', id: r.id, label: 'recommendation' })} aria-label={tx('Report')}><Icon name="flag" size={16} /></button>}
              </div>
            </article>
          ))}
          {!all && data?.recommendations.length > 3 && (
            <button className="btn btn-secondary btn-block" onClick={() => setAll(true)}>{tx('Show all {n} tips', { n: data.recommendations.length })}</button>
          )}
        </div>
      )}
      {adding && <AddTip onClose={() => setAdding(false)} onDone={() => { setAdding(false); setSort('new'); setSaved(false); setCat(''); reload(true); }} />}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </section>
  );
}

function AddTip({ onClose, onDone }) {
  const { api, meta, city, toast } = useApp();
  const [v, setV] = useState({ category: 'food', title: '', body: '', area: '', url: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/recommendations', v); toast(tx('Thanks! Your tip is shared.')); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={tx('Share a tip')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field"><span className="label">{tx('Category')}</span>
          <ChoiceChips label={tx('Category')} value={v.category} onChange={(category) => set({ category: category || 'food' })} options={meta.recCategories.map((c) => ({ key: c.key, label: c.label }))} />
        </div>
        <label className="field"><span>{tx('What do you recommend?')}</span>
          <input className="input" required maxLength={80} value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={tx('e.g. Best place to watch the sunset')} />
        </label>
        <label className="field"><span>{tx('Why? (optional)')}</span>
          <textarea className="textarea" maxLength={500} value={v.body} onChange={(e) => set({ body: e.target.value })} placeholder={tx('A sentence or two that helps other students.')} />
        </label>
        <label className="field"><span>{tx('Area (optional)')}</span>
          <select className="select" value={v.area} onChange={(e) => set({ area: e.target.value })}>
            <option value="">{tx('Not in one area / whole island')}</option>
            {city.areas.map((a) => <option key={a.key} value={a.name}>{a.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{tx('Link (optional)')}</span>
          <input className="input" type="url" maxLength={300} value={v.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
        </label>
        <p className="tiny muted">{tx('Shown with your first name. Please don’t share private addresses or phone numbers.')}</p>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{tx('Share tip')}</button>
      </form>
    </Sheet>
  );
}
