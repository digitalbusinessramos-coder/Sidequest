import { useEffect, useRef, useState } from 'react';
import { ErrorState, Icon, Loading, ReportSheet, TopBar, useApp } from '../components.jsx';
import { api as rawApi } from '../api.js';
import { fmtWhen, useApi } from '../util.js';

const QUICK = ['I’m at the meeting point 👋', 'Running about 5 minutes late', 'Could we meet somewhere else?', 'See you there!'];

export default function Chat({ id }) {
  const { api, toast, meta } = useApp();
  const act = useApi(`/activities/${id}`, { poll: 15000 });
  const [msgs, setMsgs] = useState([]);
  const [canPost, setCanPost] = useState(true);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const lastId = useRef(0);
  const scroller = useRef(null);

  useEffect(() => {
    let stop = false;
    lastId.current = 0;
    setMsgs([]);
    const load = async () => {
      try {
        const r = await rawApi.get(`/activities/${id}/messages?after=${lastId.current}`);
        if (stop) return;
        setErr(null);
        setCanPost(r.can_post);
        if (r.messages.length) {
          lastId.current = r.messages[r.messages.length - 1].id;
          setMsgs((m) => [...m, ...r.messages]);
        }
      } catch (e) { if (!stop) setErr(e); }
    };
    load();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 3000);
    return () => { stop = true; clearInterval(iv); };
  }, [id]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length]);

  const send = async (body) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/activities/${id}/messages`, { body });
      setText('');
      const r = await rawApi.get(`/activities/${id}/messages?after=${lastId.current}`);
      if (r.messages.length) { lastId.current = r.messages[r.messages.length - 1].id; setMsgs((m) => [...m, ...r.messages]); }
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  const a = act.data?.activity;
  if (err && !msgs.length) {
    return <><TopBar title="Chat" /><div className="page"><ErrorState error={err} />
      {err.status === 403 && <a className="btn btn-secondary" href={`#/activity/${id}`}>Back to the activity</a>}</div></>;
  }

  return (
    <div className="chat">
      <TopBar title={a?.title || 'Chat'}>
        <a className="icon-btn" href={`#/activity/${id}`} aria-label="Activity details"><Icon name="info" /></a>
      </TopBar>
      {a && (
        <a href={`#/activity/${id}`} className="meetup" style={{ margin: '10px 12px 0', textDecoration: 'none', color: 'inherit', display: 'block', padding: '10px 12px' }}>
          <div className="row small" style={{ gap: 6 }}><Icon name="pin" size={16} /><strong>{fmtWhen(a.starts_at, a.timezone)}</strong> · {a.meeting_point || a.meeting_area}</div>
          {!a.meeting_point && <div className="tiny muted">No exact meeting point yet. Agree on a public place here.</div>}
          {a.state === 'cancelled' && <div className="tiny" style={{ color: 'var(--coral-ink)', fontWeight: 700 }}>Cancelled</div>}
        </a>
      )}
      {err && msgs.length > 0 && (
        <div className="notice coral" role="alert" style={{ margin: '8px 12px 0' }}>
          <Icon name="info" />{err.status === 403 ? 'You are no longer a confirmed participant, so new messages are not shown.' : err.message}
        </div>
      )}
      <div className="chat-scroll" ref={scroller} aria-live="polite" aria-label="Messages">
        {!msgs.length && !err && <Loading rows={1} />}
        {msgs.map((m) => m.kind === 'system' ? (
          <div key={m.id} className="msg system">{m.body}</div>
        ) : (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''} ${m.hidden ? 'hidden' : ''}`}>
            {!m.mine && <div className="who">{m.author?.first_name}{m.author?.is_demo ? ' (sample)' : ''}</div>}
            <div>{m.hidden ? 'Message hidden because you blocked this person.' : m.body}</div>
            <div className="row tiny" style={{ justifyContent: 'flex-end', opacity: 0.75, gap: 6 }}>
              {a && fmtWhen(m.created_at, a.timezone, { withDay: false })}
              {!m.mine && !m.hidden && (
                <button className="btn-ghost" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', minHeight: 24 }}
                  aria-label={`Report message from ${m.author?.first_name}`} onClick={() => setReport({ type: 'message', id: m.id, label: 'message' })}><Icon name="flag" size={13} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      {canPost ? (
        <>
          <div className="quick-replies" role="group" aria-label="Quick messages">
            {QUICK.map((q) => <button key={q} className="chip" onClick={() => send(q)} disabled={busy}>{q}</button>)}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label className="sr-only" htmlFor="msg">Message</label>
            <input id="msg" className="input" maxLength={1000} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" />
            <button className="btn btn-primary" aria-label="Send" disabled={busy || !text.trim()}><Icon name="send" /></button>
          </form>
        </>
      ) : <div className="composer small muted" style={{ justifyContent: 'center' }}>This activity was cancelled. The chat is read-only.</div>}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </div>
  );
}
