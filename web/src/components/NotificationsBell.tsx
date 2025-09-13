import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Props = { familyId?: string };
type JoinReq = { id: string; username?: string; created_at?: string };

export default function NotificationsBell({ familyId }: Props) {
  const [items, setItems] = useState<Array<{ id: string; type: string; title: string; body?: string; created_at: string; read_at?: string }>>([]);
  const [open, setOpen] = useState(false);
  const [joinList, setJoinList] = useState<JoinReq[]>([]);

  async function refresh() {
    try { const r = await api.notifications(); setItems(r); } catch { setItems([]); }
    if (familyId) {
      try { const list = await api.ownerPendingJoinRequests(familyId); setJoinList(Array.isArray(list) ? list : []); } catch { setJoinList([]); }
    } else { setJoinList([]); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [familyId]);

  const unread = items.filter(i => !i.read_at).length;
  const badge = unread + (joinList.length || 0);

  async function markRead(id: string) { try { await api.markNotificationRead(id); setItems((arr)=>arr.map(i=>i.id===id?{...i, read_at: new Date().toISOString()}:i)); } catch {} }
  async function decide(id: string, kind: 'approve' | 'reject') {
    try { if (kind==='approve') await api.approveJoinRequest(id); else await api.rejectJoinRequest(id); setJoinList((arr)=>arr.filter(x=>x.id!==id)); } catch (e:any){ alert(e?.message || 'Falha'); }
  }

  return (
    <div className="dropdown" aria-haspopup="true">
      <button aria-label="Avisos" className="btn-icon" onClick={() => setOpen((v) => !v)} style={{ position:'relative' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 22a2 2 0 001.995-1.85L14 20h-4a2 2 0 001.85 1.995L12 22zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/>
        </svg>
        {badge > 0 && <span className="notif-badge" aria-label={`${badge} pendentes`}>{badge}</span>}
      </button>
      {open && (
        <div className="dropdown-panel" role="dialog" aria-label="Avisos" style={{ right: 0, left: 'auto', width: 320, minWidth: 280, maxWidth: 'none', padding: 8, boxSizing: 'border-box', overflow: 'hidden' }}>
          <div className="col">
            {joinList.length > 0 && (
              <div className="row" style={{ justifyContent:'space-between', borderBottom:'1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Solicitações de entrada</div>
                  <div className="muted" style={{ fontSize: '.9rem' }}>{joinList.length} pendente(s) para aprovar</div>
                </div>
              </div>
            )}
            {joinList.map((jr) => (
              <div key={jr.id} className="row" style={{ justifyContent:'space-between', alignItems:'center', gap: 8, padding: '.25rem 0', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 140px', overflow: 'hidden' }}>
                  <div style={{ fontWeight: 500 }}>{jr.username || 'Solicitante'}</div>
                  {jr.created_at && <div className="muted" style={{ fontSize: '.8rem' }}>{new Date(jr.created_at).toLocaleString()}</div>}
                </div>
                <div className="row" style={{ gap: 6, flex: '0 0 auto' }}>
                  <button onClick={() => decide(jr.id, 'reject')}>Rejeitar</button>
                  <button className="primary" onClick={() => decide(jr.id, 'approve')}>Aprovar</button>
                </div>
              </div>
            ))}
            {items.length === 0 ? <div className="muted">Sem avisos</div> : items.map((n) => (
              <div key={n.id} className="row" style={{ justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  {n.body && <div className="muted" style={{ fontSize: '.9rem' }}>{n.body}</div>}
                </div>
                {!n.read_at && <button onClick={() => markRead(n.id)}>Marcar como lido</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
