import { Fragment, useState } from 'react';
import { locale, t, tx } from '../i18n.js';
import { ActivityCard, Avatar, ChoiceChips, Empty, ErrorState, Icon, Loading, SampleBadge, Sheet, Stamp, StatusLine, useApp } from '../components.jsx';
import { ROLE_LABEL } from './Person.jsx';
import { INVITE_FOR, inviteHref, localDate, nextSlot, useApi } from '../util.js';
import { DAYS, PARTS, categoryLabel, categoryPhrase } from '../../shared/catalog.js';

// The server decides the match with simple rules; the sentence is built here so it can be shown in any language.
function reasonText(s) {
  const what = tx(categoryPhrase(s.category));
  return s.overlap.length
    ? tx('You both want to {what} and are available {when}.', { what, when: s.overlap.slice(0, 2).map((x) => slotText(x)).join(tx(' or ')) })
    : tx('You both want to {what}. One of you is flexible about timing.', { what });
}
function extrasText(s) {
  const out = [];
  if (s.shared_languages.length) out.push(tx('You both speak {langs}.', { langs: s.shared_languages.slice(0, 2).map((l) => tx(l)).join(tx(' and ')) }));
  if (s.budget_note === 'both_free') out.push(tx('You both prefer free plans.'));
  if (s.budget_note === 'one_free') out.push(tx('One of you prefers free plans, so keep it free.'));
  return out.join(' ');
}

const slotText = (slot) => { const [d, p] = slot.split('_'); return `${tx(DAYS.find((x) => x[0] === d)?.[1] || d)} ${tx(p)}`; };

/** The owner's own status: what I feel like doing, when, roughly where, and until when it is shown. */
function MyStatus() {
  const { me, meta, city, api, toast, reloadMe } = useApp();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const st = me.status;
  const tz = city.timezone;
  const days = [['', tx('Flexible')], ...DAYS.map(([d, n]) => [d, tx(n)])];
  const open = () => {
    const [d = '', p = ''] = (st?.slot || '').split('_');
    setForm({ category: st?.category || '', day: d, part: p || 'afternoon', area: st?.area || '', note: st?.note || '',
      until: st ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(st.expires_at)) : localDate(tz, 2) });
  };
  const pickDay = (day) => {
    const next = day && nextSlot(`${day}_${form.part}`, tz);
    setForm({ ...form, day, until: next ? next.date : form.until });
  };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.put('/me/status', { category: form.category, slot: form.day ? `${form.day}_${form.part}` : null, area: form.area || null, note: form.note, until: form.until });
      await reloadMe(); setForm(null); toast(tx('Status saved. It disappears automatically after the end date.'));
    } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { await api.del('/me/status'); await reloadMe(); setForm(null); toast(tx('Status cleared.')); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const untilText = st && new Intl.DateTimeFormat(locale(), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(st.expires_at));
  return (
    <section className="card card-pad stack-sm my-status" aria-labelledby="st-h" data-tour="status">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h2 id="st-h" style={{ fontSize: '1.1rem' }}>{tx('What do you feel like doing?')}</h2>
        {st && <span className="tiny muted">{tx('Shown until {date}', { date: untilText })}</span>}
      </div>
      {st ? <StatusLine status={st} /> : <p className="small muted">{tx('Optional. For example “Coffee, Friday afternoon, near Las Canteras”. Other students see it on your card until the date you choose.')}</p>}
      {me.is_guest && <p className="tiny muted">{tx('As a guest, nobody else sees your status. Create an account to show it.')}</p>}
      <div className="row wrap">
        <button className="btn btn-secondary btn-sm" onClick={open}><Icon name={st ? 'edit' : 'plus'} size={15} />{st ? tx('Edit status') : tx('Set a status')}</button>
        {st && <button className="btn btn-ghost btn-sm" onClick={clear} disabled={busy}>{tx('Clear')}</button>}
      </div>
      {form && (
        <Sheet title={tx('What do you feel like doing?')} onClose={() => setForm(null)}>
          <form className="stack" onSubmit={save}>
            <div className="field"><span className="label">{tx('I feel like…')}</span>
              <ChoiceChips label={tx('Activity')} value={form.category} onChange={(category) => setForm({ ...form, category })} options={meta.categories.map((c) => ({ key: c.key, label: c.label }))} />
            </div>
            <div className="grid-2">
              <label className="field"><span>{tx('Day (optional)')}</span>
                <select className="select" value={form.day} onChange={(e) => pickDay(e.target.value)}>
                  {days.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              </label>
              <label className="field"><span>{tx('Time of day')}</span>
                <select className="select" value={form.part} disabled={!form.day} onChange={(e) => setForm({ ...form, part: e.target.value })}>
                  {PARTS.map(([k]) => <option key={k} value={k}>{tx(k)}</option>)}
                </select>
              </label>
            </div>
            <label className="field"><span>{tx('Rough area (optional)')}</span>
              <select className="select" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                <option value="">{tx('Anywhere')}</option>
                {city.areas.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
              </select>
              <span className="hint">{tx('Only the neighbourhood is shown, never an address.')}</span>
            </label>
            <label className="field"><span>{tx('Note (optional)')}</span>
              <input className="input" maxLength={80} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={tx('e.g. Happy to practise Spanish')} />
            </label>
            <label className="field"><span>{tx('Show until')}</span>
              <input className="input" type="date" required min={localDate(tz)} max={localDate(tz, 30)} value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} />
              <span className="hint">{tx('After this day the status is hidden automatically.')}</span>
            </label>
            <div className="row">
              {st && <button type="button" className="btn btn-ghost" onClick={clear} disabled={busy}>{tx('Clear status')}</button>}
              <span className="spacer" />
              <button className="btn btn-primary" disabled={busy || !form.category}>{tx('Save status')}</button>
            </div>
          </form>
        </Sheet>
      )}
    </section>
  );
}

function SlotPicker({ value, onChange }) {
  const toggle = (s) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div className="slot-grid" role="group" aria-label={tx("When are you usually free?")}>
      <span />{PARTS.map(([p]) => <span key={p} className="tiny muted" style={{ textAlign: 'center' }}>{tx(p)}</span>)}
      {DAYS.map(([d, name]) => (
        <Fragment key={d}>
          <span className="tiny" style={{ fontWeight: 650 }}>{tx(name).slice(0, 3)}</span>
          {PARTS.map(([p]) => {
            const s = `${d}_${p}`;
            return <button key={s} type="button" aria-pressed={value.includes(s)} aria-label={`${tx(name)} ${tx(p)}`} onClick={() => toggle(s)}>{value.includes(s) ? '✓' : ''}</button>;
          })}
        </Fragment>
      ))}
    </div>
  );
}

