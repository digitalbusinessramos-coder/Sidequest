import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppName, tx } from '../i18n.js';
import { Icon, LanguageSwitch, Sheet, useApp } from '../components.jsx';
import { photo } from '../../shared/photos.js';

/**
 * First-visit tour, from a new student's point of view.
 * 1. One welcome card: what the app is for and why it helps.
 * 2. A guided walk-through: the screen is dimmed, one part is highlighted with an arrow and a short explanation,
 *    moving across Explore, Buddies, My Plans, the City Guide and Profile.
 * Shown once per browser; "How it works" replays it.
 */
const INTRO = {
  photo: 'canteras', eyebrow: 'Welcome to Las Palmas',
  title: 'New in the city? You don’t have to do things alone.',
  body: 'Want to surf, hike or go out tonight, but nobody to go with? Find one buddy or a small group for exactly that.',
  points: [['group', 'Small groups, not huge events'], ['globe', 'Exchange students, interns and locals'], ['euro', 'Costs shown up front, many plans are free']],
};

// Each step: which screen, which part to highlight, and what to say about it.
export const STEPS = [
  { route: 'explore', sel: '[data-tour=nav-explore]', title: 'Explore', body: 'Everything happening in Las Palmas: plans by students and events. This is where you start.' },
  { route: 'explore', sel: '[data-tour=people]', title: 'Students looking for company', body: 'Tap a face to see who they are, what they like and which languages they speak.' },
  { route: 'explore', sel: '[data-tour=events] .act-card', title: 'Events: find someone to go with', body: 'You register with the organiser as usual. Here you find people to go with and talk in the event’s group chat.' },
  { route: 'explore', sel: '[data-tour=plans-list] .act-card', title: 'Plans by students', body: 'Small plans with a time, area and cost. “Join directly” means one tap; for the others you send a short request to the organiser.' },
  { route: 'explore', sel: '[data-tour=view-toggle]', title: 'List or map', body: 'Switch to the city map to see where things happen. Pins show the neighbourhood, never anyone’s address.' },
  { route: 'explore', sel: '[data-tour=create]', title: 'Create your own plan', body: 'Pick a template (coffee, surf, night out…), set time and place, and choose: anyone can join, or you accept requests.' },
  { route: 'explore', sel: '[data-tour=market-switch]', title: 'Student marketplace', body: 'Buy, sell or give away bikes, books and furniture. Event tickets can only be passed on at or below the price paid.' },
  { route: 'buddies', sel: '[data-tour=students] .person-card', title: 'Invite someone', body: 'Every student has an Invite button. It starts a plan with that person already invited.' },
  { route: 'buddies', sel: '[data-tour=matches] .card', title: 'Same wish, same time', body: 'Save what you’d like to do and when. We show people with the same wish and say why in plain words. No secret score.' },
  { route: 'plans', sel: '[data-tour=plans-view], [data-tour=plans-head]', title: 'My Plans', body: 'Everything you joined, as a list or as a weekly timetable, with chats and updates.' },
  { route: 'guide', sel: '[data-tour=tip]', title: 'Tips from students', body: 'Recommendations from other students. Like the ones you agree with and save the ones you want to try. Official links are further down.' },
  { route: 'profile', sel: '[data-tour=nav-profile]', title: 'Your profile', body: 'Add a photo, choose what others see, switch language, send us feedback. You can block or report anyone from their profile.' },
];

export default function Tour({ onDone }) {
  const [phase, setPhase] = useState('intro');
  if (phase === 'spot') return <Spotlight onDone={onDone} />;
  return <Intro onStart={() => setPhase('spot')} onSkip={onDone} />;
}

