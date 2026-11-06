import { useState } from 'react';
import { getAppName } from '../i18n.js';
import { ChoiceChips, Icon, useApp } from '../components.jsx';

export function ProfileFields({ v, set, city, meta, step }) {
  return (
    <>
      {(step === undefined || step === 0) && (
        <>
          <label className="field"><span>First name</span>
            <input className="input" required maxLength={40} autoComplete="given-name" value={v.first_name} onChange={(e) => set({ first_name: e.target.value })} />
            <span className="hint">Only your first name is shown to others.</span>
          </label>
          <div className="field"><span className="label">I am…</span>
            <ChoiceChips label="I am" value={v.role} onChange={(role) => set({ role: role || 'exchange' })}
              options={[{ key: 'exchange', label: 'Erasmus / exchange student' }, { key: 'international', label: 'International student' }, { key: 'local', label: 'Local student' }]} />
          </div>
          <label className="field"><span>Short introduction (optional)</span>
            <textarea className="textarea" maxLength={280} value={v.intro} placeholder="e.g. From Lyon, here until February. Up for hikes and museums." onChange={(e) => set({ intro: e.target.value })} />
            <span className="hint">One or two lines is enough.</span>
          </label>
        </>
      )}
      {(step === undefined || step === 1) && (
        <>
          <label className="field"><span>Approximate area in {city.name.split(' de ')[0]}</span>
            <select className="select" value={v.area || ''} onChange={(e) => set({ area: e.target.value })}>
              <option value="">Prefer not to say</option>
              {city.areas.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
            <span className="hint">A neighbourhood, never your address. Used to suggest nearby plans.</span>
          </label>
          <label className="field"><span>University (optional)</span>
            <input className="input" maxLength={80} value={v.university || ''} onChange={(e) => set({ university: e.target.value })} placeholder="e.g. ULPGC" />
          </label>
          <label className="check"><input type="checkbox" checked={!!v.show_university} onChange={(e) => set({ show_university: e.target.checked })} />
            <span>Show my university on my profile<br /><span className="hint">Not verified. Shown as you typed it.</span></span>
          </label>
          {v.role !== 'local' && (
            <div className="grid-2">
              <label className="field"><span>Exchange from</span>
                <input className="input" type="month" value={v.exchange_start || ''} onChange={(e) => set({ exchange_start: e.target.value })} />
              </label>
              <label className="field"><span>Until</span>
                <input className="input" type="month" value={v.exchange_end || ''} onChange={(e) => set({ exchange_end: e.target.value })} />
              </label>
            </div>
          )}
        </>
      )}
      {(step === undefined || step === 2) && (
        <>
          <div className="field"><span className="label">Languages you’re comfortable with</span>
            <ChoiceChips multiple label="Languages" value={v.languages} onChange={(languages) => set({ languages })} options={meta.languages.map((l) => ({ key: l, label: l }))} />
          </div>
          <div className="field"><span className="label">What would you like to do?</span>
            <ChoiceChips multiple label="Interests" value={v.interests} onChange={(interests) => set({ interests })} options={meta.categories.filter((c) => c.key !== 'other').map((c) => ({ key: c.key, label: c.label }))} />
          </div>
        </>
      )}
    </>
  );
}

export const profileDefaults = (me) => ({
  first_name: me.first_name === 'Someone' ? '' : me.first_name || '', intro: me.intro || '', role: me.role || 'exchange', area: me.area || '',
  university: me.university || '', show_university: !!me.show_university, exchange_start: me.exchange_start || '', exchange_end: me.exchange_end || '',
  languages: me.languages || [], interests: me.interests || [],
});

export default function Onboarding() {
  const { me, meta, city, api, reloadMe } = useApp();
  const [step, setStep] = useState(0);
  const [v, setV] = useState(profileDefaults(me));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const titles = ['Hi! What should people call you?', 'Where are you based?', 'What are you into?'];

  const next = async (e) => {
    e.preventDefault();
    setErr('');
    if (step === 0 && !v.first_name.trim()) return setErr('Please add your first name.');
    if (step < 2) return setStep(step + 1);
    if (!v.languages.length) return setErr('Pick at least one language.');
    setBusy(true);
    try {
      await api.put('/me/profile', { ...v, city: city.slug });
      await reloadMe();
      location.hash = '#/explore';
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <main className="welcome">
      <div className="row">
        {step > 0 && <button className="icon-btn" onClick={() => setStep(step - 1)} aria-label="Back"><Icon name="back" /></button>}
        <span className="muted small">Step {step + 1} of 3</span>
      </div>
      <div className="stack-sm">
        <span className="eyebrow">Welcome to {getAppName()}</span>
        <h1>{titles[step]}</h1>
      </div>
      <form className="stack" onSubmit={next}>
        <ProfileFields v={v} set={set} city={city} meta={meta} step={step} />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{step < 2 ? 'Continue' : 'Start exploring'}</button>
        {step === 2 && <p className="tiny muted">You can change all of this later in Profile. Nearby discovery stays off unless you turn it on.</p>}
      </form>
    </main>
  );
}
