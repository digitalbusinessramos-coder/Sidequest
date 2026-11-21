import { useState } from 'react';
import { tx } from '../i18n.js';
import { Avatar, ChoiceChips, Empty, ErrorState, Icon, Loading, ReportSheet, Sheet, TopBar, useApp } from '../components.jsx';
import { fmtWhen, useApi } from '../util.js';

const CAT_ICON = { food: 'food', nightlife: 'nightout', beach: 'beach', culture: 'museum', study: 'study', practical: 'info', services: 'pin' };
const catLabel = (meta, key) => tx(meta.recCategories.find((c) => c.key === key)?.label || '');

/**
 * "Ask students": a short question about life in the city (a good hairdresser, a phone shop, a quiet café to study)
 * and answers from other students. Newest first, with a filter for questions nobody has answered yet.
 */
export function AskStudents() {
  const { me, meta, city, openAccount } = useApp();
  const [filter, setFilter] = useState('');
  const [asking, setAsking] = useState(false);
  const [all, setAll] = useState(false);
  const { data, loading, error, reload } = useApi(`/questions?city=${city.slug}${filter ? `&filter=${filter}` : ''}`);
  const ask = () => (me.is_guest ? openAccount('signup', { reason: tx('Create a free account to ask other students.') }) : setAsking(true));
  const list = data?.questions || [];
  return (
    <section className="stack" aria-labelledby="ask-h">
      <div className="section-title">
        <h2 id="ask-h" className="row"><Icon name="chat" />{tx('Ask students')}</h2>
        <button className="btn btn-primary btn-sm" onClick={ask}><Icon name="plus" size={16} />{tx('Ask a question')}</button>
      </div>
      <p className="small muted">{tx('Looking for a good hairdresser, a phone shop or a quiet place to study? Ask, and students who know will answer.')}</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label={tx('Show')}>
          <button className={filter === '' ? 'on' : ''} aria-pressed={filter === ''} onClick={() => setFilter('')}>{tx('Newest')}</button>
          <button className={filter === 'unanswered' ? 'on' : ''} aria-pressed={filter === 'unanswered'} onClick={() => setFilter('unanswered')}>{tx('Not answered yet')}</button>
          {!me.is_guest && <button className={filter === 'mine' ? 'on' : ''} aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>{tx('Mine')}</button>}
        </div>
      </div>
      {loading && !data ? <Loading rows={2} /> : error ? <ErrorState error={error} onRetry={reload} /> : list.length === 0 ? (
        <Empty icon="chat" title={filter === 'unanswered' ? tx('Every question has an answer') : tx('No questions yet')} hint={filter ? '' : tx('Be the first to ask.')} />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {list.slice(0, all ? undefined : 4).map((q) => (
            <a key={q.id} href={`#/ask/${q.id}`} className="person-row" style={{ padding: '12px 14px', alignItems: 'flex-start', color: 'inherit', textDecoration: 'none' }}>
              <span className="tip-icon"><Icon name={CAT_ICON[q.category] || 'chat'} size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block' }}>{q.body}</strong>
                <span className="tiny muted">{q.author.first_name} · {catLabel(meta, q.category)} · {fmtWhen(q.created_at, city.timezone)}</span>
              </div>
              <span className={`tiny ${q.answers ? '' : 'muted'}`} style={{ whiteSpace: 'nowrap' }}>{q.answers === 1 ? tx('1 answer') : tx('{n} answers', { n: q.answers })}</span>
            </a>
          ))}
        </div>
      )}
      {!all && list.length > 4 && <button className="btn btn-secondary btn-block" onClick={() => setAll(true)}>{tx('Show all {n} questions', { n: list.length })}</button>}
      {asking && <AskSheet onClose={() => setAsking(false)} onDone={(id) => { setAsking(false); location.hash = `#/ask/${id}`; }} />}
    </section>
  );
}

function AskSheet({ onClose, onDone }) {
  const { api, meta, toast } = useApp();
  const [v, setV] = useState({ category: 'services', body: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/questions', v); toast(tx('Question posted. You’ll get an update when someone answers.')); onDone(r.id); } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={tx('Ask students')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>{tx('Your question')}</span>
          <textarea className="textarea" required minLength={8} maxLength={300} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })}
            placeholder={tx('e.g. Where can I get a good haircut near Santa Catalina that isn’t too expensive?')} />
        </label>
        <div className="field"><span className="label">{tx('Category')}</span>
          <ChoiceChips label={tx('Category')} value={v.category} onChange={(category) => setV({ ...v, category: category || 'services' })} options={meta.recCategories.map((c) => ({ key: c.key, label: tx(c.label) }))} />
        </div>
        <p className="tiny muted">{tx('Shown with your first name to students with an account. Please don’t share phone numbers or private addresses, and don’t ask people to rate someone by name.')}</p>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{tx('Post question')}</button>
      </form>
    </Sheet>
  );
}