function Intro({ onStart, onSkip }) {
  const { me } = useApp();
  const ph = photo(INTRO.photo);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-card">
        <figure className="tour-photo">
          <img src={ph.src} alt={tx(ph.alt)} />
          <figcaption className="photo-credit">{tx('Photo')}: {ph.author}, {ph.license}, Wikimedia Commons</figcaption>
          <div className="tour-logo">{getAppName()}</div>
        </figure>
        <div className="tour-body" ref={ref} tabIndex={-1}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow">{tx(INTRO.eyebrow)}</span>
            <LanguageSwitch />
          </div>
          <h1 id="tour-title" className="tour-title">{tx(INTRO.title)}</h1>
          <p>{tx(INTRO.body)}</p>
          <ul className="tour-points">
            {INTRO.points.map(([icon, text]) => <li key={text}><span className="tour-ic"><Icon name={icon} size={18} /></span>{tx(text)}</li>)}
          </ul>
          <p className="tiny muted tour-note">
            <Icon name="info" size={13} /> {me?.is_guest ? tx('You’re looking around as a guest, no account needed. ') : ''}
            {tx('This preview is filled with example students, plans and events (marked “Example”) so you can try everything.')}
          </p>
          <div className="tour-nav">
            <button className="btn btn-ghost btn-sm" onClick={onSkip}>{tx('Skip')}</button>
            <span className="spacer" />
            <button className="btn btn-primary btn-lg" onClick={onStart}>{tx('Show me around')}<Icon name="back" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PAD = 8;

function Spotlight({ onDone }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [box, setBox] = useState(null); // highlighted area in viewport coordinates
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const tip = useRef(null);
  const target = useRef(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const measure = useCallback(() => {
    const el = target.current;
    setVp({ w: window.innerWidth, h: window.innerHeight });
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top - PAD, 6);
    const bottom = Math.min(r.bottom + PAD, window.innerHeight - 6);
    setBox({ top, left: Math.max(r.left - PAD, 6), width: Math.min(r.width + PAD * 2, window.innerWidth - 12), height: Math.max(bottom - top, 24) });
  }, []);

  // Go to the step's screen, wait for the part to appear, bring it into view, then highlight it.
  useEffect(() => {
    let cancelled = false;
    setBox(null);
    target.current = null;
    if (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] !== step.route) location.hash = `#/${step.route}`;
    const started = Date.now();
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(step.sel);
      if (el) {
        target.current = el;
        const r = el.getBoundingClientRect();
        const fixed = getComputedStyle(el).position === 'fixed' || el.closest('.tabbar');
        if (!fixed && (r.top < 70 || r.bottom > window.innerHeight - 200)) {
          window.scrollTo({ top: window.scrollY + r.top - Math.max(90, (window.innerHeight - r.height) / 3), behavior: 'auto' });
        }
        setTimeout(() => { if (!cancelled) { measure(); tip.current?.focus(); } }, 120);
      } else if (Date.now() - started < 5000) setTimeout(find, 120);
      else if (i + dir >= 0 && i + dir < STEPS.length) setI(i + dir); // part not on this screen (e.g. still loading): move on
      else onDone();
    };
    const t = setTimeout(find, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => measure();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); };
  }, [measure]);

  const go = (d) => {
    if (d > 0 && last) { finish(); return; }
    setDir(d);
    setI(Math.min(Math.max(i + d, 0), STEPS.length - 1));
  };
  const finish = () => { location.hash = '#/explore'; window.scrollTo(0, 0); onDone(); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft' && i > 0) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Bubble below the highlighted part if there is room, otherwise above it.
  const W = Math.min(360, vp.w - 32);
  let bubble = null;
  if (box) {
    const below = box.top + box.height + 18;
    const roomBelow = vp.h - below > 210;
    const cx = box.left + box.width / 2;
    const left = Math.min(Math.max(cx - W / 2, 16), vp.w - W - 16);
    bubble = {
      place: roomBelow ? 'below' : 'above',
      style: roomBelow ? { top: below, left, width: W } : { bottom: vp.h - box.top + 18, left, width: W },
      arrow: Math.min(Math.max(cx - left, 22), W - 22),
    };
  }

  return (
    <div className="spot" role="dialog" aria-modal="true" aria-labelledby="spot-title">
      {box ? <div className="spot-hole" style={box} aria-hidden="true" /> : <div className="spot-dim" aria-hidden="true" />}
      {bubble && (
        <div className={`spot-tip ${bubble.place}`} style={bubble.style} ref={tip} tabIndex={-1}>
          <span className="spot-arrow" style={{ left: bubble.arrow }} aria-hidden="true" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="spot-count">{tx('Step {n} of {total}', { n: i + 1, total: STEPS.length })}</span>
            <button className="spot-skip" onClick={finish}>{tx('Skip tour')}</button>
          </div>
          <h2 id="spot-title" className="spot-title">{tx(step.title)}</h2>
          <p className="small">{tx(step.body)}</p>
          <div className="spot-progress" aria-hidden="true"><i style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
          <div className="row">
            {i > 0 && <button className="btn btn-ghost btn-sm" onClick={() => go(-1)}>{tx('Back')}</button>}
            <span className="spacer" />
            <button className="btn btn-primary btn-sm" onClick={() => go(1)}>{last ? tx('Start exploring') : tx('Next')}{!last && <Icon name="back" size={15} style={{ transform: 'rotate(180deg)' }} />}</button>
          </div>
        </div>
      )}
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
