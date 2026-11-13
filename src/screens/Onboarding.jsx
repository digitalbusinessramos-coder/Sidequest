import { useState } from 'react';
import { getAppName, locale, t, tx } from '../i18n.js';
import { ChoiceChips, Icon, useApp } from '../components.jsx';

/** Month and year as two pick-lists: works the same in every browser, no typing. Value is "YYYY-MM" or "". */
function MonthPicker({ label, value, onChange }) {
  const [y, m] = value ? value.split('-') : ['', ''];
  const now = new Date().getFullYear();
  const years = [now - 1, now, now + 1, now + 2];
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const fmt = (mm) => new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, Number(mm) - 1, 1)));
  const set = (ny, nm) => onChange(ny && nm ? `${ny}-${nm}` : '');
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="label" style={{ marginBottom: 6 }}>{label}</legend>
      <div className="row" style={{ gap: 6 }}>
        <select className="select" aria-label={tx('Month')} value={m} onChange={(e) => set(y || String(now), e.target.value)} style={{ flex: 1, minWidth: 0 }}>
          <option value="">–</option>{months.map((mm) => <option key={mm} value={mm}>{fmt(mm)}</option>)}
        </select>
        <select className="select" aria-label={tx('Year')} value={y} onChange={(e) => set(e.target.value, m || '01')} style={{ flex: 1, minWidth: 0 }}>
          <option value="">–</option>{years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
        </select>
      </div>
    </fieldset>
  );
}

export function ProfileFields({ v, set, city, meta, step }) {
  return (
    <>
      {(step === undefined || step === 0) && (
        <>
          <label className="field"><span>{tx("First name")}</span>
            <input className="input" required maxLength={40} autoComplete="given-name" value={v.first_name} onChange={(e) => set({ first_name: e.target.value })} />
            <span className="hint">{tx("Only your first name is shown to others.")}</span>
          </label>
          <div className="field"><span className="label">{tx("I am…")}</span>
            <ChoiceChips label={tx("I am")} value={v.role} onChange={(role) => set({ role: role || 'exchange' })}
              options={[{ key: 'exchange', label: tx("Erasmus / exchange student") }, { key: 'international', label: tx("International student") }, { key: 'intern', label: tx("Intern / trainee (not studying here)") }, { key: 'local', label: tx("Local student") }]} />
          </div>
          <label className="field"><span>{tx("Short introduction (optional)")}</span>
            <textarea className="textarea" maxLength={280} value={v.intro} placeholder={tx("e.g. From Lyon, here until February. Up for hikes and museums.")} onChange={(e) => set({ intro: e.target.value })} />
            <span className="hint">{tx("One or two lines is enough.")}</span>
          </label>
        </>
      )}
      {(step === undefined || step === 1) && (
        <>
          <label className="field"><span>{tx('Approximate area in {city}', { city: city.name.split(' de ')[0] })}</span>
            <select className="select" value={v.area || ''} onChange={(e) => set({ area: e.target.value })}>
              <option value="">{tx("Prefer not to say")}</option>
              {city.areas.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
            <span className="hint">{tx("A neighbourhood, never your address. Used to suggest nearby plans.")}</span>
          </label>
          <label className="field"><span>{v.role === 'intern' ? tx("Company or organisation (optional)") : tx("University (optional)")}</span>
            <input className="input" maxLength={80} value={v.university || ''} onChange={(e) => set({ university: e.target.value })} placeholder={v.role === 'intern' ? tx("e.g. a hotel, a start-up, a lab") : tx("e.g. ULPGC")} />
          </label>
          <label className="check"><input type="checkbox" checked={!!v.show_university} onChange={(e) => set({ show_university: e.target.checked })} />
            <span>{v.role === 'intern' ? tx("Show my company on my profile") : tx("Show my university on my profile")}<br /><span className="hint">{tx("Not verified. Shown as you typed it.")}</span></span>
          </label>
          {v.role !== 'local' && (
            <div className="grid-2">
              <MonthPicker label={v.role === 'intern' ? tx("In Las Palmas from") : tx("Exchange from")} value={v.exchange_start || ''} onChange={(exchange_start) => set({ exchange_start })} />
              <MonthPicker label={tx("Until")} value={v.exchange_end || ''} onChange={(exchange_end) => set({ exchange_end })} />
            </div>
          )}
        </>
      )}
      {(step === undefined || step === 2) && (
        <>
          <div className="field"><span className="label">{tx("Languages you’re comfortable with")}</span>
            <ChoiceChips multiple label={tx("Languages")} value={v.languages} onChange={(languages) => set({ languages })} options={meta.languages.map((l) => ({ key: l, label: l }))} />
          </div>
          <div className="field"><span className="label">{tx("What would you like to do?")}</span>
            <ChoiceChips multiple label={tx("Interests")} value={v.interests} onChange={(interests) => set({ interests })} options={meta.categories.filter((c) => c.key !== 'other').map((c) => ({ key: c.key, label: c.label }))} />
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
  const titles = [tx('Hi! What should people call you?'), tx("Where are you based?"), tx("What are you into?")];

  const next = async (e) => {
    e.preventDefault();
    setErr('');
    if (step === 0 && !v.first_name.trim()) return setErr(tx("Please add your first name."));
    if (step < 2) return setStep(step + 1);
    if (!v.languages.length) return setErr(tx("Pick at least one language."));
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
        {step > 0 && <button className="icon-btn" onClick={() => setStep(step - 1)} aria-label={tx("Back")}><Icon name="back" /></button>}
        <span className="muted small">{tx('Step {n} of 3', { n: step + 1 })}</span>
      </div>
      <div className="stack-sm">
        <span className="eyebrow">{tx('Welcome to {app}')}</span>
        <h1>{titles[step]}</h1>
      </div>
      <form className="stack" onSubmit={next}>
        <ProfileFields v={v} set={set} city={city} meta={meta} step={step} />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{step < 2 ? tx('Continue') : tx('Start exploring')}</button>
        {step === 2 && <p className="tiny muted">{tx("You can change all of this later in Profile. Nearby discovery stays off unless you turn it on.")}</p>}
      </form>
    </main>
  );
}