/** One question with its answers. The most helpful answers come first. */
export function QuestionDetail({ id }) {
  const { me, api, meta, city, toast, openAccount } = useApp();
  const { data, error, loading, reload } = useApi(`/questions/${id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  if (loading && !data) return <><TopBar title={tx('Ask students')} /><div className="page"><Loading rows={2} /></div></>;
  if (error) return <><TopBar title={tx('Ask students')} /><div className="page"><ErrorState error={error} onRetry={reload} /><a className="btn btn-secondary" href="#/guide">{tx('Back to the Guide')}</a></div></>;
  const q = data.question;
  const answer = async (e) => {
    e.preventDefault();
    if (me.is_guest) { openAccount('signup', { reason: tx('Create a free account to answer.') }); return; }
    setBusy(true);
    try { await api.post(`/questions/${q.id}/answers`, { body: text }); setText(''); toast(tx('Thanks for helping!')); await reload(true); } catch (x) { toast(tx(x.message), true); } finally { setBusy(false); }
  };
  const vote = async (a) => {
    if (me.is_guest) { openAccount('signup', { reason: tx('Create a free account to answer.') }); return; }
    try { if (a.voted) await api.del(`/answers/${a.id}/helpful`); else await api.put(`/answers/${a.id}/helpful`, {}); reload(true); } catch (x) { toast(tx(x.message), true); }
  };
  const removeQ = async () => {
    if (!confirm(tx('Delete your question and its answers?'))) return;
    try { await api.del(`/questions/${q.id}`); location.hash = '#/guide'; } catch (x) { toast(tx(x.message), true); }
  };
  const removeA = async (a) => {
    if (!confirm(tx('Delete your answer?'))) return;
    try { await api.del(`/answers/${a.id}`); reload(true); } catch (x) { toast(tx(x.message), true); }
  };
  return (
    <>
      <TopBar title={tx('Ask students')} />
      <div className="page">
        <article className="card card-pad stack-sm">
          <span className="tiny muted row" style={{ gap: 6 }}><Icon name={CAT_ICON[q.category] || 'chat'} size={14} />{catLabel(meta, q.category)}</span>
          <h1 style={{ fontSize: '1.25rem', margin: 0, whiteSpace: 'pre-wrap' }}>{q.body}</h1>
          <div className="row" style={{ gap: 6 }}>
            <a href={`#/person/${q.author.id}`} className="row tiny muted" style={{ gap: 6, flex: 1, color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
              <Avatar person={q.author} size="xs" />{q.author.first_name} · {fmtWhen(q.created_at, city.timezone)}
            </a>
            {q.mine
              ? <button className="icon-btn" onClick={removeQ} aria-label={tx('Delete')}><Icon name="trash" size={16} /></button>
              : <button className="icon-btn" onClick={() => setReport({ type: 'question', id: q.id, label: 'question' })} aria-label={tx('Report')}><Icon name="flag" size={16} /></button>}
          </div>
        </article>

        <section className="stack-sm" aria-labelledby="ans-h">
          <h2 id="ans-h">{data.answers.length === 1 ? tx('1 answer') : tx('{n} answers', { n: data.answers.length })}</h2>
          {data.answers.length === 0 && <p className="small muted">{q.mine ? tx('No answers yet. You’ll get an update when someone answers.') : tx('No answers yet. Know a good place? Help out below.')}</p>}
          {data.answers.map((a) => (
            <article key={a.id} className="card card-pad stack-sm">
              <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.body}</p>
              <div className="row" style={{ gap: 6 }}>
                <a href={`#/person/${a.author.id}`} className="row tiny muted" style={{ gap: 6, flex: 1, color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
                  <Avatar person={a.author} size="xs" />{a.author.first_name} · {fmtWhen(a.created_at, city.timezone)}
                </a>
                {!a.mine && (
                  <button className={`chip ${a.voted ? 'on' : ''}`} aria-pressed={a.voted} onClick={() => vote(a)}
                    aria-label={tx(a.voted ? 'Helpful, tap to undo ({n})' : 'Mark as helpful ({n})', { n: a.helpful })}><Icon name="check" size={15} />{tx('Helpful')} {a.helpful > 0 && a.helpful}</button>
                )}
                {a.mine && a.helpful > 0 && <span className="tiny muted">{tx('{n} found this helpful', { n: a.helpful })}</span>}
                {a.mine
                  ? <button className="icon-btn" onClick={() => removeA(a)} aria-label={tx('Delete')}><Icon name="trash" size={16} /></button>
                  : <button className="icon-btn" onClick={() => setReport({ type: 'answer', id: a.id, label: 'answer' })} aria-label={tx('Report')}><Icon name="flag" size={16} /></button>}
              </div>
            </article>
          ))}
        </section>

        <form className="stack-sm card card-pad" onSubmit={answer}>
          <label className="field"><span>{tx('Your answer')}</span>
            <textarea className="textarea" required maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('Name the place and why you like it. No phone numbers or private addresses, please.')} />
          </label>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !text.trim()}><Icon name="send" size={16} />{tx('Post answer')}</button>
        </form>
        {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
      </div>
    </>
  );
}
