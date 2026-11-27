import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n.js';
import { api as rawApi } from '../api.js';
import { Avatar, ErrorState, Icon, Loading, ReportSheet, Sheet, TopBar, useApp } from '../components.jsx';
import { fmtWhen, useApi } from '../util.js';

/**
 * Connect button on a profile. States: Connect → Request sent (withdraw) · Accept / Decline (they asked) · Message (connected).
 * A private chat exists only once both said yes, so nobody gets messages from people they didn't accept.
 */
export function ConnectActions({ person, connection, onChange }) {
  const { api, toast, me, openAccount, reloadMe } = useApp();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState(false);
  const c = connection;
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await onChange(); reloadMe().catch(() => {}); } catch (x) { toast(tx(x.message), true); } finally { setBusy(false); }
  };
  const send = () => run(async () => { await api.post(`/users/${person.id}/connect`, { note: note.trim() }); setAsking(false); setNote(''); },
    tx('Request sent. {name} decides whether to connect.', { name: person.first_name }));
  if (me.is_guest) {
    return <button className="btn btn-secondary" onClick={() => openAccount('signup', { reason: tx('Create a free account to connect with other students.') })}><Icon name="buddies" size={16} />{tx('Connect')}</button>;
  }
  return (
    <>
      {!c && <button className="btn btn-secondary" disabled={busy} onClick={() => setAsking(true)}><Icon name="buddies" size={16} />{tx('Connect')}</button>}
      {c?.status === 'pending' && c.direction === 'outgoing' && (
        <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => api.del(`/connections/${c.id}`), tx('Request withdrawn.'))}>
          <Icon name="check" size={16} />{tx('Request sent')} <span className="tiny muted">· {tx('Withdraw')}</span>
        </button>
      )}
      {c?.status === 'pending' && c.direction === 'incoming' && (
        <div className="card card-pad stack-sm connect-ask">
          <strong>{tx('{name} wants to connect with you', { name: person.first_name })}</strong>
          {c.note && <p className="small" style={{ margin: 0 }}>“{c.note}”</p>}
          <span className="tiny muted">{tx('If you accept, you can message each other. {name} isn’t told if you decline.', { name: person.first_name })}</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.post(`/connections/${c.id}/accept`), tx('You’re connected with {name}.', { name: person.first_name }))}>{tx('Accept')}</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.post(`/connections/${c.id}/decline`))}>{tx('Decline')}</button>
          </div>
        </div>
      )}
      {c?.status === 'accepted' && (
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn btn-primary" href={`#/dm/${c.id}`}><Icon name="chat" size={16} />{tx('Message')}</a>
          <span className="small muted row" style={{ gap: 4 }}><Icon name="check" size={15} />{tx('Connected')}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(true)}>{tx('Remove')}</button>
        </div>
      )}
      {asking && (
        <Sheet title={tx('Connect with {name}', { name: person.first_name })} onClose={() => setAsking(false)}>
          <div className="stack">
            <p className="small">{tx('{name} gets a request. Once they accept, you can message each other privately.', { name: person.first_name })}</p>
            <label className="field"><span>{tx('Add a short note (optional)')}</span>
              <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx('e.g. Hi! We were both at the surf plan.')} />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={send}>{tx('Send request')}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setAsking(false)}>{tx('Cancel')}</button>
          </div>
        </Sheet>
      )}
      {removing && (
        <Sheet title={tx('Remove {name}?', { name: person.first_name })} onClose={() => setRemoving(false)}>
          <div className="stack">
            <p className="small">{tx('Your private chat with {name} is deleted for both of you. {name} is not told. Plans you share are not affected.', { name: person.first_name })}</p>
            <button className="btn btn-danger btn-block" disabled={busy} onClick={() => run(async () => { await api.del(`/connections/${c.id}`); setRemoving(false); })}>{tx('Remove connection')}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setRemoving(false)}>{tx('Cancel')}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Buddies: requests to answer and the people you're connected with. */
export function Connections() {
  const { api, toast, reloadMe, city, me } = useApp();
  const { data, reload } = useApi(me.is_guest ? null : '/connections', { poll: 15000 });
  const [busy, setBusy] = useState(null);
  if (me.is_guest || !data) return null;
  const answer = async (c, action) => {
    setBusy(c.id);
    try {
      await api.post(`/connections/${c.id}/${action}`);
      if (action === 'accept') toast(tx('You’re connected with {name}.', { name: c.person.first_name }));
      await reload(true); reloadMe().catch(() => {});
    } catch (x) { toast(tx(x.message), true); } finally { setBusy(null); }
  };
  return (
    <>
      {data.incoming.length > 0 && (
        <section className="stack-sm" aria-labelledby="creq-h">
          <h2 id="creq-h">{tx('Want to connect with you')}</h2>
          <div className="card" style={{ padding: 0 }}>
            {data.incoming.map((c) => (
              <div key={c.id} className="person-row" style={{ padding: '10px 14px', alignItems: 'flex-start' }}>
                <a href={`#/person/${c.person.id}`}><Avatar person={c.person} size="sm" /></a>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={`#/person/${c.person.id}`} style={{ color: 'inherit' }}><strong>{c.person.first_name}</strong></a>
                  {c.note && <div className="small">“{c.note}”</div>}
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => answer(c, 'accept')}>{tx('Accept')}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => answer(c, 'decline')}>{tx('Decline')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="stack-sm" aria-labelledby="conn-h" id="friends">
        <div className="section-title">
          <h2 id="conn-h">{tx('Your friends')}</h2>
          {data.connected.length > 0 && <span className="small muted">{data.connected.length}</span>}
        </div>
        {data.connected.length === 0 ? (
          <p className="small muted card card-pad">{tx('No friends here yet. Open a student’s profile and tap Connect. Once they accept, they show up here and you can message each other.')}</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {data.connected.map((c) => (
              <a key={c.id} href={`#/dm/${c.id}`} className="person-row dm-row" style={{ padding: '10px 14px' }}>
                <Avatar person={c.person} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{c.person.first_name}</strong>
                  <div className="tiny muted dm-last">{c.last ? `${c.last.mine ? `${tx('You')}: ` : ''}${c.last.body}` : tx('Say hello')}</div>
                </div>
                {c.last && <span className="tiny muted">{fmtWhen(c.last.created_at, city.timezone, { withDay: false })}</span>}
                {c.unread > 0 && <span className="tab-badge" style={{ position: 'static' }}>{c.unread}</span>}
              </a>
            ))}
          </div>
        )}
        {data.outgoing.length > 0 && (
          <details className="small">
            <summary className="muted">{tx(data.outgoing.length === 1 ? '1 request you sent is waiting' : '{n} requests you sent are waiting', { n: data.outgoing.length })}</summary>
            <div className="card" style={{ padding: 0, marginTop: 6 }}>
              {data.outgoing.map((c) => (
                <a key={c.id} href={`#/person/${c.person.id}`} className="person-row" style={{ padding: '8px 14px', color: 'inherit' }}>
                  <Avatar person={c.person} size="sm" /><span style={{ flex: 1 }}>{c.person.first_name}</span><span className="tiny muted">{tx('Request sent')}</span>
                </a>
              ))}
            </div>
          </details>
        )}
      </section>
    </>
  );
}

/** Private chat between two connected students. */
export function DmChat({ id }) {
  const { api, toast, city, meta, reloadMe } = useApp();
  const [other, setOther] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const lastId = useRef(0);
  const scroller = useRef(null);
  const load = async (ref) => {
    try {
      const r = await rawApi.get(`/connections/${id}/messages?after=${lastId.current}`);
      if (ref?.stop) return;
      setErr(null); setOther(r.other);
      if (r.messages.length) { lastId.current = r.messages[r.messages.length - 1].id; setMsgs((m) => [...m, ...r.messages]); reloadMe().catch(() => {}); }
    } catch (e) { if (!ref?.stop) setErr(e); }
  };
  useEffect(() => {
    const ref = { stop: false };
    lastId.current = 0; setMsgs([]); load(ref);
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(ref); }, 3000);
    return () => { ref.stop = true; clearInterval(iv); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length]);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await api.post(`/connections/${id}/messages`, { body: text }); setText(''); await load(); } catch (x) { toast(tx(x.message), true); } finally { setBusy(false); }
  };
  if (err && !other) return <><TopBar title={tx('Messages')} /><div className="page"><ErrorState error={err} /><a className="btn btn-secondary" href="#/buddies">{tx('Back to Buddies')}</a></div></>;
  return (
    <div className="chat">
      <TopBar title={other ? other.first_name : tx('Messages')}>
        {other && <a className="icon-btn" href={`#/person/${other.id}`} aria-label={tx('Profile of {name}', { name: other.first_name })}><Icon name="profile" /></a>}
      </TopBar>
      <div className="meetup" style={{ margin: '10px 12px 0', padding: '10px 12px' }}>
        <div className="tiny muted">{tx('Only the two of you can read this. Meet in public places. You can block or report from their profile any time.')}</div>
      </div>
      <div className="chat-scroll" ref={scroller} aria-live="polite" aria-label={tx('Messages')}>
        {!other && <Loading rows={1} />}
        {other && !msgs.length && <p className="small muted" style={{ textAlign: 'center', padding: 20 }}>{tx('Say hello to {name}.', { name: other.first_name })}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            <div className="row tiny" style={{ justifyContent: 'flex-end', opacity: 0.75, gap: 6 }}>
              {fmtWhen(m.created_at, city.timezone, { withDay: false })}
              {!m.mine && <button style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', minHeight: 24 }} aria-label={tx('Report message from {name}', { name: other?.first_name })} onClick={() => setReport({ type: 'direct_message', id: m.id, label: 'message' })}><Icon name="flag" size={13} /></button>}
            </div>
          </div>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <label className="sr-only" htmlFor="dmsg">{tx('Message')}</label>
        <input id="dmsg" className="input" maxLength={1000} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('Write a message')} />
        <button className="btn btn-primary" aria-label={tx('Send')} disabled={busy || !text.trim()}><Icon name="send" /></button>
      </form>
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </div>
  );
}
