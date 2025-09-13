import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import pt from '@/i18n/pt.json';
import { api } from '@/lib/api';

export default function Signup() {
  const t = pt.signup;
  const [form, setForm] = useState({ first_name: '', last_name: '', username: '', email: '', password: '', confirm_password: '', uf: '' });
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target; setForm((f) => ({ ...f, [name]: name === 'username' ? value.toLowerCase() : value }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (form.password !== form.confirm_password) { setErr('As senhas não conferem'); return; }
    if (!/^[a-z0-9._-]{3,}$/.test(form.username)) { setErr('Username inválido'); return; }
    try {
      await api.signup({ first_name: form.first_name, last_name: form.last_name, username: form.username, email: form.email, password: form.password, uf: form.uf });
      nav('/family/choose', { replace: true });
    } catch (e: any) { setErr(e?.message || 'Falha no cadastro'); }
  }

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <div className="card">
        <h1 className="title" style={{ marginTop: 0 }}>{t.title}</h1>
        <form onSubmit={onSubmit}>
          <div className="grid cols-2">
            <div className="field"><label htmlFor="first_name">{t.first_name}</label><input id="first_name" name="first_name" required value={form.first_name} onChange={onChange} /></div>
            <div className="field"><label htmlFor="last_name">{t.last_name}</label><input id="last_name" name="last_name" required value={form.last_name} onChange={onChange} /></div>
          </div>
          <div className="grid cols-2">
            <div className="field"><label htmlFor="username">{t.username}</label><input id="username" name="username" required value={form.username} onChange={onChange} /></div>
            <div className="field"><label htmlFor="email">{t.email}</label><input id="email" type="email" name="email" required value={form.email} onChange={onChange} /></div>
          </div>
          <div className="grid cols-2">
            <div className="field"><label htmlFor="password">{t.password}</label><input id="password" type="password" name="password" required value={form.password} onChange={onChange} /></div>
            <div className="field"><label htmlFor="confirm_password">{t.confirm_password}</label><input id="confirm_password" type="password" name="confirm_password" required value={form.confirm_password} onChange={onChange} /></div>
          </div>
          <div className="field"><label htmlFor="uf">{t.uf}</label>
            <select id="uf" name="uf" required value={form.uf} onChange={onChange}>
              <option value="" disabled>UF</option>
              {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          {err && <div role="alert" className="error" aria-live="assertive">{err}</div>}
          <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="submit" className="primary">{t.submit}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

