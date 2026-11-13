import { Fragment, useState } from 'react';
import { t, tx } from '../i18n.js';
import { ActivityCard, Avatar, ChoiceChips, Empty, ErrorState, Icon, Loading, SampleBadge, Sheet, Stamp, useApp } from '../components.jsx';
import { ROLE_LABEL } from './Person.jsx';
import { useApi } from '../util.js';
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

      {inv.data?.invitations.length > 0 && (
        <section className="stack" aria-labelledby="inv-h">
          <h2 id="inv-h">{tx("Invitations for you")}</h2>
          {inv.data.invitations.map((a) => <ActivityCard key={a.id} a={a} />)}
        </section>
      )}

      <section className="stack" aria-labelledby="ppl-h">
        <div className="section-title"><h2 id="ppl-h">{tx('Students in {city}', { city: 'Las Palmas' })}</h2>
          {people.data && <span className="small muted">{tx('{n} people', { n: people.data.people.length })}</span>}</div>
        <p className="small muted">{tx('People who share your interests come first. Tap someone to see their profile, or invite them to a plan.')}</p>
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
                  {p.intro && <p className="small person-intro">{p.intro}</p>}
                  <div className="chips-static">
                    {p.interests.slice(0, 4).map((c) => <span key={c} className={`mini-chip ${p.shared.includes(c) ? 'on' : ''}`}><Icon name={c} size={13} />{tx(categoryLabel(c))}</span>)}
                  </div>
                  <div className="row" style={{ marginTop: 'auto' }}>
                    {p.shared.length > 0 && <span className="tiny" style={{ color: 'var(--lime-ink)', fontWeight: 650, flex: 1 }}>{tx('{n} shared interests', { n: p.shared.length })}</span>}
                    <span className="spacer" />
                    <a className="btn btn-secondary btn-sm" href={`#/create?template=${tplFor(p.shared[0] || p.interests[0]) || 'other'}&category=${p.shared[0] || p.interests[0] || 'other'}&invite=${p.id}`}><Icon name="plus" size={15} />{tx('Invite')}</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        {people.data?.people.length > 6 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setShowAll(!showAll)}>{showAll ? tx('Show fewer') : tx('Show all {n}', { n: people.data.people.length })}</button>}
      </section>

      <section className="stack" aria-labelledby="sug-h">
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
