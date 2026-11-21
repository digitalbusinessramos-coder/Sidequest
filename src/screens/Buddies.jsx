import { useState } from 'react';
import { t, tx } from '../i18n.js';
import { ActivityCard, Avatar, ErrorState, Icon, Loading, Sheet, useApp } from '../components.jsx';
import { ROLE_LABEL } from './Person.jsx';
import { fmtPlanWhen, useApi } from '../util.js';
import { categoryLabel } from '../../shared/catalog.js';
import { FlagList, langName, stayText } from './ProfileBits.jsx';
import { Connections } from './Connect.jsx';

/**
 * Invite one person to one of my upcoming plans, or start a new plan for them.
 * Nothing is sent until the organiser taps Invite; the other person decides whether to join.
 */
export function InviteSheet({ person, onClose }) {
  const { api, toast, me, openAccount } = useApp();
  const plans = useApi(me.is_guest ? null : '/plans');
  const [sent, setSent] = useState({});
  const [busy, setBusy] = useState(null);
  const open = (plans.data?.organising || []).filter((a) => a.state !== 'past' && a.state !== 'cancelled' && a.status !== 'cancelled');
  const invite = async (a) => {
    setBusy(a.id);
    try {
      await api.post(`/activities/${a.id}/invite`, { userId: person.id });
      setSent((x) => ({ ...x, [a.id]: true }));
      toast(tx('Invitation sent to {name}. They decide whether to join.', { name: person.first_name }));
    } catch (x) { toast(tx(x.message), true); } finally { setBusy(null); }
  };
  return (
    <Sheet title={tx('Invite {name} to a plan', { name: person.first_name })} onClose={onClose}>
      <div className="stack">
        {me.is_guest ? (
          <>
            <p className="small">{tx('Create a free account to invite people to your plans.')}</p>
            <button className="btn btn-primary" onClick={() => { onClose(); openAccount('signup'); }}>{tx('Create account')}</button>
          </>
        ) : plans.loading && !plans.data ? <Loading rows={1} /> : plans.error ? <ErrorState error={plans.error} onRetry={plans.reload} /> : (
          <>
            {open.length > 0 ? (
              <>
                <p className="small muted">{tx('Pick one of your upcoming plans. {name} gets an invitation in My Plans and decides whether to join.', { name: person.first_name })}</p>
                <div className="card" style={{ padding: 0 }}>
                  {open.map((a) => {
                    const full = a.spots_left === 0;
                    return (
                      <div key={a.id} className="person-row" style={{ padding: '10px 14px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>{a.title}</strong>
                          <div className="tiny muted">{fmtPlanWhen(a)}{a.meeting_area ? ` · ${a.meeting_area}` : ''}</div>
                        </div>
                        {sent[a.id] ? <span className="small" style={{ color: 'var(--lime-ink)', fontWeight: 650 }}><Icon name="check" size={15} /> {tx('Invited')}</span>
                          : <button className="btn btn-primary btn-sm" disabled={full || busy === a.id} onClick={() => invite(a)}>{full ? tx('Full') : tx('Invite')}</button>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <p className="small muted">{tx('You have no upcoming plans yet. Create one and {name} gets the invitation as soon as it is published.', { name: person.first_name })}</p>}
            <a className="btn btn-secondary" href={`#/create?invite=${person.id}`} onClick={onClose}><Icon name="plus" size={16} />{tx('Create a new plan for {name}', { name: person.first_name })}</a>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Buddies: discover students in Las Palmas and invite them to a specific plan. No statuses, wishes or matching scores. */
export default function Buddies() {
  const inv = useApi('/invitations', { poll: 15000 });
  const people = useApi('/people');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [inviting, setInviting] = useState(null);
  const list = (people.data?.people || []).filter((p) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [p.first_name, p.intro, p.area, ...(p.languages || []).map(langName), ...p.interests.map((c) => tx(categoryLabel(c)))].some((x) => (x || '').toLowerCase().includes(s));
  });
  const shown = showAll || q ? list : list.slice(0, 12);

  return (
    <div className="page">
      <div className="stack-sm"><h1>{t('buddies.title')}</h1>
        <p className="small muted">{tx('Find other students in Las Palmas, connect, and invite them to a plan.')}</p></div>

      <Connections />

      {inv.data?.invitations.length > 0 && (
        <section className="stack" aria-labelledby="inv-h">
          <h2 id="inv-h">{tx('Invitations for you')}</h2>
          {inv.data.invitations.map((a) => <ActivityCard key={a.id} a={a} />)}
        </section>
      )}

      <section className="stack" aria-labelledby="ppl-h" data-tour="students">
        <div className="section-title"><h2 id="ppl-h">{tx('Students in {city}', { city: 'Las Palmas' })}</h2>
          {people.data && <span className="small muted">{tx('{n} people', { n: people.data.people.length })}</span>}</div>
        {people.data?.people.length > 6 && (
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search by name, language or interest')} aria-label={tx('Search students')} />
        )}
        {people.loading && !people.data ? <Loading rows={2} /> : people.error ? <ErrorState error={people.error} onRetry={people.reload} />
          : people.data.people.length === 0 ? (
            <div className="card card-pad stack-sm">
              <strong>{tx('No other students here yet.')}</strong>
              <p className="small muted">{tx('Profiles appear here when students create an account. Meanwhile, post a plan: people can find it in Explore.')}</p>
              <a className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} href="#/create"><Icon name="plus" size={15} />{tx('Create a plan')}</a>
            </div>
          ) : list.length === 0 ? <p className="small muted">{tx('Nobody matches “{q}”.', { q })}</p> : (
            <div className="people-grid">
              {shown.map((p) => (
                <article key={p.id} className="card person-card">
                  <a href={`#/person/${p.id}`} className="person-card-top">
                    <Avatar person={p} size="lg" />
                    <div style={{ minWidth: 0 }}>
                      <strong className="person-name">{p.first_name}</strong>
                      <div className="tiny muted">{tx(ROLE_LABEL[p.role] || 'Student')}{stayText(p) ? ` · ${stayText(p)}` : ''}</div>
                    </div>
                  </a>
                  {p.intro && <p className="small person-intro">{p.intro}</p>}
                  {p.flags?.length > 0 && <div className="tiny"><FlagList flags={p.flags} /></div>}
                  {p.languages?.length > 0 && <div className="tiny muted"><Icon name="globe" size={13} /> {p.languages.map(langName).join(', ')}</div>}
                  {p.interests.length > 0 && (
                    <div className="chips-static">
                      {p.interests.slice(0, 4).map((c) => <span key={c} className={`mini-chip ${p.shared.includes(c) ? 'on' : ''}`}><Icon name={c} size={13} />{tx(categoryLabel(c))}</span>)}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 'auto' }}>
                    {p.area && <span className="tiny muted" style={{ flex: 1, minWidth: 90 }}><Icon name="pin" size={13} /> {p.area}</span>}
                    <span className="spacer" />
                    <button className="btn btn-sm btn-secondary" onClick={() => setInviting(p)}><Icon name="plus" size={15} />{tx('Invite to a plan')}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        {!q && list.length > 12 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setShowAll(!showAll)}>{showAll ? tx('Show fewer') : tx('Show all {n}', { n: list.length })}</button>}
      </section>
      {inviting && <InviteSheet person={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}
