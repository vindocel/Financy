import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function MemberExitModal({ familyId }: { familyId: string }) {
  const [item, setItem] = useState<{ exit_id: string; user_id: string; user_name: string } | null>(null);

  async function check() {
    try {
      const list = await api.pendingMemberExits(familyId);
      setItem(list && list.length ? list[0] : null);
    } catch {}
  }
  useEffect(() => { check(); }, [familyId]);

  async function act(kind: 'keep' | 'delete') {
    if (!item) return;
    try {
      if (kind === 'keep') await api.keepMemberExit(familyId, item.exit_id);
      else await api.deleteMemberExit(familyId, item.exit_id);
      setItem(null);
      alert('Decisão registrada com sucesso');
    } catch (e: any) { alert(e?.message || 'Falha'); }
  }

  if (!item) return null;
  return (
    <dialog open>
      <div className="card modal">
        <h3  className="auto-s-1001">Saída de membro</h3>
        <p>Há uma saída pendente: {item.user_name}. Decida o que fazer com as compras do membro.</p>
        <div className="actions auto-s-1002" >
          <button onClick={() => act('keep')}>Manter histórico</button>
          <button className="primary" onClick={() => act('delete')}>Excluir</button>
        </div>
      </div>
    </dialog>
  );
}

