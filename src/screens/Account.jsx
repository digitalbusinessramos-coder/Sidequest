import { useState } from 'react';
import { tx } from '../i18n.js';
import { Icon, Sheet, useApp } from '../components.jsx';

/**
 * Save a guest's activity under a real account, or log in to an existing one.
 * When opened for an action (join, publish), the action continues right after: the student never has to find the plan again.
 * Email confirmation happens in the background and never blocks this.
 */
export function AccountSheet({ onClose, initial = 'signup', reason, onDone }) {
  const { api, reloadMe, toast, meta } = useApp();
  const [mode, setMode] = useState(initial);
  const [f, setF] = useState({ first_name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (mode === 'signup') await api.post('/auth/claim', f);
      else await api.post('/auth/login', { email: f.email, password: f.password });
      await reloadMe();
      onClose();
      if (onDone) await onDone();
      else toast(mode === 'signup' ? tx('Account created. Everything you did as a guest is kept.') : tx('Welcome back!'));
    } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
  };
  const sendReset = async () => {
    setBusy(true); setErr('');
    try {
      await api.post('/auth/password/forgot', { email: f.email });
      setForgot(!meta.passwordReset ? tx('Password reset by email is not switched on yet. Please contact the project team through Feedback.') : tx('If an account uses this address, we sent a link to choose a new password. It works for 1 hour.'));
    } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={mode === 'signup' ? tx('Create your account') : tx('Log in')} onClose={onClose}>
      {reason && <div className="notice lime"><Icon name="info" />{reason}</div>}
      <div className="tabs-inline" role="tablist">
        <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>{tx('Create account')}</button>
        <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>{tx('Log in')}</button>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === 'signup' && (
          <label className="field"><span>{tx('First name')}</span>
            <input className="input" autoComplete="given-name" maxLength={40} required value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
            <span className="hint">{tx('Shown to the people in your plans.')}</span>
          </label>
        )}
        <label className="field"><span>{tx('Email')}</span>
          <input className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {mode === 'signup' && <span className="hint">{tx('Never shown to others.')}</span>}
        </label>
        <label className="field"><span>{tx('Password')}</span>
          <input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {mode === 'signup' && <span className="hint">{tx('At least 8 characters.')}</span>}
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{mode === 'signup' ? (onDone ? tx('Create account and continue') : tx('Create account')) : (onDone ? tx('Log in and continue') : tx('Log in'))}</button>
        {mode === 'login' && (
          <div className="stack-sm">
            <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} disabled={busy || !f.email} onClick={sendReset}>{tx('Forgot your password?')}</button>
            {!f.email && <span className="tiny muted">{tx('Type your email above first.')}</span>}
            {forgot && <p className="small" role="status">{forgot}</p>}
          </div>
        )}
        <p className="tiny muted">{tx('Adults (18+) only.')}</p>
      </form>
    </Sheet>
  );
}