export default function Buddies() {
  const { meta, api, toast } = useApp();
  const wishes = useApi('/wishes');
  const sugg = useApi('/wishes/suggestions', { poll: 30000 });
  const inv = useApi('/invitations', { poll: 15000 });
  const people = useApi('/people');
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post('/wishes', form); setForm(null); toast(tx("Wish saved. We’ll show people with the same wish.")); wishes.reload(); sugg.reload(); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await api.del(`/wishes/${id}`); wishes.reload(); sugg.reload(); } catch (x) { toast(x.message, true); }
  };
  const tplFor = (cat) => meta.templates.find((x) => x.category === cat)?.key;

  return (
    <div className="page">
      <div className="stack-sm"><span className="eyebrow">{tx("Same wish, same time")}</span><h1>{t('buddies.title')}</h1>
        <p className="small muted">{t('buddies.lead')}</p></div>

      <MyStatus />

      {inv.data?.invitations.length > 0 && (
        <section className="stack" aria-labelledby="inv-h">
          <h2 id="inv-h">{tx("Invitations for you")}</h2>
          {inv.data.invitations.map((a) => <ActivityCard key={a.id} a={a} />)}
        </section>
      )}

      <section className="stack" aria-labelledby="ppl-h" data-tour="students">
        <div className="section-title"><h2 id="ppl-h">{tx('Students in {city}', { city: 'Las Palmas' })}</h2>
          {people.data && <span className="small muted">{tx('{n} people', { n: people.data.people.length })}</span>}</div>
        <p className="small muted">{tx('Tap someone to see their profile, or invite them to a plan. Add your interests in your profile and we show what you have in common.')}</p>
        {people.loading && !people.data ? <Loading rows={2} /> : people.error ? <ErrorState error={people.error} onRetry={people.reload} />
          : (
            <div className="people-grid">
              {people.data.people.slice(0, showAll ? undefined : 6).map((p) => (
                <article key={p.id} className="card person-card">
                  <a href={`#/person/${p.id}`} className="person-card-top">
                    <Avatar person={p} size="lg" />
                    <div style={{ minWidth: 0 }}>
                      <strong className="person-name">{p.first_name}</strong> {p.is_demo && <SampleBadge />}
                      <div className="tiny muted">{tx(ROLE_LABEL[p.role] || 'Student')}{p.area ? ` · ${p.area.split(' / ')[0]}` : ''}</div>
                    </div>
                  </a>
                  {p.status && <StatusLine status={p.status} />}
                  {p.intro && <p className="small person-intro">{p.intro}</p>}
                  <div className="chips-static">
                    {p.interests.slice(0, 4).map((c) => <span key={c} className={`mini-chip ${p.shared.includes(c) ? 'on' : ''}`}><Icon name={c} size={13} />{tx(categoryLabel(c))}</span>)}
                  </div>
                  <div className="row" style={{ marginTop: 'auto' }}>
                    {p.shared.length > 0 && <span className="tiny" style={{ color: 'var(--lime-ink)', fontWeight: 650, flex: 1 }}>{tx('You both like {what}', { what: p.shared.slice(0, 2).map((c) => tx(categoryLabel(c)).toLowerCase()).join(tx(' and ')) })}</span>}
                    <span className="spacer" />
                    <a className={`btn btn-sm ${p.status ? 'btn-primary' : 'btn-secondary'}`} href={inviteHref(p, meta.templates)}><Icon name="plus" size={15} />{p.status ? tx(INVITE_FOR[p.status.category] || 'Invite') : tx('Invite')}</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        {people.data?.people.length > 6 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setShowAll(!showAll)}>{showAll ? tx('Show fewer') : tx('Show all {n}', { n: people.data.people.length })}</button>}
      </section>

      <section className="stack" aria-labelledby="sug-h" data-tour="matches">
        <h2 id="sug-h">{t('buddies.suggestions')}</h2>
        {sugg.loading && !sugg.data ? <Loading rows={1} /> : sugg.error ? <ErrorState error={sugg.error} onRetry={sugg.reload} />
          : sugg.data.suggestions.length === 0 ? <p className="small muted">{wishes.data?.wishes.length ? t('buddies.noSuggestions') : tx("Add a wish below to see people who want the same thing.")}</p>
            : sugg.data.suggestions.map((s) => (
              <div key={`${s.wish_id}-${s.other_wish_id}`} className="card card-pad stack-sm">
                <div className="row">
                  <Avatar person={s.user} />
                  <a href={`#/person/${s.user.id}`} style={{ flex: 1, color: 'inherit' }}><strong>{s.user.first_name}</strong> {s.user.is_demo && <SampleBadge />}
                    <div className="tiny muted">{tx(categoryLabel(s.category))}{s.other_note ? ` · “${s.other_note}”` : ''}</div></a>
                </div>
                <p style={{ fontWeight: 600 }}>{reasonText(s)}</p>
                {extrasText(s) && <p className="small muted">{extrasText(s)}</p>}
                <a className="btn btn-primary btn-sm" href={`#/create?template=${tplFor(s.category) || 'other'}&category=${s.category}&invite=${s.user.id}`}><Icon name="plus" size={16} />{t('buddies.propose')}</a>
              </div>
            ))}
        <p className="tiny muted"><Icon name="info" size={13} /> {t('buddies.ruleNote')}</p>
      </section>

      <section className="stack" aria-labelledby="w-h">
        <div className="section-title"><h2 id="w-h">{t('buddies.wishes')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={() => setForm({ category: '', note: '', slots: [], budget: 'any' })}><Icon name="plus" size={16} />{t('buddies.addWish')}</button></div>
        {wishes.loading && !wishes.data ? <Loading rows={1} /> : wishes.error ? <ErrorState error={wishes.error} onRetry={wishes.reload} />
          : wishes.data.wishes.length === 0 ? <Empty icon="star" title={t('buddies.noWishes')} hint={tx("For example: “Visit a museum, Thursday afternoons, free or cheap.”")} />
            : wishes.data.wishes.map((w) => (
              <div key={w.id} className="card card-pad row">
                <Stamp category={w.category} />
                <div style={{ flex: 1 }}>
                  <strong>{tx(categoryLabel(w.category))}</strong>{w.note && <span className="muted"> · {w.note}</span>}
                  <div className="tiny muted">{w.slots.length ? w.slots.map((x) => slotText(x)).join(', ') : tx("Flexible timing")} · {tx(meta.budgets.find((b) => b.key === w.budget)?.label || '')}</div>
                </div>
                <button className="icon-btn" aria-label={tx('Delete wish: {what}', { what: tx(categoryLabel(w.category)) })} onClick={() => remove(w.id)}><Icon name="trash" /></button>
              </div>
            ))}
      </section>

      {form && (
        <Sheet title={t('buddies.addWish')} onClose={() => setForm(null)}>
          <form className="stack" onSubmit={add}>
            <div className="field"><span className="label">{tx("I’d like to…")}</span>
              <ChoiceChips label={tx("Activity")} value={form.category} onChange={(category) => setForm({ ...form, category })} options={meta.categories.map((c) => ({ key: c.key, label: c.label }))} />
            </div>
            <label className="field"><span>{tx("Details (optional)")}</span>
              <input className="input" maxLength={140} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={tx("e.g. Modern art, or anything in the old town")} />
            </label>
            <div className="field"><span className="label">{tx("When are you usually free?")}</span>
              <span className="hint">{tx("Leave empty if you’re flexible.")}</span>
              <SlotPicker value={form.slots} onChange={(slots) => setForm({ ...form, slots })} />
            </div>
            <div className="field"><span className="label">{tx("Budget")}</span>
              <ChoiceChips label={tx("Budget")} value={form.budget} onChange={(budget) => setForm({ ...form, budget: budget || 'any' })} options={meta.budgets} />
            </div>
            <p className="small muted">{tx("Others with a compatible wish see your first name, languages and this wish. Pause this any time in Profile.")}</p>
            <button className="btn btn-primary btn-block" disabled={busy || !form.category}>{tx("Save wish")}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
