import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import pt from '@/i18n/pt.json';
import { api } from '@/lib/api';

export default function Forgot() {
  const t = pt.forgot; const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api.forgot(email); setMsg('Enviado! Verifique seu e-mail.'); } catch (e: any) { setErr(e?.message || 'Falha'); }
  }
  return (
    <div className="container auto-s-1036" >
      <div className="card">
        <h1 className="title auto-s-1037" >{t.title}</h1>
        <form onSubmit={onSubmit}>
          <div className="field"><label htmlFor="email">{t.email}</label><input id="email" name="email" type="email" required value={email} onChange={(e)=>setEmail(e.target.value)} /></div>
          {err && <div role="alert" className="error" aria-live="assertive">{err}</div>}
          {msg && <div aria-live="polite">{msg}</div>}
          <div className="actions auto-s-1038" >
            <button type="submit" className="primary">{t.submit}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

