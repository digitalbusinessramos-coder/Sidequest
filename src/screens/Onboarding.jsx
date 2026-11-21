import { useState } from 'react';
import { tx } from '../i18n.js';
import { AreaInput, ChoiceChips, useApp } from '../components.jsx';
import { FlagPicker, LanguagePicker, StayPicker } from './ProfileBits.jsx';

/** Profile details. Only the first name is required; everything else is optional and can be skipped. */
export function ProfileFields({ v, set, meta }) {
  return (
    <>
      <label className="field"><span>{tx('First name')}</span>
        <input className="input" required maxLength={40} autoComplete="given-name" value={v.first_name} onChange={(e) => set({ first_name: e.target.value })} />
        <span className="hint">{tx('Only your first name is shown to others.')}</span>
      </label>
      <label className="field"><span>{tx('Short introduction (optional)')}</span>
        <textarea className="textarea" maxLength={280} value={v.intro} placeholder={tx('e.g. Here for the year. Up for hikes, beach volleyball and tapas.')} onChange={(e) => set({ intro: e.target.value })} />
      </label>
      {v.intro?.trim() && (
        <label className="check"><input type="checkbox" checked={!!v.show_intro} onChange={(e) => set({ show_intro: e.target.checked })} />
          <span>{tx('Show my introduction on my profile')}</span></label>
      )}
      <div className="field"><span className="label">{tx('I am… (optional)')}</span>
        <ChoiceChips label={tx('I am')} value={v.role} onChange={(role) => set({ role: role || 'exchange' })}
          options={[{ key: 'exchange', label: tx('Erasmus / exchange student') }, { key: 'international', label: tx('International student') }, { key: 'intern', label: tx('Intern / trainee') }, { key: 'local', label: tx('Local student') }]} />
      </div>
      <StayPicker v={v} set={set} />
      <AreaInput id="meet-area" label={tx('Where do you like to meet? (optional)')} value={v.meet_area} onChange={(meet_area) => set({ meet_area })}
        hint={tx('A broad area, like a neighbourhood or a campus. Never your home address.')} />
      {v.meet_area?.trim() && (
        <label className="check"><input type="checkbox" checked={!!v.show_area} onChange={(e) => set({ show_area: e.target.checked })} />
          <span>{tx('Show where I like to meet on my profile')}</span></label>
      )}
      <LanguagePicker value={v.languages} onChange={(languages) => set({ languages })} />
      <FlagPicker value={v.flags} onChange={(flags) => set({ flags })} />
      <div className="field"><span className="label">{tx('What would you like to do? (optional)')}</span>
        <ChoiceChips multiple label={tx('Interests')} value={v.interests} onChange={(interests) => set({ interests })} options={meta.categories.filter((c) => c.key !== 'other').map((c) => ({ key: c.key, label: c.label }))} />
      </div>
      <label className="field"><span>{v.role === 'intern' ? tx('Company or organisation (optional)') : tx('University (optional)')}</span>
        <input className="input" maxLength={80} value={v.university || ''} onChange={(e) => set({ university: e.target.value })} placeholder={v.role === 'intern' ? tx('e.g. a hotel, a start-up, a lab') : tx('e.g. ULPGC')} />
      </label>
      {v.university && (
        <label className="check"><input type="checkbox" checked={!!v.show_university} onChange={(e) => set({ show_university: e.target.checked })} />
          <span>{v.role === 'intern' ? tx('Show my company on my profile') : tx('Show my university on my profile')}<br /><span className="hint">{tx('Not verified. Shown as you typed it.')}</span></span>
        </label>
      )}
    </>
  );
}

export const profileDefaults = (me) => ({
  first_name: me.first_name === 'Someone' || me.first_name === 'Guest' ? '' : me.first_name || '', intro: me.intro || '', role: me.role || 'exchange',
  meet_area: me.meet_area || '', university: me.university || '', show_university: !!me.show_university, show_intro: !!me.show_intro, show_area: !!me.show_area,
  stay: me.stay || (me.exchange_start || me.exchange_end ? 'custom' : ''), exchange_start: me.exchange_start || '', exchange_end: me.exchange_end || '',
  languages: me.languages || [], flags: me.flags || [], interests: me.interests || [],
});

/** Brief sign-up: just a first name. Everything else lives in Profile, whenever the student feels like it. */
export default function Onboarding() {
  const { me, city, api, reloadMe } = useApp();
  const [name, setName] = useState(profileDefaults(me).first_name);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setErr('');
    if (!name.trim()) return setErr(tx('Please add your first name.'));
    setBusy(true);
    try { await api.put('/me/profile', { first_name: name, city: city.slug }); await reloadMe(); } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
    return undefined;
  };
  return (
    <main className="welcome">
      <div className="stack-sm">
        <span className="eyebrow">{tx('Welcome to {app}')}</span>
        <h1>{tx('Hi! What should people call you?')}</h1>
      </div>
      <form className="stack" onSubmit={save}>
        <label className="field"><span>{tx('First name')}</span>
          <input className="input" required autoFocus maxLength={40} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="hint">{tx('Only your first name is shown to others.')}</span>
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{tx('Start exploring')}</button>
        <p className="tiny muted">{tx('That’s all we need. You can add languages, flags and more in your profile whenever you like.')}</p>
      </form>
    </main>
  );
}
