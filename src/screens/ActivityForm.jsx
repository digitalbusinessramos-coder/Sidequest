import { tx } from '../i18n.js';
import { useEffect, useRef, useState } from 'react';
import { AreaInput, EmojiBadge, ErrorState, Icon, Loading, TopBar, useApp } from '../components.jsx';
import { DURATION_LABEL, localDate, tzLabel, useApi } from '../util.js';
import { CropSheet } from './Crop.jsx';
import { api as rawApi } from '../api.js';
import { CAT_EMOJI, PLAN_EMOJIS, PLAN_SUGGESTIONS, planEmoji } from '../../shared/catalog.js';

// Nothing is filled in for the student: no default day, time, area, duration, cost or group size.
const empty = () => ({
  title: '', category: 'other', template: 'other', description: '', day: '', day_mode: 'day', time_mode: '', time: '', time_window: '',
  meeting_area: '', meeting_point: '', duration_choice: '', cost_mode: '', cost_eur: '', capped: false, max_participants: '',
  join_mode: 'open', beginner_friendly: false, emoji: '',
});

/** Links from an event, a buddy invitation or a City Guide tip carry a title, area, day or time. The student still checks everything. */
function applyQuery(v, query) {
  const out = { ...v };
  if (query.title) out.title = String(query.title).slice(0, 80);
  if (query.category) out.category = String(query.category);
  if (query.area) out.meeting_area = String(query.area).slice(0, 80);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(query.start || '')) Object.assign(out, { day: query.start.slice(0, 10), time: query.start.slice(11), time_mode: 'exact' });
  else if (/^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) out.day = query.date;
  return out;
}

function fromActivity(a) {
  const [day, time] = (a.starts_local || '').split('T');
  return {
    ...empty(), title: a.title, category: a.category, template: a.template, description: a.description || '', day: (a.day_mode || 'day') === 'day' ? day : '', day_mode: a.day_mode || 'day',
    time_mode: a.time_mode || 'exact', time: a.time_mode === 'exact' ? time : '', time_window: a.time_window || '',
    meeting_area: a.meeting_area, meeting_point: a.meeting_point || '', duration_choice: a.duration_choice || '',
    cost_mode: a.cost_mode || '', cost_eur: a.cost_eur ?? '', capped: !!a.capped, max_participants: a.max_participants ?? '',
    join_mode: a.join_mode, beginner_friendly: !!a.beginner_friendly, photo: a.photo, emoji: a.emoji || '',
  };
}

