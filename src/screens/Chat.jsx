import { t, tx } from '../i18n.js';
import { useEffect, useRef, useState } from 'react';
import { ErrorState, Icon, Loading, ReportSheet, TopBar, useApp } from '../components.jsx';
import { api as rawApi } from '../api.js';
import { fmtPlanWhen, fmtWhen, localDate, useApi } from '../util.js';
import { canSuggestTime } from '../../shared/plan-time.js';

const QUICK = ["I’m at the meeting point 👋", "Running about 5 minutes late", "Could we meet somewhere else?", "See you there!"];

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
    return <><TopBar title={tx("Chat")} /><div className="page"><ErrorState error={err} />
      {err.status === 403 && <a className="btn btn-secondary" href={`#/activity/${id}`}>{tx("Back to the activity")}</a>}</div></>;
  }

  return (
    <div className="chat">
      <TopBar title={a?.title || 'Chat'}>
        <a className="icon-btn" href={`#/activity/${id}`} aria-label={tx("Activity details")}><Icon name="info" /></a>
      </TopBar>
      {a && (
        <a href={`#/activity/${id}`} className="meetup" style={{ margin: '10px 12px 0', textDecoration: 'none', color: 'inherit', display: 'block', padding: '10px 12px' }}>
          <div className="row small" style={{ gap: 6 }}><Icon name="pin" size={16} /><strong>{fmtPlanWhen(a)}</strong> · {a.meeting_point || a.meeting_area}</div>
          {!a.meeting_point && <div className="tiny muted">{tx("No exact meeting point yet. Agree on a public place here.")}</div>}
          {a.state === 'cancelled' && <div className="tiny" style={{ color: 'var(--coral-ink)', fontWeight: 700 }}>{tx("Cancelled")}</div>}
        </a>
      )}
      {a && a.state !== 'cancelled' && a.state !== 'past' && canSuggestTime(a) && <DatePoll id={id} a={a} tick={msgs.length} onSet={() => act.reload(true)} />}
      {err && msgs.length > 0 && (
        <div className="notice coral" role="alert" style={{ margin: '8px 12px 0' }}>
          <Icon name="info" />{err.status === 403 ? tx("You are no longer a confirmed participant, so new messages are not shown.") : err.message}
        </div>
      )}
      <div className="chat-scroll" ref={scroller} aria-live="polite" aria-label={tx("Messages")}>
        {!msgs.length && !err && <Loading rows={1} />}
        {msgs.map((m) => m.kind === 'system' ? (
          <div key={m.id} className="msg system">{m.body}</div>
        ) : (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''} ${m.hidden ? 'hidden' : ''}`}>
            {!m.mine && <div className="who">{m.author?.first_name}</div>}
            <div>{m.hidden ? tx("Message hidden because you blocked this person.") : m.body}</div>
            <div className="row tiny" style={{ justifyContent: 'flex-end', opacity: 0.75, gap: 6 }}>
              {a && fmtWhen(m.created_at, a.timezone, { withDay: false })}
              {!m.mine && !m.hidden && (
                <button className="btn-ghost" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', minHeight: 24 }}
                  aria-label={tx('Report message from {name}', { name: m.author?.first_name })} onClick={() => setReport({ type: 'message', id: m.id, label: 'message' })}><Icon name="flag" size={13} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      {canPost ? (
        <>
          <div className="quick-replies" role="group" aria-label={tx("Quick messages")}>
            {QUICK.map((q) => <button key={q} className="chip" onClick={() => send(tx(q))} disabled={busy}>{tx(q)}</button>)}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label className="sr-only" htmlFor="msg">{tx("Message")}</label>
            <input id="msg" className="input" maxLength={1000} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Write a message")} />
            <button className="btn btn-primary" aria-label={tx("Send")} disabled={busy || !text.trim()}><Icon name="send" /></button>
          </form>
        </>
      ) : <div className="composer small muted" style={{ justifyContent: 'center' }}>{tx("This activity was cancelled. The chat is read-only.")}</div>}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </div>
  );
}

/**
 * "When suits everyone?" for a plan whose day or time is still to be agreed. People in the plan suggest a date and time
 * and tap "Works for me" on the ones that suit them. The organiser picks one, or it is set when everyone agrees.
 */
function DatePoll({ id, a, tick, onSet }) {
  const { api, toast } = useApp();
  const sug = useApi(`/activities/${id}/suggestions`, { poll: 15000 });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { sug.reload(true); }, [tick]); // a new suggestion or vote also posts a chat line
  const d = sug.data;
  if (!d) return null;
  const list = d.suggestions || [];

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      if (r?.set) { toast(tx('Everyone agreed. The plan now has a date and time.')); onSet(); }
      await sug.reload(true);
      return true;
    } catch (e) { toast(e.message, true); return false; } finally { setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (await run(() => api.post(`/activities/${id}/suggestions`, { day, time }), tx('Suggestion added'))) { setForm(false); setDay(''); setTime(''); setOpen(true); }
  };
  const pick = (s) => run(async () => { await api.post(`/activities/${id}/suggestions/${s.id}/pick`, {}); onSet(); }, tx('Date set. Everyone in the plan was told.'));
  const best = list.reduce((m, s) => (s.votes > (m?.votes || 0) ? s : m), null);

  return (
    <div className="meetup date-poll" style={{ margin: '8px 12px 0', padding: '10px 12px' }}>
      <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button type="button" className="link-btn" style={{ textAlign: 'left', fontWeight: 700, padding: 0 }} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="clock" size={16} /> {list.length ? tx(list.length === 1 ? '1 date suggested' : '{n} dates suggested', { n: list.length }) : tx('When suits everyone?')}
          {list.length > 0 && <span className="tiny muted" style={{ fontWeight: 400 }}> · {open ? tx('Hide') : tx('Show')}</span>}
        </button>
        {!form && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setForm(true); setOpen(true); }}>{tx('Suggest a date')}</button>}
      </div>
      {!open && best && <div className="tiny muted" style={{ marginTop: 4 }}>{tx('Most popular: {when} ({n} of {total})', { when: fmtWhen(best.starts_at, d.timezone), n: best.votes, total: d.people })}</div>}
      {open && (
        <div className="stack-sm" style={{ marginTop: 8, maxHeight: '38vh', overflowY: 'auto' }}>
          {form && (
            <form onSubmit={submit} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input input-date" type="date" required aria-label={tx('Pick a date')} min={localDate(d.timezone, 0)} value={day} onChange={(e) => setDay(e.target.value)} style={{ flex: '1 1 140px' }} />
              <input className="input" type="time" required aria-label={tx('Start time')} value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: '1 1 100px' }} />
              <button className="btn btn-primary btn-sm" disabled={busy || !day || !time}>{tx('Suggest')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(false)}>{tx('Cancel')}</button>
            </form>
          )}
          {!list.length && !form && <div className="tiny muted">{tx('No date yet. Suggest one and the others can say if it works for them.')}</div>}
          {list.map((s) => (
            <div key={s.id} className="row" style={{ gap: 8, justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div className="small"><strong>{fmtWhen(s.starts_at, d.timezone)}</strong></div>
                <div className="tiny muted">{tx('{n} of {total} say it works', { n: s.votes, total: d.people })}{s.voters.length ? ` · ${s.voters.join(', ')}` : ''}</div>
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                <button type="button" className={`btn btn-sm ${s.i_agree ? 'btn-lime' : 'btn-secondary'}`} aria-pressed={s.i_agree} disabled={busy}
                  onClick={() => run(() => api.post(`/activities/${id}/suggestions/${s.id}/vote`, { agree: !s.i_agree }))}>
                  {s.i_agree ? `✓ ${tx('Works for me')}` : tx('Works for me')}
                </button>
                {d.can_pick && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => pick(s)}>{tx('Pick')}</button>}
                {s.can_remove && <button type="button" className="icon-btn" aria-label={tx('Remove suggestion')} disabled={busy}
                  onClick={() => run(() => api.del(`/activities/${id}/suggestions/${s.id}`))}><Icon name="x" size={16} /></button>}
              </div>
            </div>
          ))}
          <div className="tiny muted">{d.can_pick ? tx('Tap “Pick” to set the date for everyone. If everyone says a date works, it is set automatically.') : tx('The organiser picks the date. If everyone says a date works, it is set automatically.')}</div>
        </div>
      )}
    </div>
  );
}
