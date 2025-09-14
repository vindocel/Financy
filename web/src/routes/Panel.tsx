import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import pt from '@/i18n/pt.json';
import { api, buildUsersQueryParam } from '@/lib/api';
import { lsGet, lsSet } from '@/lib/storage';
import { useAuth } from '@/lib/auth';
import UserMultiSelect from '@/components/UserMultiSelect';
import NotificationsBell from '@/components/NotificationsBell';
import { MTP_OPTIONS } from '@/constants/mtp';
import TagMultiSelect from '@/components/TagMultiSelect';
import MemberExitModal from '@/components/MemberExitModal';

type Filters = {
  month: string;
  tags: string[];
  mtp?: string;
  users: string[];
  allActiveSelected: boolean;
  excludedIds: string[];
};

type PurchaseItem = { name: string; qty: string | number; total: string | number };

type PurchaseForm = {
  estabelecimento: string;
  emissao: string;
  total: string;
  discount: string;
  items: PurchaseItem[];
  tags: string[];
  mtp: string;
  pagamento_tipo: 'avista' | 'parcelado';
  pagamento_parcelas: number;
};

type AnyObj = Record<string, any>;

function brl(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  const val = isNaN(v as number) ? 0 : (v as number);
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dmy(d: string | Date | undefined | null) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
const normalize = (s: any) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const parseMoney = (s:any) => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s).trim();
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && !hasDot) return Number(str.replace(/\./g,'').replace(',','.')) || 0; // pt-BR
  if (hasDot && !hasComma) return Number(str) || 0;                                   // en-US
  return Number(str.replace(/\./g,'').replace(',','.')) || 0; // ambos → assume pt-BR
};
const round2 = (n:number) => Math.round(n*100)/100;
const parseQty = (s:any) => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const n = String(s).replace(',', '.');
  const v = Number(n);
  return isNaN(v) ? 0 : v;
};

/* === NOVO: helpers para chips === */
function tagStyle(color?: string): React.CSSProperties {
  return color ? ({ ['--tag' as any]: color } as React.CSSProperties) : {};
}
const MTP_COLOR: Record<string, string> = {
  credito:  '#1d4ed8',
  debito:   '#0f766e',
  dinheiro: '#065f46',
  pix:      '#365314',
  ticket:   '#7c2d12',
};
const mtpColor = (v?: string) =>
  MTP_COLOR[normalize(v||'')] || '#4b5563';
/* === FIM helpers === */

