import { t, tx } from '../i18n.js';
import { useEffect, useState } from 'react';
import { ChoiceChips, ErrorState, Icon, Loading, Stamp, TopBar, useApp } from '../components.jsx';
import { tzLabel } from '../util.js';
import { api as rawApi } from '../api.js';

function defaultStart(tz, hhmm = '17:00') {
  // Tomorrow at 17:00 in the city's time zone, as a wall-clock string for <input type="datetime-local">.
  const d = new Date(Date.now() + 864e5);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${day}T${hhmm}`;
}

const blank = (tpl, city, me) => ({
  template: tpl.key, category: tpl.category, title: tpl.title, description: '', starts_local: defaultStart(city.timezone, tpl.time),
  duration_min: tpl.duration, meeting_area: city.areas.find((a) => a.key === me.area)?.name || city.areas[0]?.name || '', meeting_point: '', join_mode: 'request',
  cost_eur: tpl.cost, max_participants: tpl.max, beginner_friendly: !!tpl.beginner, pace: tpl.pace || '', transport: tpl.transport || '',
  languages: me.languages?.slice(0, 2) || [], solo_format: false, welcome_plan: '', recognise_tip: '',
});

/** Pick a neighbourhood from the list (no typing needed), or type another public place. */
function AreaPicker({ value, onChange, areas }) {
  const known = areas.some((a) => a.name === value);
  const [other, setOther] = useState(!known && !!value);
  return (
    <div className="field">
      <label htmlFor="area-select" className="label">{tx("Meeting area")}</label>
      <select id="area-select" className="select" value={other ? '__other' : value}
        onChange={(e) => { if (e.target.value === '__other') { setOther(true); onChange(''); } else { setOther(false); onChange(e.target.value); } }}>
        {areas.map((a) => <option key={a.key} value={a.name}>{a.name}</option>)}
        <option value="__other">{tx("Somewhere else…")}</option>
      </select>
      {other && <input className="input" aria-label={tx("Other meeting area")} required maxLength={80} value={value} onChange={(e) => onChange(e.target.value)} placeholder={tx("Neighbourhood or landmark")} style={{ marginTop: 8 }} autoFocus />}
      <span className="hint">{tx("Shown to everyone. Pick a public place.")}</span>
    </div>
  );
}

export default function ActivityForm({ editId, query = {} }) {
  const { meta, city, me, api, toast } = useApp();
  const [tpl, setTpl] = useState(() => meta.templates.find((x) => x.key === query.template) || (query.category ? { ...meta.templates.find((x) => x.key === 'other'), category: query.category } : null));
  const [v, setV] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));

  useEffect(() => {
    if (editId) {
      rawApi.get(`/activities/${editId}`).then(({ activity: a }) => {
        if (a.my_status !== 'organiser') throw Object.assign(new Error(tx("Only the organiser can edit this activity.")), { status: 403 });
        setV({ ...a, meeting_point: a.meeting_point || '', pace: a.pace || '', transport: a.transport || '' });
        setShowMore(true);
      }).catch(setLoadErr);
    } else if (tpl) setV(blank(tpl, city, me));
  }, [editId, tpl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadErr) return <><TopBar title={tx("Edit activity")} /><div className="page"><ErrorState error={loadErr} /></div></>;

  if (!editId && !tpl) {
    return (
      <>
        <TopBar title={tx("Create a plan")} />
        <div className="page">
          <div className="stack-sm"><span className="eyebrow">{tx("Takes about a minute")}</span><h1>{tx("What do you want to do?")}</h1>
            <p className="muted small">{tx("Pick a template. You can change everything on the next screen.")}</p></div>
          <div className="template-grid">
            {meta.templates.map((x) => (
              <button key={x.key} onClick={() => setTpl(x)}><Stamp category={x.category} />{tx(x.label)}</button>
            ))}
          </div>
        </div>
      </>
    );
  }
  if (!v) return <><TopBar title="" /><div className="page"><Loading rows={2} /></div></>;

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (editId) {
        await api.put(`/activities/${editId}`, v);
        toast(tx("Changes saved."));
        location.hash = `#/activity/${editId}`;
      } else {
        const { id } = await api.post('/activities', v);
        if (query.invite) {
          try { await api.post(`/activities/${id}/invite`, { userId: Number(query.invite) }); toast(tx("Plan created and invitation sent. They decide whether to join.")); } catch (x) { toast(tx('Plan created, but the invitation failed: {error}', { error: tx(x.message) }), true); }
        } else toast(tx("Your plan is live. You’ll see requests in My Plans."));
        location.replace(`#/activity/${id}`);
      }
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <>
      <TopBar title={editId ? tx("Edit activity") : tx("New plan")} />
      <form className="page" onSubmit={submit}>
        {query.invite && <div className="notice lime"><Icon name="heart" />{tx("After you create this plan, we’ll send an invitation. Nobody is added until they accept.")}</div>}
        <label className="field"><span>{tx("Title")}</span>
          <input className="input" required maxLength={80} value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={tx("e.g. Sunset walk on the promenade")} />
        </label>
        <label className="field"><span>{tx("Short description (optional)")}</span>
          <textarea className="textarea" maxLength={600} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder={tx("What you’ll do, in a sentence or two.")} />
        </label>
        <div className="field"><span className="label">{tx("Activity type")}</span>
          <select className="select" value={v.category} onChange={(e) => set({ category: e.target.value })}>
            {meta.categories.map((c) => <option key={c.key} value={c.key}>{tx(c.label)}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <label className="field"><span>{tx("Date and time")}</span>
            <input className="input" type="datetime-local" required value={v.starts_local} onChange={(e) => set({ starts_local: e.target.value })} />
          </label>
          <label className="field"><span>{tx("Duration")}</span>
            <select className="select" value={v.duration_min} onChange={(e) => set({ duration_min: Number(e.target.value) })}>
              {[30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </select>
          </label>
        </div>
        <p className="hint" style={{ marginTop: -10 }}>{tx('Times are in {tz}.', { tz: tx(tzLabel(city.timezone)) })}</p>
        <AreaPicker value={v.meeting_area} onChange={(meeting_area) => set({ meeting_area })} areas={city.areas} />
        <label className="field"><span>{tx("Exact meeting point (optional)")}</span>
          <input className="input" maxLength={200} value={v.meeting_point} onChange={(e) => set({ meeting_point: e.target.value })} placeholder={tx("e.g. In front of the café at the north end of the beach")} />
          <span className="hint">{tx("Only confirmed participants see this. You can also agree on it later in the chat.")}</span>
        </label>
        <div className="grid-2">
          <label className="field"><span>{tx("Estimated cost per person (€)")}</span>
            <input className="input" type="number" min="0" max="500" step="0.5" inputMode="decimal" value={v.cost_eur} onChange={(e) => set({ cost_eur: e.target.value })} />
            <span className="hint">{tx("0 means free.")}</span>
          </label>
          <label className="field"><span>{tx("Group size, including you")}</span>
            <input className="input" type="number" min="2" max="30" required value={v.max_participants} onChange={(e) => set({ max_participants: Number(e.target.value) })} />
            <span className="hint">{tx("2 means one buddy.")}</span>
          </label>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>{tx("How do people join?")}</legend>
          <div className="choice-cards">
            {[['request', 'check', "People ask, you accept", "You decide who comes. Best for small groups."],
              ['open', 'bolt', "Anyone can join directly", "No waiting. People get a place straight away while there’s space. You can still remove someone."]].map(([key, icon, title, hint]) => (
              <label key={key} className={`choice-card ${v.join_mode === key ? 'on' : ''}`}>
                <input type="radio" name="join_mode" value={key} checked={v.join_mode === key} onChange={() => set({ join_mode: key })} />
                <Icon name={icon} size={20} />
                <span><strong>{tx(title)}</strong><br /><span className="hint">{tx(hint)}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check"><input type="checkbox" checked={v.solo_format} onChange={(e) => set({ solo_format: e.target.checked })} />
          <span><strong>{tx("Everyone comes solo")}</strong><br /><span className="hint">{tx("Participants sign up individually and are open to meeting new people. Good for people who don’t know anyone yet.")}</span></span>
        </label>
        <label className="check"><input type="checkbox" checked={v.beginner_friendly} onChange={(e) => set({ beginner_friendly: e.target.checked })} />
          <span><strong>{tx("Beginner-friendly")}</strong><br /><span className="hint">{tx("No experience or special equipment needed.")}</span></span>
        </label>

        {!showMore ? (
          <button type="button" className="btn btn-ghost" onClick={() => setShowMore(true)}><Icon name="plus" size={16} />{tx("Languages, pace, transport and welcome details")}</button>
        ) : (
          <>
            <div className="field"><span className="label">{tx("Languages for this plan")}</span>
              <ChoiceChips multiple label={tx("Languages")} value={v.languages} onChange={(languages) => set({ languages })} options={meta.languages.map((l) => ({ key: l, label: l }))} />
            </div>
            <div className="grid-2">
              <label className="field"><span>{tx("Pace (optional)")}</span>
                <input className="input" maxLength={40} value={v.pace} onChange={(e) => set({ pace: e.target.value })} placeholder={tx("e.g. Relaxed")} />
              </label>
              <label className="field"><span>{tx("Transport (optional)")}</span>
                <input className="input" maxLength={160} value={v.transport} onChange={(e) => set({ transport: e.target.value })} placeholder={tx("e.g. City bus")} />
              </label>
            </div>
            <label className="field"><span>{tx("Who welcomes the group? (optional)")}</span>
              <input className="input" maxLength={300} value={v.welcome_plan} onChange={(e) => set({ welcome_plan: e.target.value })} placeholder={tx("e.g. I’ll wait at the meeting point 10 minutes early")} />
            </label>
            <label className="field"><span>{tx("How will people recognise each other? (optional)")}</span>
              <input className="input" maxLength={160} value={v.recognise_tip} onChange={(e) => set({ recognise_tip: e.target.value })} placeholder={tx("e.g. Yellow cap")} />
            </label>
          </>
        )}

        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{editId ? tx("Save changes") : tx("Publish plan")}</button>
        {!editId && <p className="tiny muted">{v.join_mode === 'open' ? tx("You count as one of the group. People can join directly until the group is full.") : tx("You count as one of the group. People ask to join and you decide who comes.")}</p>}
      </form>
    </>
  );
}
