import { useEffect, useRef, useState } from 'react';
import { getAppName, t, tx } from '../i18n.js';
import { NotifySettings } from './Notify.jsx';
import { disablePush } from '../push.js';
import { Avatar, EmailBadge, Icon, LanguageSwitch, SampleBadge, Sheet, TopBar, useApp } from '../components.jsx';
import { areaName, resizeToJpeg, useApi } from '../util.js';
import { categoryLabel } from '../../shared/catalog.js';
import { ProfileFields, profileDefaults } from './Onboarding.jsx';
import { FlagList, langName, stayText } from './ProfileBits.jsx';
import { FeedbackSheet } from './Market.jsx';

function PhotoPicker() {
  const { me, api, reloadMe, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { await api.put('/me/photo', { data: await resizeToJpeg(f) }); await reloadMe(); toast(tx('Profile picture updated.')); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.del('/me/photo'); await reloadMe(); toast(tx('Profile picture removed.')); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };
  if (me.is_demo) return <Avatar person={me} size="lg" />;
  return (
    <div className="stack-sm" style={{ alignItems: 'center', gap: 4 }}>
      <button type="button" className="photo-pick" onClick={() => input.current?.click()} disabled={busy} aria-label={me.photo ? tx('Change profile picture') : tx('Add a profile picture')}>
        <Avatar person={me} size="lg" />
        <span className="photo-pick-badge"><Icon name="camera" size={14} /></span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} hidden />
      {me.photo && <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 28, padding: '0 6px' }} onClick={remove} disabled={busy}>{tx('Remove')}</button>}
    </div>
  );
}

function EditProfile() {
  const { me, meta, city, api, reloadMe, toast } = useApp();
  const [v, setV] = useState(profileDefaults(me));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.put('/me/profile', { ...v, city: city.slug }); await reloadMe(); toast(tx("Profile saved.")); location.hash = '#/profile'; } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <>
      <TopBar title={t('profile.edit')} />
      <form className="page" onSubmit={save}>
        <ProfileFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} city={city} meta={meta} />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{t('common.save')}</button>
      </form>
    </>
  );
}

