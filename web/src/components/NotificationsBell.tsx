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
      <button aria-label="Avisos" className="btn-icon auto-s-1003" onClick={() => setOpen((v) => !v)} >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 22a2 2 0 001.995-1.85L14 20h-4a2 2 0 001.85 1.995L12 22zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/>
        </svg>
        {badge > 0 && <span className="notif-badge" aria-label={`${badge} pendentes`}>{badge}</span>}
      </button>
      {open && (
        <div className="dropdown-panel auto-s-1004" role="dialog" aria-label="Avisos" >
          <div className="col">
            {joinList.length > 0 && (
              <div className="row auto-s-2001" >
                <div>
                  <div  className="auto-s-1005">Solicitações de entrada</div>
                  <div className="muted auto-s-1006" >{joinList.length} pendente(s) para aprovar</div>
                </div>
              </div>
            )}
            {joinList.map((jr) => (
              <div key={jr.id} className="row auto-s-1007" >
                <div  className="auto-s-1008">
                  <div  className="auto-s-1009">{jr.username || 'Solicitante'}</div>
                  {jr.created_at && <div className="muted auto-s-1010" >{new Date(jr.created_at).toLocaleString()}</div>}
                </div>
                <div className="row auto-s-1011" >
                  <button onClick={() => decide(jr.id, 'reject')}>Rejeitar</button>
                  <button className="primary" onClick={() => decide(jr.id, 'approve')}>Aprovar</button>
                </div>
              </div>
            ))}
            {items.length === 0 ? <div className="muted">Sem avisos</div> : items.map((n) => (
              <div key={n.id} className="row auto-s-1012" >
                <div>
                  <div  className="auto-s-1013">{n.title}</div>
                  {n.body && <div className="muted auto-s-1014" >{n.body}</div>}
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
