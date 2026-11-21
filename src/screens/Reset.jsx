import { useState } from 'react';
import { tx } from '../i18n.js';
import { useApp } from '../components.jsx';

/** Opened from the password email: choose a new password, then you are logged in. */
export default function ResetPassword({ token }) {
  const { api, reloadMe, toast } = useApp();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api.post('/auth/password/reset', { token, password: pw });
      await reloadMe();
      toast(tx('New password saved. You are logged in.'));
      location.replace('#/plans');
    } catch (x) { setErr(tx(x.message)); } finally { setBusy(false); }
  };
  return (
    <main className="welcome">
      <h1>{tx('Choose a new password')}</h1>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>{tx('New password')}</span>
          <input className="input" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
          <span className="hint">{tx('At least 8 characters.')}</span>
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{tx('Save new password')}</button>
        <a className="small" href="#/explore">{tx('Back to plans')}</a>
      </form>
    </main>
  );
}
