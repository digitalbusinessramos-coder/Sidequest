import { useState } from 'react';
import { t, tx } from '../i18n.js';
import { ActivityCard, Avatar, ChoiceChips, ErrorState, Icon, Loading, SampleBadge, Sheet, Stamp, TopBar, useApp } from '../components.jsx';
import { fmtDuration, fmtWhen, tzLabel, useApi } from '../util.js';

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

  return (
    <>
      <TopBar title={e.title} />
      <div className="page">
        <div className="detail-head">
          <Stamp category={e.category} size="lg" />
          <div className="stack-sm" style={{ flex: 1 }}>
            <div className="row wrap" style={{ gap: 6 }}>{e.is_sample && <SampleBadge />}{e.state !== 'open' && <span className={`badge badge-${e.state}`}>{t(`status.${e.state}`)}</span>}</div>
            <h1 style={{ fontSize: '1.45rem' }}>{e.title}</h1>
            <p className="small muted">{tx('By {name}', { name: e.organiser_name })}</p>
          </div>
        </div>
        {e.is_sample && <div className="notice"><Icon name="info" />{tx("This is fictional sample content for demonstration. It is not a real event and is not provided by or endorsed by ESN or any other organisation.")}</div>}
        <div className="card card-pad facts-list">
          <Icon name="clock" /><div><strong>{fmtWhen(e.starts_at, e.timezone)}</strong> · {fmtDuration(e.duration_min)}<div className="tiny muted">{tzLabel(e.timezone)}</div></div>
          <Icon name="pin" /><div>{e.venue}</div>
          {e.price_note && <><Icon name="euro" /><div className="small">{e.price_note}</div></>}
        </div>
        <p>{e.description}</p>

        <section className="card card-pad stack" aria-label={tx("Two separate steps")}>
          <div className="stack-sm">
            <span className="label">{tx("1 · Get a place at the event")}</span>
            {e.official_url
              ? <a className="btn btn-secondary btn-block" href={e.official_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={18} />{t('event.register')}</a>
              : <button className="btn btn-secondary btn-block" disabled>{t('event.registerSample')}</button>}
            <p className="tiny muted">{tx("Registration, tickets and payment happen with the organiser, never in this app.")}</p>
          </div>
          <hr className="divider" />
          <div className="stack-sm">
            <span className="label">{tx("2 · Find people to go with")}</span>
            {!e.my_interest ? (
              <button className="btn btn-primary btn-block" onClick={startFind} disabled={!open}><Icon name="group" />{t('event.find')}</button>
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
            <span className="label">{tx("3 · Event group chat")}</span>
            {e.my_interest
              ? <a className="btn btn-secondary btn-block" href={`#/event/${e.id}/chat`}><Icon name="chat" size={18} />{tx('Open the group chat ({n} messages)', { n: e.chat_count })}</a>
              : <button className="btn btn-secondary btn-block" onClick={startFind} disabled={!open}><Icon name="chat" size={18} />{tx('Join the group to chat')}</button>}
            <p className="tiny muted">{tx("Everyone who says they’re looking for company can write here, for example to agree where to meet.")}</p>
          </div>
          <hr className="divider" />
          <div className="stack-sm">
            <span className="label">{tx("Tickets from students")}</span>
            <div className="row wrap">
              <a className="btn btn-secondary btn-sm" href={`#/market?event=${e.id}`}><Icon name="star" size={16} />{tx('See tickets ({n})', { n: e.tickets_count || 0 })}</a>
              <a className="btn btn-ghost btn-sm" href={`#/market/new?kind=ticket&event=${e.id}`}>{tx("Sell my ticket")}</a>
            </div>
            <p className="tiny muted">{tx("Only at or below the price paid. Check that the organiser allows tickets to be passed on.")}</p>
          </div>
        </section>

        <section className="stack" aria-labelledby="groups-h">
          <h2 id="groups-h">{t('event.groups')}</h2>
          {e.groups.length === 0 ? <p className="small muted">{tx("No groups yet. Invite someone below to start one.")}</p> : e.groups.map((g) => <ActivityCard key={g.id} a={g} />)}
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
                    <div className="tiny muted">{s.group_pref === 'buddy' ? tx("Prefers one buddy") : s.group_pref === 'small' ? tx("Prefers a small group") : tx("One buddy or a small group")} · {s.languages.map((l) => tx(l)).join(', ')}</div></a>
                </div>
                {s.meeting_option && <p className="small"><Icon name="pin" size={14} /> {tx(s.meeting_option)}</p>}
                {s.reasons.length > 0 && <span className="reason">{[
                  s.match.shared_languages.length && tx('You both speak {langs}', { langs: s.match.shared_languages.map((l) => tx(l)).join(tx(' and ')) }),
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
            <div className="field"><span className="label">{tx("Languages")}</span>
              <ChoiceChips multiple label={tx("Languages")} value={form.languages} onChange={(languages) => setForm({ ...form, languages })} options={meta.languages.map((l) => ({ key: l, label: l }))} />
            </div>
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
