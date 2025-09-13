import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import pt from '@/i18n/pt.json';
import { api } from '@/lib/api';

export default function Reset() {
  const t = pt.reset; const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (pw !== pw2) { setErr('As senhas não conferem'); return; }
    try { await api.reset(token, pw); nav('/login', { replace: true }); } catch (e: any) { setErr(e?.message || 'Falha'); }
  }
  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1 className="title" style={{ marginTop: 0 }}>{t.title}</h1>
        <form onSubmit={onSubmit}>
          <div className="field"><label htmlFor="pw">{t.password}</label><input id="pw" type="password" required value={pw} onChange={(e)=>setPw(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw2">{t.confirm_password}</label><input id="pw2" type="password" required value={pw2} onChange={(e)=>setPw2(e.target.value)} /></div>
          {err && <div role="alert" className="error" aria-live="assertive">{err}</div>}
          <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="submit" className="primary">{t.submit}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

