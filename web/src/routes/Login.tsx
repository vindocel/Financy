import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import pt from '@/i18n/pt.json';
import { useAuth } from '@/lib/auth';

export default function Login() {
  const t = pt.login;
  const { login } = useAuth();
  const [emailOrUsername, setId] = useState('');
  const [password, setPw] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();
  const loc = useLocation() as any;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await login(emailOrUsername, password);
      nav((loc.state && loc.state.from?.pathname) || '/app', { replace: true });
    } catch (e: any) {
      setErr(e?.message || 'Falha no login');
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1 className="title" style={{ marginTop: 0 }}>{t.title}</h1>
        <form onSubmit={onSubmit} aria-describedby={err ? 'login-error' : undefined}>
          <div className="field">
            <label htmlFor="id">{t.email_or_username}</label>
            <input id="id" name="emailOrUsername" autoComplete="username" required value={emailOrUsername} onChange={(e) => setId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw">{t.password}</label>
            <input id="pw" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPw(e.target.value)} />
          </div>
          {err && <div id="login-error" role="alert" className="error" aria-live="assertive">{err}</div>}
          <div className="actions" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <div className="row">
              <Link to="/signup">{t.signup}</Link>
              <Link to="/forgot">{t.forgot}</Link>
            </div>
            <button type="submit" className="primary">{t.signin}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

