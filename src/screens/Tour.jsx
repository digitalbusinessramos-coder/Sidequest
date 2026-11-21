import { useCallback, useEffect, useRef, useState } from 'react';
import { tx } from '../i18n.js';
import { Icon } from '../components.jsx';

/**
 * Optional walk-through of the app. It never opens by itself: students start it from the card on Explore
 * ("Take the tour") or from Help. The screen is dimmed and one part at a time is highlighted with a short explanation.
 */
// Each step: which screen, which part to highlight (first match wins), and what to say about it.
export const STEPS = [
  { route: 'explore', sel: ['[data-tour=plans-list] .act-card', '[data-tour=plans-list]'], title: 'Find a plan', body: 'Plans by students in Las Palmas: coffee, surf, hikes, nights out. Tap one and join.' },
  { route: 'explore', sel: '[data-tour=create]', title: 'Or create your own', body: 'Say what you feel like doing, when and roughly where. Others can join you.' },
  { route: 'plans', sel: ['[data-tour=nav-plans]', '[data-tour=plans-head]'], title: 'My Plans', body: 'Everything you joined or created, with the chat and the meeting point.' },
  { route: 'profile', sel: ['[data-tour=notify]', '[data-tour=nav-profile]'], title: 'Don’t miss anything', body: 'Turn on notifications to know when someone joins your plan or writes to you.' },
]

export default function Tour({ onDone }) {
  return <Spotlight onDone={onDone} />;
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
      const el = [].concat(step.sel).map((q) => document.querySelector(q)).find(Boolean);
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
    const id = setInterval(on, 400); // the page can still move (images loading, a card closing)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); clearInterval(id); };
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
