import { useState } from 'react';
import { tx } from '../i18n.js';
import { ErrorState, Icon, Loading, TopBar, useApp } from '../components.jsx';
import { fmtWhen, useApi } from '../util.js';

const TYPE_LABEL = { user: 'Profile', activity: 'Plan', message: 'Plan chat message', event_message: 'Event chat message', recommendation: 'Tip', listing: 'Marketplace listing', listing_message: 'Marketplace message' };

/** Ask for the team access code once. The server checks it and remembers this account as a team member. */
function Unlock({ status, onDone }) {
  const { api, me, openAccount } = useApp();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (me.is_guest) {
    return (
      <div className="card card-pad stack-sm">
        <p>{tx('This page is only for the project team. Log in with your own account first.')}</p>
        <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => openAccount('login')}>{tx('Log in')}</button>
      </div>
    );
  }
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/team/unlock', { code }); onDone(); } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
  };
  return (
    <form className="card card-pad stack-sm" onSubmit={send}>
      <p>{tx('This page is only for the project team. Enter the team access code once and this account keeps access.')}</p>
      {!status?.code_configured && <p className="small muted">{tx('No access code is set up on the server yet, so nobody can unlock this page.')}</p>}
      <label className="field"><span>{tx('Team access code')}</span>
        <input className="input" type="password" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {err && <div className="form-error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !code}>{tx('Open the team inbox')}</button>
    </form>
  );
}

function ReviewButton({ item, kind, reload }) {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const reviewed = item.status === 'reviewed';
  const flip = async () => {
    setBusy(true);
    try { await api.post(`/team/${kind}/${item.id}`, { status: reviewed ? 'open' : 'reviewed' }); await reload(true); } catch (x) { toast(tx(x.message), true); } finally { setBusy(false); }
  };
  return <button className={`btn btn-sm ${reviewed ? 'btn-ghost' : 'btn-secondary'}`} onClick={flip} disabled={busy}><Icon name={reviewed ? 'back' : 'check'} size={15} />{reviewed ? tx('Reopen') : tx('Mark as reviewed')}</button>;
}

function Reports() {
  const { city } = useApp();
  const { data, error, loading, reload } = useApi('/team/reports', { poll: 30000 });
  if (loading && !data) return <Loading rows={2} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.reports.length) return <p className="small muted">{tx('No reports yet.')}</p>;
  return data.reports.map((r) => (
    <article key={r.id} className={`card card-pad stack-sm ${r.status === 'open' ? 'team-open' : ''}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${r.status === 'open' ? 'badge-open' : ''}`}>{r.status === 'open' ? tx('Waiting for review') : tx('Reviewed')}</span>
        <strong style={{ flex: 1 }}>{tx(r.reason)}</strong>
        <span className="tiny muted">{fmtWhen(r.created_at, city.timezone)}</span>
      </div>
      <div className="small">{tx(TYPE_LABEL[r.target_type] || r.target_type)}{r.target ? <>: {r.target.link ? <a href={r.target.link}>{r.target.label}</a> : r.target.label}</> : <span className="muted"> {tx('(no longer exists)')}</span>}
        {r.target?.author && <> · {tx('by')} <a href={`#/person/${r.target.author.id}`}>{r.target.author.first_name}</a></>}</div>
      {r.details && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>“{r.details}”</p>}
      <div className="row wrap tiny muted" style={{ gap: 10 }}>
        <span>{tx('Reported by {name}', { name: r.reporter?.first_name || tx('a deleted account') })}</span>
        {r.reviewed_at && <span>{tx('Reviewed by {name}, {when}', { name: r.reviewed_by || '?', when: fmtWhen(r.reviewed_at, city.timezone) })}</span>}
      </div>
      <ReviewButton item={r} kind="reports" reload={reload} />
    </article>
  ));
}

