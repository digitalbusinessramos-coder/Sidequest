import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n.js';
import { Avatar, ChoiceChips, Empty, ErrorState, Icon, Loading, ReportSheet, SampleBadge, Sheet, TopBar, useApp } from '../components.jsx';
import { api as rawApi } from '../api.js';
import { fmtPrice, fmtWhen, resizeToJpeg, useApi } from '../util.js';

const CAT_ICON = { furniture: 'home', kitchen: 'food', bikes: 'sports', surf: 'surf', electronics: 'bolt', books: 'study', clothes: 'shopping', tickets: 'star', other: 'other' };

/** Switch between Explore's plans and the marketplace (both live under the Explore tab). */
export function ExploreSwitch({ active }) {
  return (
    <nav className="seg seg-wide" aria-label={tx('Explore sections')}>
      <a href="#/explore" className={active === 'plans' ? 'on' : ''} aria-current={active === 'plans' ? 'page' : undefined}><Icon name="explore" size={16} />{tx('Plans')}</a>
      <a href="#/market" className={active === 'market' ? 'on' : ''} aria-current={active === 'market' ? 'page' : undefined}><Icon name="shopping" size={16} />{tx('Marketplace')}</a>
    </nav>
  );
}

const SafetyNote = () => (
  <div className="notice blue"><Icon name="shield" />
    <span className="small">{tx('Payments never happen in this app. Meet in a public place, check the item before paying, and never pay a deposit in advance to someone you haven’t met.')}</span>
  </div>
);

function ListingCard({ l }) {
  return (
    <a href={`#/market/${l.id}`} className="listing-card">
      <span className="listing-img">
        {l.photo ? <img src={l.photo} alt="" loading="lazy" /> : <Icon name={CAT_ICON[l.category] || 'other'} size={34} />}
        {l.status !== 'active' && <span className={`listing-status s-${l.status}`}>{tx(l.status === 'sold' ? 'Sold' : 'Reserved')}</span>}
      </span>
      <span className="listing-body">
        <strong className="listing-price">{fmtPrice(l)}</strong>
        <span className="listing-title">{l.title}</span>
        <span className="tiny muted">{l.kind === 'ticket' ? tx('Ticket') : l.area || ''}{l.is_sample ? ` · ${tx('Sample')}` : ''}</span>
      </span>
    </a>
  );
}

