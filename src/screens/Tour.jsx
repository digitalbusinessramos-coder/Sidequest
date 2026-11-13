import { useEffect, useRef, useState } from 'react';
import { getAppName, tx } from '../i18n.js';
import { Icon, LanguageSwitch, Sheet, useApp } from '../components.jsx';
import { photo } from '../../shared/photos.js';

/**
 * First-visit tour: what the app is for, why it helps, and how to use it, from a new student's point of view.
 * Shown once per browser; can be reopened from Explore ("How it works") and Profile.
 */
const SLIDES = [
  {
    photo: 'canteras', eyebrow: 'Welcome to Las Palmas',
    title: 'New in the city? You don’t have to do things alone.',
    body: 'Want to surf, hike or go out tonight, but nobody to go with? Find one buddy or a small group for exactly that.',
    points: [['group', 'Small groups, not huge events'], ['globe', 'Exchange students, interns and locals'], ['euro', 'Costs shown up front, many plans are free']],
  },
  {
    photo: 'alcaravaneras', eyebrow: 'Step 1 · Explore',
    title: 'Pick a plan, or start your own in a minute',
    body: 'Browse plans as a list or on the city map. Some plans you join straight away, for others you send a short request.',
    points: [['bolt', '“Join directly” plans: one tap and you’re in'], ['map', 'Map shows the neighbourhood, never your home'], ['plus', 'Create: choose a template, time and place']],
  },
  {
    photo: 'promenade', eyebrow: 'Step 2 · Buddies',
    title: 'Meet people who want the same thing',
    body: 'Save a wish like “hiking on Saturday mornings”. We show students with the same wish and time, and say why in plain words.',
    points: [['buddies', 'Simple rules you can see, no secret score'], ['chat', 'Small group chat once you’re confirmed'], ['shield', 'Block and report on every profile']],
  },
  {
    photo: 'vegueta', eyebrow: 'Step 3 · Everything else',
    title: 'Your week, the city, and a student marketplace',
    body: 'My Plans shows your week as a timetable. The City Guide has official links and tips from students. The marketplace is for bikes, books, and tickets at the price paid.',
    points: [['calendar', 'Calendar of everything you joined'], ['guide', 'Official sources, clearly separated from tips'], ['shopping', 'Buy, sell or give away; fair ticket resale']],
  },
];

export default function Tour({ onDone }) {
  const { me } = useApp();
  const [i, setI] = useState(0);
  const ref = useRef(null);
  const s = SLIDES[i];
  const ph = photo(s.photo);
  const last = i === SLIDES.length - 1;
  useEffect(() => { ref.current?.focus(); }, [i]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onDone();
      if (e.key === 'ArrowRight' && !last) setI(i + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, last, onDone]);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-card">
        <figure className="tour-photo">
          <img src={ph.src} alt={tx(ph.alt)} />
          <figcaption className="photo-credit">{tx('Photo')}: {ph.author}, {ph.license}, Wikimedia Commons</figcaption>
          {i === 0 && <div className="tour-logo">{getAppName()}</div>}
        </figure>
        <div className="tour-body" ref={ref} tabIndex={-1}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow">{tx(s.eyebrow)}</span>
            {i === 0 && <LanguageSwitch />}
          </div>
          <h1 id="tour-title" className="tour-title">{tx(s.title)}</h1>
          <p>{tx(s.body)}</p>
          <ul className="tour-points">
            {s.points.map(([icon, text]) => <li key={text}><span className="tour-ic"><Icon name={icon} size={18} /></span>{tx(text)}</li>)}
          </ul>
          {last && (
            <p className="tiny muted tour-note">
              <Icon name="info" size={13} /> {me?.is_guest ? tx('You’re looking around as a guest, no account needed. ') : ''}
              {tx('This preview is filled with example students, plans and events (marked “Example”) so you can try everything.')}
            </p>
          )}
          <div className="tour-nav">
            <div className="tour-dots" aria-hidden="true">{SLIDES.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
            <span className="spacer" />
            {i > 0 ? <button className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>{tx('Back')}</button>
              : <button className="btn btn-ghost btn-sm" onClick={onDone}>{tx('Skip')}</button>}
            <button className="btn btn-primary" onClick={() => (last ? onDone() : setI(i + 1))}>
              {last ? tx('Start exploring') : tx('Next')}{!last && <Icon name="back" size={16} style={{ transform: 'rotate(180deg)' }} />}
            </button>
          </div>
          <p className="tiny muted sr-only" aria-live="polite">{tx('Step {n} of {total}', { n: i + 1, total: SLIDES.length })}</p>
        </div>
      </div>
    </div>
  );
}

/** Save a guest's activity under a real account, or log in to an existing one. */
export function AccountSheet({ onClose, initial = 'signup' }) {
  const { api, reloadMe, toast } = useApp();
  const [mode, setMode] = useState(initial);
  const [f, setF] = useState({ first_name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (mode === 'signup') await api.post('/auth/claim', f);
      else await api.post('/auth/login', { email: f.email, password: f.password });
      await reloadMe();
      toast(mode === 'signup' ? tx('Account created. Everything you did as a guest is kept.') : tx('Welcome back!'));
      onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={mode === 'signup' ? tx('Create your account') : tx('Log in')} onClose={onClose}>
      <div className="tabs-inline" role="tablist">
        <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>{tx('Create account')}</button>
        <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>{tx('Log in')}</button>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === 'signup' && <p className="small muted">{tx('Keep your plans, chats and wishes, and let other students see your profile. Takes 20 seconds.')}</p>}
        {mode === 'signup' && (
          <label className="field"><span>{tx('First name')}</span>
            <input className="input" autoComplete="given-name" maxLength={40} value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          </label>
        )}
        <label className="field"><span>{tx('Email')}</span>
          <input className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label className="field"><span>{tx('Password')}</span>
          <input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {mode === 'signup' && <span className="hint">{tx('At least 8 characters.')}</span>}
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{mode === 'signup' ? tx('Create account') : tx('Log in')}</button>
        <p className="tiny muted">{tx('Adults (18+) only.')} {tx('Guest visits are removed automatically after 7 days.')}</p>
      </form>
    </Sheet>
  );
}