function Feedback() {
  const { city } = useApp();
  const { data, error, loading, reload } = useApi('/team/feedback', { poll: 30000 });
  if (loading && !data) return <Loading rows={2} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.feedback.length) return <p className="small muted">{tx('No feedback yet.')}</p>;
  return data.feedback.map((f) => (
    <article key={f.id} className={`card card-pad stack-sm ${f.status === 'open' ? 'team-open' : ''}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${f.status === 'open' ? 'badge-open' : ''}`}>{f.status === 'open' ? tx('New') : tx('Reviewed')}</span>
        <strong style={{ flex: 1 }}>{tx({ idea: 'Idea', problem: 'Problem', other: 'Other' }[f.kind] || f.kind)}</strong>
        <span className="tiny muted">{fmtWhen(f.created_at, city.timezone)}</span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{f.body}</p>
      <div className="row wrap tiny muted" style={{ gap: 10 }}>
        <span>{tx('From {name}', { name: f.from?.first_name || tx('a deleted account') })}</span>
        {f.reply_email ? <a href={`mailto:${f.reply_email}`}>{tx('Reply to {email}', { email: f.reply_email })}</a> : <span>{tx('No reply address')}</span>}
        {f.screen && <span>{tx('Sent from {screen}', { screen: f.screen })}</span>}
        {f.reviewed_at && <span>{tx('Reviewed by {name}, {when}', { name: f.reviewed_by || '?', when: fmtWhen(f.reviewed_at, city.timezone) })}</span>}
      </div>
      <ReviewButton item={f} kind="feedback" reload={reload} />
    </article>
  ));
}

function Numbers() {
  const { data, error, loading, reload } = useApi('/team/numbers');
  if (loading && !data) return <Loading rows={1} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const rows = [['Accounts', data.accounts], ['New accounts in the last 7 days', data.accounts_7d], ['Plans created', data.plans], ['Upcoming plans', data.plans_upcoming], ['Confirmed joins', data.joins]];
  return (
    <div className="stack-sm">
      <div className="card" style={{ padding: 0 }}>
        {rows.map(([k, v]) => <div key={k} className="person-row" style={{ padding: '10px 14px' }}><span style={{ flex: 1 }}>{tx(k)}</span><strong>{v}</strong></div>)}
      </div>
      <p className="tiny muted">{tx('Real people only. Example plans, guests and {n} test accounts are left out.', { n: data.excluded_test_accounts })}</p>
    </div>
  );
}

/** Team inbox at #/team. Every request is checked on the server; this page only shows what the server allows. */
export default function Team() {
  const { api, reloadMe } = useApp();
  const status = useApi('/team/me');
  const [tab, setTab] = useState('reports');
  const tabs = [['reports', 'Reports'], ['feedback', 'Feedback'], ['numbers', 'Numbers']];
  const leave = async () => { await api.post('/team/leave'); await reloadMe(); status.reload(); };
  return (
    <>
      <TopBar title={tx('Team inbox')} />
      <div className="page">
        {status.loading && !status.data ? <Loading rows={1} /> : status.error ? <ErrorState error={status.error} onRetry={status.reload} />
          : !status.data.admin ? <Unlock status={status.data} onDone={async () => { await reloadMe(); status.reload(); }} /> : (
            <>
              {(!status.data.alert_email || !status.data.email_service) && (
                <div className="notice"><Icon name="info" />{tx('Email alerts for new reports are off, so check this page regularly. To switch them on, set TEAM_ALERT_EMAIL, RESEND_API_KEY and EMAIL_FROM on the server.')}</div>
              )}
              <div className="seg" role="tablist" aria-label={tx('Team inbox')}>
                {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{tx(label)}</button>)}
              </div>
              <div className="stack" role="tabpanel">{tab === 'reports' ? <Reports /> : tab === 'feedback' ? <Feedback /> : <Numbers />}</div>
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={leave}>{tx('Remove team access from this account')}</button>
            </>
          )}
      </div>
    </>
  );
}