export default function Panel() {
  const t = pt.panel; const nav = useNavigate();
  const { user, logout } = useAuth();

  const [family, setFamily] = useState<{ id: string; slug: string; name: string; role?: string } | null>(null);

  const [filters, setFilters] = useState<Filters>(() =>
    lsGet<Filters>('filters:__tmp__', {
      month: new Date().toISOString().slice(0,7),
      tags: [] as string[],
      mtp: 'all',
      users: [],
      allActiveSelected: true,
      excludedIds: []
    })
  );

  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [gate, setGate] = useState<
    | { mode: 'none' }
    | { mode: 'create_or_join' }
    | { mode: 'pending_admin'; familyId: string; name?: string }
    | { mode: 'pending_owner'; joinId: string; familyId: string; name?: string }
  >({ mode: 'create_or_join' });

  // criação
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<PurchaseForm>({
    estabelecimento: '',
    emissao: new Date().toISOString().slice(0,16),
    total: '',
    discount: '',
    items: [{ name: '', qty: '1', total: '' }],
    tags: [] as string[],
    mtp: 'Dinheiro',
    pagamento_tipo: 'avista',
    pagamento_parcelas: 1,
  });
  const [touchedTotal, setTouchedTotal] = useState(false);

  useEffect(() => {
    if (!touchedTotal) {
      const sumItems = (form.items || []).reduce((acc:any, it:any)=> acc + parseMoney(it.total||0), 0);
      const total = round2(sumItems - parseMoney(form.discount||0));
      if (!isNaN(total)) setForm(f=>({...f, total: String(total)}));
    }
  }, [JSON.stringify(form.items), form.discount, touchedTotal]);

  useEffect(() => {
    const isCredito = normalize(form.mtp).includes('credito');
    if (!isCredito && (form.pagamento_tipo !== 'avista' || form.pagamento_parcelas !== 1)) {
      setForm(f => ({ ...f, pagamento_tipo: 'avista', pagamento_parcelas: 1 }));
    }
  }, [form.mtp]);

  // Perfil/Config
  const [profile, setProfile] = useState<{ display_name: string; email: string }>({ display_name: '', email: '' });
  const [profileTab, setProfileTab] = useState<'perfil'|'seg'|'tags'|'familia'>('perfil');
  const [showFamilyId, setShowFamilyId] = useState(false);
  const [members, setMembers] = useState<Array<{ id: string; display_name: string; role: string; is_active: boolean }>>([]);
  const [myId, setMyId] = useState<string>(''); // <- guardar meu ID

  // novo: controla abertura do modal de configurações
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        const myId = (me as any).id ?? (me as any).user_id ?? (me as any).userId ?? '';
        setMyId(String(myId));
        if (me.access && !me.access.allowed) {
          if (me.access.waiting === 'admin_approval' && me.access.family?.id) {
            setGate({ mode: 'pending_admin', familyId: me.access.family.id, name: me.access.family.name });
          } else if (me.access.waiting === 'owner_approval') {
            try {
              const mine = await api.mineJoinRequests();
              const pend = (mine || []).find((x: any) => x.status === 'pending');
              if (pend) setGate({ mode: 'pending_owner', joinId: pend.id, familyId: pend.family_id, name: pend.name });
              else setGate({ mode: 'create_or_join' });
            } catch { setGate({ mode: 'create_or_join' }); }
          } else {
            setGate({ mode: 'create_or_join' });
          }
          setFamily(null);
          return;
        }
        const fam = await api.familiesMine();
        if (!fam) { setGate({ mode: 'create_or_join' }); return; }
        setGate({ mode: 'none' });
        setFamily({ ...fam, role: fam.role || me.access?.family?.role });
        setProfile({ display_name: me.displayName || '', email: me.email || '' });

        // carrega filtros salvos por família
        const saved = lsGet<Filters>(`filters:${fam.id}`, {
          month: new Date().toISOString().slice(0,7),
          tags: [],
          mtp: 'all',
          users: [],
          allActiveSelected: true,
          excludedIds: []
        });
        setFilters(saved);
      } catch {
        nav('/login', { replace: true });
      }
    })().catch(()=>{});
  }, [nav]);

  // membros (quando abre aba família)
  useEffect(() => {
    (async () => {
      if (profileTab !== 'familia' || !family?.id) return;
      try { setMembers(await api.listMembers(family.id, true)); } catch {}
    })();
  }, [profileTab, family?.id]);

  const usersParam = useMemo(
    () => buildUsersQueryParam(filters.allActiveSelected, new Set(filters.excludedIds), [], filters.users),
    [filters]
  );

  async function reload() {
    if (!family) return; setLoading(true);
    try {
      const q: any = { month: filters.month };
      if (usersParam) q['users[]'] = usersParam;
      else if (filters.allActiveSelected && (filters.excludedIds?.length || 0) === 0) q.user = 'all';
      if (filters.tags?.length) q['tags[]'] = filters.tags;
      if (filters.mtp && filters.mtp !== 'all') q.mtp = filters.mtp;
      const r = await api.listPurchases(q);
      setPurchases(r.purchases || []);
    } catch {} finally { setLoading(false); }
  }

  // >>> dinâmico: salva filtros e recarrega sempre que mudar
  useEffect(() => {
    if (!family?.id) return;
    lsSet(`filters:${family.id}`, filters);
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    family?.id,
    filters.month,
    filters.mtp,
    JSON.stringify(filters.users),
    JSON.stringify(filters.tags),
    filters.allActiveSelected,
    JSON.stringify(filters.excludedIds),
  ]);

  // ===== Abas Parcelas / Compras
  const [tabView, setTabView] = useState<'parcelas'|'compras'>('parcelas');
  const [asCards, setAsCards] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  const parcelas = useMemo(() => {
    return (purchases || []).map((p:any) => {
      const usuario = p.user_name || p.usuario || p.created_by_name || p.created_by || p.createdBy || '';
      const estabelecimento = p.estabelecimento || p.store || p.merchant || '—';
      const idx = p.installment_idx ?? p.n ?? 1;
      const count = p.installment_count ?? p.pagamento_parcelas ?? 1;
      const valor = p.total_month ?? p.amount ?? p.valor ?? p.total ?? 0;
      const data = p.vencimento || p.emissao || p.due_date || p.date || p.created_at;
      return {
        id: p.row_key || `${p.id || p.purchase_id}#${idx}`,
        date: data,
        estabelecimento,
        parcela: `${idx}/${count}`,
        valor: Number(valor),
        usuario,
      };
    });
  }, [purchases]);

  const compras = useMemo(() => {
    const byId = new Map<string, AnyObj>();
    (purchases || []).forEach((r:AnyObj) => {
      const id = String(r.id || r.purchase_id || r.row_key || Math.random());
      const cur = byId.get(id) || {
        id,
        estabelecimento: r.estabelecimento || r.store || '—',
        emissao: r.emissao || r.vencimento || r.created_at,
        createdBy: r.createdBy || r.created_by || r.created_by_name || r.user_name || r.username || r.usuario || '',
        createdByUserId: r.created_by_user_id || r.createdByUserId || r.user_id || r.userId || '',
        total: 0,
        discount: 0,
        tags: r.tags || [],
        mtp: r.mtp || '',
        pagamento_tipo: r.pagamento_tipo || (r.pagamento_parcelas && r.pagamento_parcelas > 1 ? 'parcelado' : 'avista'),
        pagamento_parcelas: r.pagamento_parcelas || r.installment_count || 1,
        items: r.items || [],
      };
      const parcelaVal = Number(r.total_month ?? r.amount ?? 0);
      cur.total = Math.round(((cur.total || 0) + (isNaN(parcelaVal) ? 0 : parcelaVal)) * 100) / 100;
      if (!cur.emissao) cur.emissao = r.emissao || r.vencimento;
      if (!cur.tags?.length && r.tags?.length) cur.tags = r.tags;
      if (!cur.items?.length && r.items?.length) cur.items = r.items;
      if (typeof r.discount !== 'undefined') { const d = Number(r.discount); if (!isNaN(d)) cur.discount = d; }
      byId.set(id, cur);
    });
    return Array.from(byId.values());
  }, [purchases]);

  // ===== UI
  return (
    <div>
<header className="header">
  <div className="title">{family?.name || 'Família'}</div>
  <div className="menu">
    {family && <NotificationsBell familyId={family.id} />}
    {family && (
      <button
        aria-label="Configurações"
        title="Configurações"
        onClick={() => setShowProfile(true)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.032 7.032 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.7 8.84a.5.5 0 00.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.04.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.23 1.13-.54 1.63-.94l2.39.96c.21.09.47 0 .6-.22l1.92-3.32a.5.5 0 00.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"/>
        </svg>
      </button>
    )}
    <button onClick={() => logout().then(() => nav('/login', { replace: true }))}>
      Sair
    </button>
  </div>
</header>

      {family && family.role === 'owner' && <MemberExitModal familyId={family.id} />}

      <div className="container">

        {showProfile && (
          <dialog open>
            <div className="card modal">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Configurações</h3>
                <button onClick={() => setShowProfile(false)}>Fechar</button>
              </div>

              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button aria-selected={profileTab==='perfil'} onClick={()=>setProfileTab('perfil')}>Perfil</button>
                <button aria-selected={profileTab==='seg'} onClick={()=>setProfileTab('seg')}>Segurança</button>
                <button aria-selected={profileTab==='tags'} onClick={()=>setProfileTab('tags')}>Tags</button>
                <button aria-selected={profileTab==='familia'} onClick={()=>setProfileTab('familia')}>Família</button>
              </div>

              {profileTab === 'perfil' && (
                <div className="col" style={{ gap: 8, marginTop: 12 }}>
                  <div className="field"><label>Nome</label><input value={profile.display_name} readOnly /></div>
                  <div className="field"><label>E-mail</label><input value={profile.email} readOnly /></div>
                </div>
              )}

              {profileTab === 'seg' && (
                <div style={{ marginTop: 12 }}>
                  <SegurancaForm onDone={() => setShowProfile(false)} />
                </div>
              )}

              {profileTab === 'tags' && family && (
                <div style={{ marginTop: 12 }}>
                  <TagsManager familyId={family.id} canDelete={(family.role || '') === 'owner'} />
                </div>
              )}

          {profileTab === 'familia' && family && (
            <div className="col" style={{ gap: 12, marginTop: 12 }}>
              <div className="field">
                <label>Nome da família</label>
                <input value={family.name} readOnly />
              </div>

              <div className="field">
                <label>ID da família</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showFamilyId ? 'text' : 'password'}
                    value={family.id}
                    readOnly
                    style={{ paddingRight: 72 }} // espaço para os 2 botões
                  />

                  {/* Ver/Ocultar */}
                  <button
                    type="button"
                    className="icon-btn"
                    title={showFamilyId ? 'Ocultar' : 'Ver'}
                    aria-label={showFamilyId ? 'Ocultar' : 'Ver'}
                    onClick={() => setShowFamilyId(v => !v)}
                    style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      {showFamilyId ? (
                        // eye-off
                        <path d="M2.1 3.5L20.5 21.9l-1.4 1.4-3.1-3.1A12.3 12.3 0 0 1 12 21C6.1 21 1.7 16.7.3 12c.6-1.8 1.7-3.6 3.1-5.1L.7 4.9l1.4-1.4zm7 6.9l2.5 2.5a3.5 3.5 0 0 1-2.5-2.5zm3.8 1.4l-3.2-3.2a3.5 3.5 0 0 1 3.2 3.2zM12 5c5.9 0 10.3 4.3 11.7 9-1 3.1-3.2 5.8-6.1 7.3l-1.6-1.6C19.1 18.6 21 15.7 21.7 12 20.3 7.7 16.5 5 12 5c-1.1 0-2.1.1-3 .4L7.4 3.8A13.1 13.1 0 0 1 12 5z"/>
                      ) : (
                        // eye
                        <path d="M12 5c6.2 0 10.6 4.6 11.8 7-1.2 2.4-5.6 7-11.8 7S1.4 14.4.2 12C1.4 9.6 5.8 5 12 5zm0 2C7.7 7 4.3 9.9 3 12c1.3 2.1 4.7 5 9 5s7.7-2.9 9-5c-1.3-2.1-4.7-5-9-5zm0 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"/>
                      )}
                    </svg>
                  </button>

                  {/* Copiar */}
                  <button
                    type="button"
                    className="icon-btn"
                    title="Copiar"
                    aria-label="Copiar"
                    onClick={() => navigator.clipboard?.writeText(family.id)}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1zm3 4H9a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H9V7h10v14z"/>
                    </svg>
                  </button>
                </div>
              </div>


              <div className="field">
                <label>Membros ({members.length})</label>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle:'none', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                  {members.map(m => {
                    const role = String(m.role || '').toLowerCase();
                    const isOwner = role === 'owner';
                    const iAmOwner = String(family.role || '').toLowerCase() === 'owner';
                    const canKick = iAmOwner && !isOwner && m.id !== myId;
                    return (
                      <li key={m.id} style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', padding:'.7rem .8rem', borderTop:'1px solid var(--border)' }}>
                        <div>
                          <span style={{ fontWeight:500 }}>{m.display_name}</span>{' '}
                          {m.role ? <span className="muted">({m.role})</span> : null}
                        </div>
                        {canKick && (
                          <button
                            className="icon-btn"
                            onClick={async () => {
                              if (!confirm(`Remover ${m.display_name} da família?`)) return;
                              try {
                                await api.removeMember(family.id, m.id); // ajuste se o nome do endpoint for diferente
                                setMembers(await api.listMembers(family.id, true));
                              } catch (e:any) {
                                alert(e?.message || 'Falha ao remover membro');
                              }
                            }}
                            title="Expulsar"
                          >
                            Expulsar
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

            </div>
          </dialog>
        )}

        {/* GATES */}
        {gate.mode === 'create_or_join' && (
          <dialog open>
            <div className="card modal">
              <h3 style={{ marginTop: 0 }}>Criar ou entrar em uma família</h3>
              <CreateOrJoin
                onCreatePending={(fam)=> setGate({ mode: 'pending_admin', familyId: fam.id, name: fam.name })}
                onJoinPending={(jr)=> setGate({ mode: 'pending_owner', joinId: jr.id, familyId: jr.family_id, name: jr.name })}
              />
            </div>
          </dialog>
        )}
        {gate.mode === 'pending_admin' && (
          <dialog open>
            <div className="card modal">
              <h3 style={{ marginTop: 0 }}>Sua família está em análise</h3>
              <p>Aguarde aprovação do administrador para acessar o painel.</p>
              <div className="actions" style={{ justifyContent:'flex-end' }}>
                <button onClick={async()=>{ if (!confirm('Cancelar criação da família?')) return;
                  try { await api.cancelFamily(gate.familyId); setGate({ mode: 'create_or_join' }); } catch (e:any) { alert(e?.message||'Falha'); } }}>
                  Cancelar criação
                </button>
                <button onClick={()=> logout().then(()=>nav('/login',{replace:true}))}>Sair</button>
              </div>
            </div>
          </dialog>
        )}
        {gate.mode === 'pending_owner' && (
          <dialog open>
            <div className="card modal">
              <h3 style={{ marginTop: 0 }}>Aguardando aprovação do dono</h3>
              <p>Sua solicitação de entrada {gate.name ? `para "${gate.name}" `: ''}está pendente.</p>
              <div className="actions" style={{ justifyContent:'flex-end' }}>
                <button onClick={async()=>{ try { await api.cancelJoinRequest(gate.joinId); setGate({ mode: 'create_or_join' }); } catch (e:any) { alert(e?.message||'Falha'); } }}>
                  Cancelar solicitação
                </button>
                <button onClick={()=> logout().then(()=>nav('/login',{replace:true}))}>Sair</button>
              </div>
            </div>
          </dialog>
        )}

        {/* ===== PAINEL ===== */}
        {gate.mode === 'none' && (
          <>
            {/* FILTROS (dinâmicos) */}
            <section className="card filters">
              <div className="grid cols-3">
                <div className="field">
                  <label htmlFor="month">{t.month}</label>
                  <input
                    id="month"
                    type="month"
                    value={filters.month}
                    onChange={(e)=>setFilters((f)=>({ ...f, month: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label>{t.users}</label>
                  {family && (
                    <UserMultiSelect
                      familyId={family.id}
                      value={filters.users}
                      onChange={(ids: string[])=>setFilters((f)=>({ ...f, users: ids }))}
                      onModeChange={(m: { allActiveSelected: boolean; excludedIds: string[] }) =>
                        setFilters((f)=> ({ ...f, allActiveSelected: m.allActiveSelected, excludedIds: m.excludedIds }))
                      }
                    />
                  )}
                </div>

                <div className="field">
                  <label>Tags</label>
                  {family && (
                    <TagMultiSelect
                      familyId={family.id}
                      value={filters.tags || []}
                      onChange={(ids)=> setFilters((f)=>({ ...f, tags: ids }))}
                      placeholder="Filtrar por tags…"
                    />
                  )}
                </div>
              </div>

              <div className="grid cols-3" style={{ alignItems:'end' }}>
                <div className="field">
                  <label htmlFor="mtp">MtP</label>
                  <select
                    id="mtp"
                    value={filters.mtp || 'all'}
                    onChange={(e) => setFilters(f => ({ ...f, mtp: e.target.value }))}
                  >
                    <option value="all">Todos</option>
                    {MTP_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>

                <div className="field"></div>

                <div className="actions" style={{ justifyContent:'flex-end' }}>
                  <button className="primary" onClick={()=> setShowCreate(true)}>+ Nova compra</button>
                </div>
              </div>
            </section>

            {/* ABAS PARCELAS / COMPRAS (sem título “Resumo”) */}
            <ResumoSection
              loading={loading}
              tabView={tabView}
              setTabView={setTabView}
              asCards={asCards}
              setAsCards={setAsCards}
              parcelas={parcelas}
              compras={compras}
              onOpenDetail={(c)=> setDetail(c)}
            />

            {/* MODAL DETALHES */}
            {detail && (
              <dialog open onClose={()=> setDetail(null)}>
                <div className="card modal">
                  <h3 style={{ marginTop: 0 }}>{detail.estabelecimento}</h3>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    {dmy(detail.emissao)} — {detail.pagamento_tipo === 'parcelado' ? `parcelado (${detail.pagamento_parcelas}x)` : 'à vista'} — Total {brl(detail.total)}
                  </div>
                  <table className="table">
                    <thead>
                      <tr><th>Item</th><th>Qtd</th><th>Valor</th></tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).map((it:any, i:number) => (
                        <tr key={i}>
                          <td>{it.name}</td>
                          <td style={{ textAlign: 'center' }}>{it.qty ?? 1}</td>
                          <td className="num">{brl(it.total)}</td>
                        </tr>
                      ))}
                      {(detail.items || []).length === 0 && (
                        <tr><td colSpan={3} style={{ textAlign: 'center', padding: 12 }}>Itens indisponíveis.</td></tr>
                      )}
                      {Math.abs(Number(detail.discount || 0)) > 0 && (
                        <tr>
                          <td colSpan={2} style={{ textAlign: 'right' }}>Desconto R$:</td>
                          <td className="num">-{brl(Math.abs(Number(detail.discount || 0)))}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    {(family?.role === 'owner' || String(detail.createdBy || '') === String(user?.username || '') || String(detail.createdByUserId || '') === String(myId || '')) && (
                      <button
                        onClick={async ()=>{
                          if (!confirm('Excluir esta compra? Esta ação não pode ser desfeita.')) return;
                          try {
                            await api.deletePurchase(detail.id);
                            setDetail(null);
                            reload();
                          } catch (e:any) {
                            alert(e?.message || 'Falha ao excluir');
                          }
                        }}
                      >
                        Excluir
                      </button>
                    )}
                    <button onClick={()=> setDetail(null)}>Fechar</button>
                  </div>
                </div>
              </dialog>
            )}

            {/* MODAL CRIAR COMPRA */}
            {showCreate && (
              <dialog open>
                <div className="card modal">
                  <h3 style={{ marginTop: 0 }}>Adicionar compra</h3>

                  <div className="field">
                    <label>Estabelecimento</label>
                    <input value={form.estabelecimento} onChange={(e)=> setForm(f=>({ ...f, estabelecimento: e.target.value }))}/>
                  </div>

                  <div className="field">
                    <label>Data e hora da compra</label>
                    <input type="datetime-local" value={form.emissao} onChange={(e)=> setForm(f=>({ ...f, emissao: e.target.value }))}/>
                  </div>

                  <div className="field" style={{ alignSelf:'start', marginTop: 8 }}>
                    <div className="row items-header">
                      <label style={{ margin: 0 }}>Itens</label>
                      <div className="row" style={{ gap: 8 }}>
                        <button type="button" onClick={()=> setForm(f => ({ ...f, items: [...(f.items||[]), { name:'', qty:'1', total:'' }] }))}>
                          + Item
                        </button>
                      </div>
                    </div>

                    <div className="col" style={{ gap: 8 }}>
                      {(form.items || []).map((it: any, idx: number) => (
                        <div key={idx} className="row item-row">
                          <input placeholder="Nome do item" className="item-name" value={it.name}
                            onChange={(e) => setForm(f => { const items=[...(f.items||[])]; items[idx]={...items[idx], name:e.target.value}; return { ...f, items }; })}/>
                          <input inputMode="decimal" placeholder="1" className="item-qty" value={it.qty}
                            onChange={(e) => setForm(f => { const items=[...(f.items||[])]; items[idx]={...items[idx], qty:e.target.value}; return { ...f, items }; })}/>
                          <input inputMode="decimal" placeholder="0" className="item-price" value={it.total}
                            onChange={(e) => setForm(f => { const items=[...(f.items||[])]; items[idx]={...items[idx], total:e.target.value}; return { ...f, items }; })}/>
                          <button type="button" onClick={() => setForm(f => { const items=[...(f.items||[])]; items.splice(idx,1); return { ...f, items: items.length?items:[{name:'',qty:'1',total:''}] }; })}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid cols-2" style={{ marginTop: 8 }}>
                    <div className="field">
                      <label>Desconto (R$)</label>
                      <input inputMode="decimal" value={form.discount} onChange={(e) => setForm(f => ({ ...f, discount: e.target.value }))}/>
                    </div>
                    <div className="field">
                      <label>Total (R$)</label>
                      <input inputMode="decimal" value={form.total} onChange={(e)=> { setTouchedTotal(true); setForm(f=>({...f, total: e.target.value})) }}/>
                    </div>
                  </div>

                  <div className="grid cols-2">
                    <div className="field">
                      <label>Tags</label>
                      {family && (
                        <TagMultiSelect familyId={family.id} value={form.tags} onChange={(ids)=> setForm(f => ({ ...f, tags: ids }))} placeholder="Selecione as tags…"/>
                      )}
                    </div>
                    <div className="field">
                      <label>MtP</label>
                      <select required value={form.mtp || 'Dinheiro'} onChange={(e) => setForm(f => ({ ...f, mtp: e.target.value }))}>
                        {MTP_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                  </div>

                  {normalize(form.mtp).includes('credito') && (
                    <div className="grid cols-3" style={{ marginTop: 8 }}>
                      <div className="field" style={{ gridColumn: '1 / -1' }}>
                        <label>Pagamento</label>
                        <select value={form.pagamento_tipo} onChange={(e) => setForm(f => ({
                          ...f,
                          pagamento_tipo: (e.target.value as 'avista' | 'parcelado'),
                          pagamento_parcelas: e.target.value === 'parcelado' ? Math.max(2, Number(f.pagamento_parcelas || 2)) : 1,
                        }))}>
                          <option value="avista">À vista (1x)</option>
                          <option value="parcelado">Parcelado</option>
                        </select>
                      </div>
                      {form.pagamento_tipo === 'parcelado' && (
                        <div className="field" style={{ gridColumn: '1 / -1' }}>
                          <label>Parcelas</label>
                          <input type="number" min={2} max={36} value={form.pagamento_parcelas || 2}
                            onChange={(e) => setForm(f => ({ ...f, pagamento_parcelas: Math.max(2, Number(e.target.value || 2)) }))}/>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="actions" style={{ justifyContent:'flex-end' }}>
                    <button onClick={()=> setShowCreate(false)}>Cancelar</button>
                    <button className="primary" onClick={async ()=>{
                      try {
                        if (!Number(form.total) || Number(form.total) <= 0) { alert('Valor inválido'); return; }
                        if (filters.month && !String(form.emissao).startsWith(filters.month)) {
                          alert('Data fora do mês selecionado'); return;
                        }
                        const isCredito = normalize(form.mtp).includes('credito');
                        await api.createPurchase({
                          estabelecimento: form.estabelecimento,
                          emissao: new Date(form.emissao).toISOString(),
                          discount: parseMoney(form.discount),
                          total: parseMoney(form.total),
                          items: (form.items||[]).map((it:any)=> ({ name: it.name||'Item', qty: parseQty(it.qty||1) || 1, total: parseMoney(it.total) })),
                          tags: form.tags || [],
                          mtp: form.mtp || undefined,
                          ...(isCredito
                            ? { pagamento_tipo: form.pagamento_tipo === 'parcelado' ? 'parcelado' : 'avista',
                                pagamento_parcelas: form.pagamento_tipo === 'parcelado' ? Math.max(1, Number(form.pagamento_parcelas || 1)) : 1 }
                            : { pagamento_tipo: 'avista', pagamento_parcelas: 1 }),
                        });
                        setShowCreate(false);
                        setForm({
                          estabelecimento: '',
                          emissao: new Date().toISOString().slice(0,16),
                          discount: '',
                          items: [{ name:'', qty:'1', total:'' }],
                          total: '',
                          tags: [],
                          mtp: 'Dinheiro',
                          pagamento_tipo: 'avista',
                          pagamento_parcelas: 1,
                        });
                        setTouchedTotal(false);
                        reload();
                      } catch (e:any) { alert(e?.message || 'Falha'); }
                    }}>Salvar</button>
                  </div>
                </div>
              </dialog>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ResumoSection({
  loading, tabView, setTabView, asCards, setAsCards,
  parcelas, compras, onOpenDetail
}: {
  loading: boolean;
  tabView: 'parcelas' | 'compras';
  setTabView: (t: 'parcelas' | 'compras') => void;
  asCards: boolean;
  setAsCards: React.Dispatch<React.SetStateAction<boolean>>;
  parcelas: any[];
  compras: any[];
  onOpenDetail: (c: any) => void;
}) {
  return (
    <section className="card">
      <div className="row" style={{ justifyContent:'space-between', alignItems:'center' }}>
        <div className="row" style={{ gap: 6 }}>
          <button role="tab" aria-selected={tabView==='parcelas'} onClick={()=>setTabView('parcelas')}>Parcelas</button>
          <button role="tab" aria-selected={tabView==='compras'} onClick={()=>setTabView('compras')}>Compras</button>
        </div>
        {tabView==='compras' && (
          <button type="button" className="chip" onClick={()=> setAsCards(v => !v)} aria-label={asCards?'Ver como lista':'Ver como cards'}>
            {asCards ? 'Lista' : 'Cards'}
          </button>
        )}
      </div>

      {loading && <div className="muted" style={{ padding: 12 }}>Carregando…</div>}

      {!loading && tabView==='parcelas' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Data</th><th>Estabelecimento</th><th>Parcela</th><th className="num">Valor</th><th>Usuário</th></tr>
            </thead>
            <tbody>
              {parcelas.map((p:any)=>(
                <tr key={p.id}>
                  <td>{dmy(p.date)}</td>
                  <td>{p.estabelecimento}</td>
                  <td>{p.parcela}</td>
                  <td className="num">{brl(p.valor)}</td>
                  <td>{p.usuario || '—'}</td>
                </tr>
              ))}
              {parcelas.length===0 && <tr><td colSpan={5} style={{textAlign:'center',padding:12}}>Nenhuma parcela neste mês.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tabView==='compras' && (
        !asCards ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Emissão</th><th>Estabelecimento</th><th>Tag</th><th>MtP</th><th className="num">Total</th><th>Pagto</th></tr>
              </thead>
              <tbody>
                {compras.map((c:any)=>(
                  <tr key={c.id} style={{cursor:'pointer'}} onClick={()=> onOpenDetail(c)}>
                    <td>{dmy(c.emissao)}</td>
                    <td>{c.estabelecimento}</td>
                    <td>
                      {(c.tags||[]).length
                        ? (c.tags||[]).map((t:any)=>(
                            <span key={(t.id||t.name||t)} className="tag-pill" style={tagStyle(t.color)}>{t.name||t}</span>
                          ))
                        : '—'}
                    </td>
                    <td>
                      <span className="tag-pill" style={tagStyle(mtpColor(c.mtp))}>{c.mtp || '—'}</span>
                    </td>
                    <td className="num">{brl(c.total)}</td>
                    <td>{c.pagamento_tipo === 'parcelado' ? `parcelado (${c.pagamento_parcelas}x)` : 'à vista'}</td>
                  </tr>
                ))}
                {compras.length===0 && <tr><td colSpan={6} style={{textAlign:'center',padding:12}}>Nenhuma compra neste mês.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid cols-2" style={{ gap: 12 }}>
            {compras.map((c:any)=>(
              <div key={c.id} className="card" style={{cursor:'pointer'}} onClick={()=> onOpenDetail(c)}>
                <div className="row" style={{justifyContent:'space-between'}}><strong>{c.estabelecimento}</strong><strong>{brl(c.total)}</strong></div>
                <div className="row" style={{gap:8, marginTop:4}}>
                  <span className="tag-pill" style={tagStyle(mtpColor(c.mtp))}>{c.mtp}</span>
                  {(c.tags||[]).map((t:any)=>(
                    <span key={t.id||t} className="tag-pill" style={tagStyle(t.color)}>{t.name||t}</span>
                  ))}
                </div>
                <div className="muted" style={{marginTop:6}}>{dmy(c.emissao)} • {c.pagamento_tipo === 'parcelado' ? `parcelado (${c.pagamento_parcelas}x)` : 'à vista'}</div>
              </div>
            ))}
            {compras.length===0 && <div className="muted" style={{padding:12}}>Nenhuma compra neste mês.</div>}
          </div>
        )
      )}
    </section>
  );
}

function CreateOrJoin({ onCreatePending, onJoinPending }: { onCreatePending: (family: { id: string; name?: string }) => void; onJoinPending: (jr: { id: string; family_id: string; name?: string }) => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function doCreate() {
    try { setBusy(true); setErr(''); const r = await api.createFamily(name.trim()); onCreatePending({ id: (r as any).family?.id || (r as any).id, name }); }
    catch (e:any) { setErr(e?.message || 'Falha'); } finally { setBusy(false); }
  }
  async function doJoin() {
    try {
      setBusy(true); setErr('');
      const id = familyId.trim();
      await api.postJoinRequestById(id);
      try {
        const mine = await api.mineJoinRequests();
        const pend = (mine || []).find((x:any)=>x.status==='pending' && String(x.family_id)===String(id));
        if (pend) { onJoinPending({ id: pend.id, family_id: pend.family_id, name: pend.name }); return; }
      } catch {}
      onJoinPending({ id: 'pending', family_id: id });
    } catch (e:any) { setErr(e?.message || 'Falha'); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button aria-selected={tab==='create'} onClick={()=>setTab('create')}>Criar família</button>
        <button aria-selected={tab==='join'} onClick={()=>setTab('join')}>Entrar em família</button>
      </div>
      {tab==='create' ? (
        <div className="col" style={{ gap: 8 }}>
          <div className="field"><label>Nome da família</label><input value={name} onChange={(e)=>setName(e.target.value)} /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="actions" style={{ justifyContent:'flex-end' }}>
            <button className="primary" disabled={busy || !name.trim()} onClick={doCreate}>Criar</button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="field"><label>ID da família</label><input value={familyId} onChange={(e)=>setFamilyId(e.target.value)} /></div>
          {err && <div className="error" role="alert">{err}</div>}
          <div className="actions" style={{ justifyContent:'flex-end' }}>
            <button className="primary" disabled={busy || !familyId.trim()} onClick={doJoin}>Entrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======== Componentes auxiliares do modal de Configurações ======== */

function SegurancaForm({ onDone }: { onDone: ()=>void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="col">
      <div className="field"><label>Senha atual</label><input type="password" value={current} onChange={(e)=>setCurrent(e.target.value)} /></div>
      <div className="field"><label>Nova senha</label><input type="password" value={next} onChange={(e)=>setNext(e.target.value)} /></div>
      <div className="actions" style={{ justifyContent:'flex-end' }}>
        {/* Removido botão Fechar daqui para evitar duplicidade */}
        <button className="primary" disabled={busy || next.length < 4} onClick={async ()=>{
          setBusy(true);
          try { await api.changePassword(current, next); alert('Senha atualizada'); onDone(); }
          catch (e:any) { alert(e?.message || 'Falha'); }
          finally { setBusy(false); }
        }}>Salvar</button>
      </div>
    </div>
  );
}

function TagsManager({ familyId, canDelete }: { familyId: string; canDelete: boolean }) {
  const [tags, setTags] = useState<Array<{ id: string; name: string; color?: string; is_builtin?: boolean }>>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6B7280');
  const [hasPicked, setHasPicked] = useState(false);
  const colorRef = useRef<HTMLInputElement>(null);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setColor(v);
    if (!hasPicked) setHasPicked(true);
  };

  async function reload() { try { setTags(await api.listTags()); } catch {} }
  useEffect(()=>{ reload(); }, [familyId]);

  async function create() {
    if (!name.trim()) return;
    try {
      await api.createTag({ name: name.trim(), color: color || undefined });
      await reload();
      setName('');
      setColor('#6B7280');
      setHasPicked(false);
    } catch (e: any) {
      alert(e?.message || 'Falha');
    }
  }

  async function remove(id: string, builtin?: boolean) {
    if (!canDelete) return alert('Somente o dono pode excluir tags.');
    if (builtin) return alert('Não é possível excluir a tag fixa "Outros".');
    if (!confirm('Excluir esta tag? Compras que a tenham como única tag serão movidas para "Outros".')) return;
    try { await api.deleteTag(id); await reload(); }
    catch (e:any) { alert(e?.message || 'Falha'); }
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <div style={{ position:'relative', flex: 1 }}>
          <input
            placeholder="Nome da tag"
            value={name}
            onChange={(e)=> setName(e.target.value)}
            style={{ paddingRight: 44 }}
          />

          <button
            type="button"
            className={`color-dot-btn ${hasPicked ? '' : 'gradient'}`}
            aria-label="Escolher cor da tag"
            title="Cor"
            onClick={()=> colorRef.current?.click()}
            style={{
              position:'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              ...(hasPicked ? { background: color } : {})
            }}
          />

          <input
            ref={colorRef}
            type="color"
            value={color}
            onChange={handleColorChange}
            onInput={handleColorChange}
            style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}
            aria-hidden
            tabIndex={-1}
          />
        </div>

        <button className="primary" onClick={create}>Adicionar</button>
      </div>

      <div className="col" style={{ maxHeight: 260, overflowY:'auto', border:'1px solid var(--border)', borderRadius: 8, padding: 8 }}>
        {tags.map(t => (
          <div key={t.id} className="row" style={{ justifyContent:'space-between', padding: 6 }}>
            <div className="row" style={{ gap: 8, alignItems:'center' }}>
              <span className="dot" style={{ width:14, height:14, borderRadius: 999, background: t.color || 'var(--border)' }} />
              <strong>{t.name}</strong>{t.is_builtin && <span className="muted"> (fixa)</span>}
            </div>
            {canDelete && <button onClick={()=>remove(t.id, t.is_builtin)}>Excluir</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
