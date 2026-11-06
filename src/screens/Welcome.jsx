import { useState } from 'react';
import { getAppName, t } from '../i18n.js';
import { Avatar, Icon, SampleBadge, useApp } from '../components.jsx';

export default function Welcome() {
  const { meta, api, reloadMe } = useApp();
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const name = getAppName();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.post(mode === 'signup' ? '/auth/signup' : '/auth/login', { email, password });
      await reloadMe();
      location.hash = '#/explore';
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const demo = async (id) => {
    setBusy(true); setErr('');
    try { await api.post('/auth/demo', { personaId: id }); await reloadMe(); location.hash = '#/explore'; } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <main className="welcome">
      <div className="stack-sm">
        <span className="eyebrow">Las Palmas de Gran Canaria</span>
        <div className="logo">{name.length > 6 ? <>{name.slice(0, -5)}<span>{name.slice(-5)}</span></> : name}</div>
        <p style={{ fontSize: '1.1rem' }}>{t('welcome.tagline')}</p>
      </div>
      <ol className="journey" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {['welcome.step1', 'welcome.step2', 'welcome.step3'].map((k, i) => (
          <li key={k}><span className="n">{i + 1}</span>{t(k)}</li>
        ))}
      </ol>

      <section className="card card-pad stack" aria-label="Account">
        <div className="tabs-inline" role="tablist">
          <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>{t('welcome.signup')}</button>
          <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>{t('welcome.login')}</button>
        </div>
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'signup' && <span className="hint">At least 8 characters.</span>}
          </label>
          {err && <div className="form-error" role="alert">{err}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{mode === 'signup' ? t('welcome.signup') : t('welcome.login')}</button>
          <p className="tiny muted">{t('welcome.emailNote')} Adults (18+) only.</p>
        </form>
      </section>

      {meta.demoMode && meta.personas.length > 0 && (
        <section className="stack" aria-labelledby="demo-h">
          <div className="row"><h2 id="demo-h" style={{ fontSize: '1.05rem' }}>{t('welcome.demoTitle')}</h2><SampleBadge /></div>
          <p className="small muted">{t('welcome.demoHint')} Open a second browser window with a different persona to test requests and chat between two people.</p>
          <div className="stack-sm">
            {meta.personas.map((p) => (
              <button key={p.id} className="persona" onClick={() => demo(p.id)} disabled={busy}>
                <Avatar person={p} size="sm" />
                <span style={{ flex: 1 }}><strong>{p.first_name}</strong><br /><span className="tiny muted">{p.intro.replace('Sample profile. ', '')}</span></span>
                <Icon name="back" style={{ transform: 'rotate(180deg)' }} />
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
