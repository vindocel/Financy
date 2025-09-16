import React, { useEffect, useState } from 'react';
import pt from '@/i18n/pt.json';
import { api } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

type Tab = 'join' | 'create';

export default function FamilyChoose() {
  const t = pt.family; const nav = useNavigate();
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>('join');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [pendingReq, setPendingReq] = useState<{ id: string } | null>(null);
  useEffect(() => { (async () => { try { const fam = await api.familiesMine(); if (fam) nav('/app', { replace: true }); } catch {} })(); }, [nav]);
  useEffect(() => { (async () => { try { const mine = await api.mineJoinRequests(); const pend = (mine || []).find((x: any) => x.status === 'pending'); if (pend) setPendingReq({ id: pend.id }); else setPendingReq(null); } catch {} })(); }, []);

  async function submitJoin(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api.postJoinRequest(slug.trim()); const mine = await api.mineJoinRequests(); const pend = (mine || []).find((x: any) => x.status === 'pending'); if (pend) setPendingReq({ id: pend.id }); setMsg(t.join_feedback); } catch (e: any) { setErr(e?.message || 'Falha'); }
  }
  async function submitCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    try { await api.createFamily(name.trim()); nav('/app', { replace: true }); } catch (e: any) { setErr(e?.message || 'Falha'); }
  }

  return (
    <div className="container auto-s-1029" >
      <h1 className="title">{t.choose}</h1>

      {pendingReq ? (
        <div className="card auto-s-1030" >
          <div  className="auto-s-1031">Pedido de entrada pendente. Aguarde aprovação.</div>
          {err && <div role="alert" className="error" aria-live="assertive">{err}</div>}
          <div className="actions auto-s-1032" >
            <button onClick={async () => { try { if (pendingReq) { await api.cancelJoinRequest(pendingReq.id); setPendingReq(null); } } catch (e: any) { setErr(e?.message || 'Falha'); } }}>Cancelar solicitação</button>
            <button className="primary" onClick={async () => { try { await logout(); nav('/login', { replace: true }); } catch (e: any) { setErr(e?.message || 'Falha'); } }}>Sair</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row" role="tablist" aria-label={t.choose}>
            <button role="tab" aria-selected={tab==='join'} onClick={()=>setTab('join')}>{t.join_tab}</button>
            <button role="tab" aria-selected={tab==='create'} onClick={()=>setTab('create')}>{t.create_tab}</button>
          </div>

          <div className="card auto-s-1033" >
            {tab === 'join' ? (
              <form onSubmit={submitJoin}>
                <div className="field"><label htmlFor="family_slug">{t.family_slug}</label><input id="family_slug" required value={slug} onChange={(e)=>setSlug(e.target.value)} /></div>
                {err && <div role="alert" className="error" aria-live="assertive">{err}</div>}
                {msg && <div aria-live="polite">{msg}</div>}
                <div className="actions auto-s-1034" >
                  <button className="primary">{t.join_submit}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitCreate}>
                <div className="field"><label htmlFor="family_name">{t.family_name}</label><input id="family_name" required value={name} onChange={(e)=>setName(e.target.value)} /></div>
                {err && <div role="alert" className="error" aria-live="assertive">{err}</div>}
                <div className="actions auto-s-1035" >
                  <button className="primary">{t.create_submit}</button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

