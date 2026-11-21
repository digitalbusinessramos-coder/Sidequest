import { useMemo, useState } from 'react';
import { getLanguage, tx } from '../i18n.js';
import { Icon } from '../components.jsx';
import { LANGUAGE_CODES, LANGUAGES } from '../../shared/catalog.js';
import { fmtMonth } from '../util.js';

const uiLang = () => (getLanguage() === 'es' ? 'es' : 'en');
const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase(uiLang()) + s.slice(1) : s);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A stored language (English name, or text someone typed) in the app's language. */
export function langName(stored) {
  const code = LANGUAGE_CODES[stored];
  if (!code) return stored === 'Other' ? tx('Other') : stored;
  try { return cap(new Intl.DisplayNames([uiLang()], { type: 'language' }).of(code)) || stored; } catch { return stored; }
}

/**
 * Optional languages: a search box over the list (alphabetical in the app's language), the chosen ones as removable chips,
 * and "Add another language" for anything that is not listed.
 */
export function LanguagePicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const options = useMemo(() => LANGUAGES.map((key) => ({ key, label: langName(key) }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLang())), []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k].slice(0, 12));
  const query = norm(q.trim());
  const shown = query ? options.filter((o) => norm(o.label).includes(query) || norm(o.key).includes(query)) : options;
  const visible = query || all ? shown : shown.slice(0, 12);
  const typed = q.trim();
  const canAdd = typed.length > 1 && !options.some((o) => norm(o.label) === query || norm(o.key) === query) && !value.some((v) => norm(v) === query);
  return (
    <div className="field">
      <span className="label" id="lang-pick-l">{tx('Languages you speak (optional)')}</span>
      {value.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }} aria-label={tx('Chosen languages')}>
          {value.map((k) => (
            <button key={k} type="button" className="chip on chip-sm" onClick={() => toggle(k)} aria-label={tx('Remove {what}', { what: langName(k) })}>
              {langName(k)} <Icon name="x" size={13} />
            </button>
          ))}
        </div>
      )}
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search languages')} aria-labelledby="lang-pick-l"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1) { toggle(shown[0].key); setQ(''); } else if (canAdd) { toggle(typed); setQ(''); } } }} />
      <div className="row wrap" style={{ gap: 6 }} role="group" aria-labelledby="lang-pick-l">
        {visible.filter((o) => !value.includes(o.key)).map((o) => (
          <button key={o.key} type="button" className="chip chip-sm" onClick={() => { toggle(o.key); setQ(''); }}>{o.label}</button>
        ))}
        {!query && !all && shown.length > 12 && <button type="button" className="chip chip-sm" onClick={() => setAll(true)}>{tx('Show all')}</button>}
      </div>
      {canAdd && <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { toggle(typed); setQ(''); }}><Icon name="plus" size={15} />{tx('Add another language: “{name}”', { name: typed })}</button>}
      {!typed && <span className="hint">{tx('Not listed? Type it in the search box and add it.')}</span>}
    </div>
  );
}

