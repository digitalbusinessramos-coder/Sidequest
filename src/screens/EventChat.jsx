import { tx } from '../i18n.js';
import { useEffect, useRef, useState } from 'react';
import { Avatar, ErrorState, Icon, Loading, ReportSheet, TopBar, useApp } from '../components.jsx';
import { api as rawApi } from '../api.js';
import { fmtWhen } from '../util.js';

/** Group chat for everyone who joined an event's group ("I'm going / looking for company"). */
export default function EventChat({ id }) {
  const { api, toast, meta, city } = useApp();
  const [info, setInfo] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const lastId = useRef(0);
  const scroller = useRef(null);

  const load = async (stopRef) => {
    try {
      const r = await rawApi.get(`/events/${id}/messages?after=${lastId.current}`);
      if (stopRef?.stop) return;
      setErr(null);
      setInfo({ title: r.title, members: r.members, can_post: r.can_post, is_sample: r.is_sample });
      if (r.messages.length) {
        lastId.current = r.messages[r.messages.length - 1].id;
        setMsgs((m) => [...m, ...r.messages]);
      }
    } catch (e) { if (!stopRef?.stop) setErr(e); }
  };

  useEffect(() => {
    const ref = { stop: false };
    lastId.current = 0;
    setMsgs([]);
    load(ref);
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(ref); }, 3000);
    return () => { ref.stop = true; clearInterval(iv); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await api.post(`/events/${id}/messages`, { body: text }); setText(''); await load(); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };

  if (err && !info) {
    return <><TopBar title={tx('Event group chat')} /><div className="page"><ErrorState error={err} />
      <a className="btn btn-secondary" href={`#/event/${id}`}>{tx('Back to the event')}</a></div></>;
  }

  return (
    <div className="chat">
      <TopBar title={info?.title || tx('Event group chat')}>
        <a className="icon-btn" href={`#/event/${id}`} aria-label={tx('Event details')}><Icon name="info" /></a>
      </TopBar>
      <div className="notice blue" style={{ margin: '10px 12px 0' }}>
        <Icon name="group" />
        <span className="small">{info ? tx('{n} people in this event group. Everyone who joins the group can read this chat. Meet in public places.', { n: info.members }) : ''}</span>
      </div>
      <div className="chat-scroll" ref={scroller} aria-live="polite" aria-label={tx('Messages')}>
        {!info && <Loading rows={1} />}
        {info && !msgs.length && <p className="small muted" style={{ textAlign: 'center', padding: 20 }}>{tx('No messages yet. Say hello and suggest where to meet.')}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg-row ${m.mine ? 'mine' : ''}`}>
            {!m.mine && <Avatar person={m.author} size="xs" />}
            <div className={`msg ${m.mine ? 'mine' : ''} ${m.hidden ? 'hidden' : ''}`}>
              {!m.mine && <div className="who">{m.author?.first_name}{m.author?.is_demo ? ` (${tx('sample')})` : ''}</div>}
              <div>{m.hidden ? tx('Message hidden because you blocked this person.') : m.body}</div>
              <div className="row tiny" style={{ justifyContent: 'flex-end', opacity: 0.75, gap: 6 }}>
                {fmtWhen(m.created_at, city.timezone, { withDay: false })}
                {!m.mine && !m.hidden && (
                  <button style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', minHeight: 24 }}
                    aria-label={tx('Report message from {name}', { name: m.author?.first_name })} onClick={() => setReport({ type: 'event_message', id: m.id, label: 'message' })}><Icon name="flag" size={13} /></button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {info?.can_post ? (
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="evmsg">{tx('Message')}</label>
          <input id="evmsg" className="input" maxLength={1000} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('Write to the group')} />
          <button className="btn btn-primary" aria-label={tx('Send')} disabled={busy || !text.trim()}><Icon name="send" /></button>
        </form>
      ) : info && <div className="composer small muted" style={{ justifyContent: 'center' }}>{tx('This event is over. The chat is read-only.')}</div>}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </div>
  );
}