export default function ActivityForm({ editId, query = {} }) {
  const { city, me, meta, api, toast, openAccount } = useApp();
  const [v, setV] = useState(() => (editId ? null : applyQuery(empty(), query)));
  const [loadErr, setLoadErr] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const fileInput = useRef(null);
  const formRef = useRef(null);
  const invitee = useApi(query.invite ? `/users/${Number(query.invite)}` : null).data?.profile;
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const tz = city.timezone;

  useEffect(() => {
    if (!editId) return;
    rawApi.get(`/activities/${editId}`).then(({ activity: a }) => {
      if (a.my_status !== 'organiser') throw Object.assign(new Error(tx('Only the organiser can edit this activity.')), { status: 403 });
      setV(fromActivity(a));
      setMore(true);
    }).catch(setLoadErr);
  }, [editId]);

  if (loadErr) return <><TopBar title={tx('Edit plan')} /><div className="page"><ErrorState error={loadErr} /></div></>;
  if (!v) return <><TopBar title="" /><div className="page"><Loading rows={2} /></div></>;

  const pickPhoto = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setCropFile(f);
  };

  const validate = () => {
    if (!v.title.trim()) return tx('Write what you feel like doing.');
    if (v.day_mode === 'day' && !v.day) return tx('Choose a day, or one of the options if you’re not sure yet.');
    if (!v.time_mode) return tx('Choose an exact time, a part of the day, or “time to be agreed”.');
    if (v.time_mode === 'exact' && !v.time) return tx('Choose a time.');
    if (v.time_mode === 'window' && !v.time_window) return tx('Choose morning, afternoon or evening.');
    if (!v.meeting_area.trim()) return tx('Add a meeting area.');
    if (v.cost_mode === 'estimate' && !(Number(v.cost_eur) > 0)) return tx('Add the estimated cost per person, or choose another cost option.');
    if (v.capped && !(Number(v.max_participants) >= 2 && Number(v.max_participants) <= 30)) return tx('Set a limit between 2 and 30 people, including you, or leave the plan without a limit.');
    return '';
  };

  const payload = () => ({
    title: v.title, category: v.category, template: v.template, description: v.description, day: v.day_mode === 'day' ? v.day : undefined, day_mode: v.day_mode, time_mode: v.time_mode,
    time: v.time_mode === 'exact' ? v.time : undefined, time_window: v.time_mode === 'window' ? v.time_window : undefined,
    meeting_area: v.meeting_area, meeting_point: v.meeting_point, duration_choice: v.duration_choice || null,
    cost_mode: v.cost_mode || null, cost_eur: v.cost_mode === 'estimate' ? Number(v.cost_eur) : 0,
    max_participants: v.capped ? Number(v.max_participants) : null, join_mode: v.join_mode, beginner_friendly: v.beginner_friendly, emoji: v.emoji || '',
    ...(query.event && !editId ? { event_id: Number(query.event) } : {}),
  });

  const publish = async () => {
    setErr(''); setBusy(true);
    try {
      if (editId) {
        await api.put(`/activities/${editId}`, payload());
        if (photo) await api.put(`/activities/${editId}/photo`, { data: photo });
        toast(tx('Changes saved.'));
        location.hash = `#/activity/${editId}`;
        return;
      }
      const { id } = await api.post('/activities', payload());
      if (photo) { try { await api.put(`/activities/${id}/photo`, { data: photo }); } catch (x) { toast(tx('Plan published, but the picture could not be saved: {error}', { error: tx(x.message) }), true); } }
      if (query.invite) {
        try { await api.post(`/activities/${id}/invite`, { userId: Number(query.invite) }); toast(tx('Plan published and invitation sent. They decide whether to join.')); } catch (x) { toast(tx('Plan published, but the invitation failed: {error}', { error: tx(x.message) }), true); }
      }
      location.replace(`#/activity/${id}?created=1`);
    } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setErr(problem); return; }
    // Guests first save an account (a few seconds), then the plan is published straight away.
    if (me.is_guest) openAccount('signup', { reason: tx('Create a free account to publish your plan. It is published right after.'), onDone: publish });
    else publish();
  };

  const days = [[localDate(tz, 0), tx('Today')], [localDate(tz, 1), tx('Tomorrow')]];

  return (
    <>
      <TopBar title={editId ? tx('Edit plan') : tx('New plan')} />
      <form className="page create-form" onSubmit={submit} ref={formRef} noValidate>
        {query.invite && <div className="notice lime"><Icon name="heart" />{invitee
          ? tx('Check the details, then publish to send {name} the invitation. Nothing is sent before that, and nobody is added until they accept.', { name: invitee.first_name })
          : tx('After you publish this plan, we’ll send the invitation. Nobody is added until they accept.')}</div>}
        {query.from === 'event' && <div className="notice"><Icon name="info" />{query.start
          ? tx('This group is linked to the event and starts 30 minutes before it. Check the details, then publish. It does not reserve tickets.')
          : tx('This plan is linked to the event. Pick the day you want to go. It does not reserve tickets or places at the event.')}</div>}
        {query.from === 'tip' && <div className="notice"><Icon name="info" />{tx('Title and area come from the tip. Choose the day and time.')}</div>}

        <div className="field">
          <label htmlFor="plan-title" className="create-q">{tx('What do you feel like doing?')}</label>
          <input id="plan-title" className="input input-lg" required maxLength={80} autoFocus={!editId} enterKeyHint="next" value={v.title}
            onChange={(e) => set({ title: e.target.value })} placeholder={tx('e.g. Sunset walk on the promenade')} />
          {!editId && (
            <div className="suggest-row" role="group" aria-label={tx('Suggestions')}>
              {PLAN_SUGGESTIONS.map((s) => (
                <button key={s.key} type="button" className="chip chip-sm" aria-pressed={v.title === tx(s.title)}
                  onClick={() => { set({ title: tx(s.title), category: s.category }); document.getElementById('plan-title')?.focus(); }}>{tx(s.title)}</button>
              ))}
            </div>
          )}
        </div>

        <fieldset className="field plain">
          <legend className="label">{tx('Type of plan')}</legend>
          <div className="suggest-row" role="radiogroup" aria-label={tx('Type of plan')}>
            {meta.categories.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={v.category === c.key} className={`chip chip-sm ${v.category === c.key ? 'on' : ''}`}
                onClick={() => set({ category: c.key })}>
                <span aria-hidden="true">{CAT_EMOJI[c.key]}</span> {tx(c.label)}
              </button>
            ))}
          </div>
          <span className="hint">{tx('People who filter Explore by this type will find your plan.')}</span>
        </fieldset>

        <fieldset className="field plain">
          <legend className="label">{tx('Day')}</legend>
          <div className="row wrap" style={{ gap: 8 }}>
            {days.map(([d, label]) => <button key={d} type="button" className="chip" aria-pressed={v.day_mode === 'day' && v.day === d} onClick={() => set({ day: d, day_mode: 'day' })}>{label}</button>)}
            <input className="input input-date" type="date" aria-label={tx('Pick a date')} min={localDate(tz, 0)} value={v.day_mode === 'day' ? v.day : ''} onChange={(e) => set({ day: e.target.value, day_mode: 'day' })} />
          </div>
          <span className="hint" style={{ marginTop: 8 }}>{tx('Not sure yet?')}</span>
          <div className="row wrap" style={{ gap: 8 }}>
            {[['weekend', tx('This weekend')], ['week', tx('This week')], ['flex', tx('Flexible (next 2 weeks)')]].map(([k, label]) => (
              <button key={k} type="button" className="chip" aria-pressed={v.day_mode === k}
                onClick={() => set({ day_mode: k, day: '', ...(v.time_mode === 'exact' || !v.time_mode ? { time_mode: 'tbd' } : {}) })}>{label}</button>
            ))}
          </div>
          {v.day_mode !== 'day' && <span className="hint">{tx('You can agree on the day in the plan chat. The plan stays listed until then.')}</span>}
        </fieldset>

        <fieldset className="field plain">
          <legend className="label">{tx('Time')}</legend>
          <div className="row wrap" style={{ gap: 8 }} role="radiogroup" aria-label={tx('Time')}>
            {[['exact', tx('Exact time')], ['window', tx('Part of the day')], ['tbd', tx('To be agreed')]].filter(([k]) => k !== 'exact' || v.day_mode === 'day').map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={v.time_mode === k} className={`chip ${v.time_mode === k ? 'on' : ''}`} onClick={() => set({ time_mode: k })}>{label}</button>
            ))}
          </div>
          {v.time_mode === 'exact' && <input className="input" type="time" aria-label={tx('Start time')} value={v.time} onChange={(e) => set({ time: e.target.value })} style={{ marginTop: 8, maxWidth: 180 }} />}
          {v.time_mode === 'window' && (
            <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
              {['morning', 'afternoon', 'evening'].map((w) => <button key={w} type="button" className="chip" aria-pressed={v.time_window === w} onClick={() => set({ time_window: w })}>{tx(w)}</button>)}
            </div>
          )}
          {v.time_mode === 'tbd' && <span className="hint">{tx('You can agree on the time in the plan chat.')}</span>}
          <span className="hint">{tx('Times are in {tz}.', { tz: tx(tzLabel(tz)) })}</span>
        </fieldset>

        <AreaInput id="plan-area" label={tx('Meeting area (public)')} value={v.meeting_area} onChange={(meeting_area) => set({ meeting_area })} required
          hint={tx('Everyone sees this area. Pick a public place, never a home address.')} />

        <label className="field"><span>{tx('Short description (optional)')}</span>
          <textarea className="textarea" maxLength={600} rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder={tx('What you’ll do, in a sentence or two.')} />
        </label>

        <div className="field">
          <span className="label">{tx('Photo (optional)')}</span>
          <div className="row wrap" style={{ gap: 10 }}>
            {(photo || v.photo) && <img src={photo || v.photo} alt="" className="listing-thumb wide" />}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current?.click()}><Icon name="camera" size={16} />{photo || v.photo ? tx('Change picture') : tx('Add a picture')}</button>
            {photo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto(null)}>{tx('Remove')}</button>}
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} hidden />
          {cropFile && <CropSheet file={cropFile} shapes={['wide']} max={1200} onDone={(d) => { setPhoto(d); setCropFile(null); }} onCancel={() => setCropFile(null)} />}
        </div>

        {!(photo || v.photo) && (
          <div className="field">
            <span className="label" id="emoji-l">{tx('No photo? Pick an emoji for your plan')}</span>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <EmojiBadge a={v} size="lg" />
              <span className="hint">{v.emoji ? tx('Tap it again to go back to the automatic one.') : tx('Chosen from the type of plan. Tap another to change it.')}</span>
            </div>
            <div className="emoji-grid" role="radiogroup" aria-labelledby="emoji-l">
              {PLAN_EMOJIS.map((e) => {
                const on = planEmoji(v) === e;
                return <button key={e} type="button" role="radio" aria-checked={on} className={`emoji-opt ${on ? 'on' : ''}`} onClick={() => set({ emoji: v.emoji === e ? '' : e })}>{e}</button>;
              })}
            </div>
          </div>
        )}

        {!more ? (
          <button type="button" className="btn btn-ghost" onClick={() => setMore(true)} aria-expanded="false"><Icon name="plus" size={16} />{tx('More details (optional): exact meeting point, cost, group size…')}</button>
        ) : (
          <div className="stack more-details">
            <label className="field"><span>{tx('Exact meeting point (optional)')}</span>
              <input className="input" maxLength={200} value={v.meeting_point} onChange={(e) => set({ meeting_point: e.target.value })} placeholder={tx('e.g. In front of the café at the north end of the beach')} />
              <span className="hint">{tx('Only confirmed participants see this. You can also agree on it in the private plan chat.')}</span>
            </label>

            <fieldset className="field plain">
              <legend className="label">{tx('How long? (optional)')}</legend>
              <div className="row wrap" style={{ gap: 8 }}>
                {Object.entries(DURATION_LABEL).map(([k, label]) => <button key={k} type="button" className="chip" aria-pressed={v.duration_choice === k} onClick={() => set({ duration_choice: v.duration_choice === k ? '' : k })}>{tx(label)}</button>)}
              </div>
            </fieldset>

            <fieldset className="field plain">
              <legend className="label">{tx('Cost (optional)')}</legend>
              <div className="row wrap" style={{ gap: 8 }}>
                {[['free', tx('Free')], ['estimate', tx('Estimated cost per person')], ['unknown', tx('There’s a cost, amount unknown')]].map(([k, label]) => (
                  <button key={k} type="button" className="chip" aria-pressed={v.cost_mode === k} onClick={() => set({ cost_mode: v.cost_mode === k ? '' : k })}>{label}</button>
                ))}
              </div>
              {v.cost_mode === 'estimate' && (
                <label className="row" style={{ gap: 8, marginTop: 8 }}>
                  <span className="small">€</span>
                  <input className="input" style={{ maxWidth: 140 }} type="number" min="0.5" max="500" step="0.5" inputMode="decimal" aria-label={tx('Estimated cost per person in euros')} value={v.cost_eur} onChange={(e) => set({ cost_eur: e.target.value })} />
                  <span className="hint">{tx('per person')}</span>
                </label>
              )}
              <span className="hint">{tx('Leave it blank if you’re not sure. Nothing is paid in the app.')}</span>
            </fieldset>

            <fieldset className="field plain">
              <legend className="label">{tx('Group size (optional)')}</legend>
              <div className="row wrap" style={{ gap: 8 }}>
                <button type="button" className="chip" aria-pressed={!v.capped} onClick={() => set({ capped: false })}>{tx('No limit')}</button>
                <button type="button" className="chip" aria-pressed={v.capped} onClick={() => set({ capped: true })}>{tx('Set a limit')}</button>
              </div>
              {v.capped && (
                <label className="row" style={{ gap: 8, marginTop: 8 }}>
                  <input className="input" style={{ maxWidth: 100 }} type="number" min="2" max="30" inputMode="numeric" aria-label={tx('Maximum number of people, including you')} value={v.max_participants} onChange={(e) => set({ max_participants: e.target.value })} />
                  <span className="hint">{tx('people, including you')}</span>
                </label>
              )}
            </fieldset>

            <fieldset className="field plain">
              <legend className="label">{tx('How do people join?')}</legend>
              <div className="choice-cards">
                {[['open', 'bolt', 'Anyone can join directly', 'They tap “Join plan” and are in straight away. You can still remove someone.'],
                  ['request', 'check', 'People ask, you accept', 'You decide who comes. They tap “Ask to join”.']].map(([key, icon, title, hint]) => (
                  <label key={key} className={`choice-card ${v.join_mode === key ? 'on' : ''}`}>
                    <input type="radio" name="join_mode" value={key} checked={v.join_mode === key} onChange={() => set({ join_mode: key })} />
                    <Icon name={icon} size={20} />
                    <span><strong>{tx(title)}</strong><br /><span className="hint">{tx(hint)}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="check"><input type="checkbox" checked={v.beginner_friendly} onChange={(e) => set({ beginner_friendly: e.target.checked })} />
              <span><strong>{tx('Beginners welcome')}</strong><br /><span className="hint">{tx('For sports, hikes and similar: no experience or special equipment needed.')}</span></span>
            </label>
          </div>
        )}

        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{editId ? tx('Save changes') : tx('Publish plan')}</button>
        {!editId && <p className="tiny muted">{tx('Only what you fill in is shown. You can edit the plan or agree on details in the chat later.')} <a href="#/example">{tx('See an example plan')}</a></p>}
      </form>
    </>
  );
}