// ---------- flags ----------
// Every two-letter region the browser can name (countries and territories), plus the Canary Islands (IC) and the EU.
const NOT_FLAGS = new Set(['EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'AC', 'CP', 'DG', 'EA', 'TA', 'CQ']);
let REGION_CODES;
function regionCodes() {
  if (REGION_CODES) return REGION_CODES;
  const dn = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const out = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const c = String.fromCharCode(a, b);
    if (NOT_FLAGS.has(c)) continue;
    try { if (dn.of(c)) out.push(c); } catch { /* not a region */ }
  }
  REGION_CODES = out;
  return out;
}
export function regionName(code) {
  try { return new Intl.DisplayNames([uiLang()], { type: 'region' }).of(code) || code; } catch { return code; }
}
export const flagEmoji = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** A flag always comes with its name in text, so it reads well with a screen reader and where flag emoji don't render. */
export function FlagList({ flags }) {
  if (!flags?.length) return null;
  return (
    <span className="flag-list">
      {flags.map((c) => <span key={c} className="flag-item"><span aria-hidden="true">{flagEmoji(c)}</span> {regionName(c)}</span>)}
    </span>
  );
}

/** Optional, decorative: flags never decide language, eligibility or anything else. */
export function FlagPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const options = useMemo(() => regionCodes().map((c) => ({ c, name: regionName(c) })).sort((a, b) => a.name.localeCompare(b.name, uiLang())), []); // eslint-disable-line react-hooks/exhaustive-deps
  const query = norm(q.trim());
  const shown = query ? options.filter((o) => norm(o.name).includes(query)) : [];
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c].slice(0, 8));
  return (
    <div className="field">
      <span className="label" id="flag-pick-l">{tx('Want to add a flag to your bio? Pick any you identify with.')}</span>
      {value.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {value.map((c) => (
            <button key={c} type="button" className="chip on chip-sm" onClick={() => toggle(c)} aria-label={tx('Remove {what}', { what: regionName(c) })}>
              <span aria-hidden="true">{flagEmoji(c)}</span> {regionName(c)} <Icon name="x" size={13} />
            </button>
          ))}
        </div>
      )}
      {!open ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Icon name="plus" size={15} />{value.length ? tx('Add another flag') : tx('Add a flag')}</button>
          {!value.length && <span className="hint">{tx('Optional. You can skip this.')}</span>}
        </div>
      ) : (
        <>
          <input className="input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search by country or territory')} aria-labelledby="flag-pick-l"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1) { toggle(shown[0].c); setQ(''); } } }} />
          <div className="row wrap" style={{ gap: 6 }} role="group" aria-labelledby="flag-pick-l">
            {shown.slice(0, 24).map((o) => (
              <button key={o.c} type="button" className={`chip chip-sm ${value.includes(o.c) ? 'on' : ''}`} aria-pressed={value.includes(o.c)} onClick={() => { toggle(o.c); setQ(''); }}>
                <span aria-hidden="true">{flagEmoji(o.c)}</span> {o.name}
              </button>
            ))}
            {query && !shown.length && <span className="hint">{tx('No match. Try another spelling.')}</span>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setOpen(false); setQ(''); }}>{tx('Done')}</button>
        </>
      )}
    </div>
  );
}

// ---------- stay ----------
export const STAY_LABEL = { sem1: 'First semester', sem2: 'Second semester', year: 'Full year', custom: 'Custom dates', local: 'I live here' };

export function stayText(p) {
  if (p.stay === 'custom' || (!p.stay && (p.exchange_start || p.exchange_end))) {
    const f = (d) => (d && d.length > 7 ? new Date(`${d}T12:00:00Z`).toLocaleDateString(getLanguage() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : fmtMonth(d));
    if (p.exchange_start && p.exchange_end) return tx('Here {from} – {to}', { from: f(p.exchange_start), to: f(p.exchange_end) });
    if (p.exchange_start) return tx('Here from {from}', { from: f(p.exchange_start) });
    if (p.exchange_end) return tx('Here until {to}', { to: f(p.exchange_end) });
    return null;
  }
  if (p.stay === 'local') return tx('Lives in Las Palmas');
  if (p.stay) return tx('Here for: {stay}', { stay: tx(STAY_LABEL[p.stay]).toLowerCase() });
  return null;
}

export function StayPicker({ v, set }) {
  const pick = (stay) => set({ stay: v.stay === stay ? '' : stay });
  return (
    <div className="field">
      <span className="label" id="stay-l">{tx('How long are you in Las Palmas? (optional)')}</span>
      <div className="row wrap" style={{ gap: 6 }} role="radiogroup" aria-labelledby="stay-l">
        {Object.entries(STAY_LABEL).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={v.stay === k} className={`chip chip-sm ${v.stay === k ? 'on' : ''}`} onClick={() => pick(k)}>{tx(label)}</button>
        ))}
      </div>
      {v.stay === 'custom' && (
        <div className="grid-2">
          <label className="field"><span>{tx('From')}</span><input className="input input-date" type="date" value={v.exchange_start?.length > 7 ? v.exchange_start : ''} onChange={(e) => set({ exchange_start: e.target.value })} /></label>
          <label className="field"><span>{tx('Until')}</span><input className="input input-date" type="date" value={v.exchange_end?.length > 7 ? v.exchange_end : ''} min={v.exchange_start || undefined} onChange={(e) => set({ exchange_end: e.target.value })} /></label>
        </div>
      )}
      <span className="hint">{tx('Works for exchange students, interns and people who live here. Tap again to clear.')}</span>
    </div>
  );
}
