import { useState } from 'react';
import { getAppName, t, tx } from '../i18n.js';
import { ActivityCard, Avatar, ChoiceChips, ErrorState, Icon, Loading, SampleBadge, Sheet, Stamp, TopBar, useApp, DetailPhoto, GoogleMap } from '../components.jsx';
import { photo } from '../../shared/photos.js';
import { eventText, fmtDay, fmtDuration, fmtEventWhen, tzLabel, useApi } from '../util.js';
import { LanguagePicker, langName } from './ProfileBits.jsx';

const MEET_OPTIONS = ["Meet at the venue entrance", "Meet nearby 20 minutes before", "Walk or take the bus there together"];

export default function EventDetail({ id }) {
  const { api, toast, meta, me } = useApp();
  const { data, error, loading, reload } = useApi(`/events/${id}`, { poll: 15000 });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <><TopBar title="" /><div className="page"><Loading rows={2} /></div></>;
  if (error && !data) return <><TopBar title="" /><div className="page"><ErrorState error={error} onRetry={reload} /></div></>;
  const e = data.event;
  const open = e.state === 'open';
  const txt = eventText(e);

  const startFind = () => setForm(e.my_interest ? { ...e.my_interest } : { group_pref: 'either', languages: me.languages.slice(0, 2), meeting_option: MEET_OPTIONS[0], note: '' });
  const save = async (ev) => {
    ev.preventDefault(); setBusy(true);
    try { await api.put(`/events/${e.id}/interest`, form); setForm(null); toast(tx("Saved. Others looking for company can now see you.")); await reload(true); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true);
    try { await api.del(`/events/${e.id}/interest`); toast(tx("You’re no longer listed for this event.")); await reload(true); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const invite = async (p) => {
    setBusy(true);
    try {
      const r = await api.post(`/events/${e.id}/invite`, { userId: p.id });
      toast(tx('Invitation sent to {name}. They decide whether to join.', { name: p.first_name }));
      await reload(true);
      return r;
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
    return null;
  };
  const myGroup = e.groups.find((g) => g.my_status === 'organiser');
  const credit = e.is_sample ? tx('By {name}', { name: e.organiser_name })
    : e.organiser_name ? tx('Organised by {name}', { name: e.organiser_name }) : e.listed_by ? tx('Listed by {name}', { name: e.listed_by }) : null;
  // Tickets matter unless entry is known to be free or there is nothing to book (e.g. a street market).
  const ticketsApply = !e.is_sample && e.time_known !== false && !(e.price_note && /^Free/i.test(e.price_note));
  const goCompany = () => document.getElementById('company')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // A new group starts 30 minutes before the event (or on a day the student picks for a multi-day listing).
  const startLocal = (() => {
    const d = new Date(new Date(e.starts_at).getTime() - 30 * 60e3);
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: e.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = (k) => f.find((x) => x.type === k).value;
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
  })();
  const tplKey = { nightout: 'nightout', culture: 'concert', shopping: 'market' }[e.category];
  const startHref = `#/create?${new URLSearchParams(e.time_known === false
    ? { template: 'market', category: e.category, title: tx('Visit: {name}', { name: e.title }), area: 'santacatalina', event: String(e.id), from: 'event', date: new Date(Math.max(Date.now() + 864e5, new Date(e.starts_at).getTime())).toISOString().slice(0, 10) }
    : { ...(tplKey ? { template: tplKey } : { template: 'other' }), category: e.category, title: tx('Going together: {name}', { name: e.title }).slice(0, 80), event: String(e.id), from: 'event', start: startLocal, cost: '0', ...(e.venue ? { area: e.venue } : {}) })}`;

  return (
    <>
      <TopBar title={e.title} />
      <div className="page">
        {e.photo_key && photo(e.photo_key) && <DetailPhoto ph={photo(e.photo_key)} />}
        <div className="detail-head">
          <Stamp category={e.category} size="lg" />
          <div className="stack-sm" style={{ flex: 1 }}>
            <div className="row wrap" style={{ gap: 6 }}>{e.is_sample && <SampleBadge />}{e.state !== 'open' && <span className={`badge badge-${e.state}`}>{t(`status.${e.state}`)}</span>}</div>
            <h1 style={{ fontSize: '1.45rem' }}>{e.title}</h1>
            {credit && <p className="small muted">{credit}</p>}
          </div>
        </div>
        {e.is_sample && <div className="notice"><Icon name="info" />{tx("Example event for this preview. A real listing would come from the organiser, with their own registration page. Not linked to ESN or any other organisation.")}</div>}
        {txt.note && <div className="notice lime"><Icon name="info" />{txt.note}</div>}
        {e.sessions?.length > 1 && (
          <div className="stack-sm">
            <span className="label">{e.series_key?.startsWith('conpop') ? tx('Choose a session') : tx('Other dates of this listing')}</span>
            <div className="chips" role="group" aria-label={tx('Sessions')}>
              {e.sessions.map((x) => <a key={x.id} className="chip" aria-pressed={x.id === e.id} href={`#/event/${x.id}`}>{fmtDay(x.starts_at, e.timezone)}, {new Intl.DateTimeFormat('en-GB', { timeZone: e.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(x.starts_at))}</a>)}
            </div>
          </div>
        )}

        {/* The two things a visitor wants: company from Erasquest, details from the organiser. */}
        <div className="event-actions">
          <button className="btn btn-primary btn-lg" onClick={goCompany} disabled={!open}><Icon name="group" />{t('event.find')}</button>
          {e.official_url
            ? <a className="btn btn-secondary btn-lg" href={e.official_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={18} />{tx('Official event details')}</a>
            : e.ticket_url
              ? <a className="btn btn-secondary btn-lg" href={e.ticket_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={18} />{tx('Tickets and entry on {platform}', { platform: e.ticket_platform })}</a>
              : <button className="btn btn-secondary btn-lg" disabled>{t('event.registerSample')}</button>}
        </div>
        {ticketsApply && <p className="small event-note"><Icon name="info" size={15} />{tx('Arrange company here. Get tickets from the organiser.')}</p>}

        <div className="card card-pad facts-list">
          <Icon name="clock" /><div><strong>{fmtEventWhen(e)}</strong>{e.time_known !== false && <> · {fmtDuration(e.duration_min)}</>}<div className="tiny muted">{tzLabel(e.timezone)}</div></div>
          <Icon name="pin" /><div>{e.venue}{e.venue_address && <div className="tiny muted">{e.venue_address}</div>}</div>
          {txt.price && <><Icon name="euro" /><div className="small">{txt.price}</div></>}
          {e.age_note && <><Icon name="shield" /><div className="small">{tx('Age: {age}', { age: e.age_note })}</div></>}
          {!e.is_sample && <><Icon name="flag" /><div className="small">
            {e.organiser_name ? tx('Organised by {name}', { name: e.organiser_name }) : tx('Organiser not stated on the source page.')}
            {e.listed_by && <div>{tx('Listed by {name}', { name: e.listed_by })}</div>}
            {e.ticket_platform && <div className="tiny muted">{tx('Ticketing platform: {platform}', { platform: e.ticket_platform })}</div>}
            {e.source_url && <div className="tiny muted">{tx('Source: {source}, checked {date}.', { source: e.source_name, date: e.checked_at })} <a href={e.source_url} target="_blank" rel="noopener noreferrer">{tx('Open source')}</a></div>}
          </div></>}
        </div>
        {e.official_url && e.ticket_url && <a className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} href={e.ticket_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} />{tx('Tickets on {platform}', { platform: e.ticket_platform.split(' (')[0] })}</a>}
        <p>{txt.description}</p>
        {!e.is_sample && <p className="tiny muted">{tx('{app} is independent and not a partner of the organisers listed here.', { app: getAppName() })}</p>}
        <GoogleMap query={e.venue_address || e.venue.replace(/ area$/, '')} title={tx('Map of {place}', { place: e.venue })} />

        <section className="stack" aria-labelledby="groups-h" id="company">
          <div className="stack-sm">
            <h2 id="groups-h">{e.sessions?.length > 1 ? tx('Student groups for this session') : tx('Student groups for this event')}</h2>
            <p className="small muted">{tx('Groups are arranged by students on {app}. Joining one does not reserve a ticket or a place at the event.', { app: getAppName() })}</p>
          </div>
          {e.groups.filter((g) => g.state !== 'past').map((g) => <ActivityCard key={g.id} a={g} />)}
          {open && !myGroup && (
            <a className={`btn btn-block ${e.groups.length ? 'btn-secondary' : 'btn-primary'}`} href={startHref}><Icon name="plus" size={18} />
              {e.time_known === false ? tx('Plan a student visit on a day you choose') : tx('Start a group for this event')}</a>
          )}
          {e.groups.length === 0 && <p className="tiny muted">{tx('No group yet. Start one: the event and time are filled in, you choose where to meet and how many can join, and you review it before publishing.')}</p>}
        </section>

        <section className="card card-pad stack" aria-label={tx('More ways to find company')}>
          <div className="stack-sm">
            <span className="label">{tx('Looking for company without a group?')}</span>
            {!e.my_interest ? (
              <button className="btn btn-secondary btn-block" onClick={startFind} disabled={!open}><Icon name="group" />{tx('Say you’re looking and see who else is')}</button>
            ) : (
              <div className="row wrap">
                <span className="badge badge-confirmed"><Icon name="check" size={13} />{tx("You’re looking for company")}</span>
                <button className="btn btn-ghost btn-sm" onClick={startFind}>{tx("Change preferences")}</button>
                <button className="btn btn-ghost btn-sm" onClick={stop} disabled={busy}>{t('event.optOut')}</button>
              </div>
            )}
            <p className="tiny muted">{t('event.separate')}</p>
          </div>
          <hr className="divider" />
          <div className="stack-sm">
            <span className="label">{tx("Event group chat")}</span>
            {e.my_interest
              ? <a className="btn btn-secondary btn-block" href={`#/event/${e.id}/chat`}><Icon name="chat" size={18} />{tx('Open the group chat ({n} messages)', { n: e.chat_count })}</a>
              : <button className="btn btn-secondary btn-block" onClick={startFind} disabled={!open}><Icon name="chat" size={18} />{tx('Join the group to chat')}</button>}
            <p className="tiny muted">{tx("Everyone who says they’re looking for company can write here, for example to agree where to meet.")}</p>
          </div>
          {ticketsApply && <>
            <hr className="divider" />
            <div className="stack-sm">
              <span className="label">{tx("Tickets from students")}</span>
              <div className="row wrap">
                <a className="btn btn-secondary btn-sm" href={`#/market?event=${e.id}`}><Icon name="star" size={16} />{tx('See tickets ({n})', { n: e.tickets_count || 0 })}</a>
                <a className="btn btn-ghost btn-sm" href={`#/market/new?kind=ticket&event=${e.id}`}>{tx("Sell my ticket")}</a>
              </div>
              <p className="tiny muted">{tx("Only at or below the price paid. Check that the organiser allows tickets to be passed on.")}</p>
            </div>
          </>}
        </section>

        <section className="stack" aria-labelledby="seek-h">
          <div className="stack-sm">
            <h2 id="seek-h">{t('event.seekers')}</h2>
            <p className="small muted">{e.my_interest ? tx("Only people who also opted in can see this list.") : tx(e.seeking_count === 1 ? '1 person is looking. Say you’re looking too to see who and invite them.' : '{n} people are looking. Say you’re looking too to see who and invite them.', { n: e.seeking_count })}</p>
          </div>
          {e.seekers?.length === 0 && <p className="small muted">{tx("Nobody else yet. You’ll appear here for others who look later.")}</p>}
          {e.seekers?.map((s) => (
              <div key={s.user.id} className="card card-pad stack-sm">
                <div className="row">
                  <Avatar person={s.user} />
                  <a href={`#/person/${s.user.id}`} style={{ flex: 1, color: 'inherit' }}><strong>{s.user.first_name}</strong> {s.user.is_demo && <SampleBadge />}
                    <div className="tiny muted">{s.group_pref === 'buddy' ? tx("Prefers one buddy") : s.group_pref === 'small' ? tx("Prefers a small group") : tx("One buddy or a small group")} · {s.languages.map(langName).join(', ')}</div></a>
                </div>
                {s.meeting_option && <p className="small"><Icon name="pin" size={14} /> {tx(s.meeting_option)}</p>}
                {s.reasons.length > 0 && <span className="reason">{[
                  s.match.shared_languages.length && tx('You both speak {langs}', { langs: s.match.shared_languages.map(langName).join(tx(' and ')) }),
                  s.match.same_pref && tx(s.match.same_pref === 'buddy' ? 'You both prefer one buddy' : 'You both prefer a small group'),
                  s.match.same_meeting && tx('Same meeting option: {opt}', { opt: tx(s.meeting_option) }),
                ].filter(Boolean).join(' · ')}</span>}
                <button className="btn btn-primary btn-sm" disabled={busy || !open} onClick={() => invite(s.user)}>{myGroup ? tx("Invite to your group") : t('event.invite')}</button>
              </div>
          ))}
        </section>
      </div>

      {form && (
        <Sheet title={t('event.find')} onClose={() => setForm(null)}>
          <form className="stack" onSubmit={save}>
            <div className="field"><span className="label">{tx("I’d like to go with")}</span>
              <ChoiceChips label={tx("Group preference")} value={form.group_pref} onChange={(group_pref) => setForm({ ...form, group_pref: group_pref || 'either' })}
                options={[{ key: 'buddy', label: tx("One buddy") }, { key: 'small', label: tx("A small group") }, { key: 'either', label: tx("Either is fine") }]} />
            </div>
            <LanguagePicker value={form.languages} onChange={(languages) => setForm({ ...form, languages })} />
            <div className="field"><span className="label">{tx("Meeting option")}</span>
              <ChoiceChips label={tx("Meeting option")} value={form.meeting_option} onChange={(meeting_option) => setForm({ ...form, meeting_option })} options={MEET_OPTIONS.map((m) => ({ key: m, label: tx(m) }))} />
            </div>
            <label className="field"><span>{tx("Anything practical? (optional)")}</span>
              <input className="input" maxLength={200} value={form.note} onChange={(ev) => setForm({ ...form, note: ev.target.value })} placeholder={tx("e.g. I’ll come straight from class, step-free route please")} />
            </label>
            <p className="small muted">{tx("Your first name, languages and these preferences are shown only to others who are also looking for company for this event.")}</p>
            <button className="btn btn-primary btn-block" disabled={busy}>{tx("Show me who else is going")}</button>
          </form>
        </Sheet>
      )}
    </>
  );
}
