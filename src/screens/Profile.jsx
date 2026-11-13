import { useEffect, useRef, useState } from 'react';
import { getAppName, t, tx } from '../i18n.js';
import { Avatar, EmailBadge, Icon, LanguageSwitch, SampleBadge, Sheet, TopBar, useApp } from '../components.jsx';
import { areaName, nearestArea, useApi } from '../util.js';
import { categoryLabel } from '../../shared/catalog.js';
import { ProfileFields, profileDefaults } from './Onboarding.jsx';

/** Resize in the browser (max 512 px, JPEG) so uploads stay small, then send as JSON. */
function resizeToJpeg(file, max = 512) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height); // square crop from the centre
      const out = Math.min(max, side);
      const c = document.createElement('canvas'); c.width = out; c.height = out;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tx('That file does not look like a picture.'))); };
    img.src = url;
  });
}

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
  const { me, city, api, reloadMe, toast, lang } = useApp();
  const blocks = useApi('/me/blocks');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [geoMsg, setGeoMsg] = useState('');
  const [mailMsg, setMailMsg] = useState('');
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

  const toggleNearby = (on) => {
    if (!on) return privacy({ nearby_enabled: false }, tx("Nearby discovery is off."));
    if (!navigator.geolocation) { setGeoMsg(tx("Your browser does not support location. Choose your area manually instead.")); return undefined; }
    setGeoMsg(tx("Asking your browser for your location once…"));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // The nearest neighbourhood is worked out here on your device. Only its name is sent to the server.
        const area = nearestArea(city.areas, pos.coords.latitude, pos.coords.longitude);
        setGeoMsg(tx('Set to {area}. Your coordinates were not sent or stored.', { area: area.name }));
        privacy({ nearby_enabled: true, area: area.key }, tx("Nearby discovery is on."));
      },
      () => setGeoMsg(tx("Location permission was not given. Nothing changed. You can still choose your area manually.")),
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 },
    );
    return undefined;
  };

  const sendVerification = async () => {
    setBusy(true); setMailMsg('');
    try {
      const r = await api.post('/auth/verify/send');
      setMailMsg(r.already ? tx('Your email is already confirmed.') : r.sent ? tx('Email sent. Open the link in it within 48 hours.')
        : tx('Email sending is not set up on this server yet, so no email was sent. The project team can switch it on.'));
    } catch (x) { setMailMsg(tx(x.message)); } finally { setBusy(false); }
  };
  const logout = async () => { await api.post('/auth/logout'); await reloadMe(); location.hash = '#/explore'; };
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
        <Icon name="globe" /><div>{me.languages.map((l) => tx(l)).join(', ') || tx("No languages yet")}</div>
        <Icon name="heart" /><div>{me.interests.map((c) => tx(categoryLabel(c))).join(', ') || tx("No interests yet")}</div>
        <Icon name="pin" /><div>{areaName(city.areas, me.area) || tx("Area not set")}</div>
        {me.university && <><Icon name="school" /><div>{me.university} <span className="tiny muted">{me.show_university ? tx('(shown on profile)') : tx('(hidden)')}</span></div></>}
      </div>
      {!me.is_demo && (
        <section className="card card-pad stack-sm" aria-labelledby="mail-h">
          <div className="row"><h3 id="mail-h" style={{ flex: 1 }}>{tx('Email')}</h3>{me.email_verified && <EmailBadge />}</div>
          <p className="small">{me.email} <span className="tiny muted">{tx('(never shown to others)')}</span></p>
          {me.email_verified
            ? <p className="tiny muted">{tx('Others see “Email confirmed” on your profile. It only means you can receive email at this address. It does not verify that you are a student.')}</p>
            : (
              <>
                <p className="tiny muted">{t('profile.emailUnverified')}</p>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={sendVerification}>{tx('Send confirmation email')}</button>
                {mailMsg && <p className="small" role="status">{mailMsg}</p>}
              </>
            )}
        </section>
      )}

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
          <label className="switch"><span><strong>{t('profile.nearby')}</strong><br /><span className="hint">{t('profile.nearbyHint')}</span></span>
            <input type="checkbox" role="switch" checked={me.nearby_enabled} disabled={busy} onChange={(e) => toggleNearby(e.target.checked)} /></label>
          {geoMsg && <p className="small" role="status" style={{ padding: '8px 0' }}>{geoMsg}</p>}
          <label className="field" style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}><span>{t('profile.area')}</span>
            <select className="select" value={me.area || ''} disabled={busy} onChange={(e) => privacy({ area: e.target.value || null }, tx("Area updated."))}>
              <option value="">{tx("Prefer not to say")}</option>
              {city.areas.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
          </label>
          <label className="switch" style={{ borderBottom: 0 }}><span><strong>{t('profile.sample')}</strong><br /><span className="hint">{t('profile.sampleHint')}</span></span>
            <input type="checkbox" role="switch" checked={me.show_sample} disabled={busy} onChange={(e) => privacy({ show_sample: e.target.checked })} /></label>
        </div>
      </section>

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
        <p className="small muted">{tx("A student project prototype from Las Palmas. Recommendations use simple, visible rules, not AI. Sample profiles and events are fictional and always labelled. We are not affiliated with ESN or any university.")}</p>
      </section>

      <div className="stack-sm">
        <button className="btn btn-secondary btn-block" onClick={logout}><Icon name="logout" />{t('profile.logout')}</button>
        {!me.is_demo && <button className="btn btn-danger btn-block" onClick={() => setDel({ password: '' })}><Icon name="trash" />{t('profile.delete')}</button>}
      </div>

      {del && (
        <Sheet title={t('profile.delete')} onClose={() => setDel(null)}>
          <form className="stack" onSubmit={doDelete}>
            <p className="small">{t('profile.deleteHint')}</p>
            <label className="field"><span>{tx("Confirm with your password")}</span>
              <input className="input" type="password" autoComplete="current-password" required value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />
            </label>
            {del.err && <div className="form-error" role="alert">{del.err}</div>}
            <button className="btn btn-danger btn-block" disabled={busy}>{tx("Delete my account permanently")}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
