import { useState } from 'react';
import { t, tx } from '../i18n.js';
import { Avatar, ErrorState, Icon, Loading, ReportSheet, SampleBadge, Sheet, Stamp, StatusBadge, TopBar, useApp, EmojiTile, GoogleMap } from '../components.jsx';
import { fmtPlanCost, fmtPlanDuration, fmtPlanWhen, fmtPlaces, tzLabel, useApi } from '../util.js';
import { ShareButton } from './Share.jsx';
import { langName } from './ProfileBits.jsx';
import { InstallSuggestion } from './Install.jsx';

export default function ActivityDetail({ id, query = {} }) {
  const { api, toast, reloadMe, meta, me, openAccount } = useApp();
  const { data, error, loading, reload } = useApi(`/activities/${id}`, { poll: 10000 });
  const [busy, setBusy] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [report, setReport] = useState(null);
  const [justJoined, setJustJoined] = useState(false);
  const [openConfirm, joinOpenSheet] = useState(false);

  if (loading && !data) return <><TopBar title="" /><div className="page"><Loading rows={2} /></div></>;
  if (error && !data) return <><TopBar title="" /><div className="page"><ErrorState error={error} onRetry={reload} /></div></>;
  const a = data.activity;
  const isOrg = a.my_status === 'organiser';
  const insider = isOrg || a.my_status === 'accepted';
  const closed = a.state === 'cancelled' || a.state === 'past';

  const act = async (fn, okText) => {
    setBusy(true);
    try { await fn(); if (okText) toast(okText); await reload(true); reloadMe().catch(() => {}); return true; } catch (x) { toast(x.message, true); await reload(true); return false; } finally { setBusy(false); }
  };

  // Guests save an account first (a few seconds); the request or join then goes through without leaving this plan.
  const needAccount = (then, reason) => openAccount('signup', { reason, onDone: then });
  const sendRequest = async () => {
    if (await act(() => api.post(`/activities/${a.id}/requests`, { message: msg }), tx('Request sent. You’ll see the answer here and in My Plans.'))) { setJoinOpen(false); setMsg(''); setJustJoined(true); }
  };
  const join = (e) => {
    e.preventDefault();
    if (me.is_guest) { setJoinOpen(false); needAccount(sendRequest, tx('Create a free account so {name} can see who is asking. Your request is sent right after.', { name: a.organiser.first_name })); } else sendRequest();
  };
  const joinNow = async () => { if (await act(() => api.post(`/activities/${a.id}/requests`, { message: '' }), tx('You’re in! Say hello in the chat.'))) setJustJoined(true); };
  const joinOpenPlan = () => {
    if (me.is_guest) needAccount(joinNow, tx('Create a free account to join. You join this plan right after.'));
    else joinOpenSheet(true);
  };
  const leave = () => {
    const text = a.my_status === 'accepted' ? tx("Leave this activity? You will lose access to its chat.") : tx("Withdraw your request?");
    if (confirm(text)) act(() => api.del(`/activities/${a.id}/requests/mine`), a.my_status === 'accepted' ? tx("You left the activity.") : tx("Request withdrawn."));
  };
  const manage = (uid, action, name) => {
    if (action === 'remove' && !confirm(tx('Remove {name} from this activity? They will lose access to the chat.', { name }))) return;
    act(() => api.post(`/activities/${a.id}/members/${uid}/${action}`), action === 'accept' ? tx('{name} is confirmed.', { name }) : action === 'decline' ? tx('Request declined.') : tx('{name} was removed.', { name }));
  };
  const cancel = async (e) => {
    e.preventDefault();
    if (await act(() => api.post(`/activities/${a.id}/cancel`, { reason: cancelReason }), tx("Activity cancelled. Participants can see it in the chat."))) setCancelOpen(false);
  };
  const invitation = (action) => act(() => api.post(`/activities/${a.id}/invitation/${action}`), action === 'accept' ? tx("You’re in! Say hello in the chat.") : tx("Invitation declined."));

  const posted = isOrg ? tx('Posted by you') : tx('Posted by {name}', { name: a.organiser.first_name });
  const cost = fmtPlanCost(a);
  const duration = fmtPlanDuration(a);
  const places = fmtPlaces(a);
  const notice = {
    cancelled: ['coral', 'x', `${t('act.cancelledNote')}${a.cancel_reason ? ` ${tx('Reason: {reason}', { reason: a.cancel_reason })}` : ''}`],
    past: ['', 'clock', t('act.pastNote')],
  }[a.state] || {
    pending: ['', 'clock', tx('Request sent. {name} decides; you’ll see the answer here and in My Plans. You are not confirmed yet.', { name: a.organiser.first_name })],
    accepted: ['lime', 'check', t('act.acceptedNote')],
    invited: ['blue', 'heart', t('act.invitedNote', { name: a.organiser.first_name })],
    declined: ['', 'info', tx("The organiser didn’t accept this request. There are plenty of other plans in Explore.")],
    removed: ['', 'info', tx("You are no longer part of this activity.")],
  }[a.my_status] || (a.state === 'full' && !isOrg ? ['', 'group', t('act.fullNote')] : null);

  return (
    <>
      <TopBar title={a.title}>
        {!isOrg && <button className="icon-btn" aria-label={tx("Report this activity")} onClick={() => setReport({ type: 'activity', id: a.id, label: 'activity' })}><Icon name="flag" /></button>}
      </TopBar>
      <div className="page">
        {a.is_sample && <div className="notice blue"><Icon name="info" />{tx('This is an example plan made up to show how plans look. Nobody can join it.')}</div>}
        {a.photo ? <figure className="detail-photo"><img src={a.photo} alt="" /></figure> : <EmojiTile a={a} size="lg" />}
        <div className="detail-head">
          <Stamp category={a.category} size="lg" />
          <div className="stack-sm" style={{ flex: 1 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {a.is_sample && <SampleBadge />}
              <StatusBadge status={closed ? a.state : a.my_status || (a.state === 'full' ? 'full' : null)} />
          {a.join_mode === 'open' && <span className="badge badge-open"><Icon name="bolt" size={12} />{tx('Join directly')}</span>}
            </div>
            <h1 style={{ fontSize: '1.45rem' }}>{a.title}</h1>
            <a href={`#/person/${a.organiser.id}`} className="row small" style={{ textDecoration: 'none', color: 'var(--ink-2)' }}>
              <Avatar person={a.organiser} size="sm" />{posted}{a.organiser.is_demo && !isOrg && <SampleBadge />}
            </a>
          </div>
        </div>

        {query.created && isOrg && !closed && <div className="notice lime" role="status"><Icon name="check" />{tx('Your plan is published. Share the link so people can join. Requests and messages appear in My Plans.')}</div>}
        {((query.created && isOrg) || justJoined) && <InstallSuggestion />}
        {notice && <div className={`notice ${notice[0]}`} role="status"><Icon name={notice[1]} />{notice[2]}</div>}

        <div className="card card-pad facts-list">
          <Icon name="clock" /><div><strong>{fmtPlanWhen(a)}</strong>{duration && <> · {duration}</>}<div className="tiny muted">{tx(tzLabel(a.timezone))}</div></div>
          <Icon name="pin" /><div><strong>{a.meeting_area}</strong><div className="tiny muted">{insider ? tx('Public meeting area') : tx('Public meeting area. Confirmed participants see the exact meeting point.')}</div></div>
          {cost && <><Icon name="euro" /><div><strong>{cost}</strong>{a.cost_mode === 'estimate' && <div className="tiny muted">{tx('Estimated by the organiser. Everyone pays their own share directly; nothing is paid in the app.')}</div>}</div></>}
          <Icon name="group" /><div>{a.capped
            ? <><strong>{tx('Up to {n} people, including the organiser', { n: a.max_participants })}</strong> · {tx('{n} going', { n: a.going })} · {places}</>
            : <strong>{tx('{n} going', { n: a.going })}</strong>}</div>
          {a.beginner_friendly && <><Icon name="sprout" /><div>{tx('Beginners welcome')}</div></>}
        </div>

        {a.event && (
          <a href={`#/event/${a.event.id}`} className="notice blue" style={{ textDecoration: 'none' }}>
            <Icon name="flag" /><span>{tx('This group is going to “{title}”.', { title: a.event.title })} {t('event.separate')}</span>
          </a>
        )}

        {a.description && <p>{a.description}</p>}
        <GoogleMap query={a.meeting_area.split(' / ')[0]} title={tx('Map of {place}', { place: a.meeting_area })} note={insider ? null : tx('Shows the neighbourhood only. The exact meeting point is shared with confirmed participants.')} />

        {!insider && !closed && !a.my_status && <p className="small reassure"><Icon name="heart" size={16} />{tx('You’re welcome to come on your own.')}</p>}
        {!a.is_sample && <ShareButton activity={a} />}

        {insider && (
          <section className="meetup stack-sm" aria-label={t('act.meetup')}>
            <h3><Icon name="pin" />{t('act.meetup')}</h3>
            <p><strong>{fmtPlanWhen(a)}</strong></p>
            <p>{a.meeting_point || <span className="muted">{isOrg ? tx('No exact meeting point yet. Agree on a public place in the chat and add it with Edit.') : tx('No exact meeting point yet. Agree on a public place in the chat.')}</span>}</p>
            <p className="tiny muted">{t('act.public')}</p>
            <a className="btn btn-primary btn-sm" href={`#/activity/${a.id}/chat`}><Icon name="chat" />{t('act.chat')}</a>
          </section>
        )}

        <section className="stack-sm" aria-labelledby="who-h">
          <h2 id="who-h">{t('act.who')}</h2>
          {a.participants ? (
            <div className="card card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
              <div className="person-row"><Avatar person={a.organiser} /><span style={{ flex: 1 }}><strong>{a.organiser.first_name}</strong> <span className="tiny muted">{tx("organiser")}</span></span></div>
              {a.participants.map((p) => (
                <div key={p.id} className="person-row">
                  <Avatar person={p} />
                  <a href={`#/person/${p.id}`} style={{ flex: 1, color: 'inherit' }}>{p.hidden ? tx("Blocked person") : <strong>{p.first_name}</strong>}{p.is_demo && <> <SampleBadge /></>}</a>
                  {isOrg && !closed && <button className="btn btn-ghost btn-sm" onClick={() => manage(p.id, 'remove', p.first_name)} disabled={busy}>{t('act.remove')}</button>}
                </div>
              ))}
              {a.participants.length === 0 && <p className="small muted" style={{ padding: '10px 0' }}>{tx("Nobody confirmed yet.")}</p>}
            </div>
          ) : <p className="small muted">{tx('{n} going', { n: a.going })}. {t('act.whoHidden')}</p>}
        </section>

        {isOrg && (
          <section className="stack-sm" aria-labelledby="req-h">
            <h2 id="req-h">{t('act.requests')}</h2>
            {a.requests.length === 0 ? <p className="small muted">{t('act.noRequests')}</p> : a.requests.map((r) => (
              <div key={r.user.id} className="card card-pad stack-sm">
                <div className="row">
                  <Avatar person={r.user} />
                  <a href={`#/person/${r.user.id}`} style={{ flex: 1, color: 'inherit' }}><strong>{r.user.first_name}</strong>{r.user.is_demo && <> <SampleBadge /></>}
                    <div className="tiny muted">{r.user.languages.map(langName).join(', ')}</div></a>
                  <StatusBadge status={r.status} />
                </div>
                {r.message && <p className="small">“{r.message}”</p>}
                {r.user.intro && <p className="tiny muted">{r.user.intro}</p>}
                {r.status === 'pending' && !closed && (
                  <div className="row">
                    <button className="btn btn-primary btn-sm" disabled={busy || a.state === 'full'} onClick={() => manage(r.user.id, 'accept', r.user.first_name)}><Icon name="check" size={16} />{t('act.accept')}</button>
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => manage(r.user.id, 'decline', r.user.first_name)}>{t('act.decline')}</button>
                  </div>
                )}
                {r.status === 'pending' && a.state === 'full' && <p className="tiny muted">{tx("The activity is full. Increase the group size with Edit to accept more people.")}</p>}
                {r.status === 'invited' && !closed && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => manage(r.user.id, 'decline', r.user.first_name)}>{tx("Withdraw invitation")}</button>}
              </div>
            ))}
            {!closed && (
              <div className="row">
                <a className="btn btn-secondary btn-sm" href={`#/activity/${a.id}/edit`}><Icon name="edit" size={16} />{t('act.edit')}</a>
                <button className="btn btn-danger btn-sm" onClick={() => setCancelOpen(true)}>{t('act.cancel')}</button>
              </div>
            )}
          </section>
        )}

        {!isOrg && !closed && !a.is_sample && (
          <div className="sticky-actions">
            {!a.my_status || ['left', 'withdrawn'].includes(a.my_status) ? (
              a.state === 'full'
                ? <button className="btn btn-secondary btn-block" disabled>{t('status.full')}</button>
                : a.join_mode === 'open'
                  ? <button className="btn btn-primary btn-block" onClick={joinOpenPlan} disabled={busy}><Icon name="bolt" />{tx('Join plan')}</button>
                  : <button className="btn btn-primary btn-block" onClick={() => setJoinOpen(true)} disabled={busy}>{t('act.request')}</button>
            ) : a.my_status === 'pending' ? (
              <div className="row">
                <span className="badge badge-pending" style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}><Icon name="check" size={14} />{tx('Request sent')}</span>
                <button className="btn btn-ghost" onClick={leave} disabled={busy}>{t('act.withdraw')}</button>
              </div>
            ) : a.my_status === 'invited' ? (
              <div className="row">
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => invitation('accept')} disabled={busy || a.state === 'full'}>{t('act.acceptInvite')}</button>
                <button className="btn btn-secondary" onClick={() => invitation('decline')} disabled={busy}>{t('act.declineInvite')}</button>
              </div>
            ) : a.my_status === 'accepted' ? (
              <div className="row">
                <a className="btn btn-primary" style={{ flex: 1 }} href={`#/activity/${a.id}/chat`}><Icon name="chat" />{t('act.chat')}</a>
                <button className="btn btn-ghost" onClick={leave} disabled={busy}>{tx("Leave")}</button>
              </div>
            ) : null}
          </div>
        )}
        {insider && closed && <a className="btn btn-secondary" href={`#/activity/${a.id}/chat`}><Icon name="chat" />{tx("View chat (read-only)")}</a>}
      </div>

      {joinOpen && (
        <Sheet title={t('act.request')} onClose={() => setJoinOpen(false)}>
          <form className="stack" onSubmit={join}>
            <p className="small">{tx('{name} will see your first name, introduction and languages, and can accept or decline. You are not confirmed until they accept.', { name: a.organiser.first_name })}</p>
            {a.event && <div className="notice blue"><Icon name="info" />{t('event.separate')}</div>}
            <label className="field"><span>{t('act.requestMsg')}</span>
              <textarea className="textarea" maxLength={280} placeholder={t('act.requestPlaceholder')} value={msg} onChange={(e) => setMsg(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy}>{tx("Send request")}</button>
          </form>
        </Sheet>
      )}
      {openConfirm && (
        <Sheet title={tx('Join plan')} onClose={() => joinOpenSheet(false)}>
          <div className="stack">
            <p className="small">{tx('Your first name and picture become visible to the group, and you can chat with them.')}</p>
            {a.event && <div className="notice blue"><Icon name="info" />{t('event.separate')}</div>}
            <button className="btn btn-primary btn-block" disabled={busy} onClick={async () => { joinOpenSheet(false); await joinNow(); }}><Icon name="bolt" />{tx('Join plan')}</button>
          </div>
        </Sheet>
      )}
      {cancelOpen && (
        <Sheet title={t('act.cancel')} onClose={() => setCancelOpen(false)}>
          <form className="stack" onSubmit={cancel}>
            <p className="small">{tx("Everyone confirmed or waiting will see that it’s cancelled. The chat stays readable but nobody can post.")}</p>
            <label className="field"><span>{tx("Reason (optional, shown to participants)")}</span>
              <input className="input" maxLength={200} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={tx("e.g. Rain forecast, let’s reschedule")} />
            </label>
            <button className="btn btn-danger btn-block" disabled={busy}>{tx("Cancel activity")}</button>
          </form>
        </Sheet>
      )}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} meta={meta} />}
    </>
  );
}