export default function Profile({ sub }) {
  const { me, city, api, reloadMe, toast, lang, openAccount } = useApp();
  const blocks = useApi('/me/blocks');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [feedback, setFeedback] = useState(false);
  useEffect(() => {
    // Coming back from the link in the verification email.
    const m = /verified=(\w+)/.exec(location.hash);
    if (!m) return;
    if (m[1] === '1') { toast(tx('Thanks! Your email address is confirmed.')); reloadMe(); } else toast(tx('That confirmation link is invalid or has expired. Request a new one below.'), true);
    history.replaceState(null, '', '#/profile');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (sub === 'edit') return <EditProfile />;

  const privacy = async (patch, ok) => {
    setBusy(true);
    try { await api.put('/me/privacy', patch); await reloadMe(); if (ok) toast(ok); } catch (x) { toast(x.message, true); } finally { setBusy(false); }
  };

  const logout = async () => { await disablePush().catch(() => {}); try { localStorage.setItem('sq_wants_login', '1'); } catch { /* ignore */ } await api.post('/auth/logout'); await reloadMe(); location.hash = '#/explore'; };
  const unblock = async (id) => { try { await api.del(`/users/${id}/block`); blocks.reload(); } catch (x) { toast(x.message, true); } };
  const doDelete = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.del('/me', { password: del.password }); await reloadMe(); location.hash = '#/explore'; } catch (x) { setDel({ ...del, err: x.message }); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="row" style={{ gap: 16 }}>
        <PhotoPicker />
        <div className="stack-sm" style={{ flex: 1 }}>
          <h1>{me.first_name}</h1>
          <div className="row wrap" style={{ gap: 6 }}>{me.is_demo && <SampleBadge />}<span className="small muted">{city.name}</span></div>
        </div>
        <a className="btn btn-secondary btn-sm" href="#/profile/edit"><Icon name="edit" size={16} />{t('profile.edit')}</a>
      </div>
      {me.intro && <p>{me.intro}</p>}
      <div className="card card-pad facts-list">
        <Icon name="globe" /><div>{me.languages.map(langName).join(', ') || <span className="muted">{tx('No languages yet')}</span>}</div>
        {me.flags?.length > 0 && <><Icon name="flag" /><div><FlagList flags={me.flags} /></div></>}
        <Icon name="heart" /><div>{me.interests.map((c) => tx(categoryLabel(c))).join(', ') || <span className="muted">{tx('No interests yet')}</span>}</div>
        <Icon name="pin" /><div>{me.meet_area || areaName(city.areas, me.area) ? tx('Likes to meet around {area}', { area: me.meet_area || areaName(city.areas, me.area) }) : <span className="muted">{tx('Meeting area not set')}</span>}</div>
        {stayText(me) && <><Icon name="plans" /><div>{stayText(me)}</div></>}
        {me.university && <><Icon name="school" /><div>{me.university} <span className="tiny muted">{me.show_university ? tx('(shown on profile)') : tx('(hidden)')}</span></div></>}
      </div>
      {me.is_guest && (
        <section className="card card-pad stack-sm guest-card" aria-labelledby="guest-h">
          <h3 id="guest-h">{tx('You’re a guest right now')}</h3>
          <p className="small">{tx('Everything works without an account. Create one to keep your plans and chats, and so other students can find your profile.')}</p>
          <div className="row wrap">
            <button className="btn btn-primary btn-sm" onClick={() => openAccount('signup')}>{tx('Create account')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => openAccount('login')}>{tx('I already have one')}</button>
          </div>
        </section>
      )}
      {!me.is_demo && !me.is_guest && (
        <section className="card card-pad stack-sm" aria-labelledby="mail-h">
          <div className="row"><h3 id="mail-h" style={{ flex: 1 }}>{tx('Email')}</h3>{me.email_verified && <EmailBadge />}</div>
          <p className="small">{me.email} <span className="tiny muted">{tx('(never shown to others)')}</span></p>
        </section>
      )}

      <section className="card card-pad stack-sm" aria-labelledby="notify-h" data-tour="notify">
        <h2 id="notify-h" className="row"><Icon name="bell" />{tx('Notifications')}</h2>
        <NotifySettings />
      </section>

      <section className="stack-sm" aria-labelledby="lang-h">
        <h2 id="lang-h">{tx('Language')}</h2>
        <LanguageSwitch />
        {lang === 'es' && <p className="tiny muted">{tx('The Spanish version was drafted by AI and still needs to be checked by a native speaker. Content written by users is not translated.')}</p>}
      </section>

      <section className="stack-sm" aria-labelledby="priv-h">
        <h2 id="priv-h" className="row"><Icon name="shield" />{t('profile.privacy')}</h2>
        <div className="card card-pad" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <label className="switch"><span><strong>{t('profile.visible')}</strong><br /><span className="hint">{t('profile.visibleHint')}</span></span>
            <input type="checkbox" role="switch" checked={me.visible} disabled={busy} onChange={(e) => privacy({ visible: e.target.checked }, e.target.checked ? tx("You’re visible again.") : tx("Visibility paused."))} /></label>
        </div>
      </section>

      <section className="card card-pad stack-sm" aria-labelledby="fb-h">
        <h2 id="fb-h" className="row"><Icon name="chat" />{tx('Feedback and ideas')}</h2>
        <p className="small muted">{tx('Tell the project team what to improve, add or fix.')}</p>
        <button className="btn btn-secondary" onClick={() => setFeedback(true)}>{tx('Send feedback')}</button>
      </section>
      {feedback && <FeedbackSheet onClose={() => setFeedback(false)} />}
      <section className="stack-sm" aria-labelledby="bl-h">
        <h2 id="bl-h">{t('profile.blocked')}</h2>
        {blocks.data?.blocked.length ? (
          <div className="card card-pad" style={{ paddingTop: 0, paddingBottom: 0 }}>
            {blocks.data.blocked.map((p) => (
              <div key={p.id} className="person-row"><Avatar person={p} size="sm" /><span style={{ flex: 1 }}>{p.first_name}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => unblock(p.id)}>{t('person.unblock')}</button></div>
            ))}
          </div>
        ) : <p className="small muted">{t('profile.noBlocked')}</p>}
      </section>

      <section className="stack-sm" aria-labelledby="about-h">
        <h2 id="about-h">{tx('About {app}')}</h2>
        <p className="small muted">{tx('{app} is an independent student project developed for the Digital Business course at ULPGC.', { app: getAppName() })} {tx('Plans and profiles are posted by students. Example content is kept out of the app; one clearly labelled example plan is in Help. We are not affiliated with ESN Las Palmas, Erasmus Life Las Palmas or any other organisation.')}</p>
        <a className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} href="#/help"><Icon name="info" size={16} />{tx('Help')}</a>
        {me.team && <a className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} href="#/team"><Icon name="shield" size={16} />{tx('Team inbox')}</a>}
      </section>

      <div className="stack-sm">
        {!me.is_guest && <button className="btn btn-secondary btn-block" onClick={logout}><Icon name="logout" />{t('profile.logout')}</button>}
        {!me.is_demo && <button className="btn btn-danger btn-block" onClick={() => setDel({ password: '' })}><Icon name="trash" />{t('profile.delete')}</button>}
      </div>

      {del && (
        <Sheet title={t('profile.delete')} onClose={() => setDel(null)}>
          <form className="stack" onSubmit={doDelete}>
            <p className="small">{t('profile.deleteHint')}</p>
            {!me.is_guest && <label className="field"><span>{tx("Confirm with your password")}</span>
              <input className="input" type="password" autoComplete="current-password" required value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />
            </label>}
            {del.err && <div className="form-error" role="alert">{del.err}</div>}
            <button className="btn btn-danger btn-block" disabled={busy}>{tx("Delete my account permanently")}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