export default function Market({ query = {} }) {
  const { city, meta } = useApp();
  const [kind, setKind] = useState(query.kind || '');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [scope, setScope] = useState(''); // '' | saved | mine
  useEffect(() => { const id = setTimeout(() => setDq(q), 300); return () => clearTimeout(id); }, [q]);
  const params = new URLSearchParams({ city: city.slug });
  if (kind) params.set('kind', kind);
  if (category) params.set('category', category);
  if (dq.trim()) params.set('q', dq.trim());
  if (scope === 'saved') params.set('saved', '1');
  if (scope === 'mine') params.set('mine', '1');
  if (query.event) params.set('event', query.event);
  const { data, error, loading, reload } = useApi(`/market?${params}`, { poll: 30000 });
  const list = data?.listings || [];

  return (
    <div className="page">
      <ExploreSwitch active="market" />
      <div className="stack-sm">
        <span className="eyebrow">{tx('Buy, sell, give away')}</span>
        <h1>{tx('Student marketplace')}</h1>
        <p className="small muted">{tx('Things students leave behind, things you need, and tickets you can’t use. Payments never happen in the app.')}</p>
      </div>
      {query.event && <div className="notice lime"><Icon name="star" /><span className="small">{tx('Showing tickets for one event.')} <a href="#/market">{tx('Show everything')}</a></span></div>}
      <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="mq">{tx('Search the marketplace')}</label>
        <input id="mq" type="search" placeholder={tx('Bike, desk, ticket…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <div className="chips" role="group" aria-label={tx('Type')}>
        {[['', 'All'], ...meta.marketKinds.map((k) => [k.key, k.label])].map(([k, label]) => (
          <button key={k || 'all'} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{tx(label)}</button>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <select className="select select-sm" aria-label={tx('Category')} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{tx('All categories')}</option>
          {meta.marketCategories.map((c) => <option key={c.key} value={c.key}>{tx(c.label)}</option>)}
        </select>
        <button className="chip" aria-pressed={scope === 'saved'} onClick={() => setScope(scope === 'saved' ? '' : 'saved')}><Icon name="bookmark" size={15} />{tx('Saved')}</button>
        <button className="chip" aria-pressed={scope === 'mine'} onClick={() => setScope(scope === 'mine' ? '' : 'mine')}><Icon name="profile" size={15} />{tx('My listings')}</button>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : list.length === 0 ? (
        <Empty icon="shopping" title={tx('Nothing here yet')} hint={tx('Be the first to list something.')}>
          <a className="btn btn-primary btn-sm" href="#/market/new">{tx('Sell or give away')}</a>
        </Empty>
      ) : (
        <div className="listing-grid">{list.map((l) => <ListingCard key={l.id} l={l} />)}</div>
      )}
      <a href={`#/market/new${query.event ? `?kind=ticket&event=${query.event}` : ''}`} className="btn btn-primary fab"><Icon name="plus" />{tx('Sell or give away')}</a>
    </div>
  );
}

export function ListingDetail({ id }) {
  const { api, toast, meta, city } = useApp();
  const { data, error, loading, reload } = useApi(`/market/${id}`, { poll: 20000 });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <><TopBar title="" /><div className="page"><Loading /></div></>;
  if (error) return <><TopBar title={tx('Marketplace')} /><div className="page"><ErrorState error={error} onRetry={reload} /></div></>;
  const l = data.listing;
  const act = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok); await reload(true); } catch (x) { toast(x.message, true); } finally { setBusy(false); } };
  const setStatus = (status) => act(() => api.put(`/market/${l.id}`, { status }), tx('Listing updated.'));
  const remove = () => { if (confirm(tx('Delete this listing?'))) act(async () => { await api.del(`/market/${l.id}`); location.hash = '#/market'; }, tx('Listing deleted.')); };
  const kindLabel = meta.marketKinds.find((k) => k.key === l.kind)?.label;
  return (
    <>
      <TopBar title={tx('Marketplace')}>
        {!l.mine && <button className="icon-btn" onClick={() => setReport({ type: 'listing', id: l.id, label: 'listing' })} aria-label={tx('Report')}><Icon name="flag" /></button>}
      </TopBar>
      <div className="page">
        <div className="listing-hero">
          {l.photo ? <img src={l.photo} alt={l.title} /> : <Icon name={CAT_ICON[l.category] || 'other'} size={56} />}
        </div>
        <div className="stack-sm">
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="badge badge-community">{tx(kindLabel || '')}</span>
            {l.status !== 'active' && <span className={`badge listing-status s-${l.status}`} style={{ position: 'static' }}>{tx(l.status === 'sold' ? 'Sold' : 'Reserved')}</span>}
            {l.is_sample && <SampleBadge />}
          </div>
          <h1>{l.title}</h1>
          <div className="listing-price big">{fmtPrice(l)}</div>
          {l.kind === 'ticket' && l.face_value_eur != null && (
            <p className="small">{tx('The seller says they paid {face} €. Tickets here are only offered at or below that price.', { face: l.face_value_eur })}</p>
          )}
        </div>
        {l.description && <p style={{ whiteSpace: 'pre-wrap' }}>{l.description}</p>}
        <div className="card card-pad facts-list">
          {l.area && <><Icon name="pin" /><div>{l.area}</div></>}
          {l.event && <><Icon name="star" /><div><a href={`#/event/${l.event.id}`}>{l.event.title}</a><div className="tiny muted">{fmtWhen(l.event.starts_at, city.timezone)}</div></div></>}
          <Icon name="clock" /><div>{tx('Listed {when}', { when: fmtWhen(l.created_at, city.timezone) })}</div>
        </div>
        {l.kind === 'ticket' && (
          <div className="notice lime"><Icon name="info" /><span className="small">{tx('Some organisers don’t allow tickets to be passed on, or need the name changed. Check the event’s official page before you buy.')}</span></div>
        )}
        <a href={`#/person/${l.seller.id}`} className="card card-pad row" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
          <Avatar person={l.seller} />
          <span style={{ flex: 1 }}><strong>{l.mine ? tx('You') : l.seller.first_name}</strong><span className="tiny muted" style={{ display: 'block' }}>{tx('Seller')}</span></span>
          {l.seller.is_demo && <SampleBadge />}
        </a>
        <SafetyNote />

        {l.mine ? (
          <section className="stack" aria-labelledby="conv-h">
            <div className="field"><span className="label">{tx('Status')}</span>
              <ChoiceChips label={tx('Status')} value={l.status} onChange={(s) => s && setStatus(s)}
                options={[{ key: 'active', label: 'Available' }, { key: 'reserved', label: 'Reserved' }, { key: 'sold', label: l.kind === 'wanted' ? 'Found' : 'Sold' }]} />
            </div>
            <div className="row">
              <a className="btn btn-secondary btn-sm" href={`#/market/${l.id}/edit`}><Icon name="edit" size={16} />{tx('Edit')}</a>
              <button className="btn btn-danger btn-sm" onClick={remove} disabled={busy}><Icon name="trash" size={16} />{tx('Delete')}</button>
            </div>
            <h2 id="conv-h">{tx('Messages')}</h2>
            {l.conversations.length === 0 ? <p className="small muted">{tx('Nobody has written yet.')}</p> : (
              <div className="card">
                {l.conversations.map((c) => (
                  <a key={c.buyer.id} href={`#/market/${l.id}/chat?buyer=${c.buyer.id}`} className="person-row" style={{ textDecoration: 'none', color: 'inherit', padding: '10px 14px' }}>
                    <Avatar person={c.buyer} />
                    <span style={{ flex: 1, minWidth: 0 }}><strong>{c.buyer.first_name}</strong><span className="tiny muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last.body}</span></span>
                    {c.unread > 0 && <span className="tab-badge" style={{ position: 'static' }}>{c.unread}</span>}
                  </a>
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="sticky-actions"><div className="row">
            <a className="btn btn-primary" style={{ flex: 1 }} href={`#/market/${l.id}/chat`} aria-disabled={l.status === 'sold'}><Icon name="chat" />{l.kind === 'wanted' ? tx('I have this') : tx('Message the seller')}</a>
            <button className={`btn ${l.saved ? 'btn-secondary' : 'btn-ghost'}`} aria-pressed={l.saved} onClick={() => act(() => (l.saved ? api.del(`/market/${l.id}/save`) : api.put(`/market/${l.id}/save`, {})))} aria-label={tx(l.saved ? 'Remove from saved' : 'Save')}><Icon name="bookmark" /></button>
          </div></div>
        )}
      </div>
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </>
  );
}

export function ListingForm({ editId, query = {} }) {
  const { api, meta, city, toast } = useApp();
  const evs = useApi(`/events?city=${city.slug}`);
  const [v, setV] = useState(editId ? null : { kind: query.kind || 'sell', category: query.kind === 'ticket' ? 'tickets' : 'other', title: '', description: '', price_eur: '', face_value_eur: '', event_id: query.event || '', area: '' });
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => {
    if (!editId) return;
    rawApi.get(`/market/${editId}`).then(({ listing: l }) => setV({ ...l, price_eur: l.price_eur ?? '', face_value_eur: l.face_value_eur ?? '', event_id: l.event?.id || '', area: l.area || '', description: l.description || '' })).catch((x) => setErr(x.message));
  }, [editId]);
  if (!v) return <><TopBar title={tx('Edit listing')} /><div className="page">{err ? <div className="form-error">{err}</div> : <Loading />}</div></>;
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { setPhoto(await resizeToJpeg(f, 900, false)); } catch (x) { toast(x.message, true); }
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { ...v, category: v.kind === 'ticket' ? 'tickets' : v.category };
      const id = editId ? (await api.put(`/market/${editId}`, body), editId) : (await api.post('/market', body)).id;
      if (photo) await api.put(`/market/${id}/photo`, { data: photo });
      toast(editId ? tx('Listing updated.') : tx('Your listing is live.'));
      location.replace(`#/market/${id}`);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const ticket = v.kind === 'ticket';
  return (
    <>
      <TopBar title={editId ? tx('Edit listing') : tx('New listing')} />
      <form className="page" onSubmit={submit}>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>{tx('What kind of listing?')}</legend>
          <div className="choice-cards two">
            {[['sell', 'euro', 'For sale'], ['free', 'heart', 'Free to give away'], ['wanted', 'search', 'Looking for'], ['ticket', 'star', 'Event ticket']].map(([k, icon, label]) => (
              <label key={k} className={`choice-card ${v.kind === k ? 'on' : ''}`}>
                <input type="radio" name="kind" value={k} checked={v.kind === k} onChange={() => set({ kind: k })} />
                <Icon name={icon} size={20} /><strong>{tx(label)}</strong>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field"><span>{tx('Title')}</span>
          <input className="input" required maxLength={80} value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={ticket ? tx('e.g. 1 ticket for Saturday’s concert') : tx('e.g. City bike, works well')} />
        </label>
        {!ticket && (
          <label className="field"><span>{tx('Category')}</span>
            <select className="select" value={v.category} onChange={(e) => set({ category: e.target.value })}>
              {meta.marketCategories.filter((c) => c.key !== 'tickets').map((c) => <option key={c.key} value={c.key}>{tx(c.label)}</option>)}
            </select>
          </label>
        )}
        {ticket && (
          <>
            <label className="field"><span>{tx('Which event? (optional)')}</span>
              <select className="select" value={v.event_id} onChange={(e) => set({ event_id: e.target.value })}>
                <option value="">{tx('Not listed in the app')}</option>
                {(evs.data?.events || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
            <div className="grid-2">
              <label className="field"><span>{tx('Price you paid (€)')}</span>
                <input className="input" type="number" min="0" max="5000" step="0.5" inputMode="decimal" required value={v.face_value_eur} onChange={(e) => set({ face_value_eur: e.target.value })} />
              </label>
              <label className="field"><span>{tx('Your price (€)')}</span>
                <input className="input" type="number" min="0" max="5000" step="0.5" inputMode="decimal" value={v.price_eur} onChange={(e) => set({ price_eur: e.target.value })} placeholder={v.face_value_eur || ''} />
              </label>
            </div>
            <p className="hint" style={{ marginTop: -8 }}>{tx('Fair resale only: your price can’t be higher than what you paid. Check that the organiser allows tickets to be passed on.')}</p>
          </>
        )}
        {v.kind === 'sell' && (
          <label className="field"><span>{tx('Price (€)')}</span>
            <input className="input" type="number" min="0" max="5000" step="0.5" inputMode="decimal" required value={v.price_eur} onChange={(e) => set({ price_eur: e.target.value })} />
          </label>
        )}
        {v.kind === 'wanted' && (
          <label className="field"><span>{tx('Budget (€, optional)')}</span>
            <input className="input" type="number" min="0" max="5000" step="0.5" inputMode="decimal" value={v.price_eur} onChange={(e) => set({ price_eur: e.target.value })} />
          </label>
        )}
        <label className="field"><span>{tx('Description (optional)')}</span>
          <textarea className="textarea" maxLength={1000} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder={tx('Condition, size, when you can hand it over…')} />
        </label>
        <label className="field"><span>{tx('Pick-up area (optional)')}</span>
          <select className="select" value={v.area} onChange={(e) => set({ area: e.target.value })}>
            <option value="">{tx('Agree in the chat')}</option>
            {city.areas.map((a) => <option key={a.key} value={a.name}>{a.name}</option>)}
          </select>
          <span className="hint">{tx('Never post your home address. Agree on a public place in the chat.')}</span>
        </label>
        <div className="field"><span className="label">{tx('Picture (optional)')}</span>
          <div className="row" style={{ gap: 12 }}>
            {(photo || v.photo) && <img src={photo || v.photo} alt="" className="listing-thumb" />}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}><Icon name="camera" size={16} />{photo || v.photo ? tx('Change picture') : tx('Add a picture')}</button>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} hidden />
          </div>
          {ticket && <span className="hint">{tx('Don’t photograph the ticket’s barcode or QR code: someone could copy it.')}</span>}
        </div>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{editId ? tx('Save changes') : tx('Publish listing')}</button>
        <p className="tiny muted">{tx('Shown with your first name and picture. Payments never happen in this app.')}</p>
      </form>
    </>
  );
}

export function ListingChat({ id, query = {} }) {
  const { api, toast, city, meta } = useApp();
  const [info, setInfo] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const lastId = useRef(0);
  const scroller = useRef(null);
  const buyerQs = query.buyer ? `&buyer=${query.buyer}` : '';
  const load = async (ref) => {
    try {
      const r = await rawApi.get(`/market/${id}/messages?after=${lastId.current}${buyerQs}`);
      if (ref?.stop) return;
      setErr(null); setInfo({ other: r.other, title: r.title, status: r.status });
      if (r.messages.length) { lastId.current = r.messages[r.messages.length - 1].id; setMsgs((m) => [...m, ...r.messages]); }
    } catch (e) { if (!ref?.stop) setErr(e); }
  };
  useEffect(() => {
    const ref = { stop: false };
    lastId.current = 0; setMsgs([]); load(ref);
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(ref); }, 3000);
    return () => { ref.stop = true; clearInterval(iv); };
  }, [id, query.buyer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length]);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await api.post(`/market/${id}/messages`, { body: text, buyer: query.buyer ? Number(query.buyer) : undefined }); setText(''); await load(); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  if (err && !info) return <><TopBar title={tx('Messages')} /><div className="page"><ErrorState error={err} /><a className="btn btn-secondary" href={`#/market/${id}`}>{tx('Back to the listing')}</a></div></>;
  const QUICK = ['Is it still available?', 'Could I see it this week?', 'Where could we meet?'];
  return (
    <div className="chat">
      <TopBar title={info ? info.other.first_name : tx('Messages')}>
        <a className="icon-btn" href={`#/market/${id}`} aria-label={tx('Listing details')}><Icon name="info" /></a>
      </TopBar>
      <a href={`#/market/${id}`} className="meetup" style={{ margin: '10px 12px 0', textDecoration: 'none', color: 'inherit', display: 'block', padding: '10px 12px' }}>
        <div className="row small" style={{ gap: 6 }}><Icon name="shopping" size={16} /><strong>{info?.title}</strong>{info && info.status !== 'active' && <span className="tiny muted">· {tx(info.status === 'sold' ? 'Sold' : 'Reserved')}</span>}</div>
        <div className="tiny muted">{tx('Only the two of you can read this. Meet in a public place; payments never happen in the app.')}</div>
      </a>
      <div className="chat-scroll" ref={scroller} aria-live="polite" aria-label={tx('Messages')}>
        {!info && <Loading rows={1} />}
        {info && !msgs.length && <p className="small muted" style={{ textAlign: 'center', padding: 20 }}>{tx('Say hello and ask your question.')}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            <div className="row tiny" style={{ justifyContent: 'flex-end', opacity: 0.75, gap: 6 }}>
              {fmtWhen(m.created_at, city.timezone, { withDay: false })}
              {!m.mine && <button style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', minHeight: 24 }} aria-label={tx('Report message from {name}', { name: m.author?.first_name })} onClick={() => setReport({ type: 'listing_message', id: m.id, label: 'message' })}><Icon name="flag" size={13} /></button>}
            </div>
          </div>
        ))}
      </div>
      {!query.buyer && msgs.length === 0 && (
        <div className="quick-replies" role="group" aria-label={tx('Quick messages')}>
          {QUICK.map((qq) => <button key={qq} className="chip" onClick={() => setText(tx(qq))}>{tx(qq)}</button>)}
        </div>
      )}
      <form className="composer" onSubmit={send}>
        <label className="sr-only" htmlFor="lmsg">{tx('Message')}</label>
        <input id="lmsg" className="input" maxLength={1000} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('Write a message')} />
        <button className="btn btn-primary" aria-label={tx('Send')} disabled={busy || !text.trim()}><Icon name="send" /></button>
      </form>
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </div>
  );
}

/** Feedback box: ideas and problems go straight to the project team. */
export function FeedbackSheet({ onClose }) {
  const { api, meta, toast } = useApp();
  const [kind, setKind] = useState('idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/feedback', { kind, body, screen: location.hash.slice(0, 60) }); toast(tx('Thank you! The project team reads every message.')); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={tx('Feedback and ideas')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="small">{tx('What should we improve, add or fix? Your message goes to the project team, not to other users.')}</p>
        <ChoiceChips label={tx('Type')} value={kind} onChange={(k) => setKind(k || 'idea')} options={meta.feedbackKinds.map((k) => ({ key: k.key, label: k.label }))} />
        <label className="field"><span>{tx('Your message')}</span>
          <textarea className="textarea" required maxLength={2000} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={tx('e.g. It would be great if…')} />
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !body.trim()}>{tx('Send feedback')}</button>
      </form>
    </Sheet>
  );
}
